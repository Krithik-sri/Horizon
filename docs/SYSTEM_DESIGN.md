# System Design — Horizon (native motorcycle companion app)

> A premium native companion for motorcycle riders — not a fitness tracker, not a social
> network. It navigates, keeps a convoy together, and covers everything else that happens
> between departure and arrival. Product intent is [`docs/PRODUCT.md`](./PRODUCT.md); this
> document is only the "how."

**Status:** Phases 0–4 code-complete, unproven on a device · **Target:** Android first, iOS later ·
**Voice:** live push-to-talk · **No paid accounts / no credit card required to build or run this.**

---

## 1. Goals

Every screen belongs to one of three registers ([`docs/PRODUCT.md`](./PRODUCT.md)):

| Register | Rider is | The app answers |
|----------|----------|------------------|
| Departure | preparing | "Am I ready to ride?" |
| Motion | moving | only what's essential right now |
| Return | finished | photos, journal, stats, stories |

Live convoy tracking — everyone's position on a shared map — is one **Motion** feature among
others, not the product itself. Everything convoy-shaped is a view on one thing: each rider's
live coordinates, flowing through the Go server. Navigation — a route line plus turn-by-turn
maneuver cues — is another, alongside it, not a separate product
([`ADR-011`](./ADR/ADR-011.md)).

### Non-goals
- Any ranking or ordering of riders — no "who's ahead" ([`ADR-009`](./ADR/ADR-009.md)).
- Gamification of any kind: badges, streaks, XP, levels, leaderboards.
- A social graph beyond what Supabase Auth needs to own durable, per-rider data.
- A web client ([`ADR-007`](./ADR/ADR-007.md)).
- Off-route rerouting, spoken guidance, and destination search were all non-goals at
  [`ADR-011`](./ADR/ADR-011.md)/[`ADR-012`](./ADR/ADR-012.md) — all three have since shipped
  ([`ADR-012`](./ADR/ADR-012.md) destination search, [`ADR-014`](./ADR/ADR-014.md) off-route
  rerouting, [`ADR-015`](./ADR/ADR-015.md) spoken guidance) and none is a non-goal any longer.

---

## 2. Constraints & assumptions

- Group size ≤ ~15 riders per convoy — one Go process handles this trivially.
- **No credit card available** → every service is free with at most an email signup (map tiles
  need no signup at all).
- Riders are on mobile data mid-ride; connections drop → the app must reconnect gracefully.
- Live location is sensitive → the Go server never persists it; Supabase only stores what a
  rider explicitly saves (ride history, journal, photos).
- Battery matters on long rides → throttle GPS, avoid wasteful background work.
- **Rough cost:** effectively zero for a private group — map tiles, ORS, LiveKit, and Supabase
  are all free-tier/no-card; backend hosting is a $5/mo VPS or a free tier on Fly.io/Railway;
  app stores are optional and separate (Apple $99/yr, Google $25 once).

---

## 3. High-level architecture

Two backends, split by lifetime, not by feature:

```
        ┌──────────────────────────────────────────────┐
        │  Rider phone — React Native (Android first)   │
        │   Map (MapLibre)   GPS   Voice (LiveKit)      │
        └───┬──────────────┬─────────────┬─────────────┘
            │              │             │
   tiles    │   WebSocket  │  auth +     │  voice media
   (no key) │  (live convoy)│  durable   │
            ▼              ▼   state ▼   ▼
     ┌───────────┐  ┌────────────┐ ┌──────────┐ ┌─────────┐
     │OpenFreeMap│  │ Go server  │ │ Supabase │ │ LiveKit │
     └───────────┘  └─────┬──────┘ └──────────┘ └─────────┘
                          │ mints LiveKit token · proxies ORS
```

One **WebSocket to the Go server** carries live convoy state — ephemeral, gone when the ride
ends. REST to **Supabase** carries everything durable. Map tiles load directly from OpenFreeMap
(no key). Voice media goes through LiveKit; the Go server mints the join token so the secret
stays server-side.

---

## 4. The Go / Supabase split

Where does new code go? Answer with this table before writing anything ([`ADR-008`](./ADR/ADR-008.md)):

| | **Go server** | **Supabase** |
|---|---|---|
| Owns | ephemeral, sub-second, fan-out | durable, user-owned, queryable |
| Holds | live convoy positions (in-memory), LiveKit tokens, ORS proxy | auth, rides, journal, photos, stats |
| Lifetime | dies with the ride | forever |
| **Never** | touches Postgres — no DB driver in `go.mod` | handles a live position stream |

**Identity flows one way.** Supabase Auth is the *only* issuer. The Go server **verifies**
Supabase JWTs (ES256 via the project's JWKS, `SUPABASE_URL`, via `github.com/golang-jwt/jwt/v5`) — it never
mints identity, never has a user table. The app sends `Authorization: Bearer <supabase-jwt>` on
the WS upgrade and on every HTTP route — never in the query string. Note the reason usually given
for that rule is wrong: `internal/httpx/logging.go` logs `r.URL.Path` only, never `RawQuery`, so
this server's own log would not have captured a token either way. The rule holds for the reason
that does apply — a URL reaches proxies and CDN logs in a way a header does not.

---

## 5. Tech stack & rationale

| Layer | Choice | Why this |
|-------|--------|----------|
| Mobile app | React Native (Expo + dev client), TypeScript, Expo Router | No new language beyond Go; one codebase, both platforms. |
| Map renderer | `@maplibre/maplibre-react-native` | Open-source Mapbox fork; no token, no card. |
| Map tiles | OpenFreeMap style URL | Free vector tiles; no key, no card, no limits. |
| Directions | OpenRouteService, `driving-car` profile, via the backend | Free key, no card. **ORS has no motorcycle profile** — `driving-car` is the closest approximation, a known one. |
| Location | `expo-location` (+ `expo-task-manager` for background) | First-party Expo modules. |
| Realtime server/client | Go + `gorilla/websocket`; built-in `WebSocket` on the phone | Purpose-built fan-out; no client package needed either side. |
| Durable state | Supabase (Postgres, Auth, Storage) | Managed, free tier, no card — owns everything that outlives a ride. |
| Voice | `@livekit/react-native` + LiveKit Cloud | Don't roll WebRTC; free tier, self-hostable, and LiveKit's own server is Go. |

**Where Go fits:** the realtime convoy server, LiveKit tokens, the ORS proxy, verifying
Supabase JWTs — nothing else. **Go = ephemeral backend brain, Supabase = durable backend
memory, React Native = everything the rider sees.**

---

## 6. Component design

- **Map module** — MapLibre + an OpenFreeMap style; redraws rider markers from convoy state.
- **Location module** — `expo-location` (+ `expo-task-manager`, Phase 4), throttled to ~1 Hz,
  pushed up the WebSocket; reconnects with backoff.
- **Voice module** — a LiveKit room; push-to-talk publishes the mic only while held.
- **Realtime backend (Go)** — one HTTP server upgrades `/ws?ride=…` after verifying the
  Supabase JWT. A single hub lock guards every room's rider set; one sweep goroutine for the
  whole process broadcasts each room's combined `state` on a fixed **~4 Hz tick**, decoupled from
  each rider's ~1 Hz ingest ([`ADR-010`](./ADR/ADR-010.md)). A reconnect presenting the same
  `rider` id replaces the stale connection instead of adding a ghost. See
  [`docs/SETUP_BACKEND.md`](./SETUP_BACKEND.md) for the implementation.
- **Durable state (Supabase)** — sign-in, ride history, journal, photos, stats — populated in
  the **Return** register, never during Motion.

---

## 7. Message protocol

All WebSocket messages are JSON with a `type` discriminator.

**Client → server (~1×/sec):**
```json
{ "type": "loc", "lat": 12.9716, "lng": 77.5946, "heading": 45, "speed": 6.2, "ts": 1718700000 }
```
**Server → one client (once, on connect):**
```json
{ "type": "welcome", "id": "a1" }
```
**Server → all clients (fixed ~4 Hz tick):**
```json
{ "type": "state", "ride": "ABC123",
  "riders": [ { "id": "a1", "name": "Sam", "lat": 12.97, "lng": 77.59, "speed": 6.2, "ageSec": 0 } ] }
```

There is no position number and no distance-along-route field. Riders are sorted by `id` only
so the list doesn't jitter between frames — **this is not a ranking**
([`ADR-009`](./ADR/ADR-009.md)). `ageSec` = seconds since the last fix (server clock); grey a
rider out past ~10s. A rider's id is the `sub` claim of their verified Supabase JWT, presented as
`Authorization: Bearer <supabase-jwt>` on `GET /ws?ride=…&name=…` — the client sends no id of its
own, so a reconnect replaces that rider's old connection and the id cannot be spoofed
([`ADR-017`](./ADR/ADR-017.md)).

HTTP: `POST /rides` (→ join code) · `POST /rides/{code}/route` (ORS proxy → `{routes, selected}`) ·
`POST /geocode` (ORS Pelias proxy → places) · `POST /rides/{code}/voice-token`
(→ LiveKit JWT + url) · `GET /ws` · `GET /healthz`.

---

## 8. Key design choices & trade-offs

- **React Native over Flutter:** no new language beyond Go, at the cost of RN's native-module
  friction (custom dev client, config plugins).
- **Open-source maps, rented voice:** MapLibre/OpenFreeMap avoid a credit card
  ([`ADR-003`](./ADR/ADR-003.md)); LiveKit avoids a multi-month WebRTC build.
- **Two backends, one rule, over one doing everything:** ephemeral fan-out and durable storage
  have opposite consistency needs; splitting them keeps the Go server as simple as its
  single-binary origin ([`ADR-008`](./ADR/ADR-008.md)).
- **Fixed-tick fan-out (~4 Hz) + stable client-held rider ids:** decouples ingest from fan-out
  (constant per-client rate instead of N×, ~250ms latency cost) and lets a reconnect replace
  the zombie connection instead of adding a ghost — the id now rides behind a verified
  Supabase JWT rather than being the trust boundary itself.

---

## 9. Scaling path ("share it later")

1. **Horizontal scale** — Redis Pub/Sub between Go instances once one process isn't enough.
2. **Self-host the open services** — your own OpenFreeMap tiles, ORS, and LiveKit to remove
   rate limits and external dependencies.
3. **Observability** — structured logs, Prometheus metrics, tracing.
4. **Harden Supabase RLS** — tighten row-level-security policies as the user base grows.

---

## 10. Known sharp edges (these bite everyone)

- **Background location** — iOS "Always" / an Android foreground service; `expo-location`
  covers foreground, `expo-task-manager` covers background (Phase 4).
- **Not Expo Go.** MapLibre and LiveKit need native code — a custom dev client, rebuilt only
  when a native package changes.
- **Battery** — continuous GPS + live voice drains fast; throttle updates.
- **Reconnection** — mobile networks drop; the client needs exponential backoff and resume.
- **ORS has no motorcycle profile** — `driving-car` is the closest approximation.
- **App distribution** — Android is a one-time $25 fee; iOS needs a $99/yr Apple account and
  EAS cloud builds. Skip stores for "just us": dev builds + TestFlight.

---

## 11. Roadmap (build the spine first)

**All five phases below are code-complete. None of it has been run on a real device** — that gap
is the whole story of this section; read the table as "written and type-checked," not "working."
How to close that gap, one verifiable feature milestone at a time: [`docs/FINISHING.md`](./FINISHING.md).

| Phase | Deliverable | Proves |
|-------|-------------|--------|
| 0 | App shell + design tokens; own moving dot on the map (Motion register). | Toolchain + design system work end to end. |
| 1 | Two phones see each other's live dots move, joined by a shared ride code. | The core convoy pipe. |
| 2 | Fetch + draw a route via the backend (ORS `driving-car`). | Route handling. |
| 3 | Push-to-talk voice via LiveKit. | Comms. |
| 4 | Background location, reconnection hardening, battery tuning. | Production-readiness. |

---

## 12. Security & privacy notes

- Live location is only broadcast within an active ride, to riders holding the join code, and
  is never persisted by the Go server.
- Durable data in Supabase (journal, photos, stats) is opt-in and rider-owned — enforce that
  with Row-Level Security, not application logic.
- Keep the **LiveKit secret**, **ORS key**, and **`SUPABASE_URL`** server-side only, via
  env vars — never in the app, never committed. Verify JWTs with
  `github.com/golang-jwt/jwt/v5`, never hand-rolled.
- Never put a token in a query string. Use `wss://` (TLS) in production.
