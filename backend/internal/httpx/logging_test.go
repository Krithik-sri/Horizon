package httpx

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLogRecordsRequestFields(t *testing.T) {
	var buf bytes.Buffer
	h := Log(testLogger(&buf))(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("hello"))
	}))

	req := httptest.NewRequest(http.MethodPost, "/rides", nil)
	req.RemoteAddr = "198.51.100.7:12345"
	h.ServeHTTP(httptest.NewRecorder(), req)

	lines := logLines(t, &buf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1", len(lines))
	}
	line := lines[0]

	checks := map[string]any{
		"level":  "INFO",
		"msg":    "http request",
		"method": http.MethodPost,
		"path":   "/rides",
		"remote": "198.51.100.7:12345",
	}
	for field, want := range checks {
		if line[field] != want {
			t.Errorf("%s = %v, want %v", field, line[field], want)
		}
	}

	// JSON numbers decode as float64.
	if got := line["status"]; got != float64(http.StatusCreated) {
		t.Errorf("status = %v, want %d", got, http.StatusCreated)
	}
	if got := line["bytes"]; got != float64(5) {
		t.Errorf("bytes = %v, want 5", got)
	}
	if _, ok := line["duration"]; !ok {
		t.Error("duration field is absent")
	}
}

func TestLogDefaultsStatusTo200(t *testing.T) {
	var buf bytes.Buffer
	// A handler that writes nothing still produces 200 from net/http.
	h := Log(testLogger(&buf))(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))

	lines := logLines(t, &buf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1", len(lines))
	}
	if got := lines[0]["status"]; got != float64(http.StatusOK) {
		t.Errorf("status = %v, want 200", got)
	}
}

// The privacy rule: /ws carries ?name= and ?rider=, which identify a person.
func TestLogOmitsQueryString(t *testing.T) {
	var buf bytes.Buffer
	h := Log(testLogger(&buf))(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

	req := httptest.NewRequest(http.MethodGet, "/ws?ride=ABC123&name=Sam&rider=deadbeef", nil)
	h.ServeHTTP(httptest.NewRecorder(), req)

	out := buf.String()
	if got := logLines(t, &buf)[0]["path"]; got != "/ws" {
		t.Errorf("path = %v, want /ws with no query", got)
	}
	for _, secret := range []string{"Sam", "deadbeef", "ride=", "name=", "rider="} {
		if strings.Contains(out, secret) {
			t.Errorf("log leaks %q:\n%s", secret, out)
		}
	}
}

func TestLogHealthzAtDebug(t *testing.T) {
	// At info, the health check must not appear — monitoring polls it forever.
	var buf bytes.Buffer
	infoLogger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	h := Log(infoLogger)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, healthPath, nil))

	if got := strings.TrimSpace(buf.String()); got != "" {
		t.Errorf("health check logged at info level: %s", got)
	}

	// At debug it is still available when someone is actually debugging.
	var debugBuf bytes.Buffer
	h = Log(testLogger(&debugBuf))(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, healthPath, nil))

	lines := logLines(t, &debugBuf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines at debug, want 1", len(lines))
	}
	if lines[0]["level"] != "DEBUG" {
		t.Errorf("level = %v, want DEBUG", lines[0]["level"])
	}
}

func TestLogRecordsPositiveDuration(t *testing.T) {
	var buf bytes.Buffer
	h := Log(testLogger(&buf))(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		time.Sleep(2 * time.Millisecond)
	}))

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))

	d, ok := logLines(t, &buf)[0]["duration"].(float64)
	if !ok {
		t.Fatal("duration is not a number")
	}
	if d <= 0 {
		t.Errorf("duration = %v, want > 0", d)
	}
}

// A hijacked request must be logged as 101, not as the default 200.
func TestLogRecordsHijackAs101(t *testing.T) {
	var buf bytes.Buffer
	h := Log(testLogger(&buf))(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Errorf("Hijack through the logging middleware: %v", err)
			return
		}
		_ = conn.Close()
	}))

	h.ServeHTTP(newHijackable(), httptest.NewRequest(http.MethodGet, "/ws", nil))

	if got := logLines(t, &buf)[0]["status"]; got != float64(http.StatusSwitchingProtocols) {
		t.Errorf("status = %v, want 101", got)
	}
}

// The line must still be emitted when the handler panics, so a panicking request is
// never invisible in the access log.
func TestLogEmitsLineOnPanic(t *testing.T) {
	var buf bytes.Buffer
	h := Log(testLogger(&buf))(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))

	func() {
		defer func() { _ = recover() }()
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/rides", nil))
	}()

	lines := logLines(t, &buf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1", len(lines))
	}
	if lines[0]["path"] != "/rides" {
		t.Errorf("path = %v", lines[0]["path"])
	}
}
