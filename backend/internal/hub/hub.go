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
