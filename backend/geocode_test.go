package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/krithik/horizon/backend/internal/ors"
)

const fakeGeocodeSuccessBody = `{"features":[{"geometry":{"coordinates":[77.68,13.37]},` +
	`"properties":{"label":"Nandi Hills, Karnataka, India"}}]}`

// postGeocode POSTs to /geocode. Mirrors postRoute in route_test.go.
func postGeocode(t *testing.T, srv *httptest.Server, body string) *http.Response {
	t.Helper()
	resp, err := srv.Client().Post(srv.URL+"/geocode", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST /geocode: %v", err)
	}
	return resp
}

func TestGeocodeHandlerSuccess(t *testing.T) {
	fakeORS := httptest.NewServer(fakeORSHandler(http.StatusOK, fakeGeocodeSuccessBody))
	defer fakeORS.Close()
	srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))

	resp := postGeocode(t, srv, `{"text":"Nandi Hills","near":[12.9716,77.5946]}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var got geocodeResults
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(got.Results) != 1 || got.Results[0].Lat != 13.37 || got.Results[0].Lng != 77.68 {
		t.Errorf("results = %+v, want one place at Lat=13.37 Lng=77.68", got.Results)
	}
}

func TestGeocodeHandlerValidationErrorsReturn400(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"malformed JSON", `not json`},
		{"empty text", `{"text":""}`},
		{"whitespace-only text", `{"text":"   "}`},
		{"text over 200 chars", `{"text":"` + strings.Repeat("a", 201) + `"}`},
		{"near lat out of range", `{"text":"MG Road","near":[91,77.5]}`},
		{"near lng out of range", `{"text":"MG Road","near":[12.9,181]}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// unreachableORSHandler doubles as the assertion that a bad request never
			// reaches ORS — validation happens before the quota is spent.
			fakeORS := httptest.NewServer(unreachableORSHandler(t))
			defer fakeORS.Close()
			srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))

			resp := postGeocode(t, srv, tc.body)
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", resp.StatusCode)
			}
		})
	}
}

func TestGeocodeHandlerUnsetKeyReturns503(t *testing.T) {
	srv, _ := newTestServer(t, nil, ors.New("", nil))

	resp := postGeocode(t, srv, `{"text":"Nandi Hills"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", resp.StatusCode)
	}
}
