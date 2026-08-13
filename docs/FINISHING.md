# Finishing Horizon — from code-complete to two phones on a road

> **This document answers:** "Phases 0–4 are code-complete, nothing has run on a real
> device — what exactly remains, in what order, and how do I know each step worked?"
>
> `docs/SYSTEM_DESIGN.md` §11 is the roadmap that says *what* is built. This is the
> checklist that says *what it takes to prove it*. Each step is one verifiable feature
> milestone with a concrete exit condition. Nothing here builds a new feature; everything
> here gets the existing, untested code onto real hardware.
>
> **Scope:** Android only ([`ADR-007`](./ADR/ADR-007.md)). The Go backend deploys to a
> free-tier container host (Fly.io or Railway) using the existing `backend/Dockerfile`.
> iOS is deferred, exactly as every other document defers it.

---

## Part A — Foundation

Nothing in Part B can start until the environment is real. These four steps are the
prerequisites; they are also the steps most likely to fail on documentation drift rather
than on code, so each has a concrete exit condition.

### Step 0 · Housekeeping — commit the tree, reconcile the auth drift

Two things must be true before a single device test is worth anything: the working tree
must be committed, and the documentation must describe the auth the code actually runs.

**0.1 — Commit the working tree.**

The entire Phase 2–4 + Supabase-auth + Return work sits uncommitted in the working tree
(88 files). Commit it in logical chunks so the device-testing fixes that follow are
visible against a clean baseline. Suggested chunking, in order:

1. Backend: `backend/env.go`, `backend/env_test.go`, `backend/internal/auth/`, and the
   ES256-JWKS `main.go`/`main_test.go` changes.
2. Backend: `backend/voice.go`, `backend/voice_test.go` (LiveKit token minting).
3. Backend: geocoding + ORS changes.
4. Docs: `docs/ADR/ADR-012.md` through `ADR-022.md`, and the `docs/ADR/README.md` index.
5. Mobile core: `src/core/supabase.ts`, `api.ts`, `backgroundLocation.ts`, `rides.ts`,
   `photos.ts`, `riderName.ts`, `prefs.ts`, `voiceToken.ts`, `wsProtocol.ts`, `route.pure.ts`.
6. Mobile features: `src/features/departure/`, `src/features/motion/` (reroute, voice
   guidance, PushToTalk, EndRide), `src/features/convoy/useVoice.ts`, `RejoinLine.tsx`,
   `src/features/return/`.
7. Mobile screens: `src/app/plan/`, `src/app/return/`, plus the modified `index.tsx`,
   `ride/[code].tsx`, `_layout.tsx`.
8. `supabase/migrations/`.

**0.2 — Fix the auth docs-vs-code drift (concrete edits).**

The backend migrated from HS256 + `SUPABASE_JWT_SECRET` to **ES256-via-JWKS** — the
server now reads `SUPABASE_URL`, fetches the project's signing keys from
`<url>/auth/v1/.well-known/jwks.json`, and refuses to boot without that URL. The code,
`backend/.env.example`, and `docs/ADR/ADR-017.md` §8's recorded fork all agree; the
operational docs still describe the retired HS256 path. Anyone following them today
creates the wrong Supabase project config. Update these exact spots:

| File | What to change |
|------|----------------|
| `CLAUDE.md` §Architecture (≈:78) | "HS256, `SUPABASE_JWT_SECRET`" → "ES256 via the project's JWKS, `SUPABASE_URL`" |
| `CLAUDE.md` §Status (≈:113–114) | "legacy **HS256** JWT secret" → "the project's signing keys (JWKS)" and `SUPABASE_URL` (not `SUPABASE_JWT_SECRET`) |
| `README.md` "First ride" (≈:95–104) | Same correction: default **ES256** keys are now correct; server refuses to start without `SUPABASE_URL` |
| `docs/SETUP.md` §1 (≈:89–91) | Prereqs: default asymmetric keys, `SUPABASE_URL` |
| `docs/SYSTEM_DESIGN.md` (≈:94, :232) | Auth description + the secrets list |
| `docs/SETUP_BACKEND.md` (≈:325, :340, :634, :648) | Env template (`SUPABASE_URL`, no `SUPABASE_JWT_SECRET`), boot-log example, deploy notes |

ADRs are append-only — `ADR-008` and `ADR-017` are **not** edited. Add one line to the
`docs/ADR/README.md` index noting ADR-017 §8's ES256 fork was taken, pointing at
`backend/internal/auth/auth.go` as the implementation. `backend/.env.example` is already
correct; leave it.

✅ **Exit:** `git status` clean; docs and code agree on ES256/JWKS; `go vet ./...`,
`go test ./...`, `tsc --noEmit`, and `npm run check` all pass.

### Step 1 · Provision external services

| Service | Account | What Horizon needs | Cost |
|---------|---------|--------------------|------|
| Supabase | email signup | Project (default **ES256** keys — correct, do not switch to the legacy HS256 secret), **anonymous sign-ins enabled** (off by default), `supabase/migrations/` applied | free |
| OpenRouteService | email signup | API key (`driving-car` profile — ORS has no motorcycle profile) | free |
| LiveKit Cloud | email signup | Project keys + URL (only if voice is in the road test; see Step 9) | free |

Supabase specifics worth doing in this order:

1. Create the project.
2. **Enable anonymous sign-ins**: Authentication → Sign In / Providers → Anonymous.
   Off by default; `docs/ADR/ADR-016.md` §4 names this the single most likely first-launch
   failure. The app surfaces a specific message for it (`anonymous_provider_disabled`),
   but fixing it is a dashboard toggle, so catch it here.
3. Apply the migrations (`0001_return.sql`, `0002_storage.sql`) from the Supabase CLI or
   the SQL editor. They create `public.rides`, `public.ride_photos`, the private
   `ride-photos` Storage bucket, and all RLS policies.
4. Smoke-test the RLS boundary with the anon key: insert a `rides` row under a signed-in
   anonymous session, read it back, and confirm a second session cannot read it.

✅ **Exit:** anonymous sign-in works via the API; `rides` insert/select under RLS works;
`ride-photos` bucket accepts an upload under the `<uid>/…` path policy.

### Step 2 · Deploy the backend to a free-tier container host

Fly.io or Railway — either reads the existing multi-stage `backend/Dockerfile` (static
binary into `gcr.io/distroless/static-debian12:nonroot`). One instance; the server holds
rooms in memory and is stateless across restarts.

Environment variables to set on the host:

```
SUPABASE_URL=https://<project-ref>.supabase.co
ORS_API_KEY=<key>
LIVEKIT_URL=<if voice>
LIVEKIT_API_KEY=<if voice>
LIVEKIT_API_SECRET=<if voice>
ALLOWED_ORIGINS=<blank is fine for now — no browser client; set it before anything public>
PORT=<host-injected>
```

`LOG_LEVEL` stays unset (info) — **never `debug` on a deployed build**; it is the only
level at which rider coordinates may be logged.

Verify against the deployed host, not localhost:

```powershell
Invoke-RestMethod https://<host>/healthz                              # -> ok
Invoke-RestMethod -Method Post https://<host>/rides                   # -> { code : "ABC123" }
```

Then a `wss://` upgrade (Node 24 has a global `WebSocket`): reuse the smoke script from
`docs/SETUP_BACKEND.md` §9, swapping `ws://localhost:8080` for the deployed `wss://` host,
and sending `Authorization: Bearer <supabase-jwt>` via the `headers` option. A `welcome`
then a `state` frame = the pipe works over TLS.

✅ **Exit:** `/healthz` → `ok`, `POST /rides` → 6-char code, WS upgrade + `welcome` +
`state` over `wss://`, all authenticated.

### Step 3 · Point the app at reality (concrete edits)

The app learns where everything lives in exactly two places.

**`mobile/.env`** (copy from `.env.example`, gitignored):

```
EXPO_PUBLIC_HORIZON_API_URL=https://<deployed-host>
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key — deliberately public, ADR-016 §5>
```

**`mobile/eas.json`** — `build.preview.env.EXPO_PUBLIC_HORIZON_API_URL` currently points at
a dead quick tunnel (`https://rod-rankings-historical-investors.trycloudflare.com`).
Replace it with the deployed host. This value is **baked into every `preview` build at
bundle time** — a wrong or dead URL here is the "every rider reinstalls" trap the setup
docs warn about. EAS does not upload `.env`, so this one entry is the only way a `preview`
build learns the backend address.

Then build the dev client (`eas build --profile development --platform android`, or
`--local`) and install it. JS changes hot-reload after that; the dev client only rebuilds
when a native dependency changes.

✅ **Exit:** the dev client boots, Departure renders with no red screen, and the session
error path is clear if anonymous sign-ins are still off.

---

## Part B — Feature by feature, on a real device

Each step is independent, verifiable, and in a sensible dependency order. Skip none —
"code-complete" has never been "works on a phone." Each step names the failures the ADRs
predict for it.

### Step 4 · Departure — the toolchain end to end

What this proves: anonymous sign-in behind the splash, permission prompts, ride
start/join, and the code display all work on real hardware.

Do:
- Launch to the Departure screen. Confirm the splash holds until fonts + session resolve
  (`_layout.tsx`), then no session error.
- Enter a name, tap **Start a ride**. Confirm the permission dialogs (foreground, then
  background) appear **once**, in Departure, never mid-ride ([`ADR-021`](./ADR/ADR-021.md)
  §8). Deny background and confirm the flow still works.
- Confirm the 6-character code displays (alphabet excludes `O/0/I/1`), and the socket
  reaches `open` so **Start Riding** is enabled.
- Switch to **Join a ride**, type a made-up code → expect "That code wasn't found", not a
  hang. Type a real code → expect the connected state.
- Toggle **Spoken directions** off and back on.

✅ **Exit:** both flows reach `status === 'open'`; permissions asked once; error paths
surface real text; no red screen.

### Step 5 · Motion — your own moving dot (Phase 0)

What this proves: the one GPS subscription (`backgroundLocation.ts`, ADR-021 §1) drives
`ownFix`, which drives the dot, the speed readout, and the camera.

Do:
- Ride (or walk) with the Motion screen open. Confirm your dot moves on the map and the
  `motion.primary` speed readout changes.
- Before the first fix, confirm the ambient "Waiting for GPS…" line shows and then clears
  itself (the Confidence-pillar rule: say why something is missing).
- Kill the network (airplane mode). Your own dot and speedometer must keep moving —
  they read local GPS, not the server echo (`useRide.ts`'s `ownFix`).

⚠️ **Watch (ADR-021):** the foreground path now goes through the task, not
`watchPositionAsync`. If the dot or speed feels laggy on a real device, that is the exact
regression ADR-021 §1 predicted — measure it before assuming it's fine.

✅ **Exit:** dot tracks you live; speed is local (survives airplane mode); no second GPS
subscription exists anywhere (grep for `watchPositionAsync` — it should be gone).

### Step 6 · Two-phone convoy (Phase 1 — the whole product in miniature)

What this proves: the entire WebSocket spine — join by code, live `state` fan-out, JWT-
derived rider ids, `ageSec` greying, reconnect-replaces-not-duplicates.

Do (two phones, same ride code):
- Both dots move on both screens. Confirm no dot is ranked or ordered by anything but id.
- Turn one phone's network off. The other phone must grey that rider out within ~10 s
  (`ageSec`), never a live-looking stale dot.
- Turn the network back on. The rider must return as the **same** dot, not a second one
  (the JWT `sub` is the seat key — [`ADR-017`](./ADR/ADR-017.md) §6). Confirm the convoy
  roster never shows two of that rider.
- Force-stop the app mid-ride and relaunch. The self-connect path in `ride/[code].tsx`
  must rejoin the same room from the persisted ride code — not sit on a dead map.

✅ **Exit:** the three "Done when" checks from `docs/SETUP.md`: dots moving live, greying
in ~10 s, reconnect as one rider.

### Step 7 · Route, planner, turn cues (Phase 2 + the extras)

What this proves: the ORS route pipe, the two-tone amber line, ETA, the ambient maneuver
cue, the multi-stop planner, alternatives (pre-commit only), and destination search.

Do:
- From Motion, long-press the map. Confirm the route line draws and every rider in the
  room converges on the **same** line (it arrives as a WS `route` broadcast, not the HTTP
  response — `useRide.applyMessage`).
- Ride the route. Confirm the Ahead band shows the next maneuver (instruction, distance),
  and the ETA/summary is sane. Confirm the route line renders two-tone as you progress.
- Open the planner (`/plan/[code]`). Search a destination (geocoding), add a stop, then a
  second. Confirm alternatives appear for a single stop and are selectable **before**
  commit; the room stores exactly one route.
- Confirm the coordinate-order trap never bites: the route line, markers, and any
  `[lng, lat]` handling all agree (MapLibre/GeoJSON order; `loc`/`state` stay `lat/lng`).

⚠️ **Watch (ADR-013):** the room GC (5 min after last rider leaves) can 404 a
long-backgrounded planner at commit. That error path should surface text, not a hang.

✅ **Exit:** one line, same on both phones; alternatives chooseable pre-commit; turn cues
appear at the right time; destination search returns real places.

### Step 8 · Personal rerouting + spoken guidance

What this proves: a wrong turn reroutes **one** rider back without touching the convoy's
shared line, and spoken cues fire on distance, yielding to human speech by skipping
([`ADR-014`](./ADR/ADR-014.md), [`ADR-015`](./ADR/ADR-015.md), [`ADR-020`](./ADR/ADR-020.md)
§5).

Do:
- Drive off the route. After the trigger contract passes, confirm a personal `rejoin` line
  draws on **this device only**, with the shared route still visible, dimmed, underneath
  (`RejoinLine` over `RouteLine dimOnly`). The other phone's screen must not change.
- Confirm spoken guidance: cues timed by distance to the maneuver, not by corner detection.
- Hold the PTT band while a cue is due (needs a second rider, or at least a co-rider
  speaking). The cue must be **skipped and retried**, never delayed to fire inside the
  corner; the visual cue in the Ahead band is unaffected throughout.

✅ **Exit:** reroute is personal (one screen only); speech fires at the right distances;
a talking co-rider suppresses nav speech without queueing it.

### Step 9 · Push-to-talk voice (Phase 3)

What this proves: LiveKit join tokens, the invisible bottom-band control, always-
subscribed audio, and the no-UI-for-incoming-voice rule ([`ADR-020`](./ADR/ADR-020.md)).

Do (two phones):
- Confirm the PTT surface is the bottom band of the Motion screen and renders **nothing**
  at rest — no button, no icon. The only visual is the 2pt amber hairline while held.
- Hold to talk; confirm the other phone hears you. Release to mute.
- Kill one phone's network mid-call; confirm the LiveKit socket re-mints and reconnects
  (token TTL is 1 h, refreshed on `RoomEvent.Disconnected` — ADR-020 §4).
- Confirm nothing about who is speaking ever changes a pixel (no speaker list, no level
  meter — ADR-020 §1).
- If LiveKit env is unset on the backend, confirm **no PTT control renders at all** rather
  than a dead affordance (ADR-020 §6).

⚠️ **Watch (ADR-020):** the PTT band swallows map long-press in the bottom 42% of the
screen — destination-by-long-press is expected to be unreachable there; the planner is the
primary path. Confirm the planner still works so this regression is acceptable.

✅ **Exit:** two phones hold-to-talk reliably; reconnect survives a drop; zero voice UI;
no dead control when voice is unavailable.

### Step 10 · Background location + battery (Phase 4)

What this proves: the ride survives the screen going off, and the phone survives the ride
([`ADR-021`](./ADR/ADR-021.md)).

Do:
- Start a ride, turn the screen off (or background the app), and ride. Confirm the convoy
  keeps seeing you (no `ageSec` climb to grey) for the whole time the screen is off.
- Force-kill the app mid-ride, relaunch — the headless-rejoin path (persisted ride code +
  rider name) must reconnect as the same rider.
- End the ride. Confirm no persistent "Horizon is using your location" notification
  remains — the two independent stop paths (screen unmount + task self-stop) must both
  have fired (ADR-021 §6). A zombie service is the worst bug this feature can ship.
- Measure battery over a real, multi-hour ride. This is the heaviest state the app can
  run (high-accuracy GPS + keep-awake + continuously-subscribed WebRTC + foreground
  service) and it is **unmeasured** — the docs have flagged this since ADR-005.

⚠️ **Watch (ADR-021, the two named open risks):**
- Task delivery latency: if the speedometer/camera feel laggier in the foreground than
  `watchPositionAsync` did, reconsider the single-subscription rule.
- Background JS-timer throttling: the WS reconnect is `setTimeout`-driven. If a mid-ride
  drop while backgrounded never reconnects (rider goes silently stale), the fix is nudging
  reconnection from inside the location task, not a longer backoff.

✅ **Exit:** screen-off tracking holds for a real stretch; forced-kill rejoin works; no
zombie service; battery number recorded (it did not exist before).

### Step 11 · Return register

What this proves: the phone writes its own durable ride record to Supabase under RLS,
the archive + detail render, photos and journal work, delete cleans up, and the pending-
row guard survives a crash ([`ADR-018`](./ADR/ADR-018.md), [`ADR-019`](./ADR/ADR-019.md)).

Do:
- End a ride (hold the End Ride control after 5 s stopped). Confirm it lands in the
  archive with distance, moving/elapsed time, avg/max speed, and named companions — and
  that **no comparison to any other ride** is shown anywhere (ADR-019's one-`Ride`-props
  rule is enforced by `RideFacts`'s signature; a "longest" or lifetime figure appearing
  anywhere is a regression).
- Open the detail: the trace map, facts, and journal all render.
- Add a photo. Confirm it uploads to the private bucket and displays via a signed URL.
  Note its size on the Storage dashboard — photos, not tracks, are what fill the 1 GB free
  tier (ADR-018).
- Delete the ride. Confirm Storage objects are removed before the row (no orphaned
  objects).
- **Kill the app mid-ride** (not a clean end), then relaunch. Confirm the pending row
  flushes to Supabase automatically (`flushPendingRide` in `_layout.tsx`).

⚠️ **Watch (ADR-018):** a kill between deleting Storage objects and deleting the row
leaves an orphaned Storage object — invisible, costing bytes, accepted by the ADR. Only
act if it accumulates.

✅ **Exit:** a ride survives a crash; archive + detail + photo + journal + delete all work;
no banned aggregate anywhere in Return.

### Step 12 · Road test + preview build

The actual product moment: two phones, a real road, a `preview` build (not the dev
client).

Do:
1. Build the standalone APK: `eas build --profile preview --platform android`. Confirm
   `eas.json`'s baked-in URL is the **deployed** host (Step 3) before building — it cannot
   be changed after.
2. Install the `preview` APK on two phones. **The dev client needs Metro; `preview` does
   not** — this is the build a rider actually rides with.
3. Run the full `docs/SETUP.md` "Done when" checklist on the road:
   - both dots moving live on the shared ride code;
   - a long-press draws the same route on both phones;
   - network-off greys a rider out in ~10 s; network-on returns the **same** dot.
4. Use it like a rider: plan a route, ride it, take a wrong turn (reroute), talk over PTT,
   screen off for a long straight, end the ride and read the summary later.

✅ **Exit:** the "Done when" trio holds on two standalone `preview` builds over a real
road; a finished ride survives and reads back in Return.

---

## Done when

Every step 4–12 has its ✅ exit condition checked on real hardware — two phones, the
deployed backend, and at least one real road. At that point the "code-complete, unproven"
caveat that opens `CLAUDE.md`'s Status section is no longer true.
