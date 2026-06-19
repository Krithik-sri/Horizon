package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

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

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("horizon backend listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
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
