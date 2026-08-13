package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/krithik/horizon/backend/internal/ors"
)

// redirectTransport rewrites the scheme+host of every outgoing request to point at a
// local fake server while leaving the path untouched. This is how these tests exercise
// ors.Client's real (unexported, and rightly so) baseURL — the client always dials
// https://api.openrouteservice.org/..., and this Transport is the only thing that
// knows to redirect that to a local httptest.Server instead.
type redirectTransport struct {
	target *url.URL
}

func (rt *redirectTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.URL.Scheme = rt.target.Scheme
	req.URL.Host = rt.target.Host
	return http.DefaultTransport.RoundTrip(req)
}

// newORSClient builds an ors.Client whose requests are transparently redirected to
// fakeORS, a local httptest.Server standing in for the real ORS API.
func newORSClient(t *testing.T, fakeORS *httptest.Server) *ors.Client {
	t.Helper()
	target, err := url.Parse(fakeORS.URL)
	if err != nil {
		t.Fatalf("parsing fake ORS URL: %v", err)
	}
	hc := &http.Client{Transport: &redirectTransport{target: target}}
	return ors.New("test-ors-key", hc)
}

// fakeORSHandler answers every request with a fixed status and body — enough to drive
// ors.Client through each of its error paths without hitting the live ORS API.
func fakeORSHandler(status int, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		w.Write([]byte(body))
	}
}

// unreachableORSHandler fails the test if ORS is ever called — used for the validation
// cases below, which must be rejected before the handler spends a quota request.
func unreachableORSHandler(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		t.Error("ORS should not have been called")
		w.WriteHeader(http.StatusInternalServerError)
	}
}

const validRouteBody = `{"waypoints":[[12.9,77.5],[13.0,77.6]]}`

const fakeORSSuccessBody = `{"features":[{"geometry":{"coordinates":[[77.5,12.9],[77.6,13.0]]},` +
	`"properties":{"summary":{"distance":100,"duration":10},"segments":[{"steps":[` +
	`{"distance":100,"duration":10,"type":1,"instruction":"Head north","name":"NH 44","way_points":[0,1]}` +
	`]}]}}]}`

// fakeORSMultiFeatureBody stands in for an ORS alternatives response: two routes with
// distinguishable summaries (100 vs 130), in a fixed order, so tests can tell which one
// a response or a broadcast frame actually carries.
const fakeORSMultiFeatureBody = `{"features":[` +
	`{"geometry":{"coordinates":[[77.5,12.9],[77.6,13.0]]},"properties":{"summary":{"distance":100,"duration":10},` +
	`"segments":[{"steps":[{"distance":100,"duration":10,"type":1,"instruction":"Head north","name":"NH 44","way_points":[0,1]}]}]}},` +
	`{"geometry":{"coordinates":[[77.51,12.91],[77.62,13.02]]},"properties":{"summary":{"distance":130,"duration":13},` +
	`"segments":[{"steps":[{"distance":130,"duration":13,"type":1,"instruction":"Head northeast","name":"SH 17","way_points":[0,1]}]}]}}` +
	`]}`

// postRoute POSTs to /rides/{code}/route. No Origin header — like the Android app, and
// like mintRideCode's own default use here, this exercises the native-client path
// through CORS (see httpx.CORS), not the browser one.
func postRoute(t *testing.T, srv *httptest.Server, code, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/rides/"+code+"/route", strings.NewReader(body))
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+testToken(t, "route-caller"))
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("POST /rides/%s/route: %v", code, err)
	}
	return resp
}

// dialWS dials /ws for code, consumes the welcome frame, and returns the connection.
// rider becomes the JWT subject on the bearer token presented at dial time — it is no
// longer a query parameter. A near-duplicate of internal/hub's dialRide test helper —
// not reusable across packages, and short enough not to be worth exporting just for
// this.
func dialWS(t *testing.T, srv *httptest.Server, code, rider string) *websocket.Conn {
	t.Helper()
	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?ride=" + code
	conn, _, err := websocket.DefaultDialer.Dial(u, bearerHeader(t, rider))
	if err != nil {
		t.Fatalf("dial %s: %v", u, err)
	}
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("reading welcome: %v", err)
	}
	return conn
}

// readFrameOfType reads WS messages off conn until one with the given "type" field
// arrives, skipping anything else. That "anything else" is chiefly the hub's periodic
// ~4Hz `state` heartbeat (internal/hub/room.go), which a connected test client
// receives regardless of whether it has sent a position fix — a plain "read the next
// message" would be racy against that tick. Bounded by a 2s deadline so a genuinely
// missing frame still fails the test instead of hanging.
func readFrameOfType(t *testing.T, conn *websocket.Conn, want string) []byte {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		conn.SetReadDeadline(deadline)
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("reading %s frame: %v", want, err)
		}
		var frame struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(data, &frame); err == nil && frame.Type == want {
			return data
		}
	}
}

func manyWaypoints(n int) string {
	pts := make([]string, n)
	for i := range pts {
		pts[i] = fmt.Sprintf("[%d,%d]", i%80, i%170)
	}
	return "[" + strings.Join(pts, ",") + "]"
}

func TestRouteHandlerSuccess(t *testing.T) {
	fakeORS := httptest.NewServer(fakeORSHandler(http.StatusOK, fakeORSSuccessBody))
	defer fakeORS.Close()

	srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))
	code := mintRideCode(t, srv, "")

	resp := postRoute(t, srv, code, validRouteBody)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var got routeListResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(got.Routes) != 1 {
		t.Fatalf("routes = %+v, want exactly 1 (no alternatives requested)", got.Routes)
	}
	if got.Selected != 0 {
		t.Errorf("selected = %d, want 0", got.Selected)
	}
	route := got.Routes[0]
	if len(route.Polyline) != 2 || route.Polyline[0] != [2]float64{77.5, 12.9} {
		t.Errorf("polyline = %v, want the ORS coordinates unswapped", route.Polyline)
	}
	if len(route.Steps) != 1 || route.Steps[0].Name != "NH 44" {
		t.Errorf("steps = %+v", route.Steps)
	}
	if route.Summary == nil || route.Summary.Distance != 100 {
		t.Errorf("summary = %+v", route.Summary)
	}
}

func TestRouteHandlerUnknownCodeReturns404(t *testing.T) {
	fakeORS := httptest.NewServer(unreachableORSHandler(t))
	defer fakeORS.Close()
	srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))

	resp := postRoute(t, srv, "NOTMINTED", validRouteBody)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

func TestRouteHandlerValidationErrorsReturn400(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"malformed JSON", `not json`},
		{"too few waypoints", `{"waypoints":[[12.9,77.5]]}`},
		{"too many waypoints", `{"waypoints":` + manyWaypoints(11) + `}`},
		{"lat out of range", `{"waypoints":[[91,77.5],[12.9,77.5]]}`},
		{"lng out of range", `{"waypoints":[[12.9,181],[12.9,77.5]]}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// unreachableORSHandler doubles as the assertion that a bad request never
			// reaches ORS — validation happens before the quota is spent.
			fakeORS := httptest.NewServer(unreachableORSHandler(t))
			defer fakeORS.Close()
			srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))
			code := mintRideCode(t, srv, "")

			resp := postRoute(t, srv, code, tc.body)
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", resp.StatusCode)
			}
		})
	}
}

func TestRouteHandlerUnsetKeyReturns503(t *testing.T) {
	srv, _ := newTestServer(t, nil, ors.New("", nil))
	code := mintRideCode(t, srv, "")

	resp := postRoute(t, srv, code, validRouteBody)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "not configured") {
		t.Errorf("body = %q, want it to say the route service isn't configured", body)
	}
}

func TestRouteHandlerQuotaReturns503(t *testing.T) {
	fakeORS := httptest.NewServer(fakeORSHandler(http.StatusTooManyRequests, `{}`))
	defer fakeORS.Close()
	srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))
	code := mintRideCode(t, srv, "")

	resp := postRoute(t, srv, code, validRouteBody)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if strings.Contains(string(body), "not configured") {
		t.Errorf("quota body must be distinguishable from the unset-key body, got %q", body)
	}
	if !strings.Contains(string(body), "quota") {
		t.Errorf("body = %q, want it to mention quota", body)
	}
}

func TestRouteHandlerNoRouteReturns422(t *testing.T) {
	fakeORS := httptest.NewServer(fakeORSHandler(http.StatusOK, `{"features":[]}`))
	defer fakeORS.Close()
	srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))
	code := mintRideCode(t, srv, "")

	resp := postRoute(t, srv, code, validRouteBody)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("status = %d, want 422", resp.StatusCode)
	}
}

func TestRouteHandlerUpstreamErrorReturns502(t *testing.T) {
	fakeORS := httptest.NewServer(fakeORSHandler(http.StatusInternalServerError, `boom`))
	defer fakeORS.Close()
	srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))
	code := mintRideCode(t, srv, "")

	resp := postRoute(t, srv, code, validRouteBody)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", resp.StatusCode)
	}
}

func TestRouteMessageReachesConnectedClient(t *testing.T) {
	fakeORS := httptest.NewServer(fakeORSHandler(http.StatusOK, fakeORSSuccessBody))
	defer fakeORS.Close()
	srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))
	code := mintRideCode(t, srv, "")

	conn := dialWS(t, srv, code, "earlyjoin1")
	defer conn.Close()

	resp := postRoute(t, srv, code, validRouteBody)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST route status = %d, want 200", resp.StatusCode)
	}

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("reading route frame: %v", err)
	}
	assertRouteFrame(t, data, code)
}

// assertRouteFrame checks a `route` frame off the wire carries its payload, not just its
// envelope. routeFrame embeds routeData, an *unexported* struct type — encoding/json does
// promote exported fields out of those, but it is a rule thin enough to be broken by an
// innocent refactor (naming the embedded field, or making it a pointer that goes nil).
// Asserting only type/ride would let the polyline silently vanish and still pass: the app
// would receive a route message describing no route.
func assertRouteFrame(t *testing.T, data []byte, code string) {
	t.Helper()
	var frame struct {
		Type     string       `json:"type"`
		Ride     string       `json:"ride"`
		Polyline [][2]float64 `json:"polyline"`
		Steps    []struct {
			Instruction string `json:"instruction"`
			WayPoints   []int  `json:"wayPoints"`
		} `json:"steps"`
	}
	if err := json.Unmarshal(data, &frame); err != nil {
		t.Fatalf("route frame is not JSON: %q: %v", data, err)
	}
	if frame.Type != "route" || frame.Ride != code {
		t.Errorf("frame = {type:%s ride:%s}, want {type:route ride:%s}", frame.Type, frame.Ride, code)
	}
	// [lng,lat] — MapLibre order, straight from ORS with no swap on the way out.
	if len(frame.Polyline) != 2 || frame.Polyline[0] != [2]float64{77.5, 12.9} {
		t.Errorf("frame polyline = %v, want the ORS coordinates unswapped", frame.Polyline)
	}
	if len(frame.Steps) == 0 || frame.Steps[0].Instruction == "" || len(frame.Steps[0].WayPoints) == 0 {
		t.Errorf("frame steps = %+v, want turn instructions with wayPoints", frame.Steps)
	}
}

func TestLateJoinerReceivesRouteOnConnect(t *testing.T) {
	fakeORS := httptest.NewServer(fakeORSHandler(http.StatusOK, fakeORSSuccessBody))
	defer fakeORS.Close()
	srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))
	code := mintRideCode(t, srv, "")

	resp := postRoute(t, srv, code, validRouteBody)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST route status = %d, want 200", resp.StatusCode)
	}

	// Dial manually rather than via dialWS: the assertion here is specifically about
	// frame order — welcome first, route second — which dialWS's "consume and discard
	// the welcome" helper would hide.
	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?ride=" + code
	conn, _, err := websocket.DefaultDialer.Dial(u, bearerHeader(t, "latejoin1"))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))

	_, welcomeData, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("reading welcome: %v", err)
	}
	var welcome struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(welcomeData, &welcome); err != nil {
		t.Fatalf("welcome frame is not JSON: %q: %v", welcomeData, err)
	}
	if welcome.Type != "welcome" {
		t.Fatalf("first frame type = %q, want welcome", welcome.Type)
	}

	_, routeFrameData, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("reading route frame: %v", err)
	}
	assertRouteFrame(t, routeFrameData, code)
}

// --- ADR-013: preview, alternatives, index ---

func TestRouteHandlerPreviewDoesNotBroadcast(t *testing.T) {
	fakeORS := httptest.NewServer(fakeORSHandler(http.StatusOK, fakeORSSuccessBody))
	defer fakeORS.Close()
	srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))
	code := mintRideCode(t, srv, "")

	conn := dialWS(t, srv, code, "previewer1")
	defer conn.Close()

	resp := postRoute(t, srv, code, `{"waypoints":[[12.9,77.5],[13.0,77.6]],"preview":true}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST route status = %d, want 200", resp.StatusCode)
	}
	var got routeListResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(got.Routes) != 1 || got.Selected != 0 {
		t.Errorf("response = %+v, want one route and selected 0", got)
	}

	// A route was returned to the caller, but the room must never have been touched:
	// no rider (including the caller's own connection) receives a `route` frame. There
	// is no positive event to wait for, so this drains whatever arrives in a short
	// window and fails only if a `route` frame shows up among it — a plain "expect
	// ReadMessage to time out" would also incorrectly fail on the hub's own `state`
	// heartbeat.
	conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return // deadline hit with nothing but (at most) state frames — success
		}
		var frame struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(data, &frame); err == nil && frame.Type == "route" {
			t.Fatalf("preview request must not broadcast a route frame, got %s", data)
		}
	}
}

func TestRouteHandlerNonPreviewBroadcastsSelectedIndex(t *testing.T) {
	fakeORS := httptest.NewServer(fakeORSHandler(http.StatusOK, fakeORSMultiFeatureBody))
	defer fakeORS.Close()
	srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))
	code := mintRideCode(t, srv, "")

	conn := dialWS(t, srv, code, "selector1")
	defer conn.Close()

	resp := postRoute(t, srv, code, `{"waypoints":[[12.9,77.5],[13.0,77.6]],"alternatives":true,"index":1}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST route status = %d, want 200", resp.StatusCode)
	}
	var got routeListResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(got.Routes) != 2 {
		t.Fatalf("routes = %+v, want 2 (the fixture has 2 features)", got.Routes)
	}
	if got.Selected != 1 {
		t.Errorf("selected = %d, want 1", got.Selected)
	}

	data := readFrameOfType(t, conn, "route")
	var frame struct {
		Summary struct {
			Distance float64 `json:"distance"`
		} `json:"summary"`
	}
	if err := json.Unmarshal(data, &frame); err != nil {
		t.Fatalf("route frame is not JSON: %q: %v", data, err)
	}
	if frame.Summary.Distance != got.Routes[1].Summary.Distance {
		t.Errorf("broadcast summary.distance = %v, want routes[1]'s %v (routes[0]'s is %v — broadcast the unselected route)",
			frame.Summary.Distance, got.Routes[1].Summary.Distance, got.Routes[0].Summary.Distance)
	}
}

func TestRouteHandlerIndexOutOfRangeReturns400(t *testing.T) {
	fakeORS := httptest.NewServer(fakeORSHandler(http.StatusOK, fakeORSSuccessBody))
	defer fakeORS.Close()
	srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))
	code := mintRideCode(t, srv, "")

	// The fixture has exactly one feature — index 1 is out of range for it.
	resp := postRoute(t, srv, code, `{"waypoints":[[12.9,77.5],[13.0,77.6]],"index":1}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestRouteHandlerAlternativesOmittedForFarWaypoints(t *testing.T) {
	var gotORSBody []byte
	fakeORS := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var err error
		gotORSBody, err = io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("reading fake ORS request body: %v", err)
		}
		w.Write([]byte(fakeORSSuccessBody))
	}))
	defer fakeORS.Close()
	srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))
	code := mintRideCode(t, srv, "")

	// [12.9,77.5] to [20,85] is roughly 900km apart by haversine — comfortably over
	// the 60km straight-line gate (ADR-013 §3).
	resp := postRoute(t, srv, code, `{"waypoints":[[12.9,77.5],[20.0,85.0]],"alternatives":true}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST route status = %d, want 200", resp.StatusCode)
	}
	if strings.Contains(string(gotORSBody), "alternative_routes") {
		t.Errorf("ORS request body = %s, want no alternative_routes for waypoints over the 60km gate", gotORSBody)
	}
}

// fakeORSRetryOnAlternatives rejects any request that carries alternative_routes with
// a plain 400 (standing in for ORS refusing an alternatives search whose route turns
// out too long by road) and answers every other request with fakeORSSuccessBody. It's
// stateless — the decision is a pure function of each request's own body — so it works
// whether route.go's retry hits the same underlying connection or not.
func fakeORSRetryOnAlternatives(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	if strings.Contains(string(body), "alternative_routes") {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"alternative routes not available for this route"}`))
		return
	}
	w.Write([]byte(fakeORSSuccessBody))
}

func TestRouteHandlerRetriesWithoutAlternativesOn4xx(t *testing.T) {
	fakeORS := httptest.NewServer(http.HandlerFunc(fakeORSRetryOnAlternatives))
	defer fakeORS.Close()
	srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))
	code := mintRideCode(t, srv, "")

	resp := postRoute(t, srv, code, `{"waypoints":[[12.9,77.5],[13.0,77.6]],"alternatives":true}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("POST route status = %d, want 200 (retry without alternatives should have succeeded): %s", resp.StatusCode, body)
	}
	var got routeListResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if len(got.Routes) != 1 {
		t.Errorf("routes = %+v, want 1 (the retry's fixture has a single feature)", got.Routes)
	}
}

// The retry above must not fire on a quota error. A 403/429 is the one failure where a
// second attempt is actively harmful: it spends another request against the very ceiling
// the alternatives gate exists to protect, and a 429 specifically means send less, not
// more. This asserts the request count, not just the status code — a retrying
// implementation still returns 503 here, so status alone would not catch the regression.
func TestRouteHandlerDoesNotRetryOnQuota(t *testing.T) {
	var calls atomic.Int64
	fakeORS := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"error":"rate limit exceeded"}`))
	}))
	defer fakeORS.Close()
	srv, _ := newTestServer(t, nil, newORSClient(t, fakeORS))
	code := mintRideCode(t, srv, "")

	// Two waypoints well under the 60km gate, so alternatives really are requested and
	// the retry branch is reachable at all.
	resp := postRoute(t, srv, code, `{"waypoints":[[12.9,77.5],[13.0,77.6]],"alternatives":true}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", resp.StatusCode)
	}
	if got := calls.Load(); got != 1 {
		t.Errorf("ORS calls = %d, want 1 — a quota error must not be retried", got)
	}
}
