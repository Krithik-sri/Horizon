package hub

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// dialRide dials /ws for the given ride code and rider id, consumes the welcome frame,
// and returns the client connection. t.Fatal on any failure.
func dialRide(t *testing.T, srv *httptest.Server, code, rider string) *websocket.Conn {
	t.Helper()
	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?ride=" + code + "&rider=" + rider
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("dial %s: %v", u, err)
	}
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("reading welcome: %v", err)
	}
	return conn
}

// TestRejoinEvictsGhostNotReplacement is the identity-check regression test described
// in the brief: reconnecting with the same rider id must replace the old client, and
// the old client's own cleanup (its readPump defer, which fires later and
// asynchronously once its connection is closed) must not undo that replacement.
func TestRejoinEvictsGhostNotReplacement(t *testing.T) {
	h := newHub()
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()

	code := h.CreateRide()
	if code == "" {
		t.Fatal("CreateRide returned empty code")
	}
	const riderID = "regressor1"

	conn1 := dialRide(t, srv, code, riderID)
	defer conn1.Close()

	// Send a fix, mirroring a real rider — exercises the same c.hub.mu path readPump
	// takes, though it's incidental to the assertion below.
	if err := conn1.WriteJSON(locMsg{Type: "loc", Lat: 1, Lng: 2, Speed: 3, Ts: time.Now().Unix()}); err != nil {
		t.Fatalf("WriteJSON: %v", err)
	}
	time.Sleep(20 * time.Millisecond)

	h.mu.Lock()
	first := h.rooms[code].riders[riderID]
	h.mu.Unlock()
	if first == nil {
		t.Fatal("first client not seated")
	}

	// Reconnect with the same rider id — this is the eviction path under test.
	conn2 := dialRide(t, srv, code, riderID)
	defer conn2.Close()

	h.mu.Lock()
	room := h.rooms[code]
	second := room.riders[riderID]
	n := len(room.riders)
	h.mu.Unlock()
	if n != 1 {
		t.Fatalf("room has %d riders after reconnect, want 1", n)
	}
	if second == first {
		t.Fatal("reconnect did not replace the previously seated client")
	}

	// The evicted client's writePump wakes on its closed send channel, writes a close
	// frame, and closes the conn — so conn1's next read must fail.
	conn1.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn1.ReadMessage(); err == nil {
		t.Fatal("expected the evicted connection to be closed")
	}

	// ...which is what makes the OLD client's readPump return and run its
	// `defer c.hub.remove(c)`. remove must check identity (cur == c), not just the id,
	// or this cleanup — running well after the reconnect — would delete the
	// replacement: the ghost-rider fix kicking the very rider it exists to save.
	deadline := time.Now().Add(2 * time.Second)
	for {
		h.mu.Lock()
		cur := h.rooms[code].riders[riderID]
		h.mu.Unlock()
		if cur == second {
			return // still seated — correct
		}
		if time.Now().After(deadline) {
			t.Fatalf("new client was evicted by the old connection's cleanup (got %v, want %v)", cur, second)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestServeWSUnknownCodeReturns404(t *testing.T) {
	h := newHub()
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()

	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?ride=NOTMINTED&rider=someone12"
	_, resp, err := websocket.DefaultDialer.Dial(u, nil)
	if err == nil {
		t.Fatal("expected the dial to fail for an unminted ride code")
	}
	if resp == nil {
		t.Fatal("expected an HTTP response even though the upgrade failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}

func TestServeWSMintedCodeUpgradesAndWelcomes(t *testing.T) {
	h := newHub()
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()

	code := h.CreateRide()
	if code == "" {
		t.Fatal("CreateRide returned empty code")
	}

	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?ride=" + code + "&rider=minted001"
	conn, resp, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusSwitchingProtocols)
	}

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("reading welcome: %v", err)
	}
	var welcome struct {
		Type string `json:"type"`
		ID   string `json:"id"`
	}
	if err := json.Unmarshal(data, &welcome); err != nil {
		t.Fatalf("welcome frame is not JSON: %q: %v", data, err)
	}
	if welcome.Type != "welcome" || welcome.ID != "minted001" {
		t.Errorf("welcome = %+v, want {type:welcome id:minted001}", welcome)
	}
}

func TestSweepCollectsOnlyRoomsEmptyPastGrace(t *testing.T) {
	h := newHub()
	base := time.Now()

	occupied := h.CreateRide()
	emptied := h.CreateRide()
	rejoined := h.CreateRide()
	neverJoined := h.CreateRide()
	for _, code := range []string{occupied, emptied, rejoined, neverJoined} {
		if code == "" {
			t.Fatal("CreateRide returned empty code")
		}
	}

	// occupied: has a seated rider throughout — never eligible for GC.
	h.rooms[occupied].riders["r1"] = &Client{id: "r1"}

	// emptied: went empty right at base; still empty at sweep time.
	h.rooms[emptied].emptySince = base

	// rejoined: emptySince is old enough to be past grace on its own, but a rider is
	// seated now — occupied rooms are never collected regardless of emptySince.
	h.rooms[rejoined].emptySince = base.Add(-roomGrace)
	h.rooms[rejoined].riders["r2"] = &Client{id: "r2"}

	// neverJoined: CreateRide already set emptySince ≈ base and it was never seated —
	// ages out exactly like any other empty room.

	past := base.Add(roomGrace + time.Second)
	h.sweep(past)

	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.rooms[occupied]; !ok {
		t.Error("occupied room was collected")
	}
	if _, ok := h.rooms[emptied]; ok {
		t.Error("room empty past grace was not collected")
	}
	if _, ok := h.rooms[rejoined]; !ok {
		t.Error("occupied (rejoined) room was collected despite a stale emptySince")
	}
	if _, ok := h.rooms[neverJoined]; ok {
		t.Error("never-joined room past grace was not collected")
	}
}

func TestSetRouteUnknownCodeReturnsFalse(t *testing.T) {
	h := newHub()
	if h.SetRoute("NOTMINTED", []byte(`{"type":"route"}`)) {
		t.Error("SetRoute returned true for a code that was never minted")
	}
}

// TestSetRouteSurvivesUntilRoomGCd covers both halves of the brief: routeMsg
// (a) survives sweeps that don't collect the room, and (b) goes away only because the
// whole room does, at roomGrace — there is no separate expiry of the route itself.
func TestSetRouteSurvivesUntilRoomGCd(t *testing.T) {
	h := newHub()
	base := time.Now()

	code := h.CreateRide()
	if code == "" {
		t.Fatal("CreateRide returned empty code")
	}

	msg := []byte(`{"type":"route","ride":"` + code + `"}`)
	if !h.SetRoute(code, msg) {
		t.Fatal("SetRoute returned false for a freshly minted code")
	}

	// A sweep well before roomGrace must not disturb the room or its route — SetRoute
	// must not have touched emptySince either (a separate assertion below).
	h.sweep(base.Add(time.Second))
	h.mu.Lock()
	got := h.rooms[code].routeMsg
	h.mu.Unlock()
	if string(got) != string(msg) {
		t.Fatalf("routeMsg did not survive an intermediate sweep: got %s, want %s", got, msg)
	}

	// Past grace, the still-empty room is collected — and the route goes with it,
	// since it lives on the Room struct rather than anywhere independent.
	h.sweep(base.Add(roomGrace + time.Second))
	h.mu.Lock()
	_, exists := h.rooms[code]
	h.mu.Unlock()
	if exists {
		t.Error("room past grace was not collected")
	}
}

func TestSetRouteDoesNotResetEmptySince(t *testing.T) {
	h := newHub()
	code := h.CreateRide()
	if code == "" {
		t.Fatal("CreateRide returned empty code")
	}

	before := time.Now().Add(-time.Minute)
	h.mu.Lock()
	h.rooms[code].emptySince = before
	h.mu.Unlock()

	if !h.SetRoute(code, []byte(`{"type":"route"}`)) {
		t.Fatal("SetRoute returned false for a freshly minted code")
	}

	h.mu.Lock()
	got := h.rooms[code].emptySince
	h.mu.Unlock()
	if !got.Equal(before) {
		t.Errorf("emptySince = %v, want unchanged %v — SetRoute must not touch room lifecycle", got, before)
	}
}

func TestCreateRideCodesAreDistinct(t *testing.T) {
	h := newHub()
	seen := make(map[string]bool, 500)
	for i := 0; i < 500; i++ {
		code := h.CreateRide()
		if code == "" {
			t.Fatal("CreateRide returned empty code")
		}
		if len(code) != 6 {
			t.Errorf("code %q has length %d, want 6", code, len(code))
		}
		for _, r := range code {
			if !strings.ContainsRune(codeAlphabet, r) {
				t.Errorf("code %q contains %q, outside codeAlphabet", code, r)
			}
		}
		if seen[code] {
			t.Fatalf("duplicate code minted: %q", code)
		}
		seen[code] = true
	}
}

// TestConcurrentJoinSendDisconnect has no interesting assertions of its own — running
// it under -race is the point. N riders join, send a fix, and disconnect while sweep
// runs concurrently on its own goroutine, exercising registration, eviction, the loc
// write path, and room GC all racing against each other.
func TestConcurrentJoinSendDisconnect(t *testing.T) {
	h := newHub()
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWS))
	defer srv.Close()

	code := h.CreateRide()
	if code == "" {
		t.Fatal("CreateRide returned empty code")
	}

	stop := make(chan struct{})
	var sweepDone sync.WaitGroup
	sweepDone.Add(1)
	go func() {
		defer sweepDone.Done()
		ticker := time.NewTicker(2 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case now := <-ticker.C:
				h.sweep(now)
			}
		}
	}()

	const n = 20
	var riders sync.WaitGroup
	riders.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer riders.Done()
			id := fmt.Sprintf("concurrent%02d", i)
			u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?ride=" + code + "&rider=" + id
			conn, _, err := websocket.DefaultDialer.Dial(u, nil)
			if err != nil {
				t.Errorf("dial: %v", err)
				return
			}
			defer conn.Close()
			conn.SetReadDeadline(time.Now().Add(2 * time.Second))
			conn.ReadMessage() // welcome
			conn.WriteJSON(locMsg{Type: "loc", Lat: 1, Lng: 2, Speed: 1, Ts: time.Now().Unix()})
			time.Sleep(5 * time.Millisecond)
		}(i)
	}
	riders.Wait()
	close(stop)
	sweepDone.Wait()
}
