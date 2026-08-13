package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// testKid is the kid every TestIssuer publishes and signs under. One key under one kid
// is enough to exercise Verifier's real by-kid lookup path; nothing here needs to fake
// a multi-key rotation.
const testKid = "test-key-1"

// TestIssuer is an in-process, Supabase-shaped ES256 token issuer for tests. It
// generates a P-256 key pair, serves the public half as a JWKS from an httptest.Server
// at the same path a real Supabase project publishes to (jwksPath), and signs tokens
// with the private half.
//
// It exists so every package's tests can get a token that passes Verifier.verify
// without hand-rolling ES256 token construction or a fake JWKS endpoint —
// docs/ADR/ADR-017.md names this helper's HS256 predecessor explicitly as the answer to
// "tokens are inconvenient in tests" (Future Revisions: "What would not justify
// revisiting" is a DEV_NO_AUTH bypass; this is the alternative the record actually
// wants), and the ES256 migration keeps the same shape.
//
// Lives in this package as a regular (non-_test.go) file, not inside auth_test.go,
// because Go does not compile a package's _test.go files into anything an importing
// package can see. backend/main_test.go and backend/internal/hub/hub_test.go both need
// this, and neither could reach a helper defined only inside internal/auth's own tests.
type TestIssuer struct {
	// Server serves the JWKS. Callers must t.Cleanup(issuer.Server.Close).
	Server *httptest.Server
	// URL is Server.URL — pass it as New's supabaseURL argument, and MintToken uses it
	// to build a token's iss claim (URL + "/auth/v1").
	URL string

	key  *ecdsa.PrivateKey
	hits atomic.Int32 // number of times the JWKS endpoint has been requested
}

// NewTestIssuer generates a fresh P-256 key pair and starts an httptest.Server
// publishing it as a JWKS. The caller owns the server's lifetime.
func NewTestIssuer() (*TestIssuer, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generating test key pair: %w", err)
	}

	ti := &TestIssuer{key: key}
	mux := http.NewServeMux()
	mux.HandleFunc(jwksPath, ti.serveJWKS)
	ti.Server = httptest.NewServer(mux)
	ti.URL = ti.Server.URL
	return ti, nil
}

// Hits reports how many times the JWKS endpoint has been requested — tests use this to
// assert that an unrecognised kid triggers at most one refetch per interval rather than
// a request per lookup.
func (ti *TestIssuer) Hits() int32 {
	return ti.hits.Load()
}

func (ti *TestIssuer) serveJWKS(w http.ResponseWriter, _ *http.Request) {
	ti.hits.Add(1)
	pub := ti.key.PublicKey
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"keys": []map[string]string{{
			"kty": "EC",
			"kid": testKid,
			"crv": "P-256",
			"alg": "ES256",
			"use": "sig",
			"x":   base64.RawURLEncoding.EncodeToString(pub.X.Bytes()),
			"y":   base64.RawURLEncoding.EncodeToString(pub.Y.Bytes()),
		}},
	})
}

// MintToken signs a minimal, valid Supabase-shaped ES256 access token for subject sub,
// issued by ti.URL+"/auth/v1", signed with ti's private key and carrying ti's published
// kid — the token shape Verifier.verify checks in auth.go.
func (ti *TestIssuer) MintToken(sub string) (string, error) {
	now := time.Now()
	claims := supabaseClaims{
		Role: authenticatedRole,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   sub,
			Issuer:    ti.URL + "/auth/v1",
			Audience:  jwt.ClaimStrings{authenticatedAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	token.Header["kid"] = testKid
	return token.SignedString(ti.key)
}
