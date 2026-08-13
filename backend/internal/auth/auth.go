// Package auth verifies Supabase-issued JWTs on every request the Go server answers,
// except /healthz.
//
// Supabase Auth is the only identity issuer in this system (docs/ADR/ADR-008.md): the
// Go server never mints a session and never has a user table, so this package's whole
// job is verification, not authentication. docs/ADR/ADR-017.md is the decision this
// package implements — read it for the full rationale behind each check below. §8 of
// that record anticipated the fork this package now takes: Supabase signs with ES256,
// not the HS256 shared secret §8 chose for v1, so verification goes through the
// project's JWKS instead of a static secret. §5 (the claim set) and §7 (fail-closed
// startup) are otherwise unchanged.
package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// healthzPath is the one route Require lets through with no token
// (docs/ADR/ADR-017.md Decision §1). Mirrors internal/httpx/logging.go's healthPath
// constant; not imported from there — auth stays a leaf package with no sibling
// dependency over one string.
const healthzPath = "/healthz"

// authenticatedRole is the only Supabase `role` claim this server accepts, and
// authenticatedAudience is the only `aud` it accepts. Together they are the
// security-critical part of verification, not ceremony: in a legacy HS256 Supabase
// project the public `anon` API key shipped inside every APK — correctly so, per
// docs/ADR/ADR-016.md §5 — is itself a JWT signed with the same project secret,
// carrying role: "anon", no `aud` claim, and a ~10-year expiry. Signature verification
// alone would accept it: the signature really is valid, and really was issued by
// Supabase. Without both checks, anyone holding the app's public anon key holds a valid
// credential for this server (docs/ADR/ADR-017.md Decision §5).
const (
	authenticatedRole     = "authenticated"
	authenticatedAudience = "authenticated"
)

// tokenLeeway absorbs clock drift between this server and Supabase's when checking
// expiry.
const tokenLeeway = 30 * time.Second

// jwksPath is appended to a project's SUPABASE_URL to build its JWKS endpoint. Every
// Supabase project publishes its current signing keys here, verified live against the
// project this migration targets.
const jwksPath = "/auth/v1/.well-known/jwks.json"

// jwksTimeout bounds a single JWKS fetch, applied when New is given no http.Client of
// its own.
const jwksTimeout = 10 * time.Second

// jwksRefreshInterval rate-limits how often an unrecognised kid triggers a refetch.
// Without this, a stream of tokens bearing garbage kids becomes an outbound request
// amplifier against Supabase's JWKS endpoint — see getKey.
const jwksRefreshInterval = time.Minute

// Claims is what this package trusts out of a verified token, and nothing else.
//
// Deliberately narrow. A Supabase access token also carries `email` and
// `user_metadata`; neither is here. `user_metadata` is writable by the user themselves
// via `updateUser`, so trusting it would let a rider grant themselves whatever it
// holds. `email` has no use in this server today (docs/ADR/ADR-017.md Decision §5).
type Claims struct {
	// Subject is the token's `sub` — the Supabase user id. It is the only identity
	// this server trusts, and it becomes internal/hub.ServeWS's seat key in place of
	// the old client-asserted `?rider=`.
	Subject string

	// IsAnonymous is read but never gated on: anonymous riders are first-class
	// (docs/ADR/ADR-016.md). It lives on Claims for a caller that needs it for
	// something non-security-critical later; nothing reads it today.
	IsAnonymous bool
}

// supabaseClaims is the wire shape this package parses: jwt.RegisteredClaims covers
// sub/iss/aud/exp, and Role/IsAnonymous are the two Supabase-specific fields
// verification also needs.
type supabaseClaims struct {
	Role        string `json:"role"`
	IsAnonymous bool   `json:"is_anonymous"`
	jwt.RegisteredClaims
}

// Verifier holds the one Supabase project's issuer this server trusts, and a cache of
// its JWKS signing keys keyed by `kid`. Built once, at startup, from SUPABASE_URL — see
// main.go's run().
//
// The key cache is populated lazily and refreshed at most once every
// jwksRefreshInterval when an unrecognised kid is seen (getKey); main.go's run() also
// calls Refresh once at boot so the common case needs no request to pay for a fetch.
type Verifier struct {
	supabaseURL string
	jwksURL     string
	hc          *http.Client

	mu          sync.RWMutex
	keys        map[string]*ecdsa.PublicKey
	lastAttempt time.Time
	inFlight    chan struct{} // non-nil while a refresh is in progress; closed when it completes
}

// New builds a Verifier for supabaseURL. hc may be nil, in which case a client bounded
// by jwksTimeout is used; pass one explicitly to share a transport, override the
// timeout, or — in tests — point at an httptest.Server (see TestIssuer in
// testtoken.go).
//
// New does not fetch the JWKS itself. main.go's run() refuses to boot at all with a
// blank SUPABASE_URL (docs/ADR/ADR-017.md Decision §7) — that check happens before New
// is even called — but a transient fetch failure must not be fatal the way a blank URL
// is: call Refresh once at startup and log rather than fail on its error. With no keys
// cached, every request 401s, which is already fail-closed, and the lazy refresh in
// getKey lets the server recover without a restart once Supabase is reachable again.
func New(supabaseURL string, hc *http.Client) *Verifier {
	if hc == nil {
		hc = &http.Client{Timeout: jwksTimeout}
	}
	return &Verifier{
		supabaseURL: supabaseURL,
		jwksURL:     supabaseURL + jwksPath,
		hc:          hc,
		keys:        make(map[string]*ecdsa.PublicKey),
	}
}

// Refresh fetches the JWKS and replaces the cached key set wholesale. Callers: main.go's
// run() once at startup, and getKey — at most once per jwksRefreshInterval — when it
// meets a kid it doesn't recognise, so a key rotated after boot is picked up without a
// restart.
func (v *Verifier) Refresh() error {
	v.mu.Lock()
	v.lastAttempt = time.Now()
	v.mu.Unlock()

	keys, err := v.fetchKeys()
	if err != nil {
		return err
	}

	v.mu.Lock()
	v.keys = keys
	v.mu.Unlock()
	return nil
}

// claimsCtxKey is unexported so only this package can populate or read request context
// under it; Subject below is the only accessor a handler needs.
type claimsCtxKey struct{}

// Require returns middleware that rejects any request without a valid Supabase access
// token before next runs, and stores the verified Claims on the request context for
// Subject to read back.
//
// Wraps the whole mux rather than gating per-route (docs/ADR/ADR-017.md Decision §1):
// an authorization boundary must cover routes nobody has written yet, and per-route
// middleware fails open on the one route someone forgets to add it to.
//
// /healthz is exempt — it is the one endpoint a platform health check hits with no
// credential of any kind.
//
// Rejecting here, before next runs, is also what makes a failed WebSocket upgrade free:
// this never calls next for a bad token, so hub.ServeWS's upgrader.Upgrade never runs
// and no special handling is needed to keep a 401 from reaching a client mid-handshake
// (docs/ADR/ADR-017.md Decision §3).
func (v *Verifier) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == healthzPath {
			next.ServeHTTP(w, r)
			return
		}

		token, ok := bearerToken(r)
		if !ok {
			http.Error(w, "missing bearer token", http.StatusUnauthorized)
			return
		}

		claims, err := v.verify(token)
		if err != nil {
			http.Error(w, "invalid or expired token", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsCtxKey{}, claims)))
	})
}

// Subject returns the verified rider id from ctx, or "" if ctx carries no Claims — a
// handler reached without going through Require, or a context that was never derived
// from the *http.Request Require built.
func Subject(ctx context.Context) string {
	claims, ok := ctx.Value(claimsCtxKey{}).(Claims)
	if !ok {
		return ""
	}
	return claims.Subject
}

// bearerToken extracts the token from the Authorization header only — never a query
// string. internal/httpx/logging.go logs r.URL.Path but never headers or the query
// string, so this is what keeps a token out of the access log; a token in the URL would
// also be visible to any proxy or CDN log in front of this server, which a header is
// not (docs/ADR/ADR-008.md).
func bearerToken(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, prefix) {
		return "", false
	}
	token := strings.TrimSpace(strings.TrimPrefix(h, prefix))
	if token == "" {
		return "", false
	}
	return token, true
}

// verify parses and validates token against everything docs/ADR/ADR-017.md Decision §5
// lists:
//
//   - ES256 only (jwt.WithValidMethods) — the alg-confusion defence CLAUDE.md demands,
//     and the reason it insists on golang-jwt/jwt/v5 rather than a hand-rolled
//     verifier: accepting whatever alg the token claims to use is how "none" and
//     alg-substitution attacks work. HS256 is deliberately not also accepted — a
//     verifier that takes either is a larger attack surface than a single-algorithm
//     Supabase project needs.
//   - iss must be supabaseURL + "/auth/v1" — free, and blocks a token minted by a
//     different Supabase project sharing this server by accident.
//   - aud must be "authenticated".
//   - exp is required (jwt.WithExpirationRequired) and checked with tokenLeeway of
//     clock drift.
//
// The signing key itself comes from keyFunc, which selects by the token's `kid` header
// — never "try every published key," never "fall back to the first one" (see getKey).
//
// role is not something a jwt.ParserOption can check — WithAudience validates the
// generic, registered `aud` claim, but Supabase's `role` is not a registered claim — so
// it, and a non-empty subject, are checked explicitly afterward.
func (v *Verifier) verify(token string) (Claims, error) {
	var claims supabaseClaims
	_, err := jwt.ParseWithClaims(token, &claims, v.keyFunc,
		jwt.WithValidMethods([]string{"ES256"}),
		jwt.WithIssuer(v.supabaseURL+"/auth/v1"),
		jwt.WithAudience(authenticatedAudience),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(tokenLeeway),
	)
	if err != nil {
		return Claims{}, err
	}

	// The security-critical check no ParserOption expresses — see authenticatedRole's
	// doc comment for why this and `aud` are the pair that actually matters here.
	if claims.Role != authenticatedRole {
		return Claims{}, errors.New("token role is not " + authenticatedRole)
	}

	// A token that clears every claim check above but somehow carries no subject is
	// not one this server can seat a rider under: hub.ServeWS uses Subject as the
	// room's map key, and an empty key is not a rider identity.
	if claims.Subject == "" {
		return Claims{}, errors.New("token has no subject")
	}

	return Claims{Subject: claims.Subject, IsAnonymous: claims.IsAnonymous}, nil
}

// keyFunc is golang-jwt's Keyfunc callback: it reads the token's (still-unverified)
// `kid` header and resolves it to a public key via getKey. There is no other lookup
// path — a token with no kid, or a kid this JWKS never published, is rejected here
// before any signature check runs.
func (v *Verifier) keyFunc(t *jwt.Token) (any, error) {
	raw, ok := t.Header["kid"]
	if !ok {
		return nil, errors.New("token header has no kid")
	}
	kid, ok := raw.(string)
	if !ok || kid == "" {
		return nil, errors.New("token header kid is not a non-empty string")
	}
	return v.getKey(kid)
}

// getKey returns the cached public key for kid, refreshing the whole JWKS first if kid
// is unrecognised — but at most once per jwksRefreshInterval, so a client sending a
// stream of garbage kids cannot turn into a request amplifier against Supabase's JWKS
// endpoint (requirement 5 of the ES256 migration this package implements).
//
// A cold cache legitimately fields many concurrent requests for the same real kid —
// every rider who connects before the first fetch completes. Those must not each be
// turned away: a caller that finds a refresh already in flight waits on it and rechecks
// the cache, rather than either duplicating the fetch or being rejected as if it were
// one of the garbage-kid case the rate limit exists for.
func (v *Verifier) getKey(kid string) (*ecdsa.PublicKey, error) {
	v.mu.RLock()
	key, ok := v.keys[kid]
	v.mu.RUnlock()
	if ok {
		return key, nil
	}

	v.mu.Lock()
	if key, ok := v.keys[kid]; ok {
		// A concurrent refresh already resolved this kid while we waited for the lock.
		v.mu.Unlock()
		return key, nil
	}
	if v.inFlight != nil {
		done := v.inFlight
		v.mu.Unlock()
		<-done
		return v.lookupCached(kid)
	}
	if time.Since(v.lastAttempt) < jwksRefreshInterval {
		v.mu.Unlock()
		return nil, fmt.Errorf("unknown kid %q (refresh rate-limited)", kid)
	}
	done := make(chan struct{})
	v.inFlight = done
	v.lastAttempt = time.Now()
	v.mu.Unlock()

	// Fetched outside the lock so a slow or stalled Supabase does not hold up every
	// other concurrent verification for the duration of the request.
	keys, err := v.fetchKeys()

	v.mu.Lock()
	if err == nil {
		v.keys = keys
	}
	v.inFlight = nil
	close(done)
	v.mu.Unlock()

	if err != nil {
		return nil, fmt.Errorf("refreshing JWKS: %w", err)
	}
	return v.lookupCached(kid)
}

// lookupCached reads kid out of the current cache with no refresh attempt of its own —
// the tail end of getKey, shared by the caller that ran the fetch and every caller that
// waited on it.
func (v *Verifier) lookupCached(kid string) (*ecdsa.PublicKey, error) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	key, ok := v.keys[kid]
	if !ok {
		return nil, fmt.Errorf("unknown kid %q", kid)
	}
	return key, nil
}

// jwksResponse mirrors just enough of RFC 7517 to pull out P-256 EC keys — the only
// key shape Supabase's ES256 signing produces and the only shape verify ever asks for.
type jwksResponse struct {
	Keys []struct {
		Kty string `json:"kty"`
		Kid string `json:"kid"`
		Crv string `json:"crv"`
		X   string `json:"x"`
		Y   string `json:"y"`
	} `json:"keys"`
}

// fetchKeys does the actual HTTP round trip and JWKS parse. Refresh and getKey are its
// only two callers, both of which own the locking and rate limiting around it.
func (v *Verifier) fetchKeys() (map[string]*ecdsa.PublicKey, error) {
	req, err := http.NewRequest(http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return nil, fmt.Errorf("building JWKS request: %w", err)
	}
	resp, err := v.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching JWKS: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetching JWKS: status %d", resp.StatusCode)
	}

	var parsed jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("decoding JWKS: %w", err)
	}

	keys := make(map[string]*ecdsa.PublicKey, len(parsed.Keys))
	for _, k := range parsed.Keys {
		// Only EC/P-256 keys are usable here — verify pins ES256, so a key of any
		// other shape (an RSA key published alongside it during a hypothetical
		// migration, say) would never be looked up anyway. Skipped, not an error: one
		// malformed or unsupported entry must not blank out every other key in the
		// set, and a project mid-rotation is expected to publish more than one key.
		if k.Kty != "EC" || k.Crv != "P-256" || k.Kid == "" {
			continue
		}
		pub, err := parseECPublicKey(k.X, k.Y)
		if err != nil {
			continue
		}
		keys[k.Kid] = pub
	}
	return keys, nil
}

// parseECPublicKey rebuilds a P-256 public key from a JWK's base64url-encoded x/y
// coordinates (RFC 7518 §6.2.1). golang-jwt implements ES256 signature verification
// itself; it does not parse JWKS, so this is the one piece of that spec this package
// has to implement by hand rather than pull in a JWKS library (CLAUDE.md: golang-jwt is
// the second and last Go dependency).
func parseECPublicKey(xB64, yB64 string) (*ecdsa.PublicKey, error) {
	xb, err := base64.RawURLEncoding.DecodeString(xB64)
	if err != nil {
		return nil, fmt.Errorf("decoding x: %w", err)
	}
	yb, err := base64.RawURLEncoding.DecodeString(yB64)
	if err != nil {
		return nil, fmt.Errorf("decoding y: %w", err)
	}
	curve := elliptic.P256()
	x, y := new(big.Int).SetBytes(xb), new(big.Int).SetBytes(yb)
	if !curve.IsOnCurve(x, y) {
		return nil, errors.New("point is not on P-256")
	}
	return &ecdsa.PublicKey{Curve: curve, X: x, Y: y}, nil
}
