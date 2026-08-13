package hub

import (
	"crypto/rand"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/krithik/horizon/backend/internal/auth"
)

const (
	broadcastInterval = 250 * time.Millisecond // ~4 Hz

	// roomGrace is how long an empty room survives before sweep collects it. Long
	// enough that a convoy losing signal in a tunnel, or a rider who taps "start ride"
	// and then spends a minute putting their gloves on, doesn't lose the room.
	roomGrace = 5 * time.Minute

	// maxCodeAttempts bounds CreateRide's collision retry. At 32^6 possible codes a
	// collision is astronomically unlikely; an unbounded loop under the hub lock is
	// still not a risk worth taking to cover a case that will never happen.
	maxCodeAttempts = 10
)

type Hub struct {
	// ponytail: one hub-wide lock, and broadcast marshals JSON while holding it. At ≤15
	// riders per convoy and a handful of live rides that is microseconds per tick.
	// Shard per-room if concurrent rides ever reach the hundreds.
	mu    sync.Mutex
	rooms map[string]*Room

	// allowedOrigins backs checkOrigin below — the same allowlist httpx.CORS is built
	// from (see main.go), since CORS itself never runs against a WebSocket upgrade.
	allowedOrigins map[string]struct{}
	allowAll       bool // true when allowedOrigins is empty — dev default, see checkOrigin

	upgrader websocket.Upgrader
}

// newHub builds the hub without the sweep goroutine, so tests can drive sweep()
// deterministically instead of sleeping through the GC grace window. New() is the
// production constructor.
//
// origins is the same parsed ALLOWED_ORIGINS allowlist httpx.CORS uses (see checkOrigin
// for why the WebSocket upgrade needs its own copy of it).
func newHub(origins []string) *Hub {
	h := &Hub{
		rooms:          make(map[string]*Room),
		allowedOrigins: make(map[string]struct{}, len(origins)),
		allowAll:       len(origins) == 0,
	}
	for _, o := range origins {
		h.allowedOrigins[o] = struct{}{}
	}
	h.upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     h.checkOrigin,
	}
	return h
}

func New(origins []string) *Hub {
	h := newHub(origins)
	go h.tick()
	return h
}

// tick is the timer, sweep is the work. Kept separate so tests can call sweep with a
// synthetic `now` instead of waiting on a real clock.
func (h *Hub) tick() {
	for now := range time.Tick(broadcastInterval) {
		h.sweep(now)
	}
}

// sweep broadcasts state to every room, then evicts rooms that have been empty for at
// least roomGrace. Deleting from a map while ranging over it is safe in Go.
func (h *Hub) sweep(now time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for code, r := range h.rooms {
		// An empty room has nobody to send to, so skip the marshal entirely rather
		// than building a state frame for no one four times a second for five minutes.
		if len(r.riders) == 0 {
			if now.Sub(r.emptySince) >= roomGrace {
				delete(h.rooms, code)
			}
			continue
		}
		r.broadcast(now)
	}
}

// checkOrigin is the upgrader's CheckOrigin for /ws.
//
// A native React Native WebSocket sends no Origin header at all — there is no browser
// client to protect against (docs/ADR/ADR-007.md, the web client was cancelled), so an
// absent Origin is the real client and is always allowed. When an Origin is present
// (some other kind of caller) it's checked against the same allowlist httpx.CORS uses:
// an empty allowlist allows it too, matching CORS's own empty-list dev default, since
// CORS itself has no say here — there is no preflight and no browser enforcing a
// response header on a WebSocket upgrade.
func (h *Hub) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	if h.allowAll {
		return true
	}
	_, ok := h.allowedOrigins[origin]
	return ok
}

// CreateRide mints a fresh join code and reserves the room for it right away — unlike
// the old lazy-create scheme, a code returned from here is guaranteed to exist in
// h.rooms, so a client presenting an unminted code to /ws is a genuine error rather
// than "the room just hasn't been created yet".
//
// Retries on collision, bounded at maxCodeAttempts (see the const doc). If every
// attempt collides, returns "" — unreachable in practice, but a caller must still
// handle it rather than seat a rider in a room that doesn't exist.
func (h *Hub) CreateRide() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	for i := 0; i < maxCodeAttempts; i++ {
		code := genCode()
		if _, exists := h.rooms[code]; !exists {
			h.rooms[code] = &Room{code: code, riders: make(map[string]*Client), emptySince: time.Now()}
			return code
		}
	}
	return ""
}

// RideExists reports whether code is a currently live room. The route handler uses
// this to fail fast — 404 before spending an ORS quota request — on a code that was
// never minted or has since been GC'd, mirroring the same check ServeWS does below.
func (h *Hub) RideExists(code string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := h.rooms[code]
	return ok
}

// SetRoute stores the route frame on the room and fans it out to everyone currently in
// it, using the same non-blocking send broadcast uses — a slow client's full queue
// drops the frame rather than stalling the hub. Returns false if the code is unknown
// (the room may have been GC'd between the handler's existence check and this call).
//
// Deliberately does not touch emptySince or anything else about room lifecycle: setting
// a route is not an occupancy event.
func (h *Hub) SetRoute(code string, msg []byte) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[code]
	if !ok {
		return false
	}
	r.routeMsg = msg
	for _, c := range r.riders {
		select {
		case c.send <- msg:
		default: // client's queue is full — drop this frame rather than block the room
		}
	}
	return true
}

func (h *Hub) ServeWS(w http.ResponseWriter, req *http.Request) {
	code := req.URL.Query().Get("ride")
	if code == "" {
		http.Error(w, "missing ?ride=", http.StatusBadRequest)
		return
	}

	// Reject an unknown code before upgrading. A real HTTP 404 tells the client far
	// more than a socket that opens and immediately dies — and it's what makes ride
	// codes mean something: only a code CreateRide actually minted can seat a rider.
	h.mu.Lock()
	_, known := h.rooms[code]
	h.mu.Unlock()
	if !known {
		http.Error(w, "unknown ride code", http.StatusNotFound)
		return
	}

	name := req.URL.Query().Get("name")
	if name == "" {
		name = "rider"
	}

	// The rider's seat key is the verified JWT subject, not a client-asserted
	// ?rider= — auth.Require has already rejected this request if it didn't carry a
	// valid Supabase token, so Subject is always non-empty by the time ServeWS runs.
	// It is stable across reconnects (mobile networks drop — CLAUDE.md) because a
	// rider's sub does not change between connections, which is what lets the room
	// replace the stale connection instead of seating a duplicate "ghost" rider — and,
	// unlike the old client-chosen id, it cannot be spoofed to claim someone else's
	// seat (docs/ADR/ADR-017.md Decision §6).
	id := auth.Subject(req.Context())

	conn, err := h.upgrader.Upgrade(w, req, nil)
	if err != nil {
		return // upgrader already wrote the HTTP error
	}

	c := &Client{
		hub:  h,
		code: code,
		conn: conn,
		send: make(chan []byte, 16),
		id:   id,
		name: name,
	}

	// Tell the client its server-assigned id so it can pick its own dot out of the
	// broadcast `state`. Additive to the contract; clients may ignore it.
	//
	// Queued *before* c is seated, and that ordering is load-bearing: the moment the
	// room holds a reference to c, a concurrent reconnect presenting the same rider id
	// can evict it and close(c.send). Sending the welcome after that point would be a
	// send on a closed channel. Here nothing else can reach c yet, and send is buffered,
	// so this can neither race nor block.
	if hello, err := json.Marshal(map[string]string{"type": "welcome", "id": c.id}); err == nil {
		c.send <- hello
	}

	h.mu.Lock()
	room, known := h.rooms[code]
	if !known {
		// The room was GC'd by sweep while upgrader.Upgrade was blocked on the
		// handshake. Nobody to seat the client into.
		h.mu.Unlock()
		conn.SetWriteDeadline(time.Now().Add(writeWait))
		conn.WriteMessage(websocket.CloseMessage, []byte{})
		conn.Close()
		return
	}

	// A route already set on this room is queued right after welcome, for the same
	// reason welcome is queued before c is seated: nothing can reach c yet, so this
	// can neither race a concurrent SetRoute fan-out nor block — send is buffered at
	// 16, and this is at most the second frame queued.
	if room.routeMsg != nil {
		c.send <- room.routeMsg
	}

	// Eviction — the ghost-rider fix. c.id is stable across reconnects, so a client
	// already seated under the same id is a zombie connection from before a network
	// drop (or a second device presenting the same id).
	if old, exists := room.riders[c.id]; exists {
		delete(room.riders, c.id)
		close(old.send) // its writePump exits, closes the conn, which ends its readPump

		// Carry the fix over. Without this, broadcast skips the reconnecting rider
		// entirely (it skips any client with a zero lastSeen), so the rider vanishes
		// from every other phone until their next GPS fix lands. Carrying it over
		// instead holds the dot in place with a climbing ageSec, which the client's
		// isStale() greys out past ~10s — ageSec exists in the protocol precisely to
		// carry "last seen N seconds ago". A stale-marked position is more honest than
		// no position at all (docs/PRODUCT.md, Confidence). Product call: carry it over.
		c.lat, c.lng, c.speed, c.lastSeen = old.lat, old.lng, old.speed, old.lastSeen
	}
	room.riders[c.id] = c
	h.mu.Unlock()

	go c.writePump()
	go c.readPump()
}

// remove drops c from its room, but only if c is still the client seated under its id.
//
// That identity check, not just the id, is the whole point. An evicted zombie's
// readPump wakes up and runs this defer *after* the fresh connection is already seated
// at riders[c.id]. Comparing only the id would delete the replacement — the
// ghost-rider fix kicking the very rider it exists to save, intermittently and only
// under the timing that reconnects produce. It also avoids a double close(c.send),
// since eviction in ServeWS already closed the zombie's channel.
func (h *Hub) remove(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.rooms[c.code]
	if !ok {
		return
	}
	if cur, ok := r.riders[c.id]; ok && cur == c {
		delete(r.riders, c.id)
		close(c.send)
		if len(r.riders) == 0 {
			r.emptySince = time.Now()
		}
	}
}

// --- small helpers ---

// Ambiguity-free alphabet (no O/0, I/1) for human-shareable codes.
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// genCode uses crypto/rand rather than math/rand: a ride code is an unguessable token
// in its own right, deliberately. auth.Require (docs/ADR/ADR-017.md) verifies *who* is
// asking, but a ride code is meant to be shared with a convoy, not tied to any one
// identity — so it still needs to not be predictable, the same way it always did,
// rather than relying on auth to cover it. genID, the equivalent generator for a
// client-chosen rider id, is gone: the rider id is now the verified JWT subject
// (docs/ADR/ADR-017.md Decision §6), and there is no client-supplied value left to
// validate or fall back from.
//
// The alphabet divides 256 evenly (32), so taking a random byte mod len(codeAlphabet)
// is uniform with no bias and no rejection sampling needed. Since Go 1.24,
// crypto/rand.Read no longer returns an error in practice (it blocks or panics instead
// of failing), so its error return is ignored here rather than inventing a dead error
// path.
func genCode() string {
	b := make([]byte, 6)
	rand.Read(b)
	for i := range b {
		b[i] = codeAlphabet[int(b[i])%len(codeAlphabet)]
	}
	return string(b)
}
