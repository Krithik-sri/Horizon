package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// newTestVerifier starts a TestIssuer and returns a Verifier already pointed at it and
// warmed with one Refresh, so a test doesn't have to special-case the lazy-refresh path
// unless that's the thing it's testing (TestUnknownKidRefreshIsRateLimited does).
func newTestVerifier(t *testing.T) (*Verifier, *TestIssuer) {
	t.Helper()
	issuer, err := NewTestIssuer()
	if err != nil {
		t.Fatalf("NewTestIssuer: %v", err)
	}
	t.Cleanup(issuer.Server.Close)

	v := New(issuer.URL, nil)
	if err := v.Refresh(); err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	return v, issuer
}

// validClaims returns a claim set that passes every check in Verifier.verify, issued by
// issuerURL — the baseline every negative test case below mutates exactly one field of.
func validClaims(issuerURL string) supabaseClaims {
	now := time.Now()
	return supabaseClaims{
		Role: authenticatedRole,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "rider-1",
			Issuer:    issuerURL + "/auth/v1",
			Audience:  jwt.ClaimStrings{authenticatedAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
}

// sign builds a token from claims, signed with key using method and carrying kid in its
// header (kid is skipped when empty) — the low-level building block every case below
// customises one field on top of.
func sign(t *testing.T, method jwt.SigningMethod, key any, kid string, claims supabaseClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(method, claims)
	if kid != "" {
		token.Header["kid"] = kid
	}
	s, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("signing test token: %v", err)
	}
	return s
}

// serve runs Require(next) against a single request carrying authHeader (unset if
// empty) for path, and reports the response and the subject next observed, if any.
func serve(v *Verifier, path, authHeader string) (status int, gotSubject string) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSubject = Subject(r.Context())
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	v.Require(next).ServeHTTP(rec, req)
	return rec.Code, gotSubject
}

func TestRequireValidTokenPasses(t *testing.T) {
	v, issuer := newTestVerifier(t)
	token, err := issuer.MintToken("rider-1")
	if err != nil {
		t.Fatalf("MintToken: %v", err)
	}

	status, subject := serve(v, "/ws", "Bearer "+token)
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if subject != "rider-1" {
		t.Errorf("Subject(ctx) = %q, want rider-1", subject)
	}
}

func TestRequireRejectsInvalidRequests(t *testing.T) {
	v, issuer := newTestVerifier(t)

	expiredClaims := validClaims(issuer.URL)
	expiredClaims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Hour))

	anonRoleClaims := validClaims(issuer.URL)
	anonRoleClaims.Role = "anon"

	wrongAudClaims := validClaims(issuer.URL)
	wrongAudClaims.Audience = jwt.ClaimStrings{"anon"}

	wrongIssClaims := validClaims(issuer.URL)
	wrongIssClaims.Issuer = "https://a-different-project.supabase.co/auth/v1"

	noSubClaims := validClaims(issuer.URL)
	noSubClaims.Subject = ""

	noneTok := jwt.NewWithClaims(jwt.SigningMethodNone, validClaims(issuer.URL))
	noneTok.Header["kid"] = testKid
	noneSigned, err := noneTok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("signing alg-none token: %v", err)
	}

	// A second, unpublished P-256 key pair — stands in both for "signed by a key that
	// isn't the one JWKS published" and for a bearer token whose kid was simply made
	// up.
	otherKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generating a second key pair: %v", err)
	}

	// The alg-confusion case: an HS256 token, "signed" using the JWKS's own public key
	// bytes as the HMAC secret. This is the classic RS/ES-to-HS confusion attack — it
	// only works against a verifier whose keyfunc hands back the same key material
	// regardless of the algorithm the token claims. jwt.WithValidMethods([]string{
	// "ES256"}) must reject this before the keyfunc (or the signature) is ever
	// consulted.
	pub := issuer.key.PublicKey
	hmacSecret := append(append([]byte{}, pub.X.Bytes()...), pub.Y.Bytes()...)

	cases := []struct {
		name   string
		header string // Authorization header value to send; "" means send none at all
	}{
		{"expired", "Bearer " + sign(t, jwt.SigningMethodES256, issuer.key, testKid, expiredClaims)},
		{"signed by a different P-256 key", "Bearer " + sign(t, jwt.SigningMethodES256, otherKey, testKid, validClaims(issuer.URL))},
		{"unknown kid", "Bearer " + sign(t, jwt.SigningMethodES256, otherKey, "no-such-kid", validClaims(issuer.URL))},
		{"alg none", "Bearer " + noneSigned},
		{"alg confusion: HS256 signed with the JWKS's own public key bytes", "Bearer " + sign(t, jwt.SigningMethodHS256, hmacSecret, testKid, validClaims(issuer.URL))},
		{"role anon", "Bearer " + sign(t, jwt.SigningMethodES256, issuer.key, testKid, anonRoleClaims)},
		{"wrong aud", "Bearer " + sign(t, jwt.SigningMethodES256, issuer.key, testKid, wrongAudClaims)},
		{"wrong iss", "Bearer " + sign(t, jwt.SigningMethodES256, issuer.key, testKid, wrongIssClaims)},
		{"missing sub", "Bearer " + sign(t, jwt.SigningMethodES256, issuer.key, testKid, noSubClaims)},
		{"absent header", ""},
	}

	// next must never run for a rejected request — a 401 that still let the rest of
	// the chain execute would defeat the whole point of a fail-closed boundary.
	unreachable := func(w http.ResponseWriter, r *http.Request) {
		panic("next ran for a request that should have been rejected")
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/ws", nil)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			rec := httptest.NewRecorder()
			v.Require(http.HandlerFunc(unreachable)).ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", rec.Code)
			}
		})
	}
}

// TestUnknownKidRefreshIsRateLimited asserts requirement 5 of the ES256 migration: a
// stream of tokens bearing a kid the JWKS never published must not turn into a request
// per lookup against Supabase. Only the first lookup within jwksRefreshInterval may
// fetch; every other must be answered from the (still-empty, for this kid) cache.
func TestUnknownKidRefreshIsRateLimited(t *testing.T) {
	issuer, err := NewTestIssuer()
	if err != nil {
		t.Fatalf("NewTestIssuer: %v", err)
	}
	t.Cleanup(issuer.Server.Close)

	// Deliberately no warmup Refresh — the first unknown-kid lookup below must be the
	// one and only fetch this test allows.
	v := New(issuer.URL, nil)

	otherKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generating throwaway key: %v", err)
	}
	token := sign(t, jwt.SigningMethodES256, otherKey, "no-such-kid", validClaims(issuer.URL))

	const attempts = 5
	for i := 0; i < attempts; i++ {
		status, _ := serve(v, "/ws", "Bearer "+token)
		if status != http.StatusUnauthorized {
			t.Fatalf("attempt %d: status = %d, want 401", i, status)
		}
	}

	if hits := issuer.Hits(); hits != 1 {
		t.Errorf("JWKS server received %d requests for %d unknown-kid lookups, want 1", hits, attempts)
	}
}

func TestRequireHealthzExemptWithNoToken(t *testing.T) {
	v, _ := newTestVerifier(t)
	status, _ := serve(v, "/healthz", "")
	if status != http.StatusOK {
		t.Errorf("status = %d, want 200 — /healthz must not require a token", status)
	}
}

func TestSubjectUnauthenticatedContextReturnsEmpty(t *testing.T) {
	if got := Subject(httptest.NewRequest(http.MethodGet, "/", nil).Context()); got != "" {
		t.Errorf("Subject on a plain context = %q, want empty", got)
	}
}
