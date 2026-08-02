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
	hub  *Hub
	code string // ride code — which entry in hub.rooms this client belongs to
	conn *websocket.Conn
	send chan []byte
	id   string
	name string

	// Latest fix — guarded by hub.mu.
	lat      float64
	lng      float64
	speed    float64
	lastSeen time.Time // server receive time; zero until the first loc arrives
}

func (c *Client) readPump() {
	defer func() {
		c.hub.remove(c)
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
		c.hub.mu.Lock()
		c.lat, c.lng, c.speed = m.Lat, m.Lng, m.Speed
		c.lastSeen = time.Now()
		c.hub.mu.Unlock()
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
			if !ok { // hub closed our channel — evicted by a reconnect, or GC'd
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
