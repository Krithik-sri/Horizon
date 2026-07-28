# Backend setup — Go realtime server (WebSocket hub)

> Goal: a single Go binary that holds one WebSocket per rider, groups them into rooms by join
> code, and broadcasts everyone's combined position back to the room ~4×/sec. This is the
> **spine** of Horizon — everything else (route, standings, voice) is a view on this pipe.
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

**Naming note:** this file is `SETUP_BACKEND.md` (referenced by `CLAUDE.md` and `README.md`).
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
New-Item -ItemType Directory backend\internal\standings -Force | Out-Null
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

## 2. The standings math — `backend/internal/standings/standings.go`

Pure geometry, no dependencies. Phase 0 has no route yet, so this isn't exercised until Phase 2
— but scaffolding it now keeps the "who's 1st" logic (`SYSTEM_DESIGN.md §7`) in one place.

```go
package standings

import "math"

// Pt is a geographic point. Note: lat/lng order (the internal convention).
// MapLibre/GeoJSON use [lng, lat] — convert at the client boundary, not here.
type Pt struct {
	Lat float64
	Lng float64
}

const earthRadiusM = 6371000.0

// Haversine returns the great-circle distance between a and b in metres.
func Haversine(a, b Pt) float64 {
	la1 := a.Lat * math.Pi / 180
	la2 := b.Lat * math.Pi / 180
	dLat := (b.Lat - a.Lat) * math.Pi / 180
	dLng := (b.Lng - a.Lng) * math.Pi / 180
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(la1)*math.Cos(la2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusM * math.Asin(math.Min(1, math.Sqrt(h)))
}

// projectOntoSegment projects p onto segment a→b using a local planar approximation
// (good enough at city scale). Returns the projected point and t in [0,1] along the segment.
func projectOntoSegment(a, b, p Pt) (Pt, float64) {
	latRef := a.Lat * math.Pi / 180
	mPerDegLat := 111320.0
	mPerDegLng := 111320.0 * math.Cos(latRef)

	bx := (b.Lng - a.Lng) * mPerDegLng
	by := (b.Lat - a.Lat) * mPerDegLat
	px := (p.Lng - a.Lng) * mPerDegLng
	py := (p.Lat - a.Lat) * mPerDegLat

	seg2 := bx*bx + by*by
	t := 0.0
	if seg2 > 0 {
		t = (px*bx + py*by) / seg2
		t = math.Max(0, math.Min(1, t))
	}
	proj := Pt{Lat: a.Lat + (b.Lat-a.Lat)*t, Lng: a.Lng + (b.Lng-a.Lng)*t}
	return proj, t
}

// DistAlongRoute returns metres travelled along route for point p:
// the distance to the projection on the nearest segment. (SYSTEM_DESIGN.md §7.)
//
// Refinement for Phase 2: pass the rider's previous distAlong and constrain the segment
// search to a window around it, so progress stays monotonic on out-and-back / looped routes
// where naive nearest-segment can snap to the wrong place.
func DistAlongRoute(route []Pt, p Pt) float64 {
	var cum, best float64
	bestDist := math.Inf(1)
	for i := 0; i+1 < len(route); i++ {
		a, b := route[i], route[i+1]
		proj, t := projectOntoSegment(a, b, p)
		if d := Haversine(p, proj); d < bestDist {
			bestDist = d
			best = cum + t*Haversine(a, b)
		}
		cum += Haversine(a, b)
	}
	return best
}
```

---

## 3. The connection — `backend/internal/hub/client.go`

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

// locMsg is the client → server message (CLAUDE.md / SYSTEM_DESIGN.md §6).
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

## 4. The room — `backend/internal/hub/room.go`

One `Room` per join code, owned by a single goroutine (`run`). All mutation of the rider set
goes through its `register`/`unregister` channels, and it **broadcasts on a fixed ~4 Hz tick**
rather than on every incoming `loc` (decouples fan-out from ingest — `SYSTEM_DESIGN.md §8`).

```go
package hub

import (
	"encoding/json"
	"sort"
	"sync"
	"time"

	"github.com/krithik/horizon/backend/internal/standings"
)

const broadcastInterval = 250 * time.Millisecond // ~4 Hz

// riderState is one entry in the server → clients message (SYSTEM_DESIGN.md §6).
type riderState struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
	Speed     float64 `json:"speed"`
	AgeSec    int     `json:"ageSec"` // seconds since this rider's last fix (server clock)
	Pos       int     `json:"pos"`
	DistAlong float64 `json:"distAlong"`
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
	route []standings.Pt // set in Phase 2 via POST /rides/{code}/route

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
			// network drop. Kick it here (delete + close(send), like unregister) and
			// optionally carry its last fix over to c — otherwise a reconnecting
			// rider appears twice for up to ~60s (pongWait). See room.go for the
			// current state of this policy.
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
	hasRoute := len(r.route) > 1
	for c := range r.rider {
		if c.lastSeen.IsZero() {
			continue // hasn't sent a fix yet — don't draw a dot at (0,0)
		}
		rs := riderState{ID: c.id, Name: c.name, Lat: c.lat, Lng: c.lng, Speed: c.speed,
			AgeSec: int(now.Sub(c.lastSeen).Seconds())}
		if hasRoute {
			rs.DistAlong = standings.DistAlongRoute(r.route, standings.Pt{Lat: c.lat, Lng: c.lng})
		}
		riders = append(riders, rs)
	}
	r.mu.RUnlock()

	// Standings: by distAlong desc once a route exists; until then, a stable order by id.
	if hasRoute {
		sort.Slice(riders, func(i, j int) bool { return riders[i].DistAlong > riders[j].DistAlong })
	} else {
		sort.Slice(riders, func(i, j int) bool { return riders[i].ID < riders[j].ID })
	}
	for i := range riders {
		riders[i].Pos = i + 1
	}

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

## 5. The hub — `backend/internal/hub/hub.go`

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

## 6. Wiring it up — `backend/main.go`

```go
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/krithik/horizon/backend/internal/hub"
)

func main() {
	h := hub.New()
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	mux.HandleFunc("GET /ws", h.ServeWS)

	mux.HandleFunc("POST /rides", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]string{"code": h.CreateRide()})
	})

	// Phase 2: proxy a cycling route to OpenRouteService, store the polyline on the room.
	mux.HandleFunc("POST /rides/{code}/route", notImplemented)
	// Phase 3: mint a LiveKit JWT for this rider + room.
	mux.HandleFunc("POST /rides/{code}/voice-token", notImplemented)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("horizon backend listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func notImplemented(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "not implemented yet", http.StatusNotImplemented)
}
```

---

## 7. Environment template — `backend/.env.example`

Phase 0 needs none of these, but create the template now so the secret-handling convention is
in place. **Never commit a real `.env`** — only this `.env.example` with blank values.

```
# Port the server listens on (optional; defaults to 8080)
PORT=

# LiveKit Cloud (Phase 3 — voice). Server-side only, never in the app.
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_URL=

# OpenRouteService (Phase 2 — cycling directions). Server-side only.
ORS_API_KEY=
```

---

## 8. Format, vet, build

```powershell
Set-Location backend
go fmt ./...
go vet ./...
go build -o server.exe .
Set-Location ..
```

✅ **Checkpoint:** `go vet ./...` prints nothing (clean) and `backend\server.exe` is produced.

---

## 9. Run it

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

## 10. Verify the WebSocket pipe (loc in → state out)

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
`state: {"type":"state","ride":"TEST01","riders":[{"id":"...","name":"tester","lat":12.9716,"lng":77.5946,"speed":6.2,"ageSec":0,"pos":1,"distAlong":0}]}`
and finally `PASS: welcome + state received`.

That's the whole spine working: a `loc` went up, the hub stamped and stored it, and the tick
broadcast the combined `state` back — plus the one-time `welcome` that tells a client which
rider it is.

---

## 11. Connecting from the mobile app

The Android emulator can't reach `localhost` — it reaches your host machine at **`10.0.2.2`**.
So the app's dev URL is `ws://10.0.2.2:8080/ws?ride=...&name=...` (already the value in
`SETUP_MOBILE.md §7`). A physical device uses your computer's LAN IP instead.

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
3. Tighten `upgrader.CheckOrigin` (step 5) to your real origin before going public, and switch
   the client from `ws://` to `wss://`.

The Go code above is host-agnostic (it only reads `PORT`), so nothing here changes when you
deploy — you just wrap it.

---

## Done when…

- **Phase 0:** `go run .` serves `/healthz`, `POST /rides` mints a code, and a `loc` sent to
  `/ws` comes back inside a `state` broadcast (step 10). Then the mobile app's own dot, fed
  through this server, proves the toolchain end to end (`SYSTEM_DESIGN.md §11`).

### What's deliberately deferred
- **`POST /rides/{code}/route`** — ORS cycling proxy + storing the polyline on the room (Phase 2).
- **`POST /rides/{code}/voice-token`** — LiveKit JWT minting (Phase 3).
- **Rejoin replace policy** — the stable `rider` id is plumbed through, but the room's
  `register` case must still kick the zombie connection (marked `TODO(rejoin)` in `room.go`).
- **Windowed standings projection**, **empty-room GC**, **join-code validation/expiry**, and
  **`wss://` + origin checks** — noted inline above; add as you harden past Phase 1.
