// Package ors is a client for the OpenRouteService Directions API — the route line
// behind POST /rides/{code}/route (CLAUDE.md, "WebSocket protocol"; docs/SETUP.md).
package ors

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// defaultBaseURL is ORS's public endpoint. Kept on Client rather than hardcoded inline
// so tests in this package can point a Client at an httptest.Server instead.
const defaultBaseURL = "https://api.openrouteservice.org"

// requestTimeout bounds a single ORS call, applied when New is given no http.Client of
// its own. Generous for a routing request, but still short enough that a stalled
// upstream doesn't tie up a request goroutine indefinitely.
const requestTimeout = 15 * time.Second

// Sentinel errors the caller switches on with errors.Is. Extra detail (a status code, a
// snippet of the response body) is wrapped in via %w so it survives errors.Is while
// staying informative — never from the request or its headers, which is where the API
// key lives. See Routes' doc comment.
var (
	// ErrQuota means ORS rejected the request over quota: 403 (daily cap) or 429 (the
	// 40/min sliding window).
	ErrQuota = errors.New("ors: quota exceeded")
	// ErrBadRequest means ORS rejected the request itself: a 4xx other than the two
	// quota codes above. In practice this is almost always the alternative-routes
	// search refusing a route that turns out too long by road even though its
	// waypoints passed route.go's straight-line gate (ADR-013 §3) — route.go retries
	// once without alternatives on exactly this error.
	ErrBadRequest = errors.New("ors: bad request")
	// ErrUpstream covers everything else that isn't a usable response: a non-4xx,
	// non-2xx status (chiefly 5xx), a transport failure, or a malformed/empty body.
	ErrUpstream = errors.New("ors: upstream error")
	// ErrNoRoute means ORS answered 2xx but found no route between the given points.
	ErrNoRoute = errors.New("ors: no route found")
)

// Step is one turn-by-turn instruction, flattened out of ORS's per-segment nesting.
type Step struct {
	Instruction string  `json:"instruction"`
	Distance    float64 `json:"distance"`
	Duration    float64 `json:"duration"`
	Type        int     `json:"type"`
	Name        string  `json:"name"`
	WayPoints   []int   `json:"wayPoints"` // indices into Route.Polyline
}

type Summary struct {
	Distance float64 `json:"distance"`
	Duration float64 `json:"duration"`
}

type Route struct {
	Polyline [][2]float64 `json:"polyline"` // [lng,lat] — MapLibre order, passed through untouched
	Steps    []Step       `json:"steps"`
	Summary  *Summary     `json:"summary"`
}

type Client struct {
	apiKey  string
	hc      *http.Client
	baseURL string
}

// New builds a Client for apiKey. hc may be nil, in which case a client bounded by
// requestTimeout is used; pass one explicitly to share a transport or to override the
// timeout.
func New(apiKey string, hc *http.Client) *Client {
	if hc == nil {
		hc = &http.Client{Timeout: requestTimeout}
	}
	return &Client{apiKey: apiKey, hc: hc, baseURL: defaultBaseURL}
}

// Configured reports whether the client has an API key. main.go wires an ors.Client
// even when ORS_API_KEY is blank — this is what lets the route handler answer 503
// without needing a nilable *ors.Client threaded through buildHandler.
func (c *Client) Configured() bool {
	return c.apiKey != ""
}

type directionsRequest struct {
	Coordinates  [][2]float64 `json:"coordinates"`
	Instructions bool         `json:"instructions"`
	// AlternativeRoutes is nil unless Routes was asked for more than one route. A nil
	// pointer with omitempty drops the key entirely, so a caller that never wants
	// alternatives sends ORS the exact same body it always has — alternative_routes
	// changes ORS's own route-finding algorithm, not just how many results come back,
	// so "the key is absent" has to mean absent, not "present with a count of 1".
	AlternativeRoutes *alternativeRoutes `json:"alternative_routes,omitempty"`
}

// alternativeRoutes is ORS's tuning knob for the alternative-route search (ADR-013
// §3). Fixed at these three values rather than exposed as parameters — there is
// exactly one caller-visible knob (Routes' count, which only decides on/off) because
// nothing in this codebase needs a second tuning.
type alternativeRoutes struct {
	TargetCount  int     `json:"target_count"`
	WeightFactor float64 `json:"weight_factor"`
	ShareFactor  float64 `json:"share_factor"`
}

const (
	// altTargetCount is ORS's own documented cap — asking for more would do nothing.
	altTargetCount = 3

	// altWeightFactor and altShareFactor are tighter than ORS's own example values of
	// 2 and 0.8. Those defaults permit a route up to twice the optimal weight while
	// sharing 80% of its geometry, which in practice yields two near-duplicates and
	// one absurd detour. A rider planning a convoy route wants a genuinely different
	// road that isn't much slower, not the same road with more decimal places
	// (ADR-013 §3).
	altWeightFactor = 1.4
	altShareFactor  = 0.6
)

// directionsResponse mirrors only the fields Routes reads out of ORS's /geojson
// response; everything else ORS returns is ignored.
type directionsResponse struct {
	Features []struct {
		Geometry struct {
			Coordinates [][2]float64 `json:"coordinates"`
		} `json:"geometry"`
		Properties struct {
			Summary  Summary `json:"summary"`
			Segments []struct {
				Steps []struct {
					Distance    float64 `json:"distance"`
					Duration    float64 `json:"duration"`
					Type        int     `json:"type"`
					Instruction string  `json:"instruction"`
					Name        string  `json:"name"`
					WayPoints   []int   `json:"way_points"`
				} `json:"steps"`
			} `json:"segments"`
		} `json:"properties"`
	} `json:"features"`
}

// Routes asks ORS for a driving-car route through waypoints, given as [lat,lng] —
// matching this repo's loc/state convention (CLAUDE.md). count <= 1 asks for a single
// route; count > 1 additionally requests alternatives, tuned by the constants above
// (ADR-013 §3) — the returned slice may still come back length 1 even then, since ORS
// only returns alternatives it actually found.
//
// This is the one coordinate swap in the route path, and it happens here and nowhere
// else: ORS's request body wants [lng,lat], so waypoints are swapped going in. ORS's
// response is already [lng,lat] (that's the whole reason to use the /geojson variant
// instead of the default encoded-polyline endpoint), so each Route.Polyline passes it
// through untouched. CLAUDE.md calls coordinate order a known trap — this comment is
// the paper trail.
func (c *Client) Routes(ctx context.Context, waypoints [][2]float64, count int) ([]*Route, error) {
	coords := make([][2]float64, len(waypoints))
	for i, wp := range waypoints {
		coords[i] = [2]float64{wp[1], wp[0]} // [lat,lng] -> [lng,lat]
	}

	dr := directionsRequest{Coordinates: coords, Instructions: true}
	if count > 1 {
		dr.AlternativeRoutes = &alternativeRoutes{
			TargetCount:  altTargetCount,
			WeightFactor: altWeightFactor,
			ShareFactor:  altShareFactor,
		}
	}

	body, err := json.Marshal(dr)
	if err != nil {
		return nil, fmt.Errorf("%w: marshalling request: %v", ErrUpstream, err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/v2/directions/driving-car/geojson", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("%w: building request: %v", ErrUpstream, err)
	}
	req.Header.Set("Authorization", c.apiKey) // bare key — ORS does not use "Bearer "
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Accept", "application/geo+json")

	resp, err := c.hc.Do(req)
	if err != nil {
		// err here is a *url.Error wrapping a network failure — never the request
		// itself, so nothing about req (including its Authorization header) reaches
		// this string.
		return nil, fmt.Errorf("%w: request failed: %v", ErrUpstream, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%w: reading response: %v", ErrUpstream, err)
	}

	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
		return nil, ErrQuota
	}
	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		return nil, fmt.Errorf("%w: status %d: %s", ErrBadRequest, resp.StatusCode, snippet(respBody))
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: status %d: %s", ErrUpstream, resp.StatusCode, snippet(respBody))
	}

	var parsed directionsResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("%w: malformed response body: %s", ErrUpstream, snippet(respBody))
	}
	if len(parsed.Features) == 0 {
		return nil, ErrNoRoute
	}

	routes := make([]*Route, len(parsed.Features))
	for i, feature := range parsed.Features {
		summary := feature.Properties.Summary
		route := &Route{Polyline: feature.Geometry.Coordinates, Summary: &summary}
		for _, seg := range feature.Properties.Segments {
			for _, s := range seg.Steps {
				route.Steps = append(route.Steps, Step{
					Instruction: s.Instruction,
					Distance:    s.Distance,
					Duration:    s.Duration,
					Type:        s.Type,
					Name:        s.Name,
					WayPoints:   s.WayPoints,
				})
			}
		}
		routes[i] = route
	}
	return routes, nil
}

// snippet caps how much of an upstream response body ends up in an error string —
// enough to debug, not enough to dump a whole HTML error page into the log. The
// response body is ORS's own output, never the request, so this can never contain the
// API key.
func snippet(b []byte) string {
	const max = 200
	if len(b) > max {
		b = b[:max]
	}
	return string(b)
}
