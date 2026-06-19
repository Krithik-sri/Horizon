# System Design — Group Ride App (working name: **Horizon**)

> A live group-tracking + voice app for bike rides and trips. Everyone sees everyone
> else's location on a shared map, can talk over push-to-talk, and sees a live
> "who's 1st / 2nd / 3rd" race-style position indicator.

**Status:** design / pre-build · **Target:** iOS + Android · **Voice:** live push-to-talk · **Scope:** hobby first, shareable later
**No paid accounts / no credit card required to build or run this.**

---

## 1. Goals

| # | Feature | What it means |
|---|---------|---------------|
| 1 | Synced live locations | A shared map where each rider is a moving dot, updated in near-real-time, plus a route line. |
| 2 | Comms | Live voice, walkie-talkie style (push-to-talk). |
| 3 | Position indicator | Race-game-style ordering: who is furthest along the route (1st, 2nd, 3rd…). |

### Non-goals (for now)
- Public user accounts / social graph (anonymous join codes are enough at first).
- Full turn-by-turn navigation for every rider (route line + your own nav is enough early on).
- Desktop clients.
- Offline maps.

### Client decision: PWA first, native later
The v1 client is an **installable PWA** (`web/`, Vite + React + TypeScript), not the React Native
app — riders mount the phone on the handlebars with the screen on, so a screen **wake-lock** keeps
foreground GPS alive and the one thing a browser can't do (true **background** location) never
bites. This trades a faster iteration loop (no dev-client builds, one URL to share) against
foreground-only tracking. The `mobile/` React Native app (tech stack below) stays the documented
path for when pocketed / screen-off background tracking is needed (Phase 4). **The Go backend is
client-agnostic — none of §5–§8 changes.** The browser uses the same `WebSocket`, the same
`[lng,lat]` boundary conversion, and the same server-side standings. Web client map = MapLibre
**GL JS**; voice = the LiveKit **JS** SDK; location = `navigator.geolocation` + `navigator.wakeLock`.

The PWA client is the same shape as the native one in §3 — only the SDKs differ (browser APIs
instead of Expo/RN modules); the three wires out of the phone are identical:

```
        ┌───────────────────────────────────────────────┐
        │  Rider phone — installable PWA (in the browser) │
        │                                                 │
        │   Map UI         GPS + screen      Voice        │
        │ (MapLibre GL JS) wake-lock        (LiveKit JS)  │
        │                 (navigator.geo-    (PTT)        │
        │                  location +                     │
        │                  wakeLock)                      │
        └──────┬────────────────┬───────────────┬─────────┘
               │                │               │
   map tiles   │   WebSocket    │   voice media (WebRTC)
   (no key)    │  (loc ↑ /      │               │
               ▼   state+welcome ▼              ▼
        ┌──────────┐   ┌───────────────┐   ┌──────────┐
        │OpenFreeMap│  │  Go server    │   │ LiveKit  │
        │ (tiles)  │   │  (unchanged)  │   │  (voice) │
        └──────────┘   └───────────────┘   └──────────┘
```

### Design principles
- **One source of truth for position.** All three features are different views of the same data: every rider's live coordinates. Build that pipe first; everything else is a view on top.
- **Don't build what you can rent — and prefer free/open where it exists.** Voice (LiveKit) and maps (MapLibre + OpenStreetMap tiles) are deep, well-solved problems with open-source options that need no credit card. Spend your effort on the part that's actually yours (the realtime location server + ride logic).
- **Small, observable, single-binary backend.** Easy to run, easy to reason about, cheap to host.

---

## 2. Constraints & assumptions

- Group size: a handful of friends per ride (≤ ~15). One server process handles this trivially.
- **No credit card available** → every third-party service chosen is free with at most an email signup (and the map tiles need no signup at all).
- Riders are on mobile data; connections drop in tunnels / dead zones → the app must reconnect gracefully.
- Location is **sensitive personal data** → only shared within an active ride, never stored long-term at first.
- Battery matters on long rides → throttle GPS, avoid wasteful work.

---

## 3. High-level architecture

```
        ┌───────────────────────────────────────────────┐
        │   Rider phone — React Native (iOS + Android)  │
        │                                               │
        │   Map UI         GPS + position     Voice     │
        │  (MapLibre)      (send location)    (PTT)     │
        └──────┬───────────────┬──────────────┬─────────┘
               │               │              │
   map tiles   │   WebSocket   │   voice media (WebRTC)
   (no key)    │  (2-way: send │              │
               │   loc, recv   │              │
               ▼   everyone)   ▼              ▼
        ┌──────────┐   ┌───────────────┐  ┌──────────┐
        │OpenFreeMap│  │  Go server    │  │ LiveKit  │
        │ (tiles,   │  │  (you build)  │  │ group    │
        │  no acct) │  │  rooms +      │  │ voice    │
        │          │   │  fan-out +    │  │          │
        └──────────┘   │  position +   │  └──────────┘
                       │  route proxy  │
                       └───────┬───────┘
                       ┌───────┴────────────┐
              mints LiveKit token    fetches cycling route
                       │                    │
                       ▼                    ▼
                   (LiveKit)        OpenRouteService (ORS)
```

Every interesting feature flows through the Go server. It holds one WebSocket per rider,
receives GPS pings, computes race positions, and broadcasts the combined state to the whole
group. It also mints LiveKit voice tokens and proxies cycling-route requests to ORS (so the
ORS key stays server-side). The phone fetches **map tiles directly from OpenFreeMap**, which
needs no key, no signup, and no card. Voice media goes through LiveKit.

---

## 4. Tech stack & rationale

| Layer | Choice | Why this | Alternatives considered |
|-------|--------|----------|-------------------------|
| Mobile app | **React Native (Expo + dev client), TypeScript** | The team already knows TypeScript, so the frontend adds **no** new language — Go is the only new thing to learn. One codebase → both platforms. | Flutter (great, but Dart is a second new language on top of Go); native Swift + Kotlin (2× work). |
| Map renderer | **MapLibre** (`@maplibre/maplibre-react-native`) | Open-source fork of the Mapbox SDK; nearly identical API; **no token, no card**. | rnmapbox/Mapbox (requires account + card); react-native-maps (Google needs billing). |
| Map tiles / style | **OpenFreeMap** | Free public vector tiles; **no registration, no API key, no card, no usage limits.** Just a style URL. | MapTiler / Stadia (free tiers, but need an account; MapTiler is no-card). |
| Directions | **OpenRouteService (ORS)** | Free API key (email signup, **no card**); has cycling profiles. Key kept on the Go backend. | Self-hosted OSRM/Valhalla (no signup at all, but you run a server); Mapbox/Google (card). |
| Location | **expo-location** (+ `expo-task-manager` for background) | First-party Expo modules; foreground + background tracking. | `react-native-background-geolocation` (more robust background, partly paid). |
| Realtime backend | **Go** + `gorilla/websocket` | Concurrency model is purpose-built for many long-lived connections + fan-out. Single static binary, trivial deploy. This is where Go genuinely belongs. | `coder/websocket` (modern alt); Node/Socket.IO. |
| Voice | **LiveKit** (`@livekit/react-native` + LiveKit Cloud) | Don't roll your own WebRTC. Open source, RN SDK, free cloud tier (no card for the free tier), self-hostable later. Bonus: **LiveKit's server is written in Go.** | Agora (easy, proprietary); raw WebRTC (a multi-month rabbit hole — avoid). |
| Realtime client | **built-in `WebSocket`** | RN/JS ships a global `WebSocket` — no package needed to talk to the Go server. | reconnecting-websocket (thin convenience wrapper). |
| Join / identity | **Ride join code** (anonymous) | Zero-friction for a friend group; no accounts to build. | Firebase Auth / Clerk (add only when sharing publicly). |
| Persistence | **None at first** (in-memory rooms) | Hobby scale needs no DB. | Postgres + PostGIS + Redis (the scaling path — see §9). |

### Where Go fits (and where it doesn't)
- **Fits:** the realtime location server, the race-position math, minting LiveKit JWTs (via the LiveKit Go server SDK), and **proxying ORS route requests** (keeps the key server-side). LiveKit itself is Go, so self-hosting later keeps you in Go.
- **Doesn't fit:** the app itself. Mobile UI is TypeScript/React Native, not Go. (`gomobile` exists but can't build real mobile UIs — don't.) Clean split: **Go = backend brain, React Native = everything the rider sees.**

---

## 5. Component design

### 5.1 Mobile app (React Native / Expo)
Three loosely-coupled modules, each owning one backend dependency:

- **Map module** — renders the MapLibre map with an OpenFreeMap style, the route line, and a marker per rider. Subscribes to the location-state stream and redraws markers as it updates.
- **Location module** — reads GPS via `expo-location` (foreground) / `expo-task-manager` (background), throttles to ~1 update/sec, and pushes each fix up the WebSocket. Also handles reconnect with backoff.
- **Voice module** — connects to a LiveKit room. Push-to-talk = publish mic only while a button is held; always subscribe to everyone else.

Suggested `src/` layout:
```
mobile/
  app.config.ts
  App.tsx               # registerGlobals() + navigation
  src/
    core/    wsClient.ts · models.ts · config.ts
    state/   useRide.ts          # zustand store (riders, standings)
    features/
      ride/      # join code, ride lifecycle
      map/       # MapLibre view + rider markers + route line
      location/  # expo-location + websocket sender
      voice/     # LiveKit room + PTT button
      standings/ # the 1st/2nd/3rd UI
```

### 5.2 Realtime backend (Go)
A single HTTP server that upgrades `/ws?ride=ABC123&name=Sam` to a WebSocket.

Core types (hub pattern, the classic gorilla/websocket "chat" example adapted to locations):
```go
type Hub struct {
    rooms map[string]*Room   // keyed by ride join code
    mu    sync.RWMutex
}

type Room struct {
    code    string
    riders  map[*Client]bool
    route   []LatLng          // optional planned route (from ORS)
    mu      sync.RWMutex
}

type Client struct {
    conn *websocket.Conn
    send chan []byte          // buffered outbound queue
    id   string
    name string
}
```
Flow per ride:
1. Rider connects → added to the room for their join code.
2. Rider sends `loc` messages on a loop.
3. On each `loc`, the server updates that rider's position, recomputes standings (§7), and
   broadcasts a `state` message to every client in the room.
4. On disconnect, the rider is removed and the rest are notified.

Endpoints:
- `GET  /ws`               — the WebSocket (location in/out).
- `POST /rides`            — create a ride, returns a join code.
- `POST /rides/{code}/route` — proxy a cycling-route request to ORS; stores the polyline on the room and returns it. (Keeps the ORS key server-side.)
- `POST /rides/{code}/voice-token` — mint a LiveKit JWT for this rider + room.
- `GET  /healthz`          — liveness.

### 5.3 Voice (LiveKit)
- The LiveKit **room name = the ride join code**, so the voice group and the location group line up automatically.
- A client cannot join a LiveKit room without a signed JWT. The **Go backend mints it** using the LiveKit server SDK and your API key/secret — the secret never touches the phone.
- Push-to-talk: enable the mic on button-down, disable on button-up. Always stay subscribed to others' audio.

### 5.4 Maps (MapLibre + OpenFreeMap + ORS)
Three open pieces replace the single paid SDK, and none needs a card:
- **Tiles/basemap:** the phone loads a MapLibre **style URL from OpenFreeMap** directly (e.g. `https://tiles.openfreemap.org/styles/liberty`). No key, no signup, no limits. Attribution is auto-added by MapLibre.
- **Renderer:** **MapLibre** (`@maplibre/maplibre-react-native`) draws the basemap, the route line (a `ShapeSource` + `LineLayer`), and the rider markers.
- **Directions:** the app asks the **Go backend** for a route; the backend calls **OpenRouteService** (cycling profile) with its server-side key and returns the polyline. That same polyline feeds the standings calc (§7).
- Note: this gives you the map + a route line + your own position. Full turn-by-turn navigation is a later, separate effort. OpenFreeMap deliberately serves *only* tiles (no routing/search), which is exactly why directions go to ORS separately.

---

## 6. Data model & message protocol

All WebSocket messages are JSON with a `type` discriminator.

**Client → server (every ~1 s):**
```json
{ "type": "loc", "lat": 12.9716, "lng": 77.5946, "heading": 45, "speed": 6.2, "ts": 1718700000 }
```

**Server → all clients in room (on each update):**
```json
{
  "type": "state",
  "ride": "ABC123",
  "riders": [
    { "id": "a1", "name": "Sam", "lat": 12.972, "lng": 77.595, "speed": 6.2, "pos": 1, "distAlong": 4120 },
    { "id": "b2", "name": "Raj", "lat": 12.961, "lng": 77.583, "speed": 5.1, "pos": 2, "distAlong": 3880 }
  ]
}
```

**Ride creation + route (HTTP):**
```
POST /rides                 { "name": "Sunday loop" }            -> { "code": "ABC123" }
POST /rides/ABC123/route    { "waypoints": [[12.97,77.59], ...] } -> { "polyline": [[lat,lng], ...] }
```

Field notes: `distAlong` = metres travelled along the planned route; `pos` = 1-based race
position; `ts` = client unix seconds (for staleness detection — grey out a rider whose last
fix is older than ~10 s).

---

## 7. The "who's 1st" algorithm

Straight-line distance to the finish is misleading on twisty roads. Instead, project each
rider onto the **planned route polyline** (from ORS) and measure distance travelled along it.

For each rider:
1. Find the nearest segment of the route polyline to the rider's current point.
2. Compute the perpendicular projection onto that segment.
3. `distAlong` = (cumulative length of all earlier segments) + (length from segment start to the projection).
4. Sort riders by `distAlong` descending → 1st, 2nd, 3rd…

This runs in microseconds and lives in the Go server (which already has everyone's coords).
Sketch:
```go
// distAlongRoute returns metres travelled along `route` for point p.
func distAlongRoute(route []LatLng, p LatLng) float64 {
    var cum, best float64
    bestDist := math.Inf(1)
    for i := 0; i+1 < len(route); i++ {
        a, b := route[i], route[i+1]
        proj, t := projectOntoSegment(a, b, p) // t in [0,1]
        d := haversine(p, proj)
        if d < bestDist {
            bestDist = d
            best = cum + t*haversine(a, b)
        }
        cum += haversine(a, b)
    }
    return best
}
```
Fallback when there is no planned route: sort by straight-line distance remaining to the
destination, or by total distance covered from each rider's own start point.

---

## 8. Key design choices & trade-offs

- **React Native over Flutter:** the team already knows TypeScript, so the frontend introduces no new language — Go stays the only new thing to learn. The cost is RN's native-module friction (custom dev client, config plugins); worth it to avoid learning Dart.
- **Open-source maps over Mapbox/Google:** no credit card, and cheaper forever. MapLibre + OpenFreeMap + ORS cover render + tiles + routing for free. Trade-off: OpenFreeMap/ORS public instances are donation-funded community services — perfect for a hobby app; for a heavy product you'd self-host (both are open-source) or move to a paid tier.
- **Rent voice (LiveKit) over building WebRTC:** building a reliable SFU is a multi-month project. The free tier covers a friend group; self-hosting (still Go) is the escape hatch.
- **In-memory state over a database:** at this scale a DB is pure overhead. Rooms live in a Go map; if the process restarts mid-ride, clients reconnect and repopulate within seconds.
- **Server-side standings & route proxy over client-side:** the server already holds all coordinates, so compute standings once and broadcast; routing goes through the server so the ORS key stays secret and the shared quota is controlled.
- **Anonymous join codes over accounts:** removes an entire auth subsystem from v1.
- **Throttled fixed-rate updates (~1 Hz):** simple and predictable; adaptive rates can come later.

---

## 9. Scaling path ("share it later")

Only if/when you outgrow the friend-group stage, in rough order:

1. **Auth & identity** — Firebase Auth (fastest) or your own Go auth; persistent user IDs, ride history.
2. **Persistence** — Postgres + **PostGIS** for routes, ride history, and geo queries.
3. **Horizontal scale** — when one Go process isn't enough, put **Redis Pub/Sub** between server instances so a rider on server A still reaches a rider on server B in the same room.
4. **Self-host the open services** — run your own OpenFreeMap tiles, ORS, and LiveKit (all open-source, all Go-friendly to operate) to remove rate limits and external dependencies.
5. **Observability** — structured logs, Prometheus metrics (connections, msgs/sec, room counts), tracing.

The v1 design doesn't block any of these — they're additive.

---

## 10. Known sharp edges (these bite everyone)

- **Background location** is the #1 pain. GPS while the app is backgrounded / phone locked needs special permission flows: iOS "Always", Android a foreground service + notification. `expo-location` covers foreground; reliable background needs `expo-task-manager` (or `react-native-background-geolocation`). This is an OS problem, identical on every framework. Budget real time here.
- **Not Expo Go.** MapLibre and LiveKit need native code, so you run a **custom Expo dev client**, not the Expo Go sandbox. Rebuild the dev client only when you add/upgrade a native package; JS changes hot-reload.
- **Battery:** continuous GPS + live voice + screen-on drains fast. Throttle updates, dim the map when idle, lower GPS rate when stationary.
- **Reconnection:** mobile networks drop. The WS client needs exponential backoff and resume; the server must handle a rider vanishing and reappearing cleanly.
- **ORS quota is per key:** the free ORS key has a daily request cap. Because routing is proxied through the Go backend, you fetch a route once per ride (not per rider), which keeps usage tiny.
- **App distribution:** iOS needs an Apple Developer account ($99/yr) and a Mac *or* EAS cloud builds; Android is a one-time $25. For "just us," skip the stores: install dev builds directly and use TestFlight for iPhones. (These store fees are the only money in the whole project, and only if you want public distribution.)

---

## 11. Roadmap (build the spine first)

| Phase | Deliverable | Proves |
|-------|-------------|--------|
| 0 | RN app shows a MapLibre/OpenFreeMap map with *your own* moving dot; Go server echoes WS messages. | Toolchain works end to end. |
| 1 | Two phones see each other's live dots move; join via shared code. | The core pipe — everything else is a view on this. |
| 2 | Fetch a route via the backend (ORS), draw it, show the 1st/2nd/3rd indicator. | Standings algorithm + route handling. |
| 3 | Push-to-talk voice via LiveKit. | Comms. |
| 4 | Background location, reconnection, battery tuning. | Production-readiness for real rides. |

---

## 12. Rough cost (starting out)

- **Map tiles (OpenFreeMap):** free, unlimited, no account, no card.
- **Directions (ORS):** free; email signup for a key; no card.
- **Voice (LiveKit Cloud):** free tier covers low-volume group voice; no card for the free tier. (Self-host LiveKit to stay free at higher volume.)
- **Backend hosting:** a $5/mo VPS, or a free/cheap tier on Fly.io / Railway / Render runs the single Go binary.
- **App stores (optional):** Apple $99/yr, Google $25 once — only for public distribution.

Effectively zero to build and run for a private friend group, with no credit card required.

---

## 13. Security & privacy notes

- Treat live location as sensitive: only broadcast within an active ride, to riders who hold the join code.
- Don't persist location trails in v1. If you add history later, make it opt-in and deletable.
- Keep the **LiveKit API secret** and the **ORS API key** server-side only — never bundle them in the app. (OpenFreeMap needs no key at all.)
- Use `wss://` (TLS) for the WebSocket in production, and short-lived join codes.
