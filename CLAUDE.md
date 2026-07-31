# CLAUDE.md

Context for working in this repo. Keep edits aligned with these rules. Every document except this
one and `README.md` lives in `docs/` — product intent is [`docs/PRODUCT.md`](docs/PRODUCT.md),
architecture is [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md), setup is
[`docs/SETUP.md`](docs/SETUP.md) / [`docs/SETUP_BACKEND.md`](docs/SETUP_BACKEND.md).

## What this is

**Horizon** — a premium native companion app for motorcycle riders. Not a navigation app: it
exists for everything that happens *between* departure and arrival. It should feel like an
invisible co-rider. Success is a rider saying *"I barely noticed Horizon was there."*

`docs/PRODUCT.md` is the product's source of truth and outranks every technical document here.
Read it before designing anything a rider sees.

**Android first, iOS later.** There is no web client — that was cancelled (`docs/ADR/ADR-007.md`).

## The three registers

Every screen belongs to exactly one. They are states of mind, not routes. Typography, density,
animation and interaction all change between them.

| Register | Rider is | The app is | Answers |
|----------|----------|-----------|---------|
| **Departure** | preparing | calm, confident | "Am I ready to ride?" |
| **Motion** | moving | almost invisible | only what's essential right now |
| **Return** | finished | reflective | photos, journal, stats, stories |

**Motion is the strictest register.** Design for it first; the others relax outward from it.

When building anything a rider sees, the `horizon-design` skill carries the full rules (attention
ladder, silence budget, typography voices, colour).

## Hard constraints

1. **No paid accounts, no credit card.** Every third-party service must be free with at most an
   email signup. Do **not** introduce Mapbox, Google Maps, or anything requiring billing — even
   though `docs/PRODUCT.md` names Mapbox under "Backend Direction" (`docs/ADR/ADR-006.md`,
   `docs/ADR/ADR-003.md`).
2. **No gamification.** No badges, streaks, XP, levels, achievements, or **leaderboards**. There is
   no ranking of riders anywhere — the standings feature was deleted, not deferred
   (`docs/ADR/ADR-009.md`).
3. **Never interrupt a corner.** No non-safety information reaches the rider while they are
   turning, leaning, braking, or otherwise busy. Respect overrides every other principle.
4. **Secrets stay server-side.** LiveKit secret, ORS key and the Supabase JWT secret live only in
   the Go backend via env vars. Never in the app, never committed. Provide `.env.example` with
   blank values.

## Architecture — two backends, one rule

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

**Where does this code go?** Answer with this table before writing anything.

| | **Go server** | **Supabase** |
|---|---|---|
| Owns | ephemeral, sub-second, fan-out | durable, user-owned, queryable |
| Holds | live convoy positions (in-memory), LiveKit tokens, ORS proxy | auth, rides, journal, photos, stats |
| Lifetime | dies with the ride | forever |
| **Never** | touches Postgres — no DB driver in `go.mod` | handles a live position stream |

**Identity flows one way.** Supabase Auth is the *only* issuer. The Go server **verifies** Supabase
JWTs (HS256, `SUPABASE_JWT_SECRET`) — it never mints identity, never has a user table, never
invents a session. Full rationale: `docs/ADR/ADR-008.md`.

- The app sends `Authorization: Bearer <supabase-jwt>` on the WS upgrade. Native RN `WebSocket`
  accepts a `headers` option — this is a real benefit of having no browser client.
- **Never put a token in a query string.** `internal/httpx/logging.go` logs request URLs; a token
  in the URL lands in the logs.
- Use `github.com/golang-jwt/jwt/v5` — do not hand-roll JWT verification. Alg-confusion and
  non-constant-time compares are exactly where "stdlib first" stops applying.

## Repo layout

```
backend/   Go realtime server (WebSocket hub, LiveKit token, ORS route proxy)
mobile/    React Native (Expo) app, TypeScript — the only client
docs/      all project documentation (index: docs/README.md)
```

## Status

Early. `mobile/` is currently **empty of app code** — the Expo template was deleted in the v2
pivot and the app is scaffolded fresh. The backend has a working WebSocket hub; route and voice
are stubbed `501`.

Build order:
0. App shell + design tokens; own dot on the map (Motion register).
1. Two phones see each other (the core pipe).
2. Route line. 3. Voice. 4. Background location + reconnect hardening.

Prefer completing the current phase over adding later-phase features.

## Tech stack (don't substitute without asking)

| Concern | Choice |
|---------|--------|
| App | React Native + Expo (dev client), TypeScript, Expo Router |
| Map renderer | `@maplibre/maplibre-react-native` |
| Map tiles | OpenFreeMap style URL — **no key, no card** |
| Directions | OpenRouteService via the backend — `driving-car` profile (ORS has no motorcycle profile) |
| Location | `expo-location` (+ `expo-task-manager` for background) |
| Realtime server | Go + `github.com/gorilla/websocket` |
| Realtime client | built-in global `WebSocket` (no package) |
| Durable state | Supabase (Postgres, Auth, Storage) |
| Voice | `@livekit/react-native` + LiveKit Cloud |
| State | zustand · server cache: TanStack Query |
| Animation | Reanimated · Gesture Handler · Skia for canvas work |
| Styling | design tokens + `StyleSheet`. **No UI component libraries** — every component is custom |

**Add dependencies on first real use, not upfront.** Skia, Unistyles, TanStack Query, Lucide and
`react-native-svg` are all in the stack above and none is installed yet — install each when a
screen actually needs it.

## WebSocket protocol (the contract — keep both sides in sync)

Client → server, ~1×/sec:
```json
{ "type": "loc", "lat": 12.9716, "lng": 77.5946, "heading": 45, "speed": 6.2, "ts": 1718700000 }
```
Server → one client, once on connect (so it can pick its own dot out of `state`):
```json
{ "type": "welcome", "id": "a1" }
```
Server → all clients in room, on a fixed ~4 Hz tick (fan-out is decoupled from ingest):
```json
{ "type": "state", "ride": "ABC123",
  "riders": [ { "id": "a1", "name": "Sam", "lat": 12.97, "lng": 77.59, "speed": 6.2, "ageSec": 0 } ] }
```

**There is no `pos` or `distAlong`.** Riders are ordered by `id` purely so the list doesn't jitter
between frames — that is not a ranking, and the UI must never present it as one.

`ageSec` = seconds since that rider's last fix (server clock); clients grey a rider out past ~10 s.
Clients pass a stable per-session `rider` id on connect (`GET /ws?ride=…&name=…&rider=…`) so a
reconnect replaces the old connection instead of adding a ghost rider; if absent the server mints
one (the `welcome` id either way).

HTTP: `POST /rides` (→ join code) · `POST /rides/{code}/route` (ORS proxy → polyline) ·
`POST /rides/{code}/voice-token` (→ LiveKit JWT + url) · `GET /ws` · `GET /healthz`.

## Conventions & rules

- **Coordinate order is a known trap.** Internal `loc`/`state` messages use `lat`/`lng` fields.
  **MapLibre and GeoJSON use `[lng, lat]`.** Convert at the boundary; keep the convention explicit
  wherever you build markers or route lines.
- **Mobile is a custom Expo dev client, NOT Expo Go.** MapLibre + LiveKit need native code. Adding
  or upgrading a native package requires rebuilding the dev client; JS changes hot-reload.
- **Expo has changed** — read the versioned docs at https://docs.expo.dev/versions/v56.0.0/ before
  writing app code.
- **Go:** standard library first; keep packages under `internal/`; gofmt + vet clean.
- **TypeScript:** functional components + hooks; zustand for shared ride state; feature-first
  folders mirroring the registers (`src/features/{departure,motion,return,convoy}/`); no class
  components.
- **Background location** is an OS-permissions problem (iOS "Always", Android foreground service),
  identical on every framework — treat it as Phase 4, not a quick add.
- Throttle GPS to ~1 Hz; the app must reconnect with backoff (mobile networks drop).

## Do / Don't

- ✅ Keep the backend a single, deployable Go binary; in-memory rooms are fine at this scale.
- ✅ Fetch a route once per ride through the backend (not per rider) to spare the ORS quota.
- ✅ Defer anything non-urgent to the Return register — that is the product, not a limitation.
- ❌ Don't add a database or auth to the **Go** server — durable state is Supabase's job.
- ❌ Don't reintroduce paid/card-required services (Mapbox, Google Maps, paid APIs).
- ❌ Don't roll custom WebRTC — voice goes through LiveKit.
- ❌ Don't write the app UI in Go. Go = backend only; React Native = everything the rider sees.
- ❌ Don't add a notification, badge, count, or ranking. Re-read `docs/PRODUCT.md` first.
