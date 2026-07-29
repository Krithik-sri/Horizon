package httpx

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// testLogger returns a logger writing JSON into buf, at debug so nothing is filtered.
func testLogger(buf *bytes.Buffer) *slog.Logger {
	return slog.New(slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

// logLines parses each JSON object the handler emitted.
func logLines(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("log line is not JSON: %q: %v", line, err)
		}
		out = append(out, m)
	}
	return out
}

func TestRecoverReturns500AndSurvives(t *testing.T) {
	var buf bytes.Buffer
	h := Recover(testLogger(&buf))(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))

	rec := httptest.NewRecorder()
	// The test process reaching the next line at all is half the assertion.
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/rides", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}

	body := rec.Body.String()
	if !strings.Contains(body, "internal server error") {
		t.Errorf("body = %q, want a generic message", body)
	}
	// The panic value and stack go to the log, never to the client.
	if strings.Contains(body, "boom") {
		t.Errorf("body = %q — it leaks the panic value", body)
	}
	if strings.Contains(body, "goroutine") {
		t.Errorf("body = %q — it leaks a stack trace", body)
	}
}

func TestRecoverLogsPanicWithStack(t *testing.T) {
	var buf bytes.Buffer
	h := Recover(testLogger(&buf))(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))

	req := httptest.NewRequest(http.MethodPost, "/rides", nil)
	req.RemoteAddr = "203.0.113.9:54321"
	h.ServeHTTP(httptest.NewRecorder(), req)

	lines := logLines(t, &buf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1", len(lines))
	}
	line := lines[0]

	if line["level"] != "ERROR" {
		t.Errorf("level = %v, want ERROR", line["level"])
	}
	if line["msg"] != "panic recovered" {
		t.Errorf("msg = %v", line["msg"])
	}
	if line["panic"] != "boom" {
		t.Errorf("panic = %v, want boom", line["panic"])
	}
	if line["method"] != http.MethodPost {
		t.Errorf("method = %v", line["method"])
	}
	if line["path"] != "/rides" {
		t.Errorf("path = %v", line["path"])
	}
	if line["remote"] != "203.0.113.9:54321" {
		t.Errorf("remote = %v", line["remote"])
	}

	stack, ok := line["stack"].(string)
	if !ok || stack == "" {
		t.Fatalf("stack = %v, want a non-empty trace", line["stack"])
	}
	// Captured inside the deferred call, so the panicking frame is still present.
	if !strings.Contains(stack, "goroutine") {
		t.Errorf("stack does not look like a trace: %q", stack)
	}
	if !strings.Contains(stack, "httpx.TestRecoverLogsPanicWithStack") {
		t.Errorf("stack does not contain the panicking frame:\n%s", stack)
	}
}

func TestRecoverRepanicsErrAbortHandler(t *testing.T) {
	var buf bytes.Buffer
	h := Recover(testLogger(&buf))(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(http.ErrAbortHandler)
	}))

	// net/http recovers ErrAbortHandler itself and aborts silently; converting it to a
	// 500 would fabricate an error the handler deliberately avoided.
	defer func() {
		v := recover()
		if v == nil {
			t.Fatal("ErrAbortHandler was swallowed, want it re-panicked")
		}
		if v != http.ErrAbortHandler {
			t.Fatalf("re-panicked with %v, want http.ErrAbortHandler", v)
		}
		if n := len(logLines(t, &buf)); n != 0 {
			t.Errorf("got %d log lines, want 0 — an intentional abort is not an error", n)
		}
	}()

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
}

func TestRecoverDoesNotWriteAfterHeadersSent(t *testing.T) {
	var buf bytes.Buffer
	h := Recover(testLogger(&buf))(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("partial"))
		panic("boom after headers")
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	// The client is already reading a 200; it cannot be retracted.
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d — the status was already sent", rec.Code, http.StatusOK)
	}
	if got := rec.Body.String(); got != "partial" {
		t.Errorf("body = %q, want %q with no 500 appended", got, "partial")
	}
	// It is still logged — the panic happened.
	if n := len(logLines(t, &buf)); n != 1 {
		t.Errorf("got %d log lines, want 1", n)
	}
}

func TestRecoverDoesNotWriteAfterHijack(t *testing.T) {
	var buf bytes.Buffer
	h := Recover(testLogger(&buf))(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Errorf("Hijack: %v", err)
			return
		}
		_ = conn.Close()
		panic("boom after upgrade")
	}))

	inner := newHijackable()
	h.ServeHTTP(inner, httptest.NewRequest(http.MethodGet, "/ws", nil))

	// Writing a 500 into a hijacked connection would inject HTTP into what is now a
	// WebSocket frame stream.
	if body := inner.Body.String(); body != "" {
		t.Errorf("body = %q, want nothing written to a hijacked connection", body)
	}
	if n := len(logLines(t, &buf)); n != 1 {
		t.Errorf("got %d log lines, want 1", n)
	}
}

func TestRecoverPassesThroughWhenNoPanic(t *testing.T) {
	var buf bytes.Buffer
	h := Recover(testLogger(&buf))(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("ok"))
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}
	if got := rec.Body.String(); got != "ok" {
		t.Errorf("body = %q", got)
	}
	if n := len(logLines(t, &buf)); n != 0 {
		t.Errorf("got %d log lines, want 0 on the happy path", n)
	}
}

func TestRecoverHandlesNonStringPanicValues(t *testing.T) {
	var buf bytes.Buffer
	h := Recover(testLogger(&buf))(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		// A genuine runtime error rather than an explicit panic("string"), proving
		// recovery covers runtime.Error too. Driven by request data so no static
		// analyser can fold it away and report it as a defect.
		empty := make([]int, 0)
		_ = empty[len(r.URL.Path)]
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	lines := logLines(t, &buf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1", len(lines))
	}
	if lines[0]["panic"] == nil {
		t.Error("panic field is absent for a runtime error")
	}
}

// Recovery is outermost precisely so that a panic in another middleware is caught too.
func TestRecoverCatchesPanicInInnerMiddleware(t *testing.T) {
	var buf bytes.Buffer
	exploding := func(http.Handler) http.Handler {
		return http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			panic("middleware boom")
		})
	}

	h := Recover(testLogger(&buf))(exploding(http.HandlerFunc(
		func(http.ResponseWriter, *http.Request) { t.Error("mux should not be reached") })))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}
