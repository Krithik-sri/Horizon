package ors

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

const testKey = "test-api-key-shh"

// newTestClient points a Client at a local fake server instead of the live ORS API.
// baseURL is unexported and this file is part of package ors, so it can be overridden
// directly — that's the injection point the brief asks for.
func newTestClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	c := New(testKey, srv.Client())
	c.baseURL = srv.URL
	return c
}

const fakeSuccessBody = `{"features":[{"geometry":{"coordinates":[[77.5,12.9],[77.6,13.0]]},` +
	`"properties":{"summary":{"distance":100,"duration":10},"segments":[{"steps":[` +
	`{"distance":100,"duration":10,"type":1,"instruction":"Head north","name":"NH 44","way_points":[0,1]}` +
	`]}]}}]}`

func TestRouteSwapsRequestCoordinatesToLngLat(t *testing.T) {
	var gotBody []byte
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		var err error
		gotBody, err = io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("reading request body: %v", err)
		}
		w.Write([]byte(fakeSuccessBody))
	})

	// [lat,lng] in, [lng,lat] on the wire — the one swap, at this one site.
	if _, err := c.Route(context.Background(), [][2]float64{{12.9716, 77.5946}, {13, 77.6}}); err != nil {
		t.Fatalf("Route: %v", err)
	}

	want := `{"coordinates":[[77.5946,12.9716],[77.6,13]],"instructions":true}`
	if got := strings.TrimSpace(string(gotBody)); got != want {
		t.Errorf("request body = %s, want %s", got, want)
	}
}

func TestRoutePolylinePassesThroughUnswapped(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(fakeSuccessBody))
	})

	route, err := c.Route(context.Background(), [][2]float64{{12.9, 77.5}, {13, 77.6}})
	if err != nil {
		t.Fatalf("Route: %v", err)
	}

	want := [][2]float64{{77.5, 12.9}, {77.6, 13}}
	if !reflect.DeepEqual(route.Polyline, want) {
		t.Errorf("Polyline = %v, want %v (ORS's own [lng,lat] order, untouched)", route.Polyline, want)
	}
}

func TestRouteFlattensStepsAcrossSegmentsInOrder(t *testing.T) {
	body := `{"features":[{"geometry":{"coordinates":[]},"properties":{"summary":{"distance":1,"duration":2},` +
		`"segments":[` +
		`{"steps":[{"distance":1,"duration":1,"type":0,"instruction":"a","name":"A","way_points":[0,1]},` +
		`{"distance":2,"duration":2,"type":1,"instruction":"b","name":"B","way_points":[1,2]}]},` +
		`{"steps":[{"distance":3,"duration":3,"type":2,"instruction":"c","name":"C","way_points":[2,3]}]}` +
		`]}}]}`
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(body))
	})

	route, err := c.Route(context.Background(), [][2]float64{{1, 2}, {3, 4}})
	if err != nil {
		t.Fatalf("Route: %v", err)
	}

	want := []Step{
		{Instruction: "a", Distance: 1, Duration: 1, Type: 0, Name: "A", WayPoints: []int{0, 1}},
		{Instruction: "b", Distance: 2, Duration: 2, Type: 1, Name: "B", WayPoints: []int{1, 2}},
		{Instruction: "c", Distance: 3, Duration: 3, Type: 2, Name: "C", WayPoints: []int{2, 3}},
	}
	if !reflect.DeepEqual(route.Steps, want) {
		t.Errorf("Steps = %+v, want %+v", route.Steps, want)
	}
}

func TestRouteSendsBareAPIKeyHeader(t *testing.T) {
	var gotAuth string
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Write([]byte(fakeSuccessBody))
	})

	if _, err := c.Route(context.Background(), [][2]float64{{1, 2}, {3, 4}}); err != nil {
		t.Fatalf("Route: %v", err)
	}
	if gotAuth != testKey {
		t.Errorf("Authorization header = %q, want the bare key %q with no Bearer prefix", gotAuth, testKey)
	}
}

func TestRouteErrorMapping(t *testing.T) {
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
		{"empty features", http.StatusOK, `{"features":[]}`, ErrNoRoute},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				w.Write([]byte(tc.body))
			})

			_, err := c.Route(context.Background(), [][2]float64{{1, 2}, {3, 4}})
			if !errors.Is(err, tc.wantErr) {
				t.Errorf("err = %v, want errors.Is(err, %v)", err, tc.wantErr)
			}
			// Every one of these error paths builds its message from the response
			// status/body, never from the request — so the key this test sent in the
			// Authorization header must never come back out in the error string.
			if err != nil && strings.Contains(err.Error(), testKey) {
				t.Errorf("error string leaks the API key: %v", err)
			}
		})
	}
}
