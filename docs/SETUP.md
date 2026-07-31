# App setup — React Native (Expo + dev client, TypeScript)

> Goal: an Expo/React Native app that renders a MapLibre map with free OpenFreeMap tiles,
> sends/receives location over the Go server's WebSocket, shows every rider on a shared map,
> and does push-to-talk voice via LiveKit.
>
> **No credit card needed.** The map uses MapLibre + OpenFreeMap (no key, no signup);
> directions come from OpenRouteService via your Go backend (free key, no card); durable state
> (auth, ride history, journal) is Supabase (free tier, no card).
>
> **Read this first:** MapLibre and LiveKit both need native code, so you **cannot use the
> Expo Go app**. You'll use Expo with a *custom dev client* — same great Expo workflow, but
> you run your own dev build instead of the sandbox. It's mostly copy-paste config.

This is **the** setup guide for Horizon — the only client is this app
([`ADR-007`](./ADR/ADR-007.md)). The backend lives in `backend/`; see
[`docs/SETUP_BACKEND.md`](./SETUP_BACKEND.md).

---

## 0. Known issues — read before you touch anything

Three things are broken or incomplete right now. All three are **code changes**, not covered
by this guide (it documents them so the fix is obvious when you get to it):

1. **`npx expo prebuild` fails today.** `mobile/app.config.ts` (line ~19) registers the
   `expo-location` config plugin, but `expo-location` is **not** in `mobile/package.json`
   dependencies — Expo can't resolve a plugin for a package that isn't installed. Nothing that
   touches native config will prebuild or build until you add it (and `expo-task-manager`,
   needed for Phase 4 background tracking, while you're there):
   ```powershell
   cd mobile
   npx expo install expo-location expo-task-manager
   ```
2. **`mobile/src/` doesn't exist.** The stock Expo template was deleted in the native-first
   pivot ([`ADR-007`](./ADR/ADR-007.md)) and nothing has replaced it yet. The first
   implementation task is scaffolding `src/app/_layout.tsx` + `src/app/index.tsx` from
   scratch — `mobile/tsconfig.json` already has the `@/*` → `./src/*` path alias waiting for
   it, so nothing needs configuring there, only creating.
3. **`react-native-web` is still a dependency** in `mobile/package.json`, left over from the
   original template. There is no web client ([`ADR-007`](./ADR/ADR-007.md)) — remove it the
   next time you touch dependencies.

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
- Accounts (free, no card), **used by the backend, not the app** — set these up when you do
  [`docs/SETUP_BACKEND.md`](./SETUP_BACKEND.md):
  - **Supabase** — project URL + anon key (auth, durable state).
  - **LiveKit Cloud** — project URL + API key/secret (voice).
  - **OpenRouteService** — free API key (directions, `driving-car` profile — no motorcycle
    profile exists, this is the closest approximation).
  - The map needs **nothing**.

✅ **Checkpoint:** `eas whoami` prints your username, and `adb devices` lists a device once an
emulator/phone is connected.

---

## 2. Install the missing dependencies

Everything except `expo-location` and `expo-task-manager` is already in
`mobile/package.json` (MapLibre, LiveKit, zustand). If you haven't already (Known issue #1):

```powershell
cd mobile
npx expo install expo-location expo-task-manager
```

> The WebSocket client needs **no package** — React Native ships a global `WebSocket`.

✅ **Checkpoint:** `npm ls expo-location expo-task-manager @maplibre/maplibre-react-native
@livekit/react-native` shows all four resolved with no `UNMET DEPENDENCY` errors.

---

## 3. Map tiles — OpenFreeMap (nothing to configure)

OpenFreeMap serves free MapLibre styles with no key, no signup, and no usage limits. Pick one:
- `https://tiles.openfreemap.org/styles/liberty`
- `https://tiles.openfreemap.org/styles/positron`
- `https://tiles.openfreemap.org/styles/bright`

That URL is the only "map config" you need. Attribution is added automatically by MapLibre.

---

## 4. Plugins & permissions — `mobile/app.config.ts`

Already in place — review it, don't recreate it:

```ts
export default {
  expo: {
    name: "Horizon",
    slug: "horizon",
    ios: {
      bundleIdentifier: "com.krithik.horizon",
      infoPlist: {
        UIBackgroundModes: ["location", "audio"], // keep GPS + voice alive in background
        NSMicrophoneUsageDescription: "Lets you talk to your ride group over push-to-talk.",
      },
    },
    android: {
      package: "com.krithik.horizon",
    },
    plugins: [
      "expo-dev-client",
      "@maplibre/maplibre-react-native",
      [
        "expo-location", // <- fails to resolve until Known issue #1 is fixed
        {
          locationWhenInUsePermission: "Shows your position to your ride group.",
          locationAlwaysAndWhenInUsePermission:
            "Keeps sharing your position during a ride when the screen is off.",
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ],
      ["@livekit/react-native-expo-plugin", { android: { audioType: "communication" } }],
      "@config-plugins/react-native-webrtc",
    ],
  },
};
```

No map tokens anywhere. The only secrets in the project (Supabase JWT secret, LiveKit secret,
ORS key) live on the **Go backend**, never in the app.

✅ **Checkpoint (after Known issue #1 is fixed):** `npx expo config --type prefab` prints
merged config with your plugins listed and no errors.

---

## 5. Build the dev client once, then iterate fast

`mobile/eas.json` already has a `development` profile configured. From `mobile/`, start with
Android:

```powershell
eas build --profile development --platform android    # (iOS, later): --platform ios
# add --local to build on your own machine instead of EAS cloud
```

Install the resulting build on your device/emulator, then for day-to-day work just run:

```powershell
npx expo start --dev-client
```

Rebuild the dev client only when you add/upgrade a **native** dependency. JS changes hot-reload.

✅ **Checkpoint:** the dev client app is installed on your emulator/phone and opens to the Expo
dev launcher screen.

---

## 6. Scaffold the app shell — `mobile/src/`

This is the first real implementation task, not a copy-paste step (Known issue #2): create
`src/app/_layout.tsx` and `src/app/index.tsx` under Expo Router's file-based routing, and
register LiveKit's globals at the entry point:

```ts
import { registerGlobals } from "@livekit/react-native";

registerGlobals(); // required for LiveKit/WebRTC
// MapLibre needs no global token — the style URL carries everything.
```

Use `docs/PRODUCT.md`'s three registers to shape the folder layout from the start (§12 below) —
`src/features/{departure,motion,return,convoy}/` — rather than one flat `screens/` folder.

---

## 7. Talk to the Go server (built-in WebSocket)

The Go server verifies a Supabase JWT on every upgrade — never send it as a query parameter
(request logging captures URLs). Native RN `WebSocket` supports a `headers` option, which the
browser API never had:

```ts
// src/core/wsClient.ts
export function connectRide(
  code: string,
  name: string,
  riderId: string,
  supabaseJwt: string,
  onState: (s: any) => void
) {
  // Android emulator → host machine is 10.0.2.2; iOS sim → localhost;
  // physical device → your computer's LAN IP (e.g. 192.168.1.20)
  // riderId: a stable per-install id — presenting the same id on reconnect makes the
  // server replace the old connection instead of adding a ghost.
  const url = `ws://10.0.2.2:8080/ws?ride=${code}&name=${encodeURIComponent(name)}&rider=${encodeURIComponent(riderId)}`;
  const ws = new WebSocket(url, undefined, { headers: { Authorization: `Bearer ${supabaseJwt}` } });

  ws.onmessage = (e) => onState(JSON.parse(e.data));
  ws.onclose = () => setTimeout(() => connectRide(code, name, riderId, supabaseJwt, onState), 1500); // naive backoff

  const sendLoc = (lat: number, lng: number) =>
    ws.readyState === WebSocket.OPEN &&
    ws.send(JSON.stringify({ type: "loc", lat, lng, ts: Math.floor(Date.now() / 1000) }));

  return { ws, sendLoc };
}
```

## 8. Location (foreground + background)

```ts
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

// foreground stream
const { status } = await Location.requestForegroundPermissionsAsync();
if (status === "granted") {
  Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 5 },
    (loc) => sendLoc(loc.coords.latitude, loc.coords.longitude)
  );
}

// background (Phase 4): also request "Always", define a task, start updates
const LOCATION_TASK = "ride-location";
TaskManager.defineTask(LOCATION_TASK, ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as any;
  // forward locations[0].coords up the WebSocket
});
await Location.requestBackgroundPermissionsAsync();
await Location.startLocationUpdatesAsync(LOCATION_TASK, {
  accuracy: Location.Accuracy.High,
  timeInterval: 1000,
  foregroundService: { notificationTitle: "Sharing your ride location", notificationBody: "Tap to return" },
});
```

## 9. Map with rider markers — MapLibre + OpenFreeMap

```tsx
import { MapView, Camera, PointAnnotation, ShapeSource, LineLayer } from "@maplibre/maplibre-react-native";

const STYLE = "https://tiles.openfreemap.org/styles/liberty";

function RideMap({ riders, route }: { riders: Rider[]; route?: [number, number][] }) {
  return (
    <MapView style={{ flex: 1 }} mapStyle={STYLE}>
      <Camera followUserLocation followZoomLevel={14} />

      {route && (
        <ShapeSource id="route" shape={{ type: "Feature", geometry: { type: "LineString", coordinates: route } }}>
          <LineLayer id="routeLine" style={{ lineWidth: 4, lineColor: "#2b6cb0" }} />
        </ShapeSource>
      )}

      {riders.map((r) => (
        <PointAnnotation key={r.id} id={r.id} coordinate={[r.lng, r.lat]}>
          <RiderDot name={r.name} />
        </PointAnnotation>
      ))}
    </MapView>
  );
}
```
> Riders carry no `pos` — there is no ranking to render ([`ADR-009`](./ADR/ADR-009.md)). The
> MapLibre API is nearly identical to rnmapbox's, so most Mapbox RN snippets translate directly
> — swap the import and use a style URL instead of a token.

## 10. Directions — fetched via your backend (not the app)

The app never holds the ORS key. It asks the Go server, which calls OpenRouteService's
`driving-car` profile (the closest approximation ORS has — no motorcycle profile exists) and
returns the polyline:
```ts
// src/core/route.ts
export async function fetchRoute(code: string, waypoints: [number, number][]) {
  const res = await fetch(`http://10.0.2.2:8080/rides/${code}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ waypoints }), // [[lat,lng], ...]
  });
  const { polyline } = await res.json(); // [[lng,lat], ...] ready for MapLibre
  return polyline as [number, number][];
}
```
> MapLibre wants coordinates as `[lng, lat]`. Have the backend return them in that order (or
> flip them client-side) so the route line and ORS agree.

## 11. Push-to-talk voice — `@livekit/react-native` (Phase 3)

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
You stay subscribed to everyone else's audio automatically; only *your* mic toggles.

## 12. Suggested project structure

Feature-first, mirroring the three registers plus convoy (`CLAUDE.md`):
```
mobile/
  app.config.ts
  src/
    app/           _layout.tsx · index.tsx        # Expo Router (Known issue #2 — build this)
    core/          wsClient.ts · route.ts · models.ts · config.ts
    state/         useRide.ts                     # zustand store
    features/
      departure/   pre-ride checks, readiness
      motion/      map, convoy dots, PTT — the strictest register
      return/      journal, photos, stats (Supabase-backed)
      convoy/      join code, ride lifecycle
```

## 13. Run

```powershell
npx expo start --dev-client            # JS dev loop (after the dev build is installed)
# pick a target from the Expo dev menu / press a/i for android/ios
```

---

## (iOS, later)

Not removed, just deferred behind Android — see `PRODUCT.md`/`ADR-007` for why Android ships
first. When you pick it up:
- `eas build --profile development --platform ios` builds in the cloud; no Mac required for
  the build itself.
- A real iPhone needs a free Apple Developer account for on-device installs; the iOS
  Simulator needs a Mac, which EAS cloud builds don't give you.
- `UIBackgroundModes` and `NSMicrophoneUsageDescription` in `app.config.ts` are already in
  place for when you get here.

---

## Done when…
- **Phase 0:** the map renders (OpenFreeMap tiles) and shows your own moving dot.
- **Phase 1:** a second device on the same `?ride=` code appears as a second dot in real time.

---

### Notes / gotchas
- **Zero map cost / zero card.** OpenFreeMap tiles are free and keyless; the ORS key, LiveKit
  secret, and Supabase JWT secret live only on the backend.
- **Not Expo Go.** MapLibre and LiveKit need native code, so always run the **dev client**, not
  the Expo Go app.
- **Rebuild only for native changes.** Adding/upgrading a native package = rebuild the dev
  client. JS-only changes just hot-reload.
- **Windows = Android locally.** Build/run the Android dev client on your machine; use EAS
  cloud for iOS builds (a Mac is only needed for the iOS Simulator).
- **Emulator can't reach `localhost`.** The Android emulator reaches your host machine at
  `10.0.2.2`; a physical device needs your computer's LAN IP. `localhost` only works for the
  iOS simulator.
- **Background location is the hard part** on every framework — it's OS permissions, not RN.
- **Coordinate order:** MapLibre uses `[lng, lat]`; your `loc` messages use `lat`/`lng` fields.
  Keep the convention straight when drawing markers and routes.
- **No ranking anywhere.** A rider carries no position number and no distance-along-route
  metric — don't add one client-side either ([`ADR-009`](./ADR/ADR-009.md)).
