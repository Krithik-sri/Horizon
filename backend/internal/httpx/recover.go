package httpx

import (
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
)

// Recover returns middleware that stops a panicking handler from taking the process
// down, and is the outermost layer of the chain so that a panic anywhere else in the
// chain — including in Log or CORS — is caught too.
//
// Why this matters more here than in a typical service: every ride is held in memory
// (hub.Hub.rooms). A process death does not drop one request, it ends every ride in
// progress, on real bicycles, with no way to recover the state.
//
// # Scope: HTTP handlers only
//
// This recovers panics on the HTTP handler goroutine and nothing else. Room itself has no
// goroutine of its own (hub.Room is plain data, guarded by Hub.mu — see hub/room.go) but
// Client.readPump and Client.writePump each run on their own goroutine outside this chain,
// and a panic in either still terminates the process, because an unrecovered panic in any
// goroutine does. Recovering those is left for whenever that becomes a real problem; a
// half-recovered pump that keeps looping on corrupt state is worse than a clean crash.
func Recover(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Wrapping here — rather than reaching for the recorder Log creates — is
			// what makes the two middlewares independent: Recover is correct whether or
			// not Log is in the chain. Nested recorders pass through to one another.
			rec := newResponseRecorder(w)

			defer func() {
				v := recover()
				if v == nil {
					return
				}

				// net/http's sentinel for "abort this handler silently". The server
				// itself recovers it without logging; converting it to a 500 would turn
				// an intentional abort into a fabricated error.
				if v == http.ErrAbortHandler {
					panic(v)
				}

				// Captured inside the deferred call, while the panicking frames are
				// still on the stack. Taken any later, it describes only the unwinding.
				stack := debug.Stack()

				logger.LogAttrs(r.Context(), slog.LevelError, "panic recovered",
					// fmt.Sprint rather than slog.Any: the JSON handler renders an
					// arbitrary value through json.Marshal, so a panic carrying a struct
					// with no exported fields logs as "panic":{} and the value is lost.
					// Sprint is lossless for every value a panic can hold.
					slog.String("panic", fmt.Sprint(v)),
					slog.String("method", r.Method),
					slog.String("path", r.URL.Path),
					slog.String("remote", r.RemoteAddr),
					slog.String("stack", string(stack)),
				)

				// Both of these make writing a response impossible rather than merely
				// untidy: after a hijack the ResponseWriter no longer reaches the client
				// (a WebSocket that panicked post-upgrade would get a 500 injected into
				// its frame stream), and after a status has gone out the client is
				// already reading a response that cannot be retracted.
				if rec.hijacked || rec.wroteHeader {
					return
				}

				// Generic body. The panic value and the stack went to the log; neither
				// belongs in a response, where they describe internals to whoever
				// triggered them.
				http.Error(rec, "internal server error", http.StatusInternalServerError)
			}()

			next.ServeHTTP(rec, r)
		})
	}
}
