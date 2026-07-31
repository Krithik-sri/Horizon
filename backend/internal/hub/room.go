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
