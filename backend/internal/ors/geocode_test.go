package ors

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"
)

// Nandi Hills, deliberately with asymmetric lat/lng so a missed swap fails loudly
// instead of silently passing on a coincidentally-symmetric fixture.
const fakeGeocodeSuccessBody = `{"features":[{"geometry":{"coordinates":[77.68,13.37]},` +
	`"properties":{"label":"Nandi Hills, Karnataka, India"}}]}`

func TestGeocodeSwapsResponseCoordinatesToLatLng(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(fakeGeocodeSuccessBody))
	})

	places, err := c.Geocode(context.Background(), "Nandi Hills", nil)
	if err != nil {
		t.Fatalf("Geocode: %v", err)
	}
	if len(places) != 1 {
		t.Fatalf("len(places) = %d, want 1", len(places))
	}
	if places[0].Lat != 13.37 || places[0].Lng != 77.68 {
		t.Errorf("place = %+v, want Lat=13.37 Lng=77.68 (Pelias's [lng,lat] swapped)", places[0])
	}
	if places[0].Label != "Nandi Hills, Karnataka, India" {
		t.Errorf("label = %q", places[0].Label)
	}
}

func TestGeocodeSendsFocusParamsWhenGiven(t *testing.T) {
	var gotQuery url.Values
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query()
		w.Write([]byte(`{"features":[]}`))
	})

	focus := [2]float64{13.37, 77.68}
	if _, err := c.Geocode(context.Background(), "MG Road", &focus); err != nil {
		t.Fatalf("Geocode: %v", err)
	}
	if gotQuery.Get("focus.point.lat") != "13.37" || gotQuery.Get("focus.point.lon") != "77.68" {
		t.Errorf("focus params = %v, want lat=13.37 lon=77.68", gotQuery)
	}
}

func TestGeocodeOmitsFocusParamsWhenNil(t *testing.T) {
	var gotQuery url.Values
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query()
		w.Write([]byte(`{"features":[]}`))
	})

	if _, err := c.Geocode(context.Background(), "MG Road", nil); err != nil {
		t.Fatalf("Geocode: %v", err)
	}
	if gotQuery.Has("focus.point.lat") || gotQuery.Has("focus.point.lon") {
		t.Errorf("focus params present without a focus point: %v", gotQuery)
	}
}

func TestGeocodeEmptyFeaturesReturnsEmptySliceNotError(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"features":[]}`))
	})

	places, err := c.Geocode(context.Background(), "asdfghjklqwerty", nil)
	if err != nil {
		t.Fatalf("Geocode: %v, want nil error — no matches is not a failure", err)
	}
	if len(places) != 0 {
		t.Errorf("places = %v, want empty", places)
	}
}

func TestGeocodeErrorMapping(t *testing.T) {
	cases := []struct {
		name    string
		status  int
		body    string
		wantErr error
	}{
		{"403 forbidden", http.StatusForbidden, `{}`, ErrQuota},
		{"429 too many requests", http.StatusTooManyRequests, `{}`, ErrQuota},
		{"500 internal server error", http.StatusInternalServerError, `{}`, ErrUpstream},
		{"garbage body", http.StatusOK, `not json`, ErrUpstream},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				w.Write([]byte(tc.body))
			})

			_, err := c.Geocode(context.Background(), "Nandi Hills", nil)
			if !errors.Is(err, tc.wantErr) {
				t.Errorf("err = %v, want errors.Is(err, %v)", err, tc.wantErr)
			}
		})
	}
}
