package httpx

import (
	"bufio"
	"errors"
	"net"
	"net/http"
)

// responseRecorder wraps an http.ResponseWriter to record what the handler chain below
// it actually did: the status code and byte count that request logging needs, and the
// wroteHeader/hijacked flags that panic recovery needs in order to decide whether
// writing a 500 is still legal.
//
// One wrapper serves both middlewares deliberately. Every wrapper is a chance to drop
// an optional interface the server depends on, and this package only wants to get that
// right once. Nesting is safe — Recover and Log each wrap, and the inner recorder sees
// everything the outer one passes down.
type responseRecorder struct {
	http.ResponseWriter

	// status defaults to 200 because that is what net/http sends when a handler
	// returns without ever calling WriteHeader. It is overwritten by WriteHeader, and
	// by Hijack, which sets 101.
	//
	// One case it cannot represent: if the handler panics before writing anything, the
	// recorder still reads 200, because the 500 is written by Recover further out,
	// through a different writer. The authoritative record of a panicked request is
	// Recover's paired "panic recovered" error line, which carries the same method and
	// path.
	status      int
	bytes       int64
	wroteHeader bool
	hijacked    bool
}

func newResponseRecorder(w http.ResponseWriter) *responseRecorder {
	return &responseRecorder{ResponseWriter: w, status: http.StatusOK}
}

func (r *responseRecorder) WriteHeader(code int) {
	// After a hijack the ResponseWriter is no longer connected to anything, and a
	// second WriteHeader makes net/http log "superfluous response.WriteHeader call".
	// Swallowing both keeps the log clean and the recorded status honest — the first
	// status written is the one the client saw.
	if r.wroteHeader || r.hijacked {
		return
	}
	r.status = code
	r.wroteHeader = true
	r.ResponseWriter.WriteHeader(code)
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	if !r.wroteHeader {
		// Mirror net/http: the first Write implies 200.
		r.WriteHeader(http.StatusOK)
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += int64(n)
	return n, err
}

// Hijack surrenders the connection to the caller, and is the single most important
// method on this type.
//
// gorilla/websocket reaches the raw connection with a direct w.(http.Hijacker) type
// assertion — it does not use http.ResponseController and does not call Unwrap(). A
// wrapper that omits this method therefore fails *every* WebSocket upgrade with
// "websocket: response does not implement http.Hijacker", which is to say it breaks the
// entire application while leaving every HTTP-level test passing.
func (r *responseRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("httpx: underlying ResponseWriter does not implement http.Hijacker")
	}
	conn, brw, err := h.Hijack()
	if err != nil {
		return conn, brw, err
	}
	// Record the upgrade rather than leaving the default 200. gorilla writes the 101
	// handshake straight to the connection, bypassing this writer, so without this the
	// access log would claim every WebSocket returned 200.
	r.hijacked = true
	r.status = http.StatusSwitchingProtocols
	return conn, brw, nil
}

// Flush delegates when the underlying writer supports it.
//
// Note that responseRecorder always satisfies http.Flusher, even when the writer it
// wraps does not — the usual trade-off for avoiding one wrapper type per combination of
// optional interfaces. Nothing in this server streams today; the method exists so that
// adding server-sent events later does not silently buffer forever.
func (r *responseRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap exposes the wrapped writer to http.ResponseController. This is additive
// convenience, not a substitute for Hijack above — ResponseController is not what
// gorilla/websocket uses.
func (r *responseRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }
