package main

import (
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/krithik/horizon/backend/internal/auth"
	"github.com/krithik/horizon/backend/internal/hub"
)

// A LiveKit access token is a plain HS256 JWT with a documented claim shape, so it is
// built here with golang-jwt/jwt/v5 — already a direct dependency for verifying
// Supabase tokens (ADR-017) — rather than by pulling in github.com/livekit/protocol.
//
// ADR-005 says not to hand-roll a JWT, and that still holds: this does not touch HMAC,
// base64 or constant-time comparison. It hands a claims struct to the same vetted
// library CLAUDE.md already mandates for JWT work, which is precisely what
// livekit/protocol's own auth.AccessToken.ToJWT does internally
// (jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret), over a
// struct embedding jwt.RegisteredClaims). What it avoids is 68 indirect modules —
// protobuf, protovalidate, cel-go, antlr, prometheus and pion/webrtc — reaching a
// server that does no WebRTC, for two symbols.
//
// voice_test.go pins the wire shape against these field names; if LiveKit ever changes
// them, that test is what fails rather than a silent 401 at join time.

// videoGrant mirrors livekit/protocol's auth.VideoGrant, narrowed to the fields this
// server sets.
//
// Note the deliberate absence of `omitempty` on the three booleans. LiveKit's own
// struct types them as *bool precisely so an unset grant can be distinguished from one
// explicitly set to false — with `omitempty` on a plain bool, `canPublishData: false`
// would be omitted entirely, and LiveKit treats an omitted grant as *permitted*. That
// would silently hand every rider a data channel this server means to deny. Plain bools
// with no omitempty always serialise, which makes the safe thing the only thing.
type videoGrant struct {
	Room           string `json:"room"`
	RoomJoin       bool   `json:"roomJoin"`
	CanPublish     bool   `json:"canPublish"`
	CanSubscribe   bool   `json:"canSubscribe"`
	CanPublishData bool   `json:"canPublishData"`
}

// livekitClaims is LiveKit's tokenClaims: the JWT registered claims (iss = API key,
// sub = identity, iat/nbf/exp) with the grant object flattened in beside them.
type livekitClaims struct {
	jwt.RegisteredClaims
	Video *videoGrant `json:"video"`
}

// voiceTokenTTL is how long a minted LiveKit token stays valid.
//
// ADR-005 asked for a short TTL, and ten minutes was the number originally in mind.
// ADR-020 §4 corrects that: LiveKit validates `exp` at join *and* at every reconnect,
// not just at the initial handshake. A ten-minute token dies in the first tunnel or
// dead zone on a bike ride and voice never comes back without the app noticing and
// re-fetching — which it doesn't do today. One hour keeps the short-TTL intent (a
// leaked token is not a standing credential) while comfortably surviving the mobile
// network conditions wsClient.ts's jittered backoff already exists to handle.
const voiceTokenTTL = time.Hour

// livekitConfig is the server's LiveKit Cloud credentials, read from env in main.go's
// run(). All three fields come from the same place a real deployment gets them: the
// LiveKit Cloud project dashboard.
type livekitConfig struct {
	URL       string
	APIKey    string
	APISecret string
}

// Configured mirrors ors.Client.Configured(): main.go always builds a livekitConfig,
// even with blank env vars, so voiceTokenHandler can answer 503 without a nilable
// config threaded through buildHandler.
func (c livekitConfig) Configured() bool {
	return c.URL != "" && c.APIKey != "" && c.APISecret != ""
}

// voiceTokenResponse is the body of POST /rides/{code}/voice-token. URL is
// LIVEKIT_URL — public configuration the client needs to dial, not a secret.
// LIVEKIT_API_SECRET, which actually is one, never leaves this handler.
type voiceTokenResponse struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

// voiceTokenHandler mints a LiveKit room-join JWT for the calling rider (ADR-005,
// ADR-020 §4). No request body: the only two things a token needs beyond the room are
// an identity and (optionally) a display name, and the identity already has a source
// of truth — auth.Subject(r.Context()), the verified Supabase `sub` — that a request
// body must not be allowed to override. ADR-017 removed exactly this kind of
// client-asserted identity from /ws's `?rider=` param; accepting a `rider` field here
// would reopen the same hole one endpoint over.
//
// A display name is deliberately not accepted either, even as an optional field. Per
// ADR-020 §1 and §6, incoming voice has no UI at all — no speaking-rider list, no
// participant count — so nothing in this app ever reads a LiveKit participant's Name.
// A field that reaches no screen is exactly the "affordance that does nothing" the
// product's Confidence pillar (ADR-020 §6) argues against; SetName is simply left
// unset. If a name-bearing UI is added later (LiveKit's own dashboard, say), it can be
// wired in then — see CLAUDE.md's stack table: "add dependencies/fields on first real
// use, not upfront."
func voiceTokenHandler(h *hub.Hub, lk livekitConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		code := r.PathValue("code")

		// Same order as routeHandler: ride existence before configuration, so an
		// unknown code 404s even when LiveKit isn't set up at all, rather than
		// leaking "well, voice would be unavailable anyway" ahead of "this ride
		// doesn't exist".
		if !h.RideExists(code) {
			http.Error(w, "unknown ride code", http.StatusNotFound)
			return
		}
		if !lk.Configured() {
			http.Error(w, "voice service is not configured", http.StatusServiceUnavailable)
			return
		}

		now := time.Now()
		claims := livekitClaims{
			RegisteredClaims: jwt.RegisteredClaims{
				Issuer:    lk.APIKey,
				Subject:   auth.Subject(r.Context()),
				IssuedAt:  jwt.NewNumericDate(now),
				NotBefore: jwt.NewNumericDate(now),
				ExpiresAt: jwt.NewNumericDate(now.Add(voiceTokenTTL)),
			},
			Video: &videoGrant{
				Room:         code,
				RoomJoin:     true,
				CanPublish:   true,
				CanSubscribe: true,
				// Position already has its own pipe — the `loc`/`state` WS
				// messages (CLAUDE.md, "WebSocket protocol"). A data channel
				// through LiveKit as well would be a second, unprotocolled way
				// to move data between riders, which is exactly the bypass
				// ADR-020 §4 calls out.
				CanPublishData: false,
			},
		}

		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(lk.APISecret))
		if err != nil {
			// Not reachable in practice — HMAC signing over a struct that always
			// marshals cannot fail once Configured() has ruled out an empty secret.
			http.Error(w, "failed to mint voice token", http.StatusInternalServerError)
			return
		}

		writeJSON(w, voiceTokenResponse{URL: lk.URL, Token: token})
	}
}
