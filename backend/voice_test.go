package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

// testLiveKitConfig is a fully-configured livekitConfig for tests that need the
// endpoint to actually mint a token. The key/secret are arbitrary — nothing here talks
// to real LiveKit Cloud, so any non-empty value round-trips through ToJWT/Verify.
var testLiveKitConfig = livekitConfig{
	URL:       "wss://test.livekit.cloud",
	APIKey:    "test-lk-key",
	APISecret: "test-lk-secret",
}

// postVoiceToken POSTs to /rides/{code}/voice-token as rider sub. Mirrors postRoute in
// route_test.go — no body, since voiceTokenHandler takes none (see voice.go's doc
// comment for why: identity comes from the bearer token, never a request field).
func postVoiceToken(t *testing.T, srv *httptest.Server, code, sub string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/rides/"+code+"/voice-token", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+testToken(t, sub))
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("POST /rides/%s/voice-token: %v", code, err)
	}
	return resp
}

func TestVoiceTokenHandlerUnsetConfigReturns503(t *testing.T) {
	srv, _ := newTestServer(t, nil, nil) // no livekitConfig arg -> unconfigured
	code := mintRideCode(t, srv, "")

	resp := postVoiceToken(t, srv, code, "voice-rider1")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", resp.StatusCode)
	}
}

func TestVoiceTokenHandlerUnknownCodeReturns404(t *testing.T) {
	srv, _ := newTestServer(t, nil, nil, testLiveKitConfig)

	resp := postVoiceToken(t, srv, "NOTMINTED", "voice-rider1")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", resp.StatusCode)
	}
}

// The ride-existence check must run before the configuration check, exactly like
// routeHandler (route.go) — an unknown code shouldn't leak "and voice isn't set up
// either" ahead of "this ride doesn't exist at all". This asserts it the only way that
// actually distinguishes the two orderings: an unknown code against an *unconfigured*
// server must still 404, not 503.
func TestVoiceTokenHandlerUnknownCodeTakesPrecedenceOver503(t *testing.T) {
	srv, _ := newTestServer(t, nil, nil) // unconfigured

	resp := postVoiceToken(t, srv, "NOTMINTED", "voice-rider1")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (ride-existence must be checked before configuration)", resp.StatusCode)
	}
}

func TestVoiceTokenHandlerSuccess(t *testing.T) {
	srv, _ := newTestServer(t, nil, nil, testLiveKitConfig)
	code := mintRideCode(t, srv, "")

	resp := postVoiceToken(t, srv, code, "voice-rider1")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var got voiceTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.URL == "" {
		t.Error("url is empty, want LIVEKIT_URL echoed back")
	}
	if got.Token == "" {
		t.Error("token is empty")
	}
}

// TestVoiceTokenHandlerClaims asserts the token's **raw JSON claim shape**, not just
// that some struct round-trips.
//
// That distinction is the whole point of this test. voice.go builds LiveKit's claim
// object itself rather than importing github.com/livekit/protocol, so the contract with
// LiveKit's server is now these exact JSON keys — decoding into our own struct would
// happily pass while sending a field LiveKit ignores. Reading the payload as a bare map
// is what catches a renamed or dropped key.
//
// The claims checked are the ones ADR-020 §4 specifies: room = the ride code, sub = the
// authenticated subject (never client-suppliable — ADR-017), and canPublishData present
// and false. That last one is asserted for *presence* as well as value, because LiveKit
// treats an omitted grant as permitted — an `omitempty` slipping onto that field would
// silently grant every rider a data channel.
func TestVoiceTokenHandlerClaims(t *testing.T) {
	srv, _ := newTestServer(t, nil, nil, testLiveKitConfig)
	code := mintRideCode(t, srv, "")

	resp := postVoiceToken(t, srv, code, "voice-rider1")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got voiceTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}

	// Verify the signature with the shared secret, pinning HS256 — the same parse
	// options internal/auth uses on the inbound side.
	var claims jwt.MapClaims
	tok, err := jwt.ParseWithClaims(got.Token, &claims,
		func(*jwt.Token) (any, error) { return []byte(testLiveKitConfig.APISecret), nil },
		jwt.WithValidMethods([]string{"HS256"}),
	)
	if err != nil || !tok.Valid {
		t.Fatalf("parsing minted token: %v", err)
	}

	if claims["iss"] != testLiveKitConfig.APIKey {
		t.Errorf("iss = %v, want the API key", claims["iss"])
	}
	if claims["sub"] != "voice-rider1" {
		t.Errorf("sub = %v, want the authenticated rider id", claims["sub"])
	}
	for _, k := range []string{"iat", "nbf", "exp"} {
		if _, ok := claims[k]; !ok {
			t.Errorf("%s claim missing", k)
		}
	}

	video, ok := claims["video"].(map[string]any)
	if !ok {
		t.Fatalf("video grant missing or not an object: %#v", claims["video"])
	}
	if video["room"] != code {
		t.Errorf("video.room = %v, want %q", video["room"], code)
	}
	for _, k := range []string{"roomJoin", "canPublish", "canSubscribe"} {
		if video[k] != true {
			t.Errorf("video.%s = %v, want true", k, video[k])
		}
	}
	// Presence and value both: a missing key here is a granted permission.
	v, present := video["canPublishData"]
	if !present {
		t.Error("video.canPublishData is absent — LiveKit reads an omitted grant as permitted (ADR-020 §4)")
	} else if v != false {
		t.Errorf("video.canPublishData = %v, want false — position has its own pipe (ADR-020 §4)", v)
	}
}
