# CLAUDE.md

Context for working in this repo. Keep edits aligned with these rules. For full rationale see
`SYSTEM_DESIGN.md`; for setup steps see `SETUP_BACKEND.md` / `SETUP_MOBILE.md`.

## What this is

**Horizon** — a live group-tracking + voice app for bike rides. Riders share live GPS on a
map, talk via push-to-talk, and see a race-style "who's 1st/2nd/3rd" indicator. Scope: a
friend-group hobby app, possibly shared later. Group size ≤ ~15 per ride.

**Hard constraint: no paid accounts and no credit card.** Every third-party service must be
free with at most an email signup. Do **not** introduce Mapbox, Google Maps, or anything that
requires billing.

## Architecture (the spine)

Everything is a view on one thing: each rider's live coordinates flowing through the Go server.

- **Mobile app** (React Native / Expo, TypeScript) → opens one WebSocket to the Go server,
  sends GPS ~1×/sec, renders everyone's dots + standings, does voice via LiveKit.
- **Go server** → holds a WebSocket per rider, groups them into rooms by join code, computes
  standings, fans out combined state. Also mints LiveKit tokens and proxies route requests.
- **OpenFreeMap** → free map tiles (no key/signup), loaded directly by the app via MapLibre.
- **OpenRouteService (ORS)** → cycling directions; called **only from the Go backend** so the
  key stays server-side.
- **LiveKit** (Cloud free tier) → group push-to-talk voice; join token minted by the backend.

## Repo layout

```
backend/   Go realtime server (WebSocket hub, standings, LiveKit token, ORS route proxy)
web/       Installable PWA (Vite + React + TypeScript) — the v1 client (see SETUP_WEB.md)
mobile/    React Native (Expo) app, TypeScript — future native path (Phase 4 background GPS)
SYSTEM_DESIGN.md   architecture + decisions (source of truth)
SETUP_BACKEND.md   Go setup
SETUP_WEB.md       PWA setup
SETUP_MOBILE.md    Expo setup
```

**Client is PWA-first** (`SYSTEM_DESIGN.md §1` "Client decision"). Riders mount the phone screen-on,
so the `web/` PWA with a screen wake-lock covers v1; the React Native `mobile/` app stays the path
for true background location. The Go backend is identical for both clients. Web equivalents of the
native deps: MapLibre **GL JS** (`maplibre-gl`), LiveKit **JS** SDK, `navigator.geolocation` +
`navigator.wakeLock`.

## Status

Early scaffolding. The directory layout above is the **target**; not all code exists yet.
Build in this order (see `SYSTEM_DESIGN.md §11`):
0. Map shows own dot; server echoes WS. 1. Two phones see each other (core pipe).
2. Route + standings. 3. Voice. 4. Background location + reconnect.
Prefer completing the current phase over adding later-phase features.

## Tech stack (don't substitute without asking)

| Concern | Choice |
|---------|--------|
| App | React Native + Expo (dev client), TypeScript |
| Map renderer | `@maplibre/maplibre-react-native` |
| Map tiles | OpenFreeMap style URL (e.g. `https://tiles.openfreemap.org/styles/liberty`) |
| Directions | OpenRouteService (cycling profile), via backend |
| Location | `expo-location` (+ `expo-task-manager` for background) |
| Realtime server | Go + `github.com/gorilla/websocket` |
| Realtime client | built-in global `WebSocket` (no package) |
| Voice | `@livekit/react-native` + LiveKit Cloud |
| State (app) | zustand |

## Commands

Backend:
```bash
cd backend && go run .            # dev
go build -o server . && ./server  # binary
go fmt ./... && go vet ./...      # format + vet before committing
```
Mobile (requires a custom dev client — see below):
```bash
cd mobile && npx expo start --dev-client          # JS dev loop
eas build --profile development --platform android # (re)build dev client when native deps change
```

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
  "riders": [ { "id": "a1", "name": "Sam", "lat": 12.97, "lng": 77.59, "speed": 6.2, "ageSec": 0, "pos": 1, "distAlong": 4120 } ] }
```
`ageSec` = seconds since that rider's last fix (server clock); clients grey a rider out past
~10 s. Clients should pass a stable per-session `rider` id on connect
(`GET /ws?ride=…&name=…&rider=…`) so a reconnect replaces the old connection instead of
adding a ghost rider; if it's absent the server mints one (the `welcome` id either way).
HTTP: `POST /rides` (→ join code) · `POST /rides/{code}/route` (ORS proxy → polyline) ·
`POST /rides/{code}/voice-token` (→ LiveKit JWT + url) · `GET /ws` · `GET /healthz`.

## Conventions & rules

- **Secrets stay server-side.** LiveKit API secret and ORS key live only in the backend, via
  env vars (`LIVEKIT_API_KEY/SECRET/URL`, `ORS_API_KEY`); never in the app or committed to git.
  OpenFreeMap needs no key. Provide a `.env.example` with blank values.
- **Coordinate order is a known trap.** Internal `loc`/`state` messages use `lat`/`lng` fields.
  **MapLibre and GeoJSON use `[lng, lat]`.** Convert at the boundary; keep the convention
  explicit wherever you build markers or route lines.
- **Standings logic lives in the Go server**, not the client — it already has all coordinates.
  Project each rider onto the route polyline and sort by distance-along-route (`SYSTEM_DESIGN.md §7`).
- **Mobile is a custom Expo dev client, NOT Expo Go.** MapLibre + LiveKit need native code.
  Adding/upgrading a native package requires rebuilding the dev client; JS changes hot-reload.
- **Go:** standard library first; keep packages under `internal/`; gofmt + vet clean.
- **TypeScript:** functional components + hooks; zustand for shared ride state; no class components.
- **Background location** is an OS-permissions problem (iOS "Always", Android foreground
  service), identical on every framework — treat it as Phase 4, not a quick add.
- Throttle GPS to ~1 Hz; the app must reconnect with backoff (mobile networks drop).

## Do / Don't

- ✅ Keep the backend a single, deployable Go binary; in-memory rooms are fine at this scale.
- ✅ Fetch a route once per ride through the backend (not per rider) to spare the ORS quota.
- ❌ Don't add a database, Redis, or auth yet — those are the documented scaling path, not v1.
- ❌ Don't reintroduce paid/card-required services (Mapbox, Google Maps, paid APIs).
- ❌ Don't roll custom WebRTC — voice goes through LiveKit.
- ❌ Don't write the app UI in Go. Go = backend only; React Native = everything the rider sees.
