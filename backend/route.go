package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/krithik/horizon/backend/internal/hub"
	"github.com/krithik/horizon/backend/internal/ors"
)

// maxRouteRequestBytes caps the body of POST /rides/{code}/route. This is the first
// JSON-bodied endpoint on the server, so nothing upstream limits it yet — a 10-waypoint
// request is a few hundred bytes; 4 KiB leaves headroom without letting a hostile body
// tie up a goroutine decoding it.
const maxRouteRequestBytes = 4 << 10

const (
	minWaypoints = 2
	maxWaypoints = 10
)

// routeRequest is the body of POST /rides/{code}/route — waypoints as [lat,lng],
// matching this repo's loc/state convention (CLAUDE.md). ors.Client does the one swap
// to ORS's [lng,lat] order.
type routeRequest struct {
	Waypoints [][2]float64 `json:"waypoints"`
}

func (req routeRequest) validate() error {
	if n := len(req.Waypoints); n < minWaypoints || n > maxWaypoints {
		return fmt.Errorf("waypoints must have between %d and %d points, got %d", minWaypoints, maxWaypoints, n)
	}
	for _, wp := range req.Waypoints {
		lat, lng := wp[0], wp[1]
		if lat < -90 || lat > 90 {
			return fmt.Errorf("latitude %v out of range [-90, 90]", lat)
		}
		if lng < -180 || lng > 180 {
			return fmt.Errorf("longitude %v out of range [-180, 180]", lng)
		}
	}
	return nil
}

// routeData is the route itself: the shape returned directly to the HTTP caller, and
// embedded (anonymously, so its fields flatten into the parent's JSON) in routeFrame
// for the WS broadcast.
type routeData struct {
	Polyline [][2]float64 `json:"polyline"`
	Steps    []ors.Step   `json:"steps"`
	Summary  *ors.Summary `json:"summary"`
}

// routeFrame is the `route` message queued to WS clients (CLAUDE.md, "WebSocket
// protocol").
type routeFrame struct {
	Type string `json:"type"`
	Ride string `json:"ride"`
	routeData
}

// routeHandler proxies POST /rides/{code}/route to ORS, stores the result on the room
// (fanned out to whoever's already connected, and to whoever joins later), and returns
// the same route data over HTTP to the caller.
func routeHandler(h *hub.Hub, orsClient *ors.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		code := r.PathValue("code")

		// Checked before decoding the body or calling ORS at all — fail fast rather
		// than burning a quota request, or even parsing a body, on a bad code.
		if !h.RideExists(code) {
			http.Error(w, "unknown ride code", http.StatusNotFound)
			return
		}
		if !orsClient.Configured() {
			http.Error(w, "route service is not configured", http.StatusServiceUnavailable)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxRouteRequestBytes)
		var req routeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "malformed request body", http.StatusBadRequest)
			return
		}
		if err := req.validate(); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		route, err := orsClient.Route(r.Context(), req.Waypoints)
		if err != nil {
			switch {
			case errors.Is(err, ors.ErrQuota):
				http.Error(w, "route service is over its request quota", http.StatusServiceUnavailable)
			case errors.Is(err, ors.ErrNoRoute):
				http.Error(w, "no route found between the given points", http.StatusUnprocessableEntity)
			default: // ors.ErrUpstream, or anything else Route might one day return
				http.Error(w, "route service is unavailable", http.StatusBadGateway)
			}
			return
		}

		data := routeData{Polyline: route.Polyline, Steps: route.Steps, Summary: route.Summary}

		msg, err := json.Marshal(routeFrame{Type: "route", Ride: code, routeData: data})
		if err != nil {
			http.Error(w, "failed to build route message", http.StatusInternalServerError)
			return
		}
		if !h.SetRoute(code, msg) {
			// The room was GC'd between the RideExists check above and here.
			http.Error(w, "unknown ride code", http.StatusNotFound)
			return
		}

		writeJSON(w, data)
	}
}
