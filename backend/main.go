package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/krithik/horizon/backend/internal/httpx"
	"github.com/krithik/horizon/backend/internal/hub"
)

func main() {
	h := hub.New()
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	mux.HandleFunc("GET /ws", h.ServeWS)

	mux.HandleFunc("POST /rides", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]string{"code": h.CreateRide()})
	})

	// Phase 2: proxy a cycling route to OpenRouteService, store the polyline on the room.
	mux.HandleFunc("POST /rides/{code}/route", notImplemented)
	// Phase 3: mint a LiveKit JWT for this rider + room.
	mux.HandleFunc("POST /rides/{code}/voice-token", notImplemented)

	// Read once, at startup: a misconfiguration surfaces at boot rather than on a
	// rider's phone, and the request path does no parsing.
	origins := httpx.ParseOrigins(os.Getenv("ALLOWED_ORIGINS"))
	if len(origins) == 0 {
		log.Printf("WARNING: ALLOWED_ORIGINS is not set — every origin is allowed. " +
			"Set it to a comma-separated list of origins before deploying.")
	} else {
		log.Printf("CORS: %d allowed origin(s): %s", len(origins), strings.Join(origins, ", "))
	}

	// Wrapping the whole mux, rather than individual handlers, is what makes /ws and
	// every route added later inherit the policy without anyone remembering to.
	// Panic recovery goes outside this; the rate limiter goes inside it, so that a
	// preflight is never rate-limited.
	handler := httpx.CORS(origins)(mux)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("horizon backend listening on :%s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal(err)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func notImplemented(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "not implemented yet", http.StatusNotImplemented)
}
