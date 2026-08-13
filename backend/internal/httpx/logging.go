package httpx

import (
	"log/slog"
	"net/http"
	"time"
)

// healthPath is logged at debug rather than info. Uptime monitoring polls it on a
// schedule forever, and at info it would out-number every line that describes a rider.
const healthPath = "/healthz"

// Log returns middleware that emits one structured line per request.
//
// It sits inside Recover and outside CORS: outside CORS so that preflights are visible
// — a 403 on a preflight is exactly the kind of failure worth having in a log, and CORS
// answers those itself without ever reaching the mux.
//
// # What is deliberately not logged
//
// The query string. /ws carries ?name= — a rider's display name. r.URL.Path is logged;
// r.URL.RawQuery and r.RequestURI are not, and neither is any request body.
//
// Headers are not logged either, which is what keeps the Authorization bearer token out
// of the log (ADR-017). Identity used to ride in ?rider=; since ADR-017 it is the JWT's
// `sub` claim, derived server-side, so the query string no longer carries it at all.
//
// Coordinates never appear here at all: this middleware sees the WebSocket upgrade, not
// the loc frames that flow over it afterwards (docs/SYSTEM_DESIGN.md — location is
// the most sensitive data class in the app).
//
// remote is r.RemoteAddr as the server sees it. Behind the Cloudflare Tunnel this
// becomes the tunnel's address for every request; making it meaningful again needs
// proxy-aware header handling, which is deliberately not done here — trusting
// X-Forwarded-For without knowing the hop count is a spoofing vector.
func Log(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := newResponseRecorder(w)

			// Deferred so the line is emitted even when the handler panics. In that
			// case status reads 200 — see responseRecorder.status — and Recover's
			// "panic recovered" line, carrying the same method and path, is the
			// authoritative record.
			defer func() {
				level := slog.LevelInfo
				if r.URL.Path == healthPath {
					level = slog.LevelDebug
				}
				logger.LogAttrs(r.Context(), level, "http request",
					slog.String("method", r.Method),
					slog.String("path", r.URL.Path),
					slog.Int("status", rec.status),
					slog.Duration("duration", time.Since(start)),
					slog.Int64("bytes", rec.bytes),
					slog.String("remote", r.RemoteAddr),
				)
			}()

			next.ServeHTTP(rec, r)
		})
	}
}
