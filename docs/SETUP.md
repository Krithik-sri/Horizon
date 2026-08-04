# App setup — React Native (Expo + dev client), TypeScript

> **Goal (this MVP):** create a ride, 2–3 riders join by code, everyone sees everyone move on a
> shared map, a long-press sets a destination and a route line + next-turn cue appear on every
> phone. **No accounts, no sign-in, no voice** — those are later phases, referenced below but not
> part of what you're setting up today.
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

**Built:**
- **Departure register** (`src/app/index.tsx`) — enter a name, start a ride (get a join code) or
  join one by code.
- **Motion register** (`src/app/ride/[code].tsx`) — the map, every rider's dot, the Horizon Line
  HUD (speed + next-turn cue), long-press to set a destination.
- The WebSocket client (`src/core/wsClient.ts`) — connect, reconnect with backoff + jitter, ~1 Hz
  location throttle.
- The route client (`src/core/route.ts`) — `POST /rides/{code}/route`.
- Design tokens (`src/design/tokens.ts`) — the only source of color/type/spacing in the app.

**Not built:** sign-in (no auth at all yet — [`ADR-008`](./ADR/ADR-008.md) describes the
eventual design), voice, the Return register (journal/photos/stats), and background location
(foreground tracking only — the screen has to stay on, which is why `ride/[code].tsx` calls
`useKeepAwake()`).

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
- **A running backend** — see [`docs/SETUP_BACKEND.md`](./SETUP_BACKEND.md). Its only account
  requirement for this MVP is **OpenRouteService** (free key, no card, `driving-car` profile —
  ORS has no motorcycle profile) — and that key lives on the backend, never in this app.
- **The map needs nothing.** OpenFreeMap tiles are keyless, no signup.
- **Not needed for this MVP — don't create these accounts yet:** Supabase (auth is deferred,
  [`ADR-008`](./ADR/ADR-008.md)) and LiveKit Cloud (voice is Phase 3, §11).

✅ **Checkpoint:** `eas whoami` prints your username, and `adb devices` lists a device once an
emulator/phone is connected.

---

## 2. Verify dependencies

Everything this MVP needs is already in `mobile/package.json` — confirm rather than install:

```powershell
cd mobile
npm ls @maplibre/maplibre-react-native expo-location expo-task-manager @react-native-async-storage/async-storage @expo-google-fonts/inter expo-keep-awake zustand
```

> The WebSocket client needs **no package** — React Native ships a global `WebSocket`.

✅ **Checkpoint:** every package above resolves with no `UNMET DEPENDENCY` errors. (Exact
installed versions live in `mobile/package.json` — currently `expo-location@~56.0.22`,
`expo-task-manager@~56.0.24`, `@react-native-async-storage/async-storage@2.2.0`,
`@expo-google-fonts/inter@^0.4.2`, `expo-keep-awake@~56.0.3`. `react-native-web` and `react-dom`
have already been removed — there is no web client, [`ADR-007`](./ADR/ADR-007.md).)

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

No map tokens anywhere. The only secret in the project today is the ORS key (LiveKit's secret
and the Supabase JWT secret join it once those phases land) — all of them live on the **Go
backend**, never in the app.

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

**`mobile/src/core/config.ts` is baked into a `preview` build at bundle time.** Set
`KOYEB_BASE_URL` there to your deployed backend's `https://…` host **before** you build preview,
not after — changing it later means every rider needs a fresh APK; there's no over-the-air
update path for this yet.

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
  `riderId.ts` (a stable per-install id, so a reconnect replaces your old connection instead of
  leaving a ghost — §7), `wsClient.ts` (connect/reconnect/throttle, §7), `route.ts` (the
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

- **No auth today.** The MVP sends no token at all on the WebSocket upgrade. Whenever Supabase
  auth lands ([`ADR-008`](./ADR/ADR-008.md)), the rule stays the same either way: never put a
  token in the `/ws` query string — `backend/internal/httpx/logging.go` logs request URLs.
- **Reconnect is automatic**, with exponential backoff and full jitter, capped at 15s
  (`MAX_BACKOFF_MS`) — mobile networks drop constantly. A 404 (unknown or expired ride code) is
  treated as terminal and not retried forever.
- **Location sends are throttled to ~1 Hz** (`MIN_LOC_INTERVAL_MS`) even if GPS fires faster.
- Every device presents a stable `riderId` (`src/core/riderId.ts`, persisted in AsyncStorage) so
  a reconnect **replaces** the old connection instead of leaving a ghost rider on everyone's map.

---

## 8. Location — foreground only (background is Phase 4)

The real foreground location loop lives in `src/app/ride/[code].tsx` — read it there. In short:
on mount it checks (never re-prompts mid-ride — that's exactly the interruption `CLAUDE.md`
forbids) for foreground permission, and if granted starts `Location.watchPositionAsync` at 1 Hz,
feeding fixes into `useRide().sendLoc`. The permission prompt itself lives in
`src/app/index.tsx` (Departure), asked once before a ride starts.

`expo-task-manager` is installed but **not wired to anything yet**. Background tracking (screen
locked, phone in a pocket) is Phase 4 in `CLAUDE.md`'s build order, not part of this MVP.
`useKeepAwake()` in `ride/[code].tsx` is the current stand-in — it keeps the screen on for the
whole ride so foreground tracking never pauses.

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

## 11. Push-to-talk voice — `@livekit/react-native` (Phase 3, not part of this MVP)

Nothing under `mobile/src/` implements this yet — the shape below is a forward reference so it
doesn't need re-deriving when Phase 3 starts, not a description of working code.

```tsx
import { LiveKitRoom, AudioSession, useLocalParticipant } from "@livekit/react-native";
import { useEffect } from "react";

// token + url come from your Go backend: POST /rides/{code}/voice-token
function Voice({ url, token }: { url: string; token: string }) {
  useEffect(() => {
    AudioSession.startAudioSession();
    return () => { AudioSession.stopAudioSession(); };
  }, []);
  // audio={false} → mic starts muted; un-mute only while the PTT button is held
  return (
    <LiveKitRoom serverUrl={url} token={token} connect audio={false}>
      <PttButton />
    </LiveKitRoom>
  );
}

function PttButton() {
  const { localParticipant } = useLocalParticipant();
  return (
    <Pressable
      onPressIn={() => localParticipant.setMicrophoneEnabled(true)}
      onPressOut={() => localParticipant.setMicrophoneEnabled(false)}
    >
      <Text>Hold to talk</Text>
    </Pressable>
  );
}
```
You'd stay subscribed to everyone else's audio automatically; only *your* mic toggles.

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
      index.tsx                Departure register — create / join a ride
      ride/[code].tsx           Motion register — map, HUD, GPS
    core/
      config.ts                 backend base URL (HTTP + derived WS)
      models.ts                 wire protocol types
      riderId.ts                 stable per-install rider id (AsyncStorage)
      wsClient.ts                 WebSocket + reconnect backoff + 1 Hz loc throttle
      wsClient.check.ts            runnable self-check (§6)
      route.ts                      POST /rides/{code}/route
    state/
      useRide.ts                     zustand store
    design/
      tokens.ts                       the DESIGN.md token set, authoritative
    features/
      motion/    HorizonLine.tsx · AheadCue.tsx · SpeedReadout.tsx
      convoy/    MapCanvas.tsx · RiderMarkers.tsx · RouteLine.tsx
```

`features/departure/` and `features/return/` don't exist yet — Departure is still one screen and
the Return register hasn't started, so nothing has needed splitting out of `src/app/index.tsx`
yet. Add those directories when a second screen in either register does.

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
   - A deployed backend: fill in `KOYEB_BASE_URL` with the `https://…` host — `WS_BASE_URL`
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
  dot, not a second one (stable `riderId`, §7) — a rider who loses signal comes back as one rider,
  not two.

---

### Notes / gotchas
- **Zero map cost / zero card.** OpenFreeMap tiles are free and keyless; the ORS key lives only
  on the backend. LiveKit's and Supabase's secrets will too, once those phases start — this MVP
  doesn't use either.
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
- **Background location isn't built yet.** `expo-task-manager` is installed but unused — that's
  Phase 4, not this MVP. The screen has to stay on (`useKeepAwake()`) for now.
- **Coordinate order:** MapLibre uses `[lng, lat]`; `loc`/`state` messages use `lat`/`lng`
  fields. `src/core/models.ts` encodes the convention in its type names, not just comments —
  keep it straight wherever you draw markers or routes.
- **No ranking anywhere.** A rider carries no position number and no distance-along-route
  metric — don't add one client-side either ([`ADR-009`](./ADR/ADR-009.md)).
