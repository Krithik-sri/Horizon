# Web setup — Horizon PWA (Vite + React + TypeScript)

> The v1 client is an **installable PWA**: a web app you "Add to Home Screen" and run fullscreen
> like a native app. It renders the map, sends your GPS to the Go backend ~1×/sec over a
> WebSocket, and draws everyone's dots from the broadcast it gets back. A screen **wake-lock**
> keeps GPS alive on a handlebar-mounted phone — which is why a foreground-only PWA is enough for
> v1 (true background tracking is the reason the native `mobile/` app exists; see `SYSTEM_DESIGN.md
> §1` "Client decision").
>
> **Phase 0 scope (this guide):** map shows your own dot, fed through the server. Join codes and
> multiple riders (Phase 1) already work because the backend is room-based.

Run commands from `web/` (PowerShell, your shell). Requires the Go backend running — see
`SETUP_BACKEND.md`.

---

## 0. Prerequisites

- **Node 20+** (`node --version`). No account, no card.
- The **Go backend** running on `:8080` (`SETUP_BACKEND.md`). The app talks to it for `POST /rides`
  and `GET /ws`.

---

## 1. Install

```powershell
Set-Location web
npm install
```

The PWA home-screen icons are generated from code (no binary assets in the repo):

```powershell
npm run gen-icons    # writes public/icon-192.png, icon-512.png, apple-touch-icon.png
```

---

## 2. Dev loop

```powershell
npm run dev          # http://localhost:5173  (also printed: a LAN URL like http://192.168.x.x:5173)
```

Open `http://localhost:5173` in a browser, allow location, and you should see the OpenFreeMap map
center on your dot. The service worker runs in dev (`devOptions.enabled`), so install/offline can
be tested locally.

✅ **Checkpoint:** map renders, your dot appears, and the Network tab shows a `/ws` connection with
`loc` frames going out and `state` frames coming back.

---

## 3. Point the app at the backend

By default the app assumes the backend is on **`:8080` of the same host** in dev (works for a phone
on the same Wi-Fi too, since it uses the page's hostname). Override with a `web/.env` if needed:

```
VITE_BACKEND_HTTP=http://192.168.1.50:8080
VITE_BACKEND_WS=ws://192.168.1.50:8080
```

In a deployed build the app assumes the backend is reachable on the **same origin** (e.g. behind a
Cloudflare Tunnel that routes `/ws`, `/rides`, … to the Go binary), so set these only if it isn't.

---

## 4. Build + install on a phone

```powershell
npm run build        # tsc -b + vite build → dist/ (with service worker + manifest)
npm run preview      # serve dist/ locally to sanity-check the production build
```

PWA install / Geolocation / Wake Lock / WebRTC all require **HTTPS** (an exception is made for
`localhost`). For two-phone testing, serve `dist/` over HTTPS — deploy it to any free static host,
or put a trusted tunnel in front of `npm run preview`. Then:

- **Android (Chrome):** an "Install" prompt appears automatically; or ⋮ → *Install app*.
- **iPhone (Safari):** Share → *Add to Home Screen*. It launches fullscreen (the `apple-mobile-web-app-*`
  meta tags in `index.html`). Note iOS PWAs are Safari-only and screen-on; that matches the mounted
  ride use-case.

---

## 5. Map of the code

```
web/src/
  types.ts            # the WebSocket contract (loc / state / welcome) + STALE_AFTER_SEC — lat/lng wire format
  store/ride.ts       # zustand: name, ride code, selfId, status, riders
  net/config.ts       # where the backend lives (dev :8080 vs same-origin prod)
  net/api.ts          # POST /rides
  net/identity.ts     # stable per-tab rider id (sessionStorage) — reconnects replace, not duplicate
  net/ws.ts           # useRideSocket: WS + reconnect/backoff (+ ?rider= id), routes welcome/state → store, sendLoc()
  location/useGeo.ts  # watchPosition throttled to ~1 Hz
  location/useWakeLock.ts  # keep screen awake; re-acquire on visibilitychange
  map/Map.tsx         # MapLibre GL JS + OpenFreeMap; one marker per rider (greyed when stale). [lng,lat] conversion lives here.
  App.tsx / Ride.tsx  # lobby (name + create/join) and the riding view (map + standings)
```

The `[lng, lat]` vs `lat/lng` trap (CLAUDE.md): the wire format is `lat`/`lng`; MapLibre wants
`[lng, lat]`. The only conversion is in `map/Map.tsx` where markers are placed.

**Dead zones:** the server includes `ageSec` (seconds since a rider's last fix) in every
`state`. Past `STALE_AFTER_SEC` (10 s, `types.ts`) the map dot greys out and the standings row
shows "Ns ago" instead of a confidently frozen speed. On reconnect the client presents the same
`rider` id (`net/identity.ts` — sessionStorage on purpose: it survives a reload, but two tabs
get *different* ids, so the two-tab test below still works), letting the server replace the
zombie connection instead of seating a ghost.

### Data flow (one GPS fix, end to end)

```
 navigator.geolocation.watchPosition          (device GPS, ~1 Hz, throttled)
        │  Fix {lat,lng,heading,speed}
        ▼
 useGeo  ──►  sendLoc()  ──►  WebSocket  ──►  Go server (stamps + stores the fix)
   (Ride.tsx)   (net/ws.ts)                          │
                                                      │  ~4 Hz broadcast tick
        ┌─────────────────────────────────────────────┘
        ▼
 ws.onmessage  ──►  store.setRiders()  ──►  Map.tsx reconciles one marker per rider
   (net/ws.ts)        (store/ride.ts)         + Ride.tsx standings list
```

Your own dot shows because the server echoes your fix back inside `state`; the one-time `welcome`
message tells the client its `id`, which is how `Map.tsx`/`Ride.tsx` label *you* and skip drawing a
duplicate. The store is the single client-side source of truth — the map and the standings list are
both just views of `riders`.

---

## Phases 1–4 (web)

### Phase 1 — two phones see each other ✅ already working

The backend is room-based and the client already creates/joins codes (lobby) and renders **every**
rider from `state`, labelling self via `selfId`. To verify: open the app on two phones (or two
browser tabs), have one *Start a ride* and share the 6-char code, the other *Join* with it — both
dots appear and move. No new code needed; this falls out of Phase 0.

### Phase 2 — route + standings line

The standings *ordering* already arrives from the server (`pos`, sorted by `distAlong`) and the list
in `Ride.tsx` already renders it — but `distAlong` stays 0 until a route exists. To finish Phase 2:

- **Backend** (`backend/`): implement `POST /rides/{code}/route` — proxy OpenRouteService (cycling
  profile, `ORS_API_KEY` server-side), decode to `[]standings.Pt`, store it on the room's `route`
  field. From then on `broadcast()` fills `distAlong` and sorts by it (already coded in `room.go`).
- **Web**:
  - `net/api.ts`: add `setRoute(code, waypoints)` → `POST /rides/{code}/route`. Fetch **once per
    ride** (the ride creator sets it), not per rider — spares the ORS quota (CLAUDE.md).
  - `map/Map.tsx`: add a GeoJSON **source + line layer** for the polyline. Decode the returned
    geometry to `[lng, lat]` pairs (same boundary conversion) before handing it to MapLibre.
  - Optional: a simple "set destination" interaction (long-press to drop start/end) in the lobby or
    a route panel. Keep it minimal — a friend group can hard-code or paste coords at first.

### Phase 3 — push-to-talk voice

- **Backend**: implement `POST /rides/{code}/voice-token` — mint a LiveKit JWT (room name = ride
  code, identity = rider id) using `LIVEKIT_API_KEY/SECRET/URL`; return `{ token, url }`.
- **Web**:
  - `npm install livekit-client` (a JS dep, no native build — that's the whole point of the PWA).
  - `voice/voice.ts`: fetch the token, `Room.connect(url, token)`, and wire a **push-to-talk**
    button — `setMicrophoneEnabled(true)` on press, `false` on release.
  - **iOS gotcha:** audio playback must start from a user gesture — start/resume the audio context on
    the first tap (e.g. a "Join voice" button), not automatically on load.
  - HTTPS is already required (Phase 0), which also satisfies WebRTC's secure-context rule.

### Phase 4 — background location (out of scope, by design)

A browser stops `geolocation` when the tab is backgrounded / screen locked — no service-worker trick
overrides it. The screen wake-lock covers the mounted, screen-on ride; true background tracking
(pocketed / screen off) is exactly why the native `mobile/` app exists. Don't try to force it in the
PWA — build the native client when that use-case becomes real (`SYSTEM_DESIGN.md §10`).
