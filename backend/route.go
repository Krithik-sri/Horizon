package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
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

// alternativesRequestCount is what Routes is asked for when an alternatives request
// passes route.go's own gates below. Any value over 1 has the same effect on the ORS
// request — the actual target_count/weight/share tuning sent to ORS is fixed inside
// internal/ors/ors.go — so this only needs to clear that threshold; it's named rather
// than a bare 3 so the call site reads as "ask for alternatives", not a magic number.
const alternativesRequestCount = 3

// alternativesGateMeters — see wantAlternatives: alternatives are only requested when the
// two waypoints are under this distance apart, by straight-line haversine (ADR-013
// §3). ORS refuses alternatives entirely above roughly 100 km of *road* distance, and
// road distance runs about 1.2–1.4x straight-line, so 60 km straight-line sits under
// the road-distance cap with margin.
const alternativesGateMeters = 60_000

// routeRequest is the body of POST /rides/{code}/route — waypoints as [lat,lng],
// matching this repo's loc/state convention (CLAUDE.md). ors.Client does the one swap
// to ORS's [lng,lat] order.
type routeRequest struct {
	Waypoints [][2]float64 `json:"waypoints"`

	// Preview, when true, returns the route(s) to this caller only: no hub.SetRoute
	// call, no broadcast, no other rider learns the request happened (ADR-013 §1).
	// Selected is always 0 in the response when Preview is true — nothing was
	// committed, so there is nothing to have selected.
	Preview bool `json:"preview"`

	// Alternatives asks ORS for up to 3 routes instead of one (ADR-013 §2). Only
	// actually requested when wantAlternatives' extra gates pass — an Alternatives
	// request that doesn't clear them silently falls back to a single route rather
	// than erroring, since asking for alternatives is advisory, not a hard
	// requirement of the caller.
	Alternatives bool `json:"alternatives"`

	// Index selects which returned route to store and broadcast; ignored when Preview
	// is true. Its zero value (0) is exactly right for the common case: one route
	// back, index 0 — today's behaviour, unchanged.
	Index int `json:"index"`
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
// protocol"). Always carries exactly one route — the one committed — never the full
// alternatives list (ADR-013 §2).
type routeFrame struct {
	Type string `json:"type"`
	Ride string `json:"ride"`
	routeData
}

// routeListResponse is the HTTP response body of POST /rides/{code}/route (ADR-013
// §1). Routes is always an array — length 1 unless Alternatives was requested and
// granted — so the client has exactly one parser for both cases. Selected is the
// index of the route that was stored/broadcast, or 0 when Preview was true (nothing
// was committed, so nothing was selected).
type routeListResponse struct {
	Routes   []routeData `json:"routes"`
	Selected int         `json:"selected"`
}

// wantAlternatives reports whether req's Alternatives flag should actually be honoured
// against ORS. Two guards, both required (ADR-013 §3):
//   - exactly two waypoints — whether ORS accepts via-points together with
//     alternatives is undocumented either way, so this never tries it;
//   - under alternativesGateMeters apart in a straight line, so the road-distance cap
//     ORS enforces is cleared with margin.
//
// A request that fails these gates isn't an error: it just falls back to a single
// route, same as Alternatives being unset.
func wantAlternatives(req routeRequest) bool {
	return req.Alternatives && len(req.Waypoints) == 2 &&
		haversine(req.Waypoints[0], req.Waypoints[1]) < alternativesGateMeters
}

// haversine returns the great-circle distance between two [lat,lng] points, in
// meters. Go's standard library has no geo package; this is only ever used as a
// threshold comparison for wantAlternatives, so a spherical approximation is
// plenty accurate.
func haversine(a, b [2]float64) float64 {
	const earthRadiusMeters = 6_371_000.0
	lat1, lat2 := a[0]*math.Pi/180, b[0]*math.Pi/180
	dLat := (b[0] - a[0]) * math.Pi / 180
	dLng := (b[1] - a[1]) * math.Pi / 180
	h := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusMeters * math.Asin(math.Sqrt(h))
}

// routeHandler proxies POST /rides/{code}/route to ORS and returns the resulting
// route(s) over HTTP. Unless the request is a preview, the selected route is also
// stored on the room and broadcast (fanned out to whoever's already connected, and to
// whoever joins later) — ADR-013 §1.
func routeHandler(h *hub.Hub, orsClient *ors.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		code := r.PathValue("code")

		// Checked before decoding the body or calling ORS at all — fail fast rather
		// than burning a quota request, or even parsing a body, on a bad code. This
		// gate is the only thing standing between a preview request and an
		// unauthenticated ORS proxy (ADR-013 §1), so it runs for previews too.
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

		count := 1
		if wantAlternatives(req) {
			count = alternativesRequestCount
		}
		routes, err := orsClient.Routes(r.Context(), req.Waypoints, count)
		if err != nil && count > 1 && errors.Is(err, ors.ErrBadRequest) {
			// ORS rejected the alternatives request itself — typically a route that
			// turns out too long by road despite clearing the straight-line gate
			// above (ADR-013 §3). Retry once, plain, before giving up.
			//
			// Gated on ErrBadRequest specifically, not on "any error that isn't
			// ErrNoRoute or ErrUpstream": that wider condition also catches ErrQuota,
			// and retrying a 403/429 is the one case where a retry is actively
			// harmful — it spends another request against the very ceiling the gate
			// above exists to protect, and a 429 means the correct move is to send
			// less, not more. A 5xx (ErrUpstream) is skipped for the different reason
			// that it's ORS's own problem, which dropping "alternatives" won't fix.
			routes, err = orsClient.Routes(r.Context(), req.Waypoints, 1)
		}
		if err != nil {
			switch {
			case errors.Is(err, ors.ErrQuota):
				http.Error(w, "route service is over its request quota", http.StatusServiceUnavailable)
			case errors.Is(err, ors.ErrNoRoute):
				http.Error(w, "no route found between the given points", http.StatusUnprocessableEntity)
			default: // ors.ErrUpstream, ors.ErrBadRequest, or anything else Routes might one day return
				http.Error(w, "route service is unavailable", http.StatusBadGateway)
			}
			return
		}

		if req.Index < 0 || req.Index >= len(routes) {
			http.Error(w, fmt.Sprintf("index %d out of range for %d route(s)", req.Index, len(routes)), http.StatusBadRequest)
			return
		}

		data := make([]routeData, len(routes))
		msgs := make([][]byte, len(routes))
		for i, route := range routes {
			data[i] = routeData{Polyline: route.Polyline, Steps: route.Steps, Summary: route.Summary}
			msg, err := json.Marshal(routeFrame{Type: "route", Ride: code, routeData: data[i]})
			if err != nil {
				http.Error(w, "failed to build route message", http.StatusInternalServerError)
				return
			}
			msgs[i] = msg
		}

		selected := 0
		if !req.Preview {
			selected = req.Index
			if !h.SetRoute(code, msgs[selected]) {
				// The room was GC'd between the RideExists check above and here.
				http.Error(w, "unknown ride code", http.StatusNotFound)
				return
			}
		}

		writeJSON(w, routeListResponse{Routes: data, Selected: selected})
	}
}
