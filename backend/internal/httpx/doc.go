// Package httpx holds the top-level HTTP middleware for the Horizon backend.
//
// Middleware lives here rather than in main.go so it can be unit-tested without a
// listener, a mux, or a hub; main.go stays a composition root that only wires things
// together (see buildHandler in backend/main.go).
//
// One concern per file: cors.go, logging.go, recover.go, and responsewriter.go — the
// shared http.ResponseWriter wrapper that logging needs for the status code and that
// recovery needs in order to know whether writing a response is still legal.
//
// # The Hijacker rule
//
// gorilla/websocket obtains the raw connection with a direct w.(http.Hijacker) type
// assertion (server.go:175 in v1.5.3) — not http.ResponseController, and not Unwrap().
// Any http.ResponseWriter wrapper in this package must therefore implement Hijack()
// itself, or every WebSocket upgrade fails with "response does not implement
// http.Hijacker". responseRecorder does. A wrapper added later must too, and
// implementing only Unwrap() is not sufficient.
//
// The chain that main.go builds is:
//
//	Recover → Log → CORS → Auth → mux
//
// Recovery is outermost so that a panic in any other middleware is still caught. CORS
// sets its headers before delegating, which is what lets a 500 written by Recover carry
// them, so a browser surfaces the error instead of an opaque CORS failure.
//
// # Auth is not in this package
//
// Auth (internal/auth.Verifier.Require) sits inside CORS and outside the mux, but lives
// in its own leaf package rather than here — verifying a Supabase JWT is a different
// concern from applying browser cross-origin policy or writing an access log line, and
// internal/auth has no reason to depend on this package or vice versa. It wraps the
// whole mux for the same reason CORS does: a route added later must inherit the
// boundary without anyone remembering to wire it in (docs/ADR/ADR-017.md Decision §1).
//
// Its position in the chain is load-bearing in the same two directions CORS's is
// (docs/ADR/ADR-017.md Decision §2):
//
//   - Inside CORS, because a browser preflight (OPTIONS carrying
//     Access-Control-Request-Method) carries no Authorization header — the browser
//     strips it. Auth outside CORS would therefore 401 every preflight; CORS answers
//     preflights itself, before Auth ever sees them.
//   - Inside Log, so a 401 shows up in the access log. An auth boundary whose
//     rejections are invisible is not observable.
package httpx
