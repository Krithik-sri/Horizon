# Backend setup — Go realtime server (WebSocket hub)

> Goal: a single Go binary that holds one WebSocket per rider, groups them into rooms by join
> code, and broadcasts everyone's combined position back to the room ~4×/sec. This is the
> **spine** of Horizon — everything else (route, voice) is a view on this pipe.
>
> **This server owns ephemeral realtime only** — live positions, LiveKit tokens, and the ORS
> route proxy. Durable state (auth, ride history, journal, photos) belongs to Supabase, not this
> server — see `docs/ADR/ADR-008.md` for the split.
>
> **Phase 0 scope (this guide):** `GET /healthz`, `POST /rides` (mint a join code), and
> `GET /ws` (the location in/out pipe). The route proxy and voice-token endpoints are
> scaffolded as `501 Not Implemented` stubs — you fill them in Phase 2 / Phase 3.
>
> No paid accounts, no credit card. The only secrets (LiveKit, ORS) come later and live **only**
> here on the backend, never in the app.

---

## How to use this guide

Run commands from the **repo root** (`C:\Data\Projects\Horizon`) unless a step says otherwise.
Commands are PowerShell (your shell). Each numbered step ends with a ✅ checkpoint — don't move
on until it passes.

**Naming note:** this file is `docs/SETUP_BACKEND.md` (referenced by `CLAUDE.md` and `README.md`).
If you prefer `go-setup.md`, just rename it — nothing depends on the filename.

---

## 0. Install Go

Go isn't installed on this machine yet. Install it (no account, no card):

```powershell
winget install GoLang.Go
```

Close and reopen PowerShell so `PATH` picks up Go, then verify:

```powershell
go version    # expect go1.22 or newer (we use net/http method routing, added in 1.22)
```

✅ **Checkpoint:** `go version` prints `go1.22`+.

---

## 1. Create the module

```powershell
New-Item -ItemType Directory backend\internal\hub -Force | Out-Null
Set-Location backend
go mod init github.com/krithik/horizon/backend
go get github.com/gorilla/websocket@latest
Set-Location ..
```

> The module path doesn't need to resolve on the internet — it's just the import prefix. If you
> ever push this to GitHub under a different name, change it here and in the `import` lines.

✅ **Checkpoint:** `backend\go.mod` exists and lists `github.com/gorilla/websocket` under
`require`. `backend\go.sum` was created.

---

## 2. The connection — `backend/internal/hub/client.go`

One `Client` per WebSocket. The **read pump** parses `loc` messages and stamps the rider's
last-seen with the **server's** receive time (don't trust the phone's clock for staleness). The
**write pump** drains a buffered `send` channel and keeps the socket alive with pings.

```go
package hub

import (
	"encoding/json"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 1024
)

// locMsg is the client → server message (CLAUDE.md / docs/SYSTEM_DESIGN.md §6).
type locMsg struct {
	Type    string  `json:"type"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Heading float64 `json:"heading"`
	Speed   float64 `json:"speed"`
	Ts      int64   `json:"ts"`
}

type Client struct {
	room *Room
	conn *websocket.Conn
	send chan []byte
	id   string
	name string

	// Latest fix — guarded by room.mu.
	lat      float64
	lng      float64
	speed    float64
	lastSeen time.Time // server receive time; zero until the first loc arrives
}

func (c *Client) readPump() {
	defer func() {
		c.room.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		var m locMsg
		if err := json.Unmarshal(data, &m); err != nil || m.Type != "loc" {
			continue // ignore anything that isn't a well-formed loc
		}
		c.room.mu.Lock()
		c.lat, c.lng, c.speed = m.Lat, m.Lng, m.Speed
		c.lastSeen = time.Now()
		c.room.mu.Unlock()
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok { // room closed our channel
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
```

---

## 3. The room — `backend/internal/hub/room.go`

One `Room` per join code, owned by a single goroutine (`run`). All mutation of the rider set
goes through its `register`/`unregister` channels, and it **broadcasts on a fixed ~4 Hz tick**
rather than on every incoming `loc` (decouples fan-out from ingest — `docs/SYSTEM_DESIGN.md §8`).

```go
package hub

import (
	"encoding/json"
	"sort"
	"sync"
	"time"
)

const broadcastInterval = 250 * time.Millisecond // ~4 Hz

// riderState is one entry in the server → clients message (docs/SYSTEM_DESIGN.md §6).
//
// Deliberately carries no position/rank: Horizon does not rank riders
// (docs/ADR/ADR-009.md, "No Gamification" in docs/PRODUCT.md).
type riderState struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
	Speed  float64 `json:"speed"`
	AgeSec int     `json:"ageSec"` // seconds since this rider's last fix (server clock)
}

type stateMsg struct {
	Type   string       `json:"type"`
	Ride   string       `json:"ride"`
	Riders []riderState `json:"riders"`
}

type Room struct {
	code  string
	mu    sync.RWMutex
	rider map[*Client]bool

	register   chan *Client
	unregister chan *Client
}

func newRoom(code string) *Room {
	return &Room{
		code:       code,
		rider:      make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (r *Room) run() {
	ticker := time.NewTicker(broadcastInterval)
	defer ticker.Stop()
	for {
		select {
		case c := <-r.register:
			r.mu.Lock()
			// Rejoin policy: c.id is stable across reconnects (hub.go), so a client
			// already seated with the same id is a zombie connection from before a
			// network drop (or a second device presenting the same id).
			//
			// TODO(rejoin): decide what happens to it. Under this lock you can:
			//   1. find any existing old *Client in r.rider with old.id == c.id
			//   2. kick it — delete(r.rider, old) + close(old.send), exactly like
			//      the unregister case (its pumps then shut down on their own)
			//   3. optionally carry its last fix over (old.lat/lng/speed/lastSeen → c)
			//      so the rider's dot unfreezes instead of vanishing until the next fix
			// Until this is implemented, a reconnecting rider appears twice for up to
			// ~60s (pongWait, client.go) — the ghost-rider bug.
			r.rider[c] = true
			r.mu.Unlock()
		case c := <-r.unregister:
			r.mu.Lock()
			if _, ok := r.rider[c]; ok {
				delete(r.rider, c)
				close(c.send)
			}
			r.mu.Unlock()
		case <-ticker.C:
			r.broadcast()
		}
	}
}

func (r *Room) broadcast() {
	now := time.Now()
	r.mu.RLock()
	riders := make([]riderState, 0, len(r.rider))
	for c := range r.rider {
		if c.lastSeen.IsZero() {
			continue // hasn't sent a fix yet — don't draw a dot at (0,0)
		}
		riders = append(riders, riderState{ID: c.id, Name: c.name, Lat: c.lat, Lng: c.lng,
			Speed: c.speed, AgeSec: int(now.Sub(c.lastSeen).Seconds())})
	}
	r.mu.RUnlock()

	// Stable order by id so the client's list doesn't jitter between frames.
	// Not a ranking — see riderState.
	sort.Slice(riders, func(i, j int) bool { return riders[i].ID < riders[j].ID })

	msg, err := json.Marshal(stateMsg{Type: "state", Ride: r.code, Riders: riders})
	if err != nil {
		return
	}
	r.mu.RLock()
	for c := range r.rider {
		select {
		case c.send <- msg:
		default: // client's queue is full — drop this frame rather than block the room
		}
	}
	r.mu.RUnlock()
}
```

---

## 4. The hub — `backend/internal/hub/hub.go`

Owns the room map and upgrades incoming `/ws` requests. Each new client is greeted with a
one-time `welcome` message carrying its id (so it can pick its own dot out of `state`), and
may present a stable `?rider=` id so a reconnect replaces its old connection.

```go
package hub

import (
	"encoding/json"
	"math/rand"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

type Hub struct {
	mu    sync.RWMutex
	rooms map[string]*Room
}

func New() *Hub {
	return &Hub{rooms: make(map[string]*Room)}
}

// Dev-only: accept any origin. Tighten before any public deployment.
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(*http.Request) bool { return true },
}

// room returns the room for code, creating and starting it if needed.
// TODO(later): garbage-collect empty rooms. Omitted in Phase 0 to keep the hub race-free
// and easy to read; at ≤15 riders and a handful of rides, idle rooms are negligible.
func (h *Hub) room(code string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[code]
	if !ok {
		r = newRoom(code)
		h.rooms[code] = r
		go r.run()
	}
	return r
}

// CreateRide mints a fresh join code. The room itself is created lazily on the first /ws join.
func (h *Hub) CreateRide() string {
	return genCode()
}

func (h *Hub) ServeWS(w http.ResponseWriter, req *http.Request) {
	code := req.URL.Query().Get("ride")
	if code == "" {
		http.Error(w, "missing ?ride=", http.StatusBadRequest)
		return
	}
	name := req.URL.Query().Get("name")
	if name == "" {
		name = "rider"
	}

	// Optional stable rider id, kept by the client across reconnects (mobile networks
	// drop — CLAUDE.md). Presenting the same id lets the room replace the stale
	// connection instead of seating a duplicate "ghost" rider. Absent/invalid → minted.
	id := req.URL.Query().Get("rider")
	if !validRiderID(id) {
		id = genID()
	}

	conn, err := upgrader.Upgrade(w, req, nil)
	if err != nil {
		return // upgrader already wrote the HTTP error
	}

	room := h.room(code)
	c := &Client{
		room: room,
		conn: conn,
		send: make(chan []byte, 16),
		id:   id,
		name: name,
	}

	// Tell the client its server-assigned id so it can pick its own dot out of the
	// broadcast `state`. Additive to the contract; clients may ignore it. The send
	// channel is buffered, so queuing this before the write pump starts can't block.
	if hello, err := json.Marshal(map[string]string{"type": "welcome", "id": c.id}); err == nil {
		c.send <- hello
	}

	room.register <- c
	go c.writePump()
	go c.readPump()
}

// --- small helpers ---

// Ambiguity-free alphabet (no O/0, I/1) for human-shareable codes.
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func genCode() string {
	b := make([]byte, 6)
	for i := range b {
		b[i] = codeAlphabet[rand.Intn(len(codeAlphabet))]
	}
	return string(b)
}

func genID() string {
	const hex = "0123456789abcdef"
	b := make([]byte, 8)
	for i := range b {
		b[i] = hex[rand.Intn(16)]
	}
	return string(b)
}

// validRiderID accepts client-supplied ids shaped like crypto.randomUUID() output:
// 8–64 chars of [A-Za-z0-9_-]. Anything else falls back to a server-minted id.
func validRiderID(s string) bool {
	if len(s) < 8 || len(s) > 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '_':
		default:
			return false
		}
	}
	return true
}
```

> `math/rand`'s global source is auto-seeded on Go 1.20+, so codes differ each run. These codes
> are fine for a friend group; note that anyone holding a code can join (a bearer token). Real
> validation/expiry is a later concern.

---

## 5. Wiring it up — `backend/main.go`

```go
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/krithik/horizon/backend/internal/httpx"
	"github.com/krithik/horizon/backend/internal/hub"
)

// Server lifecycle timings.
//
// Only two of the four http.Server timeouts are set, and the two that are left at zero
// are the interesting decision — see the http.Server literal in run() for why.
const (
	// Slow-loris defence: a client that opens a connection and dribbles headers holds
	// a goroutine until it is bounded. Harmless to WebSockets, whose headers arrive in
	// the first packet like any other request's.
	readHeaderTimeout = 5 * time.Second

	// Bounds idle keep-alive connections between requests. Does not apply to a
	// WebSocket: once gorilla hijacks the connection it leaves the server's management
	// entirely, and liveness is the ping/pong in internal/hub/client.go from then on.
	idleTimeout = 120 * time.Second

	// How long Shutdown may drain before we stop waiting. Comfortably inside the ~30s
	// most platforms allow between SIGTERM and SIGKILL.
	shutdownGrace = 15 * time.Second
)

func main() {
	if err := run(); err != nil {
		// run() has already logged the detail through slog.
		os.Exit(1)
	}
}

func run() error {
	logger, levelErr := newLogger(os.Getenv("LOG_LEVEL"))
	if levelErr != nil {
		logger.Warn("invalid LOG_LEVEL, defaulting to info", "err", levelErr)
	}

	// Read once, at startup: a misconfiguration surfaces at boot rather than on a
	// rider's phone, and the request path does no parsing.
	origins := httpx.ParseOrigins(os.Getenv("ALLOWED_ORIGINS"))
	if len(origins) == 0 {
		logger.Warn("ALLOWED_ORIGINS is not set — every origin is allowed; " +
			"set it to a comma-separated list of origins before deploying")
	} else {
		logger.Info("CORS configured", "origins", origins)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: buildHandler(logger, origins, hub.New()),

		ReadHeaderTimeout: readHeaderTimeout,
		IdleTimeout:       idleTimeout,

		// ReadTimeout and WriteTimeout are deliberately left at 0 (no limit), and
		// setting them is the most likely way to break this server.
		//
		// Both are absolute deadlines armed when the request begins, not idle
		// timeouts. On a WebSocket that lives for a whole bike ride, either one would
		// kill the connection the moment it elapsed — presenting as "riders vanish
		// after exactly N seconds", which is a miserable thing to diagnose from a
		// bicycle. The pumps in internal/hub/client.go already bound both directions
		// at the right granularity: a 60s read deadline refreshed by pong, and a 10s
		// write deadline set before every individual write.
		//
		// If you are here to harden the server, ReadHeaderTimeout above is the field
		// that gives slow-loris protection without touching long-lived connections.

		// Route net/http's own internal errors into the structured stream instead of
		// letting them reach stderr unformatted.
		ErrorLog: slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}

	// SIGTERM is what a container platform sends; os.Interrupt is Ctrl+C in dev. Note
	// that Windows never really delivers SIGTERM, so the drain path below is only
	// genuinely exercised on the Linux deployment target.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		// Shutdown makes ListenAndServe return ErrServerClosed. That is the success
		// path, not a failure — reporting it would make every clean stop look like a
		// crash to whatever is supervising the process.
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	logger.Info("server started", "addr", srv.Addr)

	select {
	case err := <-serveErr:
		if err != nil {
			logger.Error("server failed", "err", err)
			return err
		}
		return nil

	case <-ctx.Done():
		// Restore default signal handling first, so a second Ctrl+C from an impatient
		// operator kills the process immediately instead of being swallowed.
		stop()
		logger.Info("shutdown signal received, draining", "grace", shutdownGrace)

		sctx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
		defer cancel()

		// Shutdown stops accepting, then waits for active requests to finish. It does
		// not close hijacked connections, so live WebSockets are not sent a close
		// frame here — they are simply cut when the process exits. Delivering close
		// frames needs a hub-level teardown and a way for Room.run to exit, which is
		// the room-lifecycle task's territory (HZ-012), not this one.
		if err := srv.Shutdown(sctx); err != nil {
			logger.Error("graceful shutdown did not complete", "err", err)
			return err
		}

		logger.Info("shutdown complete")
		return nil
	}
}

// newLogger builds the process logger from a LOG_LEVEL value.
//
// JSON to stderr, so logs stay machine-readable and stdout stays free. An unparseable
// level is not fatal: the server starts at info and says so, because refusing to boot
// over a typo in an observability setting would be a worse failure than the typo.
//
// Levels: debug, info, warn, error (case-insensitive). Default info.
//
// LOG_LEVEL=debug is the only level at which rider coordinates may be logged, and it
// must never be enabled in a deployed build — location is the most sensitive data class
// in this app (docs/SYSTEM_DESIGN.md, "Security & privacy").
func newLogger(raw string) (*slog.Logger, error) {
	level := slog.LevelInfo
	var parseErr error
	if raw != "" {
		if err := level.UnmarshalText([]byte(raw)); err != nil {
			level = slog.LevelInfo
			parseErr = fmt.Errorf("LOG_LEVEL %q: %w", raw, err)
		}
	}
	handler := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: level})
	return slog.New(handler), parseErr
}

// buildHandler registers the routes and wraps them in the middleware chain.
//
// Extracted from run() so that main_test.go can exercise the exact chain the server
// runs — a WebSocket upgrade only proves anything if it goes through every wrapper.
//
// Order is Recover → Log → CORS → mux:
//   - Recover outermost, so a panic in any other middleware is caught too.
//   - Log outside CORS, so preflights are visible; CORS answers those itself and the
//     mux never sees them.
//   - CORS wrapping the whole mux, so /ws and every route added later inherit the
//     policy without anyone remembering to.
//
// A per-IP rate limiter, when it lands, goes inside CORS so that a preflight is never
// rate-limited.
func buildHandler(logger *slog.Logger, origins []string, h *hub.Hub) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	mux.HandleFunc("GET /ws", h.ServeWS)

	mux.HandleFunc("POST /rides", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]string{"code": h.CreateRide()})
	})

	// Phase 2: proxy a route to OpenRouteService (driving-car profile — ORS has no motorcycle
	// profile), store the polyline on the room.
	mux.HandleFunc("POST /rides/{code}/route", notImplemented)
	// Phase 3: mint a LiveKit JWT for this rider + room.
	mux.HandleFunc("POST /rides/{code}/voice-token", notImplemented)

	return httpx.Recover(logger)(httpx.Log(logger)(httpx.CORS(origins)(mux)))
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func notImplemented(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "not implemented yet", http.StatusNotImplemented)
}
```

### The middleware chain

`srv.Handler` is the wrapped chain, **not** the bare `mux`. `buildHandler` assembles it:

```
Recover → Log → CORS → mux
```

One concern per file, all in `backend/internal/httpx/` (read them — they are short and the
reasoning is in the comments, and this guide deliberately does not copy source that can drift):

| File | What it does |
|---|---|
| `cors.go` | Browser cross-origin policy and `OPTIONS` preflights |
| `logging.go` | One structured line per request |
| `recover.go` | Turns a panic into a 500 instead of a dead process |
| `responsewriter.go` | The shared wrapper the other two need |

Why that order:

- **Recover outermost**, so a panic in *any* other middleware is caught too, not just one in a
  handler. Every ride lives in memory, so a process death ends every ride in progress.
- **Log outside CORS**, so preflights appear in the log. CORS answers those itself and the mux
  never sees them, so logging inside CORS would make a failing preflight invisible — exactly the
  failure you would be trying to diagnose.
- **CORS wrapping the whole mux**, so `/ws` and every route added later inherit the policy.

A per-IP rate limiter, when it lands, goes *inside* CORS so a preflight is never rate-limited.

#### The one that will bite you: `http.Hijacker`

`gorilla/websocket` reaches the raw connection with a **direct** `w.(http.Hijacker)` type
assertion (`server.go:175` in v1.5.3) — not `http.ResponseController`, and not `Unwrap()`.

Request logging needs the status code, which means wrapping `http.ResponseWriter`. A wrapper that
does not itself implement `Hijack()` therefore fails **every** WebSocket upgrade with *"response
does not implement http.Hijacker"* — and it fails silently in the sense that every HTTP-level test
still passes. `responseRecorder` implements `Hijack()` (and `Flush()`); anything you add later
must too, and implementing only `Unwrap()` is not enough.

`backend/main_test.go` guards this with a real WebSocket dial through the real chain. If you touch
`responsewriter.go`, that is the test that tells you whether you broke the app.

### The CORS wrapper

Why it matters: the native Android app sends no `Origin` header at all — CORS is a browser-enforced
mechanism, and neither RN's `WebSocket` nor `fetch` set one — so CORS never gates its requests. The
wrapper exists for browser-based tooling instead, e.g. the Expo web dev server on `:8081`, where a
JSON-bodied request to a different origin would otherwise be silently discarded by the browser.
**CORS is not the auth boundary here** — it only decides which browser pages may read a response,
never who may call the API. That boundary is the Supabase JWT check on the backend
(`docs/ADR/ADR-008.md`).

Three things the wrapper is doing, all of which are easy to get wrong:

- **It wraps the whole mux, once.** A route added later inherits the policy without anyone
  remembering to add it, and responses the mux generates itself (404, 405) still carry the headers
  a browser needs in order to *show* you the failure.
- **It answers `OPTIONS` preflights itself and returns 204.** The mux registers no `OPTIONS`
  pattern, so a preflight that reached it would get a 405 — and a 405 is a failed preflight, which
  would make every JSON-bodied endpoint (the Phase 2 route proxy, the Phase 3 voice token)
  unreachable from a browser.
- **It sets its headers before delegating.** That is what lets a 500 written by the outer recovery
  middleware still carry `Access-Control-Allow-Origin`, so a panic surfaces in the browser as a
  real 500 rather than an opaque CORS error.

A disallowed origin is not rejected server-side on ordinary requests — the request runs and the
response simply carries no `Access-Control-Allow-Origin`, which is precisely how CORS refuses.
Rejecting would stop no attacker (CORS is enforced by the *browser*, on the response) while
breaking every legitimate caller that sends no `Origin` at all: the native client, `curl`, and
platform health checks. Server-side origin enforcement belongs on the WebSocket path, in the
upgrader's `CheckOrigin` — see *What's deliberately deferred* at the end of this guide.

---

## 6. Environment template — `backend/.env.example`

Phase 0 needs none of these, but create the template now so the secret-handling convention is
in place. **Never commit a real `.env`** — only this `.env.example` with blank values.

```
# Port the server listens on (optional; defaults to 8080)
PORT=

# Browser origins allowed to call the HTTP API (CORS), comma separated. Matching is
# exact — no wildcards, and a trailing slash makes an entry that can never match.
# Leave blank in local dev: blank allows every origin and warns at startup. Set it for
# any deployment, e.g. https://horizon.example.com,http://localhost:8081
ALLOWED_ORIGINS=

# Log verbosity: debug | info | warn | error (case-insensitive). Blank means info.
# Logs are JSON on stderr. An unrecognised value is not fatal — the server starts at
# info and logs a warning saying so.
#
# WARNING: debug is the only level at which rider coordinates may be logged. Location is
# the most sensitive data this app handles — never set debug in a deployed build.
LOG_LEVEL=

# LiveKit Cloud (Phase 3 — voice). Server-side only, never in the app.
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_URL=

# OpenRouteService (Phase 2 — driving-car profile; ORS has no motorcycle profile). Server-side only.
ORS_API_KEY=
```

### `ALLOWED_ORIGINS`

**Purpose.** The allowlist of browser origins permitted to call the HTTP API. It is the only
input to the CORS wrapper from §5 — nothing else configures it. It does **not** yet guard the
WebSocket upgrade; that is a separate, still-open piece of work (see the deferred list below).

**Format.** A comma-separated list of origins. An origin is *scheme + host + port* and nothing
else — no path, and **no trailing slash**.

- Whitespace around entries is trimmed, and empty entries are dropped, so `a, b`, `a,b` and
  `a,,b,` all parse identically.
- **Matching is exact string equality.** Nothing is normalised. `http://localhost:8081/` has a
  trailing slash and can therefore never match; `HTTP://LocalHost:8081` differs in case and will
  not match either. Both are misconfigurations to fix, not things the server repairs for you.
- **No wildcards.** `*.horizon.app` is a literal string that will never match anything.
- **Blank means permissive** — every origin is allowed, and the server logs a warning at startup
  saying so. That is the deliberate zero-config default for local development, because the dev
  page is reachable as `localhost`, as `127.0.0.1` and as a DHCP-assigned LAN address (a phone on
  your wifi), which are three separate origins. **Set it before deploying.**

**Example.**

```
ALLOWED_ORIGINS=http://localhost:8081,https://horizon.app
```

**What you should see at startup.** Set, and the server confirms what it parsed:

```
CORS: 2 allowed origin(s): http://localhost:8081, https://horizon.app
horizon backend listening on :8080
```

Blank, and it warns instead — if you see this line on a deployed box, it is a bug to fix:

```
WARNING: ALLOWED_ORIGINS is not set — every origin is allowed. Set it to a comma-separated list of origins before deploying.
```

**Checking it by hand**, without a browser — an allowed origin gets the header echoed back:

```powershell
curl.exe -i -X POST -H "Origin: http://localhost:8081" http://localhost:8080/rides
# -> 200, Access-Control-Allow-Origin: http://localhost:8081, {"code":"9DK6PY"}
```

A preflight (what the browser sends ahead of any JSON-bodied request) gets a 204 and the policy:

```powershell
curl.exe -i -X OPTIONS -H "Origin: http://localhost:8081" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type" http://localhost:8080/rides
# -> 204, Allow-Methods: GET, POST, OPTIONS · Allow-Headers: Content-Type, Authorization · Max-Age: 600
```

An origin that is *not* on the list gets a normal response with **no** `Access-Control-Allow-Origin`
header — that absence is the refusal, and the browser is what enforces it.

### `LOG_LEVEL`

**Purpose.** Sets the verbosity of the process logger. Everything the server emits is JSON on
**stderr**, one object per line, via `log/slog` from the standard library — no logging dependency.

**Format.** One of `debug`, `info`, `warn`, `error`, case-insensitive. Blank means `info`.

An unrecognised value is **not fatal**: the server starts at `info` and logs a warning naming the
bad value. Refusing to boot over a typo in an observability setting would be a worse failure than
the typo.

**Example.**

```
LOG_LEVEL=debug
```

> ⚠️ **`debug` is the only level at which rider coordinates may be logged.** Location is the most
> sensitive data this app handles. Never set `debug` in a deployed build.

**What you get.** One line per request, from the logging middleware:

```json
{"time":"...","level":"INFO","msg":"http request","method":"POST","path":"/rides","status":200,"duration":312000,"bytes":18,"remote":"127.0.0.1:51292"}
```

Two deliberate omissions in that line:

- **No query string.** `/ws` carries `?name=` and `?rider=` — a rider's display name and their
  identity across reconnects. Only `r.URL.Path` is logged, never `RawQuery` or `RequestURI`, and
  never a request body.
- **No proxy awareness.** `remote` is the address the server sees. Behind the Cloudflare Tunnel
  that becomes the tunnel's address for every request; fixing that needs `X-Forwarded-For`
  handling, which is deliberately deferred — trusting that header without knowing the hop count
  is a spoofing vector.

`GET /healthz` logs at `debug`, not `info`. Uptime monitoring polls it on a schedule forever, and
at `info` it would out-number every line that describes an actual rider.

A WebSocket upgrade is logged as **101**, once, when the upgrade completes — not when the rider
eventually disconnects. `ServeWS` returns as soon as the pumps are running, so `duration` measures
the handshake, not the length of the ride.

### Server timeouts — and the two that are deliberately unset

`main.go` builds an `http.Server` rather than calling `http.ListenAndServe`, which sets no
timeouts at all. Only two of the four fields are set, and **the two left at zero are the decision
worth understanding**:

| Field | Value | Why |
|---|---|---|
| `ReadHeaderTimeout` | **5s** | Slow-loris defence. A client that opens a connection and dribbles headers holds a goroutine until something bounds it. Harmless to WebSockets — their headers arrive in the first packet like any other request's |
| `IdleTimeout` | **120s** | Bounds idle keep-alive connections between requests. Does not apply to a WebSocket: once gorilla hijacks the connection it leaves the server's management entirely |
| `ReadTimeout` | **0 (unset)** | See below |
| `WriteTimeout` | **0 (unset)** | See below |

**Setting `ReadTimeout` or `WriteTimeout` is the most likely way to break this server.** Both are
absolute deadlines armed when the request begins, not idle timeouts. On a WebSocket that lives for
a whole bike ride, either one kills the connection the moment it elapses — presenting as *"riders
vanish after exactly N seconds"*, which is a miserable thing to diagnose from a bicycle.

Both directions are already bounded at the right granularity, per connection, in
`internal/hub/client.go`: a 60s read deadline refreshed by every pong, and a 10s write deadline set
before each individual write. If you are hardening the server, `ReadHeaderTimeout` is the field
that buys protection without touching long-lived connections.

**Graceful shutdown.** `SIGINT`/`SIGTERM` stops the server accepting, drains in-flight requests
within 15s, and exits 0. `ListenAndServe` returns `http.ErrServerClosed` on a clean stop, which is
explicitly *not* treated as a failure — reporting it would make every clean shutdown look like a
crash to whatever supervises the process.

> Note: `srv.Shutdown` does not close hijacked connections, so live WebSockets are **not** sent a
> close frame — they are cut when the process exits. Delivering close frames needs a hub-level
> teardown and an exit path for `Room.run`, which belongs to the room-lifecycle work, not here.
> On Windows `SIGTERM` is never really delivered, so only Ctrl+C exercises this path locally.

---

## 7. Format, vet, build

```powershell
Set-Location backend
go fmt ./...
go vet ./...
go build -o server.exe .
Set-Location ..
```

✅ **Checkpoint:** `go vet ./...` prints nothing (clean) and `backend\server.exe` is produced.

---

## 8. Run it

```powershell
Set-Location backend
go run .
# -> horizon backend listening on :8080
```

Leave it running. In a **second** PowerShell window:

```powershell
Invoke-RestMethod http://localhost:8080/healthz                 # -> ok
Invoke-RestMethod -Method Post http://localhost:8080/rides      # -> code : ABC123
```

✅ **Checkpoint:** `/healthz` returns `ok` and `POST /rides` returns a JSON object with a 6-char
`code`.

---

## 9. Verify the WebSocket pipe (loc in → state out)

Node 24 ships a global `WebSocket`, so no install needed. Create `backend\wstest.mjs`:

```js
// Phase 0 smoke test: open the WS, send one loc, expect a `welcome` then a `state`
// broadcast echoing our fix. Delete or keep as a smoke test.
const ws = new WebSocket("ws://localhost:8080/ws?ride=TEST01&name=tester");
let gotWelcome = false;
let gotState = false;
ws.onopen = () => {
  console.log("connected");
  ws.send(JSON.stringify({ type: "loc", lat: 12.9716, lng: 77.5946, heading: 45, speed: 6.2, ts: Math.floor(Date.now() / 1000) }));
};
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "welcome") { gotWelcome = true; console.log("welcome id:", msg.id); }
  if (msg.type === "state") { gotState = true; console.log("state:", e.data); }
};
setTimeout(() => {
  console.log(gotWelcome && gotState ? "PASS: welcome + state received" : `FAIL: welcome=${gotWelcome} state=${gotState}`);
  process.exit(gotWelcome && gotState ? 0 : 1);
}, 1500);
```

Run it (server still running in the other window):

```powershell
node backend\wstest.mjs
```

✅ **Checkpoint:** a `welcome id: …` line immediately, then within ~250 ms a line like:
`state: {"type":"state","ride":"TEST01","riders":[{"id":"...","name":"tester","lat":12.9716,"lng":77.5946,"speed":6.2,"ageSec":0}]}`
and finally `PASS: welcome + state received`.

That's the whole spine working: a `loc` went up, the hub stamped and stored it, and the tick
broadcast the combined `state` back — plus the one-time `welcome` that tells a client which
rider it is.

---

## 10. Connecting from the mobile app

The Android emulator can't reach `localhost` — it reaches your host machine at **`10.0.2.2`**.
So the app's dev URL is `ws://10.0.2.2:8080/ws?ride=...&name=...` (already the value in
`docs/SETUP.md §7`). A physical device uses your computer's LAN IP instead.

---

## Deployment later — Cloudflare Tunnel in front of the Go binary

You don't need this for development, but here's the plan (chosen because the backend must stay
Go, and Cloudflare's free realtime primitive — Durable Objects — is TypeScript-only):

1. Run the single `server.exe` (or a Linux build: `GOOS=linux GOARCH=amd64 go build -o server .`)
   on a host that's free **without a card**: Koyeb's free instance, or simply your own machine.
   (Check the fine print elsewhere — Oracle "Always-Free" and Fly.io both want a card at signup
   for verification, and Render's free web services spin down on idle, which kills WebSockets.)
2. Put **Cloudflare Tunnel** (`cloudflared`) in front of it for TLS/`wss://` with no open
   inbound ports. Two flavours:
   - **Quick tunnel** (`cloudflared tunnel --url http://localhost:8080`) — zero signup, no card,
     but the `*.trycloudflare.com` URL is random and changes on every restart. Fine for a friend
     group that re-shares a link.
   - **Named tunnel** — stable hostname, but requires a domain you own added to Cloudflare
     (domains cost ~$10/yr; this is the one place "no card" bends if you want a fixed URL).
3. Tighten `upgrader.CheckOrigin` (step 4) to your real origin before going public, and switch
   the client from `ws://` to `wss://`.

The Go code above is host-agnostic — it reads only `PORT` and `ALLOWED_ORIGINS`, so nothing here
changes when you deploy; you just wrap it. **Set `ALLOWED_ORIGINS` to the tunnel hostname as part
of that step** (see §6): a deployed server left blank allows every origin, which is exactly the
state the startup warning is telling you about.

---

## Done when…

- **Phase 0:** `go run .` serves `/healthz`, `POST /rides` mints a code, and a `loc` sent to
  `/ws` comes back inside a `state` broadcast (step 9). Then the mobile app's own dot, fed
  through this server, proves the toolchain end to end (`docs/SYSTEM_DESIGN.md §11`).

### What's deliberately deferred
- **`POST /rides/{code}/route`** — ORS driving-car proxy + storing the polyline on the room (Phase 2).
- **`POST /rides/{code}/voice-token`** — LiveKit JWT minting (Phase 3).
- **Rejoin replace policy** — the stable `rider` id is plumbed through, but the room's
  `register` case must still kick the zombie connection (marked `TODO(rejoin)` in `room.go`).
- **Empty-room GC**, **join-code validation/expiry**, and **`wss://` + origin checks** — noted
  inline above; add as you harden past Phase 1.
- **Supabase JWT verification middleware** — the Go server verifies (never mints) Supabase-issued
  JWTs before trusting a caller's identity; not yet implemented (`docs/ADR/ADR-008.md`).
- **Redacting `Authorization` in the logging middleware** — once JWTs flow through `/ws`, the
  logging middleware (`internal/httpx/logging.go`) must not let a bearer token reach the log
  stream unredacted (`docs/ADR/ADR-008.md`).
- **WebSocket origin enforcement** — `upgrader.CheckOrigin` still returns `true` for every
  request. The CORS wrapper in §5 covers the *HTTP* API only; CORS does not apply to a WebSocket
  handshake, so `ALLOWED_ORIGINS` currently has no effect on `/ws`. Wiring the same allowlist into
  `CheckOrigin` is its own task, and it must land before the server is publicly reachable.
- **Panic recovery for the hub's goroutines** — `Recover` covers the HTTP handler chain only.
  `Room.run`, `readPump` and `writePump` run outside it, and an unrecovered panic in *any*
  goroutine still terminates the process. Deliberately left to the tasks that rewrite that code.
- **Hub-level shutdown** — see the note under §6 on close frames.
- **Hub lifecycle logging** — connect, disconnect, room create/destroy, dropped frame, malformed
  message and unknown ride code are not logged yet. The request log covers the HTTP edge; nothing
  inside `internal/hub` emits anything.
