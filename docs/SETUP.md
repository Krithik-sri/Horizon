# App setup — React Native (Expo + dev client), TypeScript

> **Goal:** create a ride, riders join by code, everyone sees everyone move on a shared map, set a
> destination and get a route line, spoken turn-by-turn, and push-to-talk voice — the whole app,
> not a slice of it. Every rider is signed in, anonymously and with no signup step (`ADR-016`),
> because `/ws` now refuses a connection without a verified Supabase JWT (`ADR-017`).
>
> **No credit card needed.** The map uses MapLibre + OpenFreeMap (no key, no signup);
> directions come from OpenRouteService via your Go backend (free key, no card) — that key lives
> on the backend, never in this app.
>
> **Read this first:** MapLibre needs native code, so you **cannot use the Expo Go app**. You'll
> use Expo with a *custom dev client* — same great Expo workflow, but you run your own dev build
> instead of the sandbox. It's mostly copy-paste config.

This is **the** setup guide for Horizon — the only client is this app
([`ADR-007`](./ADR/ADR-007.md)). The backend lives in `backend/`; see
[`docs/SETUP_BACKEND.md`](./SETUP_BACKEND.md).

---

## 0. Where the project is

`mobile/src/` is a working app, not a template — read this before you start.

**Built — all four route groups, code-complete:**
- **Departure register** (`src/app/index.tsx`) — sign-in (anonymous, [`ADR-016`](./ADR/ADR-016.md)),
  start a ride (get a join code) or join one by code, permission prompts asked once.
- **Motion register** (`src/app/ride/[code].tsx`) — the map, every rider's dot, the Horizon Line
  HUD, spoken turn-by-turn ([`ADR-015`](./ADR/ADR-015.md)), personal off-route rerouting
  ([`ADR-014`](./ADR/ADR-014.md)), and push-to-talk voice ([`ADR-020`](./ADR/ADR-020.md)).
- **The planner** (`src/app/plan/[code].tsx`) — a multi-stop route with alternatives, previewed
  before it's committed to the room ([`ADR-013`](./ADR/ADR-013.md)).
- **The Return register** (`src/app/return/`) — the archive list and per-ride detail, backed by
  Supabase, reflective-only per the no-ranking rule ([`ADR-018`](./ADR/ADR-018.md),
  [`ADR-019`](./ADR/ADR-019.md)).
- The WebSocket client (`src/core/wsClient.ts`) — connect, reconnect with backoff + jitter, ~1 Hz
  location throttle, a Supabase JWT on every attempt.
- The route client (`src/core/route.ts`) — `POST /rides/{code}/route`.
- Background location (`src/core/backgroundLocation.ts`) — one GPS subscription that survives the
  screen going off, behind an Android foreground service ([`ADR-021`](./ADR/ADR-021.md)); the
  screen is still kept on as a belt-and-braces measure, now via manual `activateKeepAwakeAsync`/
  `deactivateKeepAwake` rather than the `useKeepAwake()` hook (`ride/[code].tsx`).
- Design tokens (`src/design/tokens.ts`) — the only source of color/type/spacing in the app.

**Not proven:** none of the above has been run on a real device yet — that gap, not a missing
feature, is this project's actual state (`CLAUDE.md` Status).

You're about to: confirm dependencies (§2), point the app at a running backend (§13), build a
dev client once (§5), then run it (§13).

---

## How to use this guide

Run every command **from the repo root** (`C:\Data\projects\Horizon`) unless a step says
`cd mobile`. Commands are written for **PowerShell on Windows** (your shell). After each
numbered step there's a ✅ checkpoint — don't move on until it passes.

**Android first.** Steps marked *(iOS, later)* are deferred, not removed — Windows can't build
or run the iOS Simulator locally regardless, so those steps wait for EAS cloud builds and a
real device.

---

## 1. Prerequisites

Check what's already installed (you likely have all of these):

```powershell
node -v      # need 20+
npm -v       # any recent
eas --version  # EAS CLI — the `expo` commands come via `npx`
```

Still needed:

- **Expo account** (free) for EAS Build. Create one at https://expo.dev, then:
  ```powershell
  eas login
  ```
- **Android:** Android Studio with an emulator (AVD) **or** a USB device with USB debugging on.
  Verify the toolchain sees a device once an emulator is running:
  ```powershell
  adb devices   # should list at least one device/emulator
  ```
- **A running backend** — see [`docs/SETUP_BACKEND.md`](./SETUP_BACKEND.md). It needs
  **OpenRouteService** (free key, no card, `driving-car` profile — ORS has no motorcycle profile),
  a **Supabase** project with the default ES256 signing keys (JWKS) and anonymous sign-ins enabled
  ([`ADR-016`](./ADR/ADR-016.md), [`ADR-017`](./ADR/ADR-017.md) — the server refuses to boot
  without `SUPABASE_URL`), and **LiveKit Cloud** for voice
  ([`ADR-020`](./ADR/ADR-020.md)). All three are free with no card; every secret lives on the
  backend, never in this app.
- **The map needs nothing.** OpenFreeMap tiles are keyless, no signup.

✅ **Checkpoint:** `eas whoami` prints your username, and `adb devices` lists a device once an
emulator/phone is connected.

---

## 2. Verify dependencies

Everything the app needs is already in `mobile/package.json` — confirm rather than install. The
list below is a sample, not the full set (voice alone pulls in four LiveKit packages) — read
`package.json` for the rest:

```powershell
cd mobile
npm ls @maplibre/maplibre-react-native expo-location expo-task-manager @react-native-async-storage/async-storage @expo-google-fonts/inter @supabase/supabase-js @livekit/react-native expo-speech zustand
```

> The WebSocket client needs **no package** — React Native ships a global `WebSocket`.

✅ **Checkpoint:** every package above resolves with no `UNMET DEPENDENCY` errors. `react-native-web`
and `react-dom` have already been removed — there is no web client, [`ADR-007`](./ADR/ADR-007.md).

---

## 3. Map tiles — OpenFreeMap (nothing to configure)

OpenFreeMap serves free MapLibre styles with no key, no signup, and no usage limits.

- `https://tiles.openfreemap.org/styles/dark` — **what Horizon uses.** Background `rgb(12,12,12)`,
  which is the only one of these compatible with the Motion register's `#000000` surface and 7:1
  contrast floor.
- `liberty` · `positron` · `bright` — all light styles. Do not put these behind a Motion screen.

That URL is the only "map config" you need. Attribution is added automatically by MapLibre.

---

## 4. Plugins & permissions — `mobile/app.config.ts`

Already in place — read it there, don't recreate it. Two things worth knowing when you do:

- **`scheme: "horizon"` is set.** This is what expo-router and the dev client need to register
  deep links and for `npx expo start --dev-client` to hand off to your build — it previously had
  no scheme at all.
- **The `expo-location` plugin entry now resolves.** It used to fail because `expo-location`
  wasn't a dependency yet; it is now (§2), so `npx expo config` and `npx expo prebuild` both
  work.

No map tokens anywhere. The ORS key, the LiveKit secret, and the Supabase JWT secret all live on
the **Go backend**, never in the app — the app only ever holds the public Supabase `anon` key,
which is safe to ship because Postgres Row-Level Security, not secrecy, protects it
([`ADR-017`](./ADR/ADR-017.md)).

✅ **Checkpoint:** `npx expo config --type prefab` prints merged config with `scheme: "horizon"`
and every plugin listed, no errors.

---

## 5. Build a client — two profiles, two different jobs

`mobile/eas.json` defines profiles that are **not interchangeable**:

- **`development`** — `developmentClient: true`. This APK loads its JavaScript from a Metro dev
  server (`npx expo start --dev-client`) over the network. Use it on your own device while
  building — JS changes hot-reload, no rebuild needed. It needs Metro reachable, so it's useless
  away from your laptop — including on an actual ride.
- **`preview`** — `distribution: "internal"`, no `developmentClient`. The JS bundle is baked in
  at build time. This is the standalone build you actually hand to riders.

Build the one you need:

```powershell
cd mobile
eas build --profile development --platform android   # your own device, while iterating
eas build --profile preview --platform android        # the build you send to riders
# add --local to build on your own machine instead of EAS cloud
# (iOS, later): --platform ios
```

Both profiles set `distribution: "internal"`, so either build finishes with an **install link**
in the EAS dashboard/terminal output — send that link to each rider's phone directly, no app
store. The very first build you ever run also mints this project's EAS `projectId` (already
present as `extra.eas.projectId` in `mobile/app.config.ts`, from an earlier build).

**`EXPO_PUBLIC_HORIZON_API_URL` is baked into a `preview` build at bundle time**, via `eas.json`'s
`build.preview.env` (EAS does not upload `.env`, so anything unset there silently falls back to
the Android-emulator default in `mobile/src/core/config.ts`). Set it to your deployed backend's
`https://…` host **before** you build preview, not after — changing it later means every rider
needs a fresh APK; there's no over-the-air update path for this yet.

Rebuild only when you add or upgrade a **native** dependency — that applies to `development`,
where JS-only changes hot-reload. A `preview` build has no such shortcut: cut a fresh one
whenever the JS you want riders running has changed.

✅ **Checkpoint:** the `development` build is installed on your emulator/phone and opens to the
Expo dev launcher screen once `npx expo start --dev-client` is running.

---

## 6. Orientation — `mobile/src/`

The app is scaffolded; this is a map of what's there, not an instruction to build it. See §12
for the full tree.

- **Start here:** `src/app/_layout.tsx` (root — fonts, splash screen, gesture handler), then
  `src/app/index.tsx` (the Departure register: name, start/join a ride).
- **`src/core/`** — everything that isn't UI: `config.ts` (backend URL, §13), `models.ts` (the
  wire protocol types, mirroring `CLAUDE.md`'s WebSocket contract field-for-field),
  `supabase.ts` (the Supabase client and session — the rider's id is now the JWT's `sub`, not a
  client-generated one, so a reconnect replaces the old connection instead of leaving a ghost —
  `ADR-017`, §7), `wsClient.ts` (connect/reconnect/throttle, §7), `route.ts` (the
  `POST /rides/{code}/route` call, §10).
- **`src/state/useRide.ts`** — the one zustand store. Owns the live `riders` list, your own GPS
  fix, the current route, and connection status; every screen reads from here rather than
  keeping its own copy.
- **`src/app/ride/[code].tsx`** — the Motion register: the map screen a rider actually rides
  with open.
- **`src/features/motion/`** — `HorizonLine` (the Ahead/Now/Held layout), `SpeedReadout`,
  `AheadCue` (next-turn text).
- **`src/features/convoy/`** — `MapCanvas` (the MapLibre `<Map>`, §9), `RiderMarkers`,
  `RouteLine`.
- **`src/design/tokens.ts`** — the only place color, type, and spacing values are defined.

`src/core/wsClient.check.ts` is a runnable self-check for the two things in `wsClient.ts` that
would break silently in a refactor — the reconnect backoff schedule and the outbound `loc`
throttle:
```powershell
npx tsx src/core/wsClient.check.ts
```

---

## 7. Talk to the Go server

The real implementation is `mobile/src/core/wsClient.ts` (connect) and
`mobile/src/core/config.ts` (the URL) — read them there rather than a paraphrase here. Worth
knowing before you do:

- **Every request carries a Supabase JWT**, including the WebSocket upgrade, as
  `Authorization: Bearer <token>` ([`ADR-017`](./ADR/ADR-017.md)). Riders are signed in
  anonymously at first launch, so this costs no sign-up step ([`ADR-016`](./ADR/ADR-016.md)).
  Never put a token in the `/ws` query string — not because this server's log would capture it
  (`backend/internal/httpx/logging.go` logs `r.URL.Path` only), but because a URL is exposed to
  proxies and CDN logs in a way a header is not.
- **Reconnect is automatic**, with exponential backoff and full jitter, capped at 15s
  (`MAX_BACKOFF_MS`) — mobile networks drop constantly. A 404 (unknown or expired ride code) is
  treated as terminal and not retried forever.
- **Location sends are throttled to ~1 Hz** (`MIN_LOC_INTERVAL_MS`) even if GPS fires faster.
- The rider id is the `sub` claim of the verified Supabase JWT, not a client-generated value —
  `riderId.ts` is gone — so a reconnect **replaces** the old connection instead of leaving a
  ghost rider on everyone's map, and the id can no longer be spoofed ([`ADR-017`](./ADR/ADR-017.md)).

---

## 8. Location — one subscription, foreground and background alike

The real implementation is `src/core/backgroundLocation.ts` — read it there.
`Location.startLocationUpdatesAsync` with an Android foreground service is the **only** source of
fixes now, in both foreground and background; there is no separate `watchPositionAsync` effect to
hand off from ([`ADR-021`](./ADR/ADR-021.md)). The `expo-task-manager` task calls the same
`useRide.getState().sendLoc` the UI called before, is registered at module scope so it also runs
in a headless restart, and rejoins from a persisted ride code if the JS context did not survive a
process death. Background permission is requested once, in Departure (`src/app/index.tsx`),
alongside foreground — denial degrades to foreground-only tracking rather than breaking anything.

This is the one phase of this project furthest from proven: it is code-complete but has never run
on a real ride, and `ADR-021`'s Future Revisions section names exactly what to watch for
(task-delivery latency, background JS timer throttling) once it does.

---

## 9. Map with rider markers — MapLibre + OpenFreeMap

The working implementation is `mobile/src/features/convoy/` — read it there. Two things about
this library are worth knowing before you write against it:

**The component names changed in v11.** Most MapLibre-RN material online (and every rnmapbox
snippet, which the API otherwise closely mirrors) uses `MapView` / `ShapeSource` / `LineLayer` /
`PointAnnotation`. Version 11 renames them, and code written against the old names does not
compile:

| Old / rnmapbox | `@maplibre/maplibre-react-native` v11 |
|---|---|
| `MapView` | `Map` |
| `ShapeSource` | `GeoJSONSource` |
| `LineLayer`, `CircleLayer`, … | `Layer` (with `LineLayerProps` etc.) |
| `PointAnnotation` | `Marker` |

`Camera` keeps its name. When in doubt, read
`node_modules/@maplibre/maplibre-react-native/lib/typescript/module/index.d.ts` — it is the
authoritative list and takes ten seconds to check.

**Use the dark style, not `liberty`.** OpenFreeMap publishes a keyless dark style at
`https://tiles.openfreemap.org/styles/dark` (background `rgb(12,12,12)`). The Motion register
demands a `#000000` surface and a 7:1 contrast floor ([`docs/DESIGN.md`](./DESIGN.md)) — a light
basemap breaks both, and is blinding at night. `liberty`, `bright`, and `positron` are all light.

> Riders carry no `pos` — there is no ranking to render ([`ADR-009`](./ADR/ADR-009.md)).
> Coordinates go to MapLibre as `[lng, lat]`; `route.polyline` already arrives in that order from
> the server and must be passed through unswapped.

---

## 10. Directions — fetched via your backend (not the app)

The app never holds the ORS key. The real implementation is `mobile/src/core/route.ts` — it
POSTs waypoints (`[lat, lng]` pairs, the one lat-first request body in the whole protocol) to
`{BASE_URL}/rides/{code}/route` and maps the response status to a typed `FetchRouteError`
(`unknown-ride` / `bad-waypoints` / `no-route` / `unavailable` / `upstream-failed` / `network`).

That HTTP response is for surfacing an error to whoever set the destination. The route itself
arrives over the WebSocket as a `route` message broadcast to everyone in the room — that WS
message, not this HTTP response, is what `src/state/useRide.ts` renders from, so every rider's
map converges on the same line.

> MapLibre wants coordinates as `[lng, lat]`; `route.polyline` already arrives in that order.
> Don't flip it a second time.

---

## 11. Push-to-talk voice — `@livekit/react-native`

Implemented — read `src/features/convoy/useVoice.ts` and `src/features/motion/PushToTalk.tsx`
rather than a paraphrase here. In short: the Motion screen connects on mount with the microphone
muted and stays subscribed to the rest of the convoy from the first metre; the PTT control is the
invisible bottom 42% of the screen (`HorizonLine`'s *Held* band), operable by feel, rendering
nothing at rest ([`ADR-020`](./ADR/ADR-020.md)). The token comes from your Go backend,
`POST /rides/{code}/voice-token` (`src/core/voiceToken.ts`), minted with `golang-jwt` rather than
`livekit/protocol` to avoid 68 indirect modules ([`ADR-022`](./ADR/ADR-022.md)).

Voice is deliberately exempt from the corner rule — the app never mutes, ducks, or delays a
co-rider, at any point (`ADR-020` Decision §1). If the backend answers 503 (LiveKit env unset) or
the token fetch fails, no PTT control renders at all rather than an affordance that does nothing.

---

## 12. Project structure — what exists

Feature-first, mirroring the registers plus convoy (`CLAUDE.md`):
```
mobile/
  app.config.ts              scheme: "horizon", permissions, plugins (§4)
  eas.json                   development / preview / production build profiles (§5)
  src/
    app/
      _layout.tsx              root: Inter fonts, splash, gesture handler
      index.tsx                Departure register — sign in, create / join a ride
      ride/[code].tsx          Motion register — map, HUD, GPS, voice, spoken guidance
      plan/[code].tsx          planner — multi-stop route, alternatives (§ADR-013)
      return/                  archive list + per-ride detail (index.tsx, [id].tsx)
    core/
      config.ts                 backend base URL (HTTP + derived WS)
      models.ts / wsProtocol.ts wire protocol types
      supabase.ts                Supabase client, session, anonymous sign-in
      wsClient.ts                 WebSocket + reconnect backoff + 1 Hz loc throttle
      wsClient.check.ts            runnable self-check (§6)
      route.ts / route.pure.ts      POST /rides/{code}/route + pure helpers
      backgroundLocation.ts          the task from §8 (ADR-021)
      voiceToken.ts                   POST /rides/{code}/voice-token
      rides.ts / routePlans.ts         Supabase reads/writes for Return + planner
      rideTrack.ts / routeProgress.ts / bearing.ts   plus their `.check.ts` self-checks
    state/
      useRide.ts                     zustand store
    design/
      tokens.ts                       the DESIGN.md token set, authoritative
    features/
      motion/     HorizonLine.tsx · AheadCue.tsx · SpeedReadout.tsx · PushToTalk.tsx · EndRide.tsx
      convoy/     MapCanvas.tsx · RiderMarkers.tsx · RouteLine.tsx · RejoinLine.tsx · useVoice.ts
      departure/  PlannerMap.tsx · DestinationSearch.tsx
      return/     RideCard.tsx · RideFacts.tsx · RideTrace.tsx · JournalNote.tsx · PhotoStrip.tsx
```

`riderId.ts` is gone — the rider id is now the `sub` claim of the verified Supabase JWT, not a
client-generated one (`ADR-017`). `features/departure/` and `features/return/` both exist now;
the note that they didn't is stale.

---

## 13. Run

In order:

1. **Backend running and reachable** — `go run .` in `backend/`
   ([`docs/SETUP_BACKEND.md`](./SETUP_BACKEND.md)), confirmed with
   `Invoke-RestMethod http://localhost:8080/healthz` from a second window.
2. **`mobile/src/core/config.ts` pointing at it.** Read the comment at the top of that file and
   pick the right option:
   - Android emulator (the default already in the file): `http://10.0.2.2:8080` — reaches your
     host machine.
   - iOS simulator: `http://localhost:8080`.
   - A physical device (Android or iOS): your computer's LAN IP, e.g.
     `http://192.168.1.20:8080` — neither `10.0.2.2` nor `localhost` reach your machine from
     real hardware.
   - A deployed backend: fill in `EXPO_PUBLIC_HORIZON_API_URL` (in `mobile/.env` for local runs,
     or `eas.json`'s `build.preview.env` for EAS builds) with the `https://…` host — `WS_BASE_URL`
     derives `wss://` from it automatically. **Do this before running
     `eas build --profile preview`** (§5) — it's baked into that build at bundle time.

   Getting this step wrong is the single most likely reason a rider's app shows no one moving.
3. **A dev client installed** on the device you're testing with (§5).
4. **Start Metro:**
   ```powershell
   cd mobile
   npx expo start --dev-client
   ```
   Pick a target from the Expo dev menu, or press `a`/`i` for android/ios.

✅ **Checkpoint:** the app opens to the Departure screen, "Start a ride" returns a 6-character
code, and the Motion screen shows your own dot moving as you walk with location on.

---

## (iOS, later)

Not removed, just deferred behind Android — see `PRODUCT.md`/`ADR-007` for why Android ships
first. When you pick it up:
- `eas build --profile development --platform ios` builds in the cloud; no Mac required for
  the build itself. Swap `development` for `preview` (§5) for the standalone build you'd hand a
  rider.
- A real iPhone needs a free Apple Developer account for on-device installs; the iOS
  Simulator needs a Mac, which EAS cloud builds don't give you.
- `UIBackgroundModes` and `NSMicrophoneUsageDescription` in `app.config.ts` are already in
  place for when you get here.

---

## Done when…

- Two phones, on the same ride code — one running a `preview` build, or both running
  `development` builds with Metro reachable — see the other's dot moving in real time.
- A long-press on either phone draws the same route line, in the same place, on both phones.
- Turning one phone's network off greys that rider out on the other phone within ~10s (`ageSec`,
  `CLAUDE.md`'s WebSocket protocol). Turning it back on reconnects that rider as the **same**
  dot, not a second one (the JWT-derived rider id, §7) — a rider who loses signal comes back as
  one rider, not two.

---

### Notes / gotchas
- **Zero map cost / zero card.** OpenFreeMap tiles are free and keyless; the ORS key, LiveKit's
  secret, and the Supabase JWT secret all live only on the backend, never in this app.
- **Not Expo Go.** MapLibre needs native code, so always run a dev client — `development` while
  building, `preview` for a standalone install — never the Expo Go app.
- **`development` and `preview` are not interchangeable** (§5). `development` needs Metro
  running nearby; `preview` is what you actually hand a rider, and it bakes in whatever
  `config.ts` said at build time.
- **Windows = Android locally.** Build/run the Android dev client on your machine; use EAS
  cloud for iOS builds (a Mac is only needed for the iOS Simulator).
- **Emulator can't reach `localhost`.** The Android emulator reaches your host machine at
  `10.0.2.2`; a physical device needs your computer's LAN IP. `localhost` only works for the
  iOS simulator.
- **Background location is built but unproven.** `expo-task-manager` backs the one GPS
  subscription described in §8 (`ADR-021`) — code-complete, never run on a real ride.
- **Coordinate order:** MapLibre uses `[lng, lat]`; `loc`/`state` messages use `lat`/`lng`
  fields. `src/core/models.ts` encodes the convention in its type names, not just comments —
  keep it straight wherever you draw markers or routes.
- **No ranking anywhere.** A rider carries no position number and no distance-along-route
  metric — don't add one client-side either ([`ADR-009`](./ADR/ADR-009.md)).
