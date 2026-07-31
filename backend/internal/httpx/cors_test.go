package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

const (
	devOrigin   = "http://localhost:8081"
	lanOrigin   = "http://192.168.1.50:8081"
	otherOrigin = "http://evil.example.com"
)

func TestParseOrigins(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want []string
	}{
		{"empty string", "", nil},
		{"only whitespace", "   ", nil},
		{"only separators", ",,,", nil},
		{"separators and whitespace", " , ,  ", nil},
		{"single origin", devOrigin, []string{devOrigin}},
		{"single origin padded", "  " + devOrigin + "  ", []string{devOrigin}},
		{"two origins", devOrigin + "," + lanOrigin, []string{devOrigin, lanOrigin}},
		{"two origins spaced", devOrigin + ", " + lanOrigin, []string{devOrigin, lanOrigin}},
		{"trailing separator", devOrigin + ",", []string{devOrigin}},
		{"leading separator", "," + devOrigin, []string{devOrigin}},
		{"empty entry between", devOrigin + ",," + lanOrigin, []string{devOrigin, lanOrigin}},
		{"newline padded", "\n" + devOrigin + "\n,\t" + lanOrigin + "\t", []string{devOrigin, lanOrigin}},

		// Exact matching is the contract: ParseOrigins must not normalise. A trailing
		// slash or a different case is a misconfiguration the operator has to fix, not
		// something this function silently repairs.
		{"case preserved", "HTTP://LocalHost:8081", []string{"HTTP://LocalHost:8081"}},
		{"trailing slash preserved", devOrigin + "/", []string{devOrigin + "/"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseOrigins(tt.raw)
			if len(got) != len(tt.want) {
				t.Fatalf("ParseOrigins(%q) = %#v, want %#v", tt.raw, got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("ParseOrigins(%q)[%d] = %q, want %q", tt.raw, i, got[i], tt.want[i])
				}
			}
		})
	}
}

// probe is the inner handler the middleware wraps. It records whether it ran, so tests
// can assert that a preflight terminates in the middleware and never reaches the mux.
type probe struct {
	called bool
	status int
}

func (p *probe) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	p.called = true
	status := p.status
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
}

// serve runs one request through CORS(origins) and reports what came back.
func serve(t *testing.T, origins []string, req *http.Request, inner *probe) *http.Response {
	t.Helper()
	rec := httptest.NewRecorder()
	CORS(origins)(inner).ServeHTTP(rec, req)
	return rec.Result()
}

func preflight(origin, method string) *http.Request {
	req := httptest.NewRequest(http.MethodOptions, "/rides", nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	req.Header.Set("Access-Control-Request-Method", method)
	req.Header.Set("Access-Control-Request-Headers", "content-type")
	return req
}

func simple(origin string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/rides", nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	return req
}

func TestCORS(t *testing.T) {
	allowlist := []string{devOrigin, lanOrigin}

	tests := []struct {
		name string

		origins    []string
		req        *http.Request
		innerCode  int // status the wrapped handler writes; 0 means 200
		wantStatus int

		// "" asserts the header is absent.
		wantAllowOrigin  string
		wantAllowMethods string
		wantAllowHeaders string
		wantMaxAge       string

		wantInnerCalled bool
	}{
		{
			// The bug this task exists to fix: a simple cross-origin POST /rides from
			// the dev page must come back with an allow-origin header, or the browser
			// discards a response the server already produced.
			name:            "simple request from allowed origin is annotated",
			origins:         allowlist,
			req:             simple(devOrigin),
			wantStatus:      http.StatusOK,
			wantAllowOrigin: devOrigin,
			wantInnerCalled: true,
		},
		{
			name:            "simple request from second allowed origin is annotated",
			origins:         allowlist,
			req:             simple(lanOrigin),
			wantStatus:      http.StatusOK,
			wantAllowOrigin: lanOrigin,
			wantInnerCalled: true,
		},
		{
			// Refusal is the absence of the header. The request still runs: CORS is
			// enforced by the browser on the response, and rejecting here would break
			// every non-browser caller without stopping anything.
			name:            "simple request from disallowed origin gets no headers but still runs",
			origins:         allowlist,
			req:             simple(otherOrigin),
			wantStatus:      http.StatusOK,
			wantAllowOrigin: "",
			wantInnerCalled: true,
		},
		{
			name:             "preflight from allowed origin returns 204 with the full header set",
			origins:          allowlist,
			req:              preflight(devOrigin, http.MethodPost),
			wantStatus:       http.StatusNoContent,
			wantAllowOrigin:  devOrigin,
			wantAllowMethods: allowMethods,
			wantAllowHeaders: allowHeaders,
			wantMaxAge:       maxAge,
			wantInnerCalled:  false, // terminates in the middleware; the mux never sees it
		},
		{
			name:            "preflight from disallowed origin is refused with 403",
			origins:         allowlist,
			req:             preflight(otherOrigin, http.MethodPost),
			wantStatus:      http.StatusForbidden,
			wantAllowOrigin: "",
			wantInnerCalled: false,
		},
		{
			// Zero-config local development: localhost, 127.0.0.1 and a DHCP-assigned
			// LAN address are three separate origins, and requiring all three to be
			// enumerated would make the tool hostile.
			name:            "empty allowlist allows any origin",
			origins:         nil,
			req:             simple(otherOrigin),
			wantStatus:      http.StatusOK,
			wantAllowOrigin: otherOrigin,
			wantInnerCalled: true,
		},
		{
			name:             "empty allowlist answers any preflight",
			origins:          nil,
			req:              preflight(otherOrigin, http.MethodPost),
			wantStatus:       http.StatusNoContent,
			wantAllowOrigin:  otherOrigin,
			wantAllowMethods: allowMethods,
			wantAllowHeaders: allowHeaders,
			wantMaxAge:       maxAge,
			wantInnerCalled:  false,
		},
		{
			// The native client, curl, wstest.mjs and platform health checks all send no
			// Origin. They must pass through completely untouched.
			name:            "request with no Origin passes through unannotated",
			origins:         allowlist,
			req:             simple(""),
			wantStatus:      http.StatusOK,
			wantAllowOrigin: "",
			wantInnerCalled: true,
		},
		{
			// Guards the Access-Control-Request-Method condition. Without it, every
			// OPTIONS on the server would answer 204 — masking net/http's 405 + Allow
			// and making a genuine OPTIONS route impossible to add later.
			name:            "OPTIONS without Access-Control-Request-Method is not a preflight",
			origins:         allowlist,
			req:             optionsNoPreflight(devOrigin),
			wantStatus:      http.StatusMethodNotAllowed, // whatever the mux decides
			innerCode:       http.StatusMethodNotAllowed,
			wantAllowOrigin: devOrigin,
			wantInnerCalled: true,
		},
		{
			// Exact matching, no normalisation: a trailing slash is not an origin, and a
			// configured entry that carries one simply never matches.
			name:            "case-differing origin does not match",
			origins:         allowlist,
			req:             simple("HTTP://LocalHost:8081"),
			wantStatus:      http.StatusOK,
			wantAllowOrigin: "",
			wantInnerCalled: true,
		},
		{
			// Origin: null is a shared origin across mutually untrusting contexts
			// (sandboxed iframes, file://) and must never be special-cased into an allow.
			name:            "Origin null is denied under a real allowlist",
			origins:         allowlist,
			req:             simple("null"),
			wantStatus:      http.StatusOK,
			wantAllowOrigin: "",
			wantInnerCalled: true,
		},
		{
			// Headers are set before delegating, so they survive onto whatever the inner
			// chain produces. Without this, a handler failure is doubly invisible: the
			// request fails and the browser suppresses the response that says so.
			name:            "headers survive an inner error response",
			origins:         allowlist,
			req:             simple(devOrigin),
			innerCode:       http.StatusInternalServerError,
			wantStatus:      http.StatusInternalServerError,
			wantAllowOrigin: devOrigin,
			wantInnerCalled: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			inner := &probe{status: tt.innerCode}
			res := serve(t, tt.origins, tt.req, inner)
			defer res.Body.Close()

			if res.StatusCode != tt.wantStatus {
				t.Errorf("status = %d, want %d", res.StatusCode, tt.wantStatus)
			}
			if inner.called != tt.wantInnerCalled {
				t.Errorf("inner handler called = %v, want %v", inner.called, tt.wantInnerCalled)
			}

			checkHeader(t, res, "Access-Control-Allow-Origin", tt.wantAllowOrigin)
			checkHeader(t, res, "Access-Control-Allow-Methods", tt.wantAllowMethods)
			checkHeader(t, res, "Access-Control-Allow-Headers", tt.wantAllowHeaders)
			checkHeader(t, res, "Access-Control-Max-Age", tt.wantMaxAge)

			// Vary is unconditional: the allow-origin value depends on the request's
			// Origin, so any shared cache could otherwise replay one origin's response
			// to another — including a cached header-less one.
			if got := res.Header.Get("Vary"); got != "Origin" {
				t.Errorf("Vary = %q, want %q", got, "Origin")
			}

			// No cookies, no sessions, no auth. Sending this while the permissive
			// default is active would let any site make authenticated requests the
			// moment authentication exists.
			if got := res.Header.Get("Access-Control-Allow-Credentials"); got != "" {
				t.Errorf("Access-Control-Allow-Credentials = %q, want it absent", got)
			}

			// Echoing the matched origin keeps the door open for credentials later;
			// "*" would close it, and would need a second code path today.
			if got := res.Header.Get("Access-Control-Allow-Origin"); got == "*" {
				t.Error(`Access-Control-Allow-Origin = "*", want the echoed origin`)
			}
		})
	}
}

func optionsNoPreflight(origin string) *http.Request {
	req := httptest.NewRequest(http.MethodOptions, "/rides", nil)
	req.Header.Set("Origin", origin)
	return req
}

func checkHeader(t *testing.T, res *http.Response, name, want string) {
	t.Helper()
	got := res.Header.Get(name)
	if got != want {
		if want == "" {
			t.Errorf("%s = %q, want it absent", name, got)
			return
		}
		t.Errorf("%s = %q, want %q", name, got, want)
	}
}
