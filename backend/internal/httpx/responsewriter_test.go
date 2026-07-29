package httpx

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

// hijackableWriter is an httptest.ResponseRecorder that also implements http.Hijacker
// and http.Flusher, standing in for the real *http.response the server passes handlers.
type hijackableWriter struct {
	*httptest.ResponseRecorder
	hijackCalled bool
	hijackErr    error
	flushed      bool
}

func (h *hijackableWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h.hijackCalled = true
	if h.hijackErr != nil {
		return nil, nil, h.hijackErr
	}
	client, server := net.Pipe()
	go func() { _ = server.Close() }()
	return client, bufio.NewReadWriter(bufio.NewReader(client), bufio.NewWriter(client)), nil
}

func (h *hijackableWriter) Flush() { h.flushed = true }

func newHijackable() *hijackableWriter {
	return &hijackableWriter{ResponseRecorder: httptest.NewRecorder()}
}

// The compile-time assertion that matters most. gorilla/websocket reaches the raw
// connection with a direct w.(http.Hijacker) assertion, so losing this method breaks
// every WebSocket upgrade while leaving every HTTP test in this package passing.
var (
	_ http.ResponseWriter = (*responseRecorder)(nil)
	_ http.Hijacker       = (*responseRecorder)(nil)
	_ http.Flusher        = (*responseRecorder)(nil)
)

func TestResponseRecorderDefaultsTo200(t *testing.T) {
	rec := newResponseRecorder(httptest.NewRecorder())

	// A handler that returns without writing anything still produces 200 from
	// net/http, so that is what the recorder must report.
	if rec.status != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.status, http.StatusOK)
	}
	if rec.wroteHeader {
		t.Error("wroteHeader = true before anything was written")
	}
	if rec.bytes != 0 {
		t.Errorf("bytes = %d, want 0", rec.bytes)
	}
}

func TestResponseRecorderRecordsStatusAndBytes(t *testing.T) {
	inner := httptest.NewRecorder()
	rec := newResponseRecorder(inner)

	rec.WriteHeader(http.StatusTeapot)
	n, err := rec.Write([]byte("hello"))
	if err != nil {
		t.Fatalf("Write: %v", err)
	}

	if n != 5 {
		t.Errorf("Write returned %d, want 5", n)
	}
	if rec.status != http.StatusTeapot {
		t.Errorf("status = %d, want %d", rec.status, http.StatusTeapot)
	}
	if rec.bytes != 5 {
		t.Errorf("bytes = %d, want 5", rec.bytes)
	}
	if !rec.wroteHeader {
		t.Error("wroteHeader = false after WriteHeader")
	}
	if got := inner.Body.String(); got != "hello" {
		t.Errorf("body reached the inner writer as %q, want %q", got, "hello")
	}
}

func TestResponseRecorderWriteImpliesStatus200(t *testing.T) {
	rec := newResponseRecorder(httptest.NewRecorder())

	if _, err := rec.Write([]byte("body")); err != nil {
		t.Fatalf("Write: %v", err)
	}

	if !rec.wroteHeader {
		t.Error("wroteHeader = false; the first Write must imply WriteHeader(200)")
	}
	if rec.status != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.status, http.StatusOK)
	}
}

func TestResponseRecorderKeepsFirstStatus(t *testing.T) {
	rec := newResponseRecorder(httptest.NewRecorder())

	rec.WriteHeader(http.StatusCreated)
	rec.WriteHeader(http.StatusInternalServerError) // net/http would log "superfluous"

	// The client saw 201. Recording the second call would make the log disagree with
	// what was actually sent.
	if rec.status != http.StatusCreated {
		t.Errorf("status = %d, want %d — the first status is the one the client saw",
			rec.status, http.StatusCreated)
	}
}

func TestResponseRecorderHijackDelegatesAndRecords101(t *testing.T) {
	inner := newHijackable()
	rec := newResponseRecorder(inner)

	conn, brw, err := rec.Hijack()
	if err != nil {
		t.Fatalf("Hijack: %v", err)
	}
	defer conn.Close()

	if !inner.hijackCalled {
		t.Error("Hijack did not reach the underlying writer")
	}
	if brw == nil {
		t.Error("Hijack returned a nil bufio.ReadWriter")
	}
	if !rec.hijacked {
		t.Error("hijacked = false after a successful Hijack")
	}
	// gorilla writes the 101 handshake straight to the connection, bypassing this
	// writer. Without recording it here the access log would claim 200.
	if rec.status != http.StatusSwitchingProtocols {
		t.Errorf("status = %d, want %d", rec.status, http.StatusSwitchingProtocols)
	}
}

func TestResponseRecorderWriteHeaderAfterHijackIsIgnored(t *testing.T) {
	rec := newResponseRecorder(newHijackable())

	conn, _, err := rec.Hijack()
	if err != nil {
		t.Fatalf("Hijack: %v", err)
	}
	defer conn.Close()

	rec.WriteHeader(http.StatusInternalServerError)

	if rec.status != http.StatusSwitchingProtocols {
		t.Errorf("status = %d, want %d — a hijacked connection cannot be given a status",
			rec.status, http.StatusSwitchingProtocols)
	}
}

func TestResponseRecorderHijackErrorLeavesStateClean(t *testing.T) {
	inner := newHijackable()
	inner.hijackErr = http.ErrNotSupported
	rec := newResponseRecorder(inner)

	if _, _, err := rec.Hijack(); err == nil {
		t.Fatal("Hijack returned nil error, want the underlying failure")
	}

	// A failed hijack means the writer is still usable, so recovery must still be able
	// to write a 500 through it.
	if rec.hijacked {
		t.Error("hijacked = true after a failed Hijack")
	}
	if rec.status != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.status, http.StatusOK)
	}
}

func TestResponseRecorderHijackOnNonHijacker(t *testing.T) {
	// httptest.ResponseRecorder is not a Hijacker.
	rec := newResponseRecorder(httptest.NewRecorder())

	_, _, err := rec.Hijack()
	if err == nil {
		t.Fatal("Hijack returned nil error on a non-hijackable writer")
	}
	if rec.hijacked {
		t.Error("hijacked = true after Hijack failed")
	}
}

func TestResponseRecorderFlushDelegates(t *testing.T) {
	inner := newHijackable()
	rec := newResponseRecorder(inner)

	rec.Flush()

	if !inner.flushed {
		t.Error("Flush did not reach the underlying writer")
	}
}

func TestResponseRecorderFlushOnNonFlusherDoesNotPanic(t *testing.T) {
	// A writer that implements neither Flusher nor Hijacker.
	rec := newResponseRecorder(struct{ http.ResponseWriter }{httptest.NewRecorder()})
	rec.Flush() // must be a no-op, not a panic
}

func TestResponseRecorderUnwrap(t *testing.T) {
	inner := httptest.NewRecorder()
	rec := newResponseRecorder(inner)

	if rec.Unwrap() != http.ResponseWriter(inner) {
		t.Error("Unwrap did not return the wrapped writer")
	}
}

// Recover and Log each wrap the writer, so recorders nest in the real chain. The inner
// one must still see everything.
func TestResponseRecordersNest(t *testing.T) {
	outer := newResponseRecorder(newHijackable())
	inner := newResponseRecorder(outer)

	inner.WriteHeader(http.StatusAccepted)
	if _, err := inner.Write([]byte("xy")); err != nil {
		t.Fatalf("Write: %v", err)
	}

	for _, tc := range []struct {
		name string
		rec  *responseRecorder
	}{{"inner", inner}, {"outer", outer}} {
		if tc.rec.status != http.StatusAccepted {
			t.Errorf("%s status = %d, want %d", tc.name, tc.rec.status, http.StatusAccepted)
		}
		if tc.rec.bytes != 2 {
			t.Errorf("%s bytes = %d, want 2", tc.name, tc.rec.bytes)
		}
	}

	// Hijack must still reach the bottom of a nested stack.
	conn, _, err := inner.Hijack()
	if err != nil {
		t.Fatalf("Hijack through nested recorders: %v", err)
	}
	defer conn.Close()
	if !outer.hijacked {
		t.Error("outer recorder did not observe the hijack")
	}
}
