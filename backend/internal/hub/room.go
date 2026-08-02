package hub

import (
	"encoding/json"
	"sort"
	"time"
)

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

// Room is plain data — there is no per-room goroutine or lock. Every field is guarded
// by Hub.mu; see the ponytail note there for why one hub-wide lock is fine at this
// scale.
type Room struct {
	code       string
	riders     map[string]*Client // keyed by rider id — this is the ghost-rider fix
	emptySince time.Time          // only meaningful while riders is empty
	routeMsg   []byte             // marshalled `route` frame, nil until a route is set; guarded by Hub.mu
}

// broadcast marshals the room's current state once and fans it out to every rider.
// The caller (Hub.sweep) holds h.mu for the duration, so broadcast does no locking of
// its own. now is passed in rather than read from time.Now() so tests can drive it.
func (r *Room) broadcast(now time.Time) {
	riders := make([]riderState, 0, len(r.riders))
	for _, c := range r.riders {
		if c.lastSeen.IsZero() {
			continue // hasn't sent a fix yet — don't draw a dot at (0,0)
		}
		riders = append(riders, riderState{ID: c.id, Name: c.name, Lat: c.lat, Lng: c.lng,
			Speed: c.speed, AgeSec: int(now.Sub(c.lastSeen).Seconds())})
	}

	// Stable order by id so the client's list doesn't jitter between frames.
	// Not a ranking — see riderState.
	sort.Slice(riders, func(i, j int) bool { return riders[i].ID < riders[j].ID })

	msg, err := json.Marshal(stateMsg{Type: "state", Ride: r.code, Riders: riders})
	if err != nil {
		return
	}
	for _, c := range r.riders {
		select {
		case c.send <- msg:
		default: // client's queue is full — drop this frame rather than block the room
		}
	}
}
