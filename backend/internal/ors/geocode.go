package ors

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
)

// geocodeSize caps how many candidates Pelias returns for a search. A rider typing a
// destination is picking off a short list, not paging through results — 5 is plenty.
const geocodeSize = 5

// Place is one geocoder result. Lat/Lng follow this repo's loc/state naming (CLAUDE.md)
// even though the wire format underneath is Pelias's [lng,lat] — see Geocode's doc
// comment for the swap.
type Place struct {
	Label string  `json:"label"`
	Lat   float64 `json:"lat"`
	Lng   float64 `json:"lng"`
}

// geocodeResponse mirrors only the fields Geocode reads out of Pelias's GeoJSON
// FeatureCollection (the query echo, warnings, and engine info ORS also returns are all
// ignored) — same pattern as directionsResponse above it.
type geocodeResponse struct {
	Features []struct {
		Geometry struct {
			Coordinates []float64 `json:"coordinates"`
		} `json:"geometry"`
		Properties struct {
			Label string `json:"label"`
		} `json:"properties"`
	} `json:"features"`
}

// Geocode asks ORS's Pelias-backed /geocode/search for places matching free-typed text.
// focus, given as [lat,lng] (this repo's convention, not Pelias's — see the swap below),
// biases results toward a rider's current position; pass nil for an unbiased search.
// Without a focus point a query like "MG Road" is as likely to match the wrong city as
// the right one — Pelias has no idea which "MG Road" the rider means.
//
// This is the one coordinate swap in the geocode path, and it happens here and nowhere
// else: focus goes out as separate focus.point.lat/focus.point.lon query params (no
// swap needed, they're already named), but Pelias's response geometry is [lng,lat] —
// GeoJSON order — while Place has named Lat/Lng fields, so the two are swapped coming
// back in. CLAUDE.md calls coordinate order a known trap — this comment is the paper
// trail, same as Route's above.
func (c *Client) Geocode(ctx context.Context, text string, focus *[2]float64) ([]Place, error) {
	q := url.Values{}
	q.Set("text", text)
	q.Set("size", strconv.Itoa(geocodeSize))
	if focus != nil {
		q.Set("focus.point.lat", strconv.FormatFloat(focus[0], 'f', -1, 64))
		q.Set("focus.point.lon", strconv.FormatFloat(focus[1], 'f', -1, 64))
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.baseURL+"/geocode/search?"+q.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("%w: building request: %v", ErrUpstream, err)
	}
	req.Header.Set("Authorization", c.apiKey) // bare key, same as Route
	req.Header.Set("Accept", "application/geo+json")

	resp, err := c.hc.Do(req)
	if err != nil {
		// Same care as Route: err here is a *url.Error wrapping a network failure,
		// never the request itself, so the Authorization header never reaches this
		// string.
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
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: status %d: %s", ErrUpstream, resp.StatusCode, snippet(respBody))
	}

	var parsed geocodeResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("%w: malformed response body: %s", ErrUpstream, snippet(respBody))
	}

	// Zero features is a normal outcome — "no place matches that text" isn't an error,
	// unlike Route's ErrNoRoute (two points that can't be connected is a routing
	// failure). The loop below already produces a non-nil empty slice for this case.
	places := make([]Place, 0, len(parsed.Features))
	for _, f := range parsed.Features {
		if len(f.Geometry.Coordinates) != 2 {
			continue // malformed feature geometry — skip rather than fail the whole search
		}
		places = append(places, Place{
			Label: f.Properties.Label,
			Lng:   f.Geometry.Coordinates[0],
			Lat:   f.Geometry.Coordinates[1],
		})
	}
	return places, nil
}
