package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/krithik/horizon/backend/internal/hub"
	"github.com/krithik/horizon/backend/internal/ors"
)

const testOrigin = "http://localhost:8081"

// syncBuffer is a bytes.Buffer that survives the server writing to it from a handler
// goroutine while the test reads it. The plain buffer would be a data race.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// newTestServer starts the real handler chain — Recover → Log → CORS → mux — over a
// real hub, and returns it alongside the buffer its logger writes to.
//
// These are wiring tests. The individual middlewares are covered in internal/httpx;
// what can only be verified here is that the composition works, which is precisely
// where a ResponseWriter wrapper breaks WebSockets.
//
// orsClient may be nil for tests that never touch the route endpoint — it falls back
// to an unconfigured client (blank key), which is enough to keep buildHandler happy
// without any test needing to know that.
func newTestServer(t *testing.T, origins []string, orsClient *ors.Client) (*httptest.Server, *syncBuffer) {
	t.Helper()
	buf := &syncBuffer{}
	logger := slog.New(slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	if orsClient == nil {
		orsClient = ors.New("", nil)
	}
	srv := httptest.NewServer(buildHandler(logger, origins, hub.New(), orsClient))
	t.Cleanup(srv.Close)
	return srv, buf
}

// mintRideCode POSTs /rides and returns the code, so tests that dial /ws can use a
// code the hub actually reserved. A hardcoded code 404s now that ride codes are a real
// registry instead of whatever the first /ws client happened to type.
func mintRideCode(t *testing.T, srv *httptest.Server, origin string) string {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/rides", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	req.Header.Set("Origin", origin)
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("POST /rides: %v", err)
	}
	defer resp.Body.Close()
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decoding /rides response: %v", err)
	}
	return body.Code
}

// The regression this whole branch risks: a ResponseWriter wrapper that does not
// implement http.Hijacker fails every WebSocket upgrade with "response does not
// implement http.Hijacker", while leaving every HTTP-level test passing.
func TestWebSocketUpgradeSurvivesMiddlewareChain(t *testing.T) {
	srv, logs := newTestServer(t, []string{testOrigin}, nil)
	code := mintRideCode(t, srv, testOrigin)

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?ride=" + code + "&name=auditor&rider=aud12345"
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": {testOrigin}})
	if err != nil {
		if resp != nil {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			t.Fatalf("WebSocket upgrade failed through the chain: %v (status %d: %s)",
				err, resp.StatusCode, body)
		}
		t.Fatalf("WebSocket upgrade failed through the chain: %v", err)
	}
	defer conn.Close()

	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusSwitchingProtocols)
	}

	// The upgrade is only half of it — the connection has to actually carry traffic.
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("SetReadDeadline: %v", err)
	}
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("reading the welcome frame: %v", err)
	}

	var welcome struct {
		Type string `json:"type"`
		ID   string `json:"id"`
	}
	if err := json.Unmarshal(data, &welcome); err != nil {
		t.Fatalf("welcome frame is not JSON: %q: %v", data, err)
	}
	if welcome.Type != "welcome" {
		t.Errorf("first frame type = %q, want welcome", welcome.Type)
	}
	if welcome.ID != "aud12345" {
		t.Errorf("welcome id = %q, want the rider id we supplied", welcome.ID)
	}

	// And the access log must record it as an upgrade, not as a plain 200.
	line := findLogLine(t, logs, "/ws")
	if got := line["status"]; got != float64(http.StatusSwitchingProtocols) {
		t.Errorf("logged status = %v, want 101", got)
	}
	// The query carried a name and a rider id; neither may reach the log.
	if out := logs.String(); strings.Contains(out, "auditor") || strings.Contains(out, "aud12345") {
		t.Errorf("access log leaks identifying query parameters:\n%s", out)
	}
}

func TestCreateRideThroughChain(t *testing.T) {
	srv, logs := newTestServer(t, []string{testOrigin}, nil)

	req, err := http.NewRequest(http.MethodPost, srv.URL+"/rides", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	req.Header.Set("Origin", testOrigin)

	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("POST /rides: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
	// HZ-001's behaviour must survive the two new middlewares.
	if got := resp.Header.Get("Access-Control-Allow-Origin"); got != testOrigin {
		t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, testOrigin)
	}

	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(body.Code) != 6 {
		t.Errorf("code = %q, want 6 characters", body.Code)
	}

	line := findLogLine(t, logs, "/rides")
	if line["method"] != http.MethodPost {
		t.Errorf("logged method = %v", line["method"])
	}
	if got := line["status"]; got != float64(http.StatusOK) {
		t.Errorf("logged status = %v, want 200", got)
	}
	if got, ok := line["bytes"].(float64); !ok || got <= 0 {
		t.Errorf("logged bytes = %v, want > 0", line["bytes"])
	}
	if line["remote"] == "" || line["remote"] == nil {
		t.Error("logged remote is empty")
	}
}

func TestPreflightThroughChain(t *testing.T) {
	srv, _ := newTestServer(t, []string{testOrigin}, nil)

	req, err := http.NewRequest(http.MethodOptions, srv.URL+"/rides/ABC123/route", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	req.Header.Set("Origin", testOrigin)
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "content-type")

	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("OPTIONS: %v", err)
	}
	defer resp.Body.Close()

	// Terminates in CORS. Reaching the mux would produce 405 or the 501 stub, and a
	// non-2xx preflight makes the endpoint unreachable from a browser.
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("status = %d, want 204", resp.StatusCode)
	}
	if got := resp.Header.Get("Access-Control-Allow-Headers"); !strings.Contains(got, "Content-Type") {
		t.Errorf("Access-Control-Allow-Headers = %q", got)
	}
}

func TestHealthzThroughChain(t *testing.T) {
	srv, _ := newTestServer(t, nil, nil)

	resp, err := srv.Client().Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "ok" {
		t.Errorf("body = %q, want ok", body)
	}
}

func TestNewLogger(t *testing.T) {
	tests := []struct {
		raw       string
		wantLevel slog.Level
		wantErr   bool
	}{
		{"", slog.LevelInfo, false},
		{"debug", slog.LevelDebug, false},
		{"DEBUG", slog.LevelDebug, false},
		{"info", slog.LevelInfo, false},
		{"warn", slog.LevelWarn, false},
		{"error", slog.LevelError, false},
		// A typo must not stop the server booting — it degrades to info and says so.
		{"verbose", slog.LevelInfo, true},
	}

	for _, tt := range tests {
		t.Run("LOG_LEVEL="+tt.raw, func(t *testing.T) {
			logger, err := newLogger(tt.raw)
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if logger == nil {
				t.Fatal("logger is nil")
			}
			if !logger.Enabled(t.Context(), tt.wantLevel) {
				t.Errorf("level %v is not enabled", tt.wantLevel)
			}
			if tt.wantLevel > slog.LevelDebug && logger.Enabled(t.Context(), tt.wantLevel-1) {
				t.Errorf("a level below %v is enabled", tt.wantLevel)
			}
		})
	}
}

// findLogLine returns the first logged request line for path, waiting for it to appear.
//
// The wait is not incidental. The logging middleware emits its line in a defer, when
// the handler returns — and for /ws the client can receive the welcome frame before
// ServeWS has returned, because writePump is already running on its own goroutine.
// Reading the buffer immediately would be a race against the server, not a failure.
func findLogLine(t *testing.T, buf *syncBuffer, path string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		for _, raw := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
			if raw == "" {
				continue
			}
			var m map[string]any
			if err := json.Unmarshal([]byte(raw), &m); err != nil {
				t.Fatalf("log line is not JSON: %q: %v", raw, err)
			}
			if m["msg"] == "http request" && m["path"] == path {
				return m
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("no request log line for %q within 2s, got:\n%s", path, buf.String())
			return nil
		}
		time.Sleep(5 * time.Millisecond)
	}
}
