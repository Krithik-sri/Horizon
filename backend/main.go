package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/krithik/horizon/backend/internal/httpx"
	"github.com/krithik/horizon/backend/internal/hub"
	"github.com/krithik/horizon/backend/internal/ors"
)

// Server lifecycle timings.
//
// Only two of the four http.Server timeouts are set, and the two that are left at zero
// are the interesting decision — see the http.Server literal in run() for why.
const (
	// Slow-loris defence: a client that opens a connection and dribbles headers holds
	// a goroutine until it is bounded. Harmless to WebSockets, whose headers arrive in
	// the first packet like any other request's.
	readHeaderTimeout = 5 * time.Second

	// Bounds idle keep-alive connections between requests. Does not apply to a
	// WebSocket: once gorilla hijacks the connection it leaves the server's management
	// entirely, and liveness is the ping/pong in internal/hub/client.go from then on.
	idleTimeout = 120 * time.Second

	// How long Shutdown may drain before we stop waiting. Comfortably inside the ~30s
	// most platforms allow between SIGTERM and SIGKILL.
	shutdownGrace = 15 * time.Second
)

func main() {
	if err := run(); err != nil {
		// run() has already logged the detail through slog.
		os.Exit(1)
	}
}

func run() error {
	logger, levelErr := newLogger(os.Getenv("LOG_LEVEL"))
	if levelErr != nil {
		logger.Warn("invalid LOG_LEVEL, defaulting to info", "err", levelErr)
	}

	// Read once, at startup: a misconfiguration surfaces at boot rather than on a
	// rider's phone, and the request path does no parsing.
	origins := httpx.ParseOrigins(os.Getenv("ALLOWED_ORIGINS"))
	if len(origins) == 0 {
		logger.Warn("ALLOWED_ORIGINS is not set — every origin is allowed; " +
			"set it to a comma-separated list of origins before deploying")
	} else {
		logger.Info("CORS configured", "origins", origins)
	}

	// Same pattern as ALLOWED_ORIGINS above: read once at startup, warn rather than
	// fail. A blank key is not fatal — the server still runs, and the route endpoint
	// answers 503 until it's set.
	orsKey := os.Getenv("ORS_API_KEY")
	if orsKey == "" {
		logger.Warn("ORS_API_KEY is not set — POST /rides/{code}/route will return 503 until it is")
	}
	orsClient := ors.New(orsKey, nil)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: buildHandler(logger, origins, hub.New(origins), orsClient),

		ReadHeaderTimeout: readHeaderTimeout,
		IdleTimeout:       idleTimeout,

		// ReadTimeout and WriteTimeout are deliberately left at 0 (no limit), and
		// setting them is the most likely way to break this server.
		//
		// Both are absolute deadlines armed when the request begins, not idle
		// timeouts. On a WebSocket that lives for a whole bike ride, either one would
		// kill the connection the moment it elapsed — presenting as "riders vanish
		// after exactly N seconds", which is a miserable thing to diagnose from a
		// bicycle. The pumps in internal/hub/client.go already bound both directions
		// at the right granularity: a 60s read deadline refreshed by pong, and a 10s
		// write deadline set before every individual write.
		//
		// If you are here to harden the server, ReadHeaderTimeout above is the field
		// that gives slow-loris protection without touching long-lived connections.

		// Route net/http's own internal errors into the structured stream instead of
		// letting them reach stderr unformatted.
		ErrorLog: slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}

	// SIGTERM is what a container platform sends; os.Interrupt is Ctrl+C in dev. Note
	// that Windows never really delivers SIGTERM, so the drain path below is only
	// genuinely exercised on the Linux deployment target.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		// Shutdown makes ListenAndServe return ErrServerClosed. That is the success
		// path, not a failure — reporting it would make every clean stop look like a
		// crash to whatever is supervising the process.
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	logger.Info("server started", "addr", srv.Addr)

	select {
	case err := <-serveErr:
		if err != nil {
			logger.Error("server failed", "err", err)
			return err
		}
		return nil

	case <-ctx.Done():
		// Restore default signal handling first, so a second Ctrl+C from an impatient
		// operator kills the process immediately instead of being swallowed.
		stop()
		logger.Info("shutdown signal received, draining", "grace", shutdownGrace)

		sctx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
		defer cancel()

		// Shutdown stops accepting, then waits for active requests to finish. It does
		// not close hijacked connections, so live WebSockets are not sent a close
		// frame here — they are simply cut when the process exits. Sending close
		// frames on shutdown would need the hub to enumerate and close every live
		// connection itself; that's still unimplemented.
		if err := srv.Shutdown(sctx); err != nil {
			logger.Error("graceful shutdown did not complete", "err", err)
			return err
		}

		logger.Info("shutdown complete")
		return nil
	}
}

// newLogger builds the process logger from a LOG_LEVEL value.
//
// JSON to stderr, so logs stay machine-readable and stdout stays free. An unparseable
// level is not fatal: the server starts at info and says so, because refusing to boot
// over a typo in an observability setting would be a worse failure than the typo.
//
// Levels: debug, info, warn, error (case-insensitive). Default info.
//
// LOG_LEVEL=debug is the only level at which rider coordinates may be logged, and it
// must never be enabled in a deployed build — location is the most sensitive data class
// in this app (docs/SYSTEM_DESIGN.md, "Security & privacy").
func newLogger(raw string) (*slog.Logger, error) {
	level := slog.LevelInfo
	var parseErr error
	if raw != "" {
		if err := level.UnmarshalText([]byte(raw)); err != nil {
			level = slog.LevelInfo
			parseErr = fmt.Errorf("LOG_LEVEL %q: %w", raw, err)
		}
	}
	handler := slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: level})
	return slog.New(handler), parseErr
}

// buildHandler registers the routes and wraps them in the middleware chain.
//
// Extracted from run() so that main_test.go can exercise the exact chain the server
// runs — a WebSocket upgrade only proves anything if it goes through every wrapper.
//
// Order is Recover → Log → CORS → mux:
//   - Recover outermost, so a panic in any other middleware is caught too.
//   - Log outside CORS, so preflights are visible; CORS answers those itself and the
//     mux never sees them.
//   - CORS wrapping the whole mux, so /ws and every route added later inherit the
//     policy without anyone remembering to.
//
// A per-IP rate limiter, when it lands, goes inside CORS so that a preflight is never
// rate-limited.
func buildHandler(logger *slog.Logger, origins []string, h *hub.Hub, orsClient *ors.Client) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	mux.HandleFunc("GET /ws", h.ServeWS)

	mux.HandleFunc("POST /rides", func(w http.ResponseWriter, _ *http.Request) {
		code := h.CreateRide()
		if code == "" {
			http.Error(w, "could not allocate a ride code", http.StatusServiceUnavailable)
			return
		}
		writeJSON(w, map[string]string{"code": code})
	})

	// Proxy a driving-car route through OpenRouteService and store it on the room —
	// ORS has no motorcycle profile (CLAUDE.md).
	mux.HandleFunc("POST /rides/{code}/route", routeHandler(h, orsClient))
	// Free-typed address search, proxied to ORS's Pelias geocoder. Not ride-scoped —
	// see geocodeHandler's doc comment for why, and for why this is POST not GET.
	mux.HandleFunc("POST /geocode", geocodeHandler(orsClient))
	// Phase 3: mint a LiveKit JWT for this rider + room.
	mux.HandleFunc("POST /rides/{code}/voice-token", notImplemented)

	return httpx.Recover(logger)(httpx.Log(logger)(httpx.CORS(origins)(mux)))
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func notImplemented(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "not implemented yet", http.StatusNotImplemented)
}
