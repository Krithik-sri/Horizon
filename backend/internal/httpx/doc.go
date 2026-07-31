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
//	Recover → Log → CORS → mux
//
// Recovery is outermost so that a panic in any other middleware is still caught. CORS
// sets its headers before delegating, which is what lets a 500 written by Recover carry
// them, so a browser surfaces the error instead of an opaque CORS failure.
package httpx
