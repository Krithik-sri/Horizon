# Mobile setup — React Native (Expo + dev client, TypeScript)

> Goal: an Expo/React Native app that renders a MapLibre map with free OpenFreeMap tiles,
> sends/receives location over the Go server's WebSocket, shows every rider as a dot +
> standings, and does push-to-talk voice via LiveKit.
>
> **No credit card needed.** The map uses MapLibre + OpenFreeMap (no key, no signup);
> directions come from OpenRouteService via your Go backend (free key, no card).
>
> **Read this first:** MapLibre and LiveKit both need native code, so you **cannot use the
> Expo Go app**. You'll use Expo with a *custom dev client* — same great Expo workflow, but
> you run your own dev build instead of the sandbox. It's mostly copy-paste config.

---

## How to use this guide

Run every command **from the repo root** (`C:\Data\projects\Horizon`) unless a step says
`cd mobile`. Commands are written for **PowerShell on Windows** (your shell). After each
numbered step there's a ✅ checkpoint — don't move on until it passes.

**Current state:** `mobile/` exists as an untouched `create-expo-app` default template
(expo-router layout) — none of the Horizon code below has been added yet, so step 1 is done
and you start at step 2. The **v1 client is the PWA** (`docs/SETUP_WEB.md`); pick this guide back
up when Phase 4 (true background GPS, screen off) becomes real. (The backend lives in
`backend/`; see `docs/SETUP_BACKEND.md`.)

**Windows note:** you can build and run the **Android** dev client locally. For **iOS** you'll
use **EAS cloud builds** (no Mac required for the build itself; a real iPhone still needs a
free Apple Developer account, and the iOS Simulator needs a Mac). Start with Android.

---

## 0. Prerequisites

Check what's already installed (you likely have all of these):

```powershell
node -v      # need 20+  (you have v24)
npm -v       # any recent (you have 11.x)
eas --version  # EAS CLI  (you have 20.x) — the `expo` commands come via `npx`
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
- Accounts (free, no card), **used by the backend, not the app** — you can set these up later
  when you do `docs/SETUP_BACKEND.md`:
  - **LiveKit Cloud** — project URL + API key/secret (for voice).
  - **OpenRouteService** — free API key (for directions).
  - The map needs **nothing**.

✅ **Checkpoint:** `eas whoami` prints your username, and `adb devices` lists a device once an
emulator/phone is connected.

---

## 1. Create the project

From the repo root:

```powershell
npx create-expo-app@latest mobile --template default   # TypeScript by default
cd mobile
npx expo install expo-dev-client                        # enables custom dev builds
```

✅ **Checkpoint:** a `mobile/` folder now exists with `package.json`, `app.json`, and an `app/`
directory. `npx expo start` would launch (Ctrl-C out — we can't use Expo Go anyway).

---

## 2. Add dependencies

Still inside `mobile/`. **PowerShell has no `\` line continuation** — run each `npx expo install`
on a single line (use a backtick `` ` `` at end-of-line only if you must wrap):

```powershell
# Map renderer (open-source Mapbox fork — no token, no card)
npx expo install @maplibre/maplibre-react-native

# Location (foreground + background)
npx expo install expo-location expo-task-manager

# Voice (LiveKit over WebRTC) — one line
npx expo install @livekit/react-native @livekit/react-native-webrtc @livekit/react-native-expo-plugin @config-plugins/react-native-webrtc livekit-client

# State (optional but handy)
npx expo install zustand
```

> The WebSocket client needs **no package** — React Native ships a global `WebSocket`.
> There is **no Mapbox token, no `.netrc`, no secret download token** — that whole step is gone.

✅ **Checkpoint:** `npm ls @maplibre/maplibre-react-native @livekit/react-native expo-location`
shows all three resolved with no `UNMET DEPENDENCY` errors.

---

## 3. Map tiles — OpenFreeMap (nothing to configure)

OpenFreeMap serves free MapLibre styles with no key, no signup, and no usage limits. Pick one:
- `https://tiles.openfreemap.org/styles/liberty`
- `https://tiles.openfreemap.org/styles/positron`
- `https://tiles.openfreemap.org/styles/bright`

That URL is the only "map config" you need. Attribution is added automatically by MapLibre.

---

## 4. Configure plugins & permissions — `app.config.ts`

`create-expo-app` gives you `app.json`. Rename it and convert to TypeScript:

```powershell
Remove-Item app.json
```

Then create `app.config.ts` (the `package`/`bundleIdentifier` is just a unique id — it doesn't
have to be a domain you own; change it before you ever publish if you like):

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
        "expo-location",
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

No map tokens anywhere. The only secrets in the project (LiveKit secret, ORS key) live on the
**Go backend**, never in the app.

✅ **Checkpoint:** `npx expo config --type prefab` prints merged config with your plugins listed
and no errors.

---

## 5. Build the dev client once, then iterate fast

From `mobile/`. Start with Android:

```powershell
eas build --profile development --platform android    # or: --platform ios
# add --local to build on your own machine instead of EAS cloud
```

The first run prompts you to create an `eas.json` and a `development` profile — accept the
defaults. Install the resulting build on your device/emulator, then for day-to-day work just run:

```powershell
npx expo start --dev-client
```

Rebuild the dev client only when you add/upgrade a **native** dependency. JS changes hot-reload.

✅ **Checkpoint:** the dev client app is installed on your emulator/phone and opens to the Expo
dev launcher screen.

---

## 6. Initialise the SDKs at app entry

In your root (e.g. `App.tsx` / `index.ts`):
```ts
import { registerGlobals } from "@livekit/react-native";

registerGlobals(); // required for LiveKit/WebRTC
// MapLibre needs no global token — the style URL carries everything.
```

## 7. Talk to the Go server (built-in WebSocket)

```ts
// src/core/wsClient.ts
export function connectRide(code: string, name: string, riderId: string, onState: (s: any) => void) {
  // Android emulator → host machine is 10.0.2.2; iOS sim → localhost;
  // physical device → your computer's LAN IP (e.g. 192.168.1.20)
  // riderId: a stable per-install id (e.g. UUID in AsyncStorage) — presenting the same
  // id on reconnect makes the server replace the old connection instead of adding a ghost.
  const url = `ws://10.0.2.2:8080/ws?ride=${code}&name=${encodeURIComponent(name)}&rider=${encodeURIComponent(riderId)}`;
  const ws = new WebSocket(url);

  ws.onmessage = (e) => onState(JSON.parse(e.data));
  ws.onclose = () => setTimeout(() => connectRide(code, name, riderId, onState), 1500); // naive backoff

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
          <RiderDot pos={r.pos} name={r.name} />
        </PointAnnotation>
      ))}
    </MapView>
  );
}
```
> The MapLibre API is nearly identical to rnmapbox's, so most map snippets you find online for
> Mapbox RN translate directly — just swap the import and use a style URL instead of a token.

## 10. Directions — fetched via your backend (not the app)

The app never holds the ORS key. It asks the Go server, which calls OpenRouteService and
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

```
mobile/
  app.config.ts
  App.tsx                 # registerGlobals() + navigation
  src/
    core/      wsClient.ts · route.ts · models.ts · config.ts
    state/     useRide.ts            # zustand store (riders, standings)
    features/
      ride/    join + ride lifecycle
      map/     RideMap.tsx · RiderDot.tsx
      location/ tracker.ts
      voice/   Voice.tsx · PttButton.tsx
      standings/ Standings.tsx       # 1st/2nd/3rd UI
```

## 13. Run

```powershell
npx expo start --dev-client            # JS dev loop (after the dev build is installed)
# pick a target from the Expo dev menu / press a/i for android/ios
```

---

## Done when…
- **Phase 0:** the map renders (OpenFreeMap tiles) and shows your own moving dot.
- **Phase 1:** a second device on the same `?ride=` code appears as a second dot in real time.

---

### Notes / gotchas
- **Zero map cost / zero card.** OpenFreeMap tiles are free and keyless; the ORS key and LiveKit secret live only on the backend.
- **Not Expo Go.** MapLibre and LiveKit need native code, so always run the **dev client**, not the Expo Go app.
- **Rebuild only for native changes.** Adding/upgrading a native package = rebuild the dev client. JS-only changes just hot-reload.
- **Windows = Android locally.** Build/run the Android dev client on your machine; use EAS cloud for iOS builds (a Mac is only needed for the iOS Simulator).
- **Emulator can't reach `localhost`.** The Android emulator reaches your host machine at `10.0.2.2`, a physical device needs your computer's LAN IP. `localhost` only works for the iOS simulator.
- **Background location is the hard part** on every framework — it's OS permissions, not RN. If `expo-location` background tracking proves flaky for your rides, `react-native-background-geolocation` is the more robust (partly paid) option.
- **Coordinate order:** MapLibre uses `[lng, lat]`; your `loc` messages use `lat`/`lng` fields. Keep the convention straight when drawing markers and routes.
