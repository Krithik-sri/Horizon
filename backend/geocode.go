package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/krithik/horizon/backend/internal/ors"
)

// maxGeocodeRequestBytes caps the body of POST /geocode. route.go gives its own
// endpoint 4 KiB for up to 10 waypoints; a search string tops out at maxGeocodeTextLen
// characters, so 1 KiB is already generous headroom without letting a hostile body tie
// up a goroutine decoding it.
const maxGeocodeRequestBytes = 1 << 10

// maxGeocodeTextLen bounds the search text itself — long past what anyone would type
// looking for a place, short enough to reject nonsense before it ever reaches ORS.
const maxGeocodeTextLen = 200

// geocodeRequest is the body of POST /geocode. Near is a pointer so an absent focus
// point (no bias) is distinguishable from [0,0] — a real point off the coast of West
// Africa — the same reasoning routeRequest's waypoints don't need, but a single
// optional point does.
type geocodeRequest struct {
	Text string      `json:"text"`
	Near *[2]float64 `json:"near"`
}

func (req geocodeRequest) validate() error {
	text := strings.TrimSpace(req.Text)
	if text == "" {
		return errors.New("text must not be empty")
	}
	if len(text) > maxGeocodeTextLen {
		return fmt.Errorf("text must be at most %d characters, got %d", maxGeocodeTextLen, len(text))
	}
	if req.Near != nil {
		lat, lng := req.Near[0], req.Near[1]
		if lat < -90 || lat > 90 {
			return fmt.Errorf("latitude %v out of range [-90, 90]", lat)
		}
		if lng < -180 || lng > 180 {
			return fmt.Errorf("longitude %v out of range [-180, 180]", lng)
		}
	}
	return nil
}

// geocodeResults is the body of a successful response — a bare array would work just as
// well, but wrapping it in an object matches routeData/writeJSON's shape elsewhere and
// leaves room to add fields (a warning, a truncation flag) without a breaking change.
type geocodeResults struct {
	Results []ors.Place `json:"results"`
}

// geocodeHandler proxies POST /geocode to ORS's Pelias geocoder, turning rider-typed
// text ("Nandi Hills") into a short list of places with coordinates.
//
// Deliberately not under /rides/{code}/: unlike routeHandler, a place search has
// nothing to do with any particular ride — a rider can look one up before a ride even
// exists — so there's no code parameter, no h.RideExists check, and no *hub.Hub
// argument.
//
// Deliberately POST, not GET /geocode?q=...: internal/httpx/logging.go logs every
// request's URL, and search text is location data — a destination the rider is about to
// travel to, the most sensitive data class this app handles (see newLogger's doc
// comment in main.go). A query string would put that text straight into the logs; a
// JSON body keeps it out. Resist "simplifying" this back into a GET.
func geocodeHandler(orsClient *ors.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !orsClient.Configured() {
			http.Error(w, "geocode service is not configured", http.StatusServiceUnavailable)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxGeocodeRequestBytes)
		var req geocodeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "malformed request body", http.StatusBadRequest)
			return
		}
		if err := req.validate(); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		places, err := orsClient.Geocode(r.Context(), strings.TrimSpace(req.Text), req.Near)
		if err != nil {
			switch {
			case errors.Is(err, ors.ErrQuota):
				http.Error(w, "geocode service is over its request quota", http.StatusServiceUnavailable)
			default: // ors.ErrUpstream, or anything else Geocode might one day return
				http.Error(w, "geocode service is unavailable", http.StatusBadGateway)
			}
			return
		}
		if places == nil {
			// Geocode already returns a non-nil empty slice for a genuine no-match, but
			// don't let a `results` field turn into JSON null if that ever changes.
			places = []ors.Place{}
		}

		writeJSON(w, geocodeResults{Results: places})
	}
}
