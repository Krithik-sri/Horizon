# Project Board — Horizon

> The live task board. **What we're building right now, what's queued, and what's broken.**
>
> For *how* to build it see [`docs/DEVELOPMENT_GUIDE.md`](./DEVELOPMENT_GUIDE.md). For *why* the
> architecture is what it is see [`docs/ADR/`](./ADR/). For the long view see
> [`docs/ROADMAP.md`](./ROADMAP.md). For the full analysis behind every item here, see
> [`docs/ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md).

| | |
|---|---|
| **Last updated** | 2026-07-28 |
| **Repo state** | branch `main`, clean tree, HEAD `56a8482` |
| **Branches in flight** | none — `main` only |
| **Current milestone** | [M1 — Stable Realtime Platform](./ROADMAP.md#milestone-1--stable-realtime-platform) |
| **Feature tally** | 30 complete · 9 partial · 42 missing · 4 blocked |
| **Automated tests** | 0 |

## Board conventions

- **Task ids** are `HZ-<n>`, assigned in order and never reused. Reference them in branch PRs and
  commit footers (`Refs: HZ-3`).
- **Status:** `Todo` → `In Progress` → `In Review` → `Blocked` → `Done`.
- **Priority:** `Critical` (blocks other work or breaks a shipped path) · `High` (needed this
  milestone) · `Medium` (needed eventually, no one is blocked) · `Low` (nice to have).
- **Complexity:** `XS` <1h · `S` a few hours · `M` a day · `L` several days · `XL` needs splitting.
- **Sections don't duplicate.** *Current Sprint* holds execution plans. *Known Bugs* is the defect
  registry — symptom, root cause, blast radius — and points at the sprint or backlog id that fixes
  it. *Product Backlog* is unscheduled new capability. *Technical Debt* is work on existing code that
  adds no capability.

---

# Current Sprint

## Sprint 01 — Unbreak the Core Pipe

**Goal:** make the three things that already claim to work actually work, then make the foundation
testable. `README.md` marks Phases 0 and 1 ✅, but three defects mean the core pipe is not solid —
and every later feature compounds on top of it.

**Exit criterion:** a rider can create a ride from the browser, two riders can ride through a dead
zone and come back as two riders (not four), the server survives an idle night without leaking, and
`go test ./...` runs something real.

---

### HZ-1 · Add CORS middleware to the Go backend

| | |
|---|---|
| **Priority** | 🔴 Critical |
| **Branch** | `bugfix/cors-preflight-middleware` |
| **Dependencies** | none — **do this first** |
| **Complexity** | S |
| **Status** | Todo |

**Why first.** `POST /rides` has no `Access-Control-Allow-Origin` header. In dev the page is at
`:5173` and the API at `:8080`, so the browser blocks the response, the promise rejects, and the
lobby renders *"Couldn't reach the server. Is the backend running?"* — while the server is running
fine and has already minted a code. **"Start a ride" does not work.** Every subsequent manual test
goes through that button.

It hides well: WebSocket handshakes are exempt from CORS and any string creates a room, so you can
test the whole pipe via "Join" and never notice. It also self-masks in production behind a single
reverse proxy, then breaks again on every dev machine.

**Files expected**
- `backend/main.go` — wrap the mux in a CORS middleware; register an `OPTIONS` handler
- `backend/internal/httpx/middleware.go` *(new, optional)* — if it grows past a few lines
- `backend/.env.example` — add `ALLOWED_ORIGINS`
- `docs/SETUP_BACKEND.md` — document the new variable

**Acceptance criteria**
- [ ] `POST /rides` from `http://localhost:5173` succeeds and the code reaches the UI
- [ ] An `OPTIONS` preflight returns 204 with allow-origin, -methods, and -headers
- [ ] Preflighted `Content-Type: application/json` requests pass (Phase 2/3 need this)
- [ ] Allowed origins come from env, defaulting to permissive **in dev only**
- [ ] Middleware wraps the whole mux, so `/ws` and future endpoints inherit it

**Notes.** A Vite `server.proxy` would fix dev only. The middleware is the right fix because the
mobile client and any split-origin deployment need it too.

---

### HZ-2 · Evict the zombie connection on rejoin (ghost rider)

| | |
|---|---|
| **Priority** | 🔴 Critical |
| **Branch** | `bugfix/ghost-rider-rejoin-eviction` |
| **Dependencies** | none (do alongside HZ-3 — same edit surface) |
| **Complexity** | S |
| **Status** | Todo |

**Why.** `room.go:58-69` carries a `TODO(rejoin)` that describes exactly what to do and then does
none of it — `r.rider[c] = true` just adds. Every dead-zone reconnect seats a *second* client with
the *same* rider id, and the zombie survives until its 60 s read deadline expires. Mobile networks
drop constantly on real rides, so this fires often. See [BUG-01](#bug-01--ghost-rider).

**Files expected**
- `backend/internal/hub/room.go` — the `register` case
- `backend/internal/hub/room_test.go` *(new)* — rejoin leaves exactly one client
- `backend/internal/hub/client.go` — only if carrying the last fix needs a helper

**Acceptance criteria**
- [ ] Registering a client whose id matches an existing one deletes the old entry and closes its
      `send` channel, under the existing write lock
- [ ] `lat`/`lng`/`speed`/`lastSeen` carry across, so the dot unfreezes rather than vanishing
- [ ] The `state` payload contains exactly one entry per rider id, always
- [ ] The old connection's pumps exit cleanly; no `send on closed channel` panic
- [ ] `go test -race ./...` clean
- [ ] Manual: two windows, kill and restore one client's network → one rider, not two

**Watch for.** The `delete`-before-`close(send)` ordering is what makes the broadcast's non-blocking
send safe. Preserve it, and add a comment saying so — it is currently correct but undocumented.

---

### HZ-3 · Room garbage collection + join-code registry

| | |
|---|---|
| **Priority** | 🔴 Critical |
| **Branch** | `bugfix/room-gc-and-code-registry` |
| **Dependencies** | HZ-2 (same files; land HZ-2 first to keep diffs reviewable) |
| **Complexity** | M |
| **Status** | Todo |

**Why.** `hub.go:29` carries `TODO(later)`. A room, once created, is never destroyed: it keeps a map
entry, a goroutine, and a 250 ms ticker that marshals `{"riders":[]}` and sends it to nobody, 4×/s,
forever. And because **any** `?ride=` string creates a room, this is an unauthenticated unbounded
resource-allocation primitive. Memory leak, CPU leak, and trivial DoS — all fixed by the same two
changes. See [BUG-03](#bug-03--room-goroutine--memory-leak) and
[BUG-04](#bug-04--unauthenticated-unbounded-room-creation).

**Files expected**
- `backend/internal/hub/hub.go` — record minted codes in `CreateRide`; reject unknown codes in
  `ServeWS`; delete rooms on shutdown
- `backend/internal/hub/room.go` — stop the ticker and return from `run()` when the last rider leaves
- `backend/internal/hub/hub_test.go` *(new)* — creation, rejection, GC, and the join-during-teardown race
- `web/src/App.tsx` — surface the new "unknown code" error *(coordinate with HZ-9)*

**Acceptance criteria**
- [ ] `CreateRide()` registers the code; `/ws` with an unminted code returns 404 and creates nothing
- [ ] The last rider leaving stops the ticker, ends the goroutine, and removes the room from `h.rooms`
- [ ] A rider joining between the emptiness check and the delete is not lost — re-check under `h.mu`
- [ ] Codes have a TTL (suggest 24 h) so minted-but-unused codes don't accumulate
- [ ] Goroutine count returns to baseline after a ride ends
- [ ] `go test -race ./...` clean

**Watch for.** The join-during-teardown race is the whole difficulty. Do the emptiness check and the
map delete under `h.mu` with a re-check, not under `r.mu`.

---

### HZ-4 · Fix mobile config drift

| | |
|---|---|
| **Priority** | 🟠 High |
| **Branch** | `bugfix/mobile-expo-location-dep` |
| **Dependencies** | none |
| **Complexity** | XS |
| **Status** | Todo |

**Why.** `app.config.ts:19` lists the `expo-location` plugin; `mobile/package.json` doesn't have the
package — nor `expo-task-manager`. `npx expo config`, `prebuild`, and `eas build` will all fail to
resolve it. The missing `scheme` compounds it: expo-router and expo-dev-client need one for deep
linking, and `version`/`icon`/`splash` were lost when `app.json` was deleted.

**Do it now precisely because it isn't urgent yet** — it's a five-minute fix that otherwise gets
discovered under pressure at the start of Milestone 4.

**Files expected**
- `mobile/package.json`, `mobile/package-lock.json` — `npx expo install expo-location expo-task-manager`
- `mobile/app.config.ts` — add `scheme: "horizon"`, `version`, `orientation`, `icon`, `splash`,
  `userInterfaceStyle`

**Acceptance criteria**
- [ ] `npx expo config --type public` resolves without error
- [ ] `expo-location` and `expo-task-manager` are in dependencies at Expo-56-compatible versions
- [ ] `scheme` is set and deep links resolve
- [ ] `icon` and `splash` point at files that exist in `mobile/assets/`
- [ ] `npx expo-doctor` reports no new issues

---

### HZ-5 · Structured server logging

| | |
|---|---|
| **Priority** | 🟠 High |
| **Branch** | `feature/backend-structured-logging` |
| **Dependencies** | HZ-2, HZ-3 (log the lifecycle events they add) |
| **Complexity** | S |
| **Status** | Todo |

**Why.** The backend emits exactly one `log.Printf`, at startup. When a rider says *"I vanished from
the map halfway up the climb"*, there is no data to distinguish GPS loss, wake-lock refusal, socket
drop, a dropped frame, or ghost-rider confusion. **This must land before Milestone 2** — you cannot
debug standings from a moving bicycle.

**Files expected**
- `backend/main.go` — `slog` setup, level from env, request-logging middleware
- `backend/internal/hub/hub.go`, `room.go`, `client.go` — lifecycle events
- `backend/.env.example` — `LOG_LEVEL`

**Acceptance criteria**
- [ ] `log/slog` with JSON output; level from `LOG_LEVEL`, default info
- [ ] Logged at info: connect, disconnect (with reason), room create, room destroy, rejoin eviction
- [ ] Logged at warn: dropped frame (rate-limited), malformed message, unknown ride code
- [ ] Every line carries `ride` and `rider` as fields
- [ ] **No coordinates at info level** — debug only, never in a deployed build (P8/P9)
- [ ] Zero third-party logging dependencies

---

### HZ-6 · Unit tests for `internal/standings`

| | |
|---|---|
| **Priority** | 🟠 High |
| **Branch** | `feature/standings-unit-tests` |
| **Dependencies** | none — but land **before** HZ-10 |
| **Complexity** | S |
| **Status** | Todo |

**Why.** `standings.go` is 66 lines of pure math with no I/O and zero tests — the highest-value,
lowest-effort test target in the repo. It is also exactly the code whose bugs (non-monotonic
projection, wrong distances) are hardest to spot by eye on a map. Writing these *before* the route
endpoint gives that endpoint something to validate against.

**Files expected**
- `backend/internal/standings/standings_test.go` *(new)* — the first test file in the repository

**Acceptance criteria**
- [ ] `Haversine` against known great-circle distances, within 0.5% tolerance
- [ ] `projectOntoSegment` including the `t` clamp at both ends and a point beyond each endpoint
- [ ] `DistAlongRoute` on a straight line, an L-bend, and a rider exactly on a vertex
- [ ] An out-and-back case documented and `t.Skip`-ped with a reference to HZ-13, so the known
      non-monotonicity is recorded in code rather than folklore
- [ ] Table-driven, tolerance-based (never exact float equality)
- [ ] `go test ./...` passes; `go test -cover` reports >90% for this package

---

## Sprint 01 summary

| Id | Task | Priority | Complexity | Status |
|---|---|---|---|---|
| HZ-1 | CORS middleware | 🔴 Critical | S | Todo |
| HZ-2 | Ghost-rider rejoin eviction | 🔴 Critical | S | Todo |
| HZ-3 | Room GC + code registry | 🔴 Critical | M | Todo |
| HZ-4 | Mobile config drift | 🟠 High | XS | Todo |
| HZ-5 | Structured logging | 🟠 High | S | Todo |
| HZ-6 | `standings` unit tests | 🟠 High | S | Todo |

**Suggested order:** HZ-1 → HZ-2 → HZ-3 → HZ-5 → HZ-6, with HZ-4 dropped in whenever there's a gap.

---

# Product Backlog

Unscheduled **new capability**. Work on existing code lives under [Technical Debt](#technical-debt).

## 🔴 Critical

### HZ-7 · Deploy: Koyeb + Cloudflare Tunnel, HTTPS and `wss://`
Milestone 1 · Complexity **M** · Branch `feature/deploy-koyeb-tunnel` · Depends on HZ-1

The plan is already written (`docs/SETUP_BACKEND.md` §"Deployment later"). **This must come before
Milestone 2, not after** — geolocation, wake lock, PWA install, *and* WebRTC all require a secure
context. Until the app is on HTTPS, every feature is validated in two desk tabs instead of on two
phones. Includes replacing `CheckOrigin: return true` with a real allowlist and enforcing `wss://`.

### HZ-8 · First real two-phone road test
Milestone 1 · Complexity **M** · Depends on HZ-7, HZ-2

**A development step, not a QA step.** Take the current build outside and ride with it. It will
produce a priority list — GPS accuracy in traffic, wake-lock behaviour on the actual phones, tunnel
reconnection, battery over an hour — that no amount of desk reasoning will. Everything downstream
gets re-prioritized against what this reveals. Run the real-world checklist in
`docs/DEVELOPMENT_GUIDE.md` §9 and file every observation as a task.

## 🟠 High

### HZ-9 · Ride persistence + shareable join URL
Milestone 1 · Complexity **M** · Branch `feature/ride-url-persistence`

Put the code in the URL (`pushState` or a hash fragment), persist `code` and `name` in
sessionStorage, rehydrate on load. Today a reload ejects you to the lobby mid-ride, and sharing a
ride means reading six characters aloud. Also makes `net/identity.ts`'s sessionStorage rationale
("survives a page reload mid-ride") actually true — the rider *id* survives today, but there's no
ride to survive into. **Placed after HZ-8 because the road test is what makes its absence painful.**
A full router is overkill for two screens; `pushState`/`popstate` is enough.

### HZ-10 · `POST /rides/{code}/route` — ORS cycling proxy
Milestone 2 · Complexity **L** · Branch `feature/route-ors-proxy` · Depends on HZ-6

The first Phase 2 endpoint. Reads `ORS_API_KEY` from env, calls the cycling profile, decodes the
geometry to `[]standings.Pt`, stores it on the room **under `r.mu.Lock()`**, and returns the polyline
as `[lng, lat]` so MapLibre can consume it directly. Enforce once-per-ride to protect the free quota.
Give ORS its own package so it can be stubbed in tests without a socket.

**Bundle three things into this one change**, because retrofitting them means re-validating standings
twice: (1) the endpoint, (2) cumulative segment-length precompute (HZ-11), (3) moving `distAlong` out
of the read lock (HZ-12).

### HZ-11 · Precompute cumulative segment lengths
Milestone 2 · Complexity **S** · Ships **with** HZ-10 · See [DEBT-H2](#-high-1)

### HZ-12 · Move `distAlong` computation out of `r.mu.RLock()`
Milestone 2 · Complexity **S** · Ships **with** HZ-10 · See [DEBT-H3](#-high-1)

### HZ-13 · Windowed monotonic projection + off-route detection
Milestone 2 · Complexity **L** · Branch `feature/standings-monotonic-projection` · Depends on HZ-14

Nearest-segment snapping is non-monotonic: a rider on the return leg of an out-and-back can snap to
the outbound leg and appear to lose kilometres (`standings.go:50-52` documents the fix). Requires
per-rider state that doesn't exist — add `lastDistAlong` to `Client` and constrain the segment search
to a window around it. In the same change, stop discarding `bestDist`: it is already computed and is
the natural "rider has left the route" signal. **After HZ-14**, because you need a route drawn on
screen to see the fix working.

### HZ-14 · Web: route line layer + route fetch + destination picker
Milestone 2 · Complexity **L** · Branch `feature/web-route-line-layer` · Depends on HZ-10

GeoJSON source + `LineLayer` in `Map.tsx` (the `[lng, lat]` boundary stays there), `setRoute()` in
`net/api.ts`, route state in the store, and a minimal way to choose a destination. **Keep the picker
deliberately crude** — a friend group can paste coordinates at first; a long-press handler is the
next increment.

### HZ-15 · `POST /rides/{code}/voice-token` — LiveKit JWT minting
Milestone 3 · Complexity **M** · Branch `feature/voice-token-endpoint` · Depends on HZ-7

LiveKit Go SDK, room name = ride code, identity = rider id, short TTL, `{token, url}` response. First
new backend dependency since `gorilla/websocket` — needs an ADR amendment or a note referencing
[ADR-005](./ADR/ADR-005.md). Inherits every auth weakness in the system, but now with a
cryptographically signed credential to an external service: keep the TTL short and validate the ride
code against the registry from HZ-3.

### HZ-16 · Web voice + push-to-talk
Milestone 3 · Complexity **L** · Branch `feature/web-voice-ptt` · Depends on HZ-15

`npm install livekit-client`, connect with `audio: false`, mic on press / off on release, always
subscribed to others. **iOS gotcha:** audio must be started from a user gesture, so gate the
connection behind an explicit "Join voice" tap. Voice state goes in the zustand store.

### HZ-17 · Port the shared core to `mobile/`
Milestone 4 · Complexity **XL — split before starting** · Branch `feature/mobile-core-port`
Depends on HZ-4, HZ-18

In dependency order: types → store → socket → config/identity (AsyncStorage) → location → map →
standings UI. `types.ts` and the zustand store copy over unchanged; `ws.ts` needs only the identity
backend swapped. Delete the template scaffolding first.

### HZ-18 · ADR: mobile directory layout, `features/` vs flat
Milestone 4 · Complexity **XS** · Branch `docs/adr-mobile-directory-layout`

`docs/SYSTEM_DESIGN.md` §5.1 and `docs/SETUP_MOBILE.md` §12 prescribe a `features/` layout; `web/` uses a
flatter one. **Decide before the port starts** — unresolved, this yields two conventions in one repo.
Recommendation: copy `web/`'s flat structure, because it is proven.

### HZ-19 · ADR + implementation: background location task ↔ WebSocket ownership
Milestone 4 · Complexity **XL** · Depends on HZ-17

**The hardest unsolved design question in the project.** An `expo-task-manager` background task runs
in a *separate JS context* and cannot reuse the React-owned WebSocket. Either the socket moves
outside React and becomes reachable from the task, or fixes are queued and handed off.
`docs/SETUP_MOBILE.md:249` glosses over this. Decide in an ADR **before** writing code.

## 🟡 Medium

| Id | Task | Milestone | Cx | Notes |
|---|---|---|---|---|
| HZ-20 | Standings hysteresis | M2 | S | Require a margin or a sustained lead before swapping positions, so GPS jitter doesn't flicker 1st/2nd at 4 Hz. **Last in M2** — you can't tune the threshold until you've watched real standings on a real ride. |
| HZ-21 | Geolocation-denied error UX | M1 | S | `useGeo.ts:35` logs to console and stops. A denied permission shows "Waiting for a GPS fix…" forever. Needs store state + an actionable UI. See [BUG-05](#bug-05--geolocation-denial-is-invisible). |
| HZ-22 | Wake-lock status indicator | M1 | S | `useWakeLock.ts:18` swallows refusals silently. Show whether the lock is held; warn if refused. See [BUG-06](#bug-06--wake-lock-refusal-is-invisible). |
| HZ-23 | Follow-camera + recentre button | M1 | S | One `easeTo` at first fix and never again. Ride 2 km and you're off-screen with no way back. Add follow mode, a recentre control, and fit-bounds-to-group. |
| HZ-24 | Add `heading` to the `state` payload | M2 | S | Ingested and discarded today. Unblocks heading arrows on markers. Protocol change — all three implementations plus `CLAUDE.md`, same PR (P4). |
| HZ-25 | Add `accuracy` to the protocol | M2 | M | `GeolocationCoordinates.accuracy` is available and thrown away. A ±500 m urban-canyon fix currently feeds the standings projection as if it were exact. Add the field, then use it to weight or reject fixes. |
| HZ-26 | GPS outlier rejection / smoothing | M2 | M | One wild fix teleports a dot and, post-M2, can reorder the whole standings. Depends on HZ-25. |
| HZ-27 | Marker position interpolation | M1 | S | Dots teleport every 250 ms. Interpolating between fixes reads dramatically smoother for ~20 lines. |
| HZ-28 | Runtime message validation | M1 | S | `ServerMsg` is compile-time only. A malformed `state` whose `riders` isn't an array crashes the render. Hand-write the guard — don't add zod (P5). |
| HZ-29 | Tile runtime caching | M1 | S | Only the app shell is precached; offline shows a blank map. A Workbox `CacheFirst` rule for tiles is both useful and polite to a donation-funded service. |
| HZ-30 | Service-worker update prompt | M1 | S | `registerType: "autoUpdate"` swaps versions silently — mid-ride. Prompt instead. |
| HZ-31 | Rate limits and caps | M1 | M | No max riders per room, no max rooms, no connection cap, no message-rate limit. A client can send `loc` in a tight loop, each taking the room-wide write lock. |
| HZ-32 | Graceful shutdown + `http.Server` timeouts | M1 | S | `ListenAndServe` leaves `ReadHeaderTimeout`/`IdleTimeout` unset. Add a real `http.Server` and drain on SIGTERM. |
| HZ-33 | Panic recovery middleware | M1 | XS | One panic in one handler kills the process and destroys every in-progress ride, since all state is in memory. |
| HZ-34 | Ride metadata on `POST /rides` | M2 | S | The body is ignored; `docs/SYSTEM_DESIGN.md:245` specifies `{"name":"Sunday loop"}`. Either honour it or remove it from the spec. |
| HZ-35 | Route survives a server restart | M2 | M | Rider positions repopulate in seconds; a route does not — it's server-only state no client re-POSTs. Cheapest fix: have the client cache the route and re-POST on reconnect. |
| HZ-36 | Native voice | M4 | L | `registerGlobals()`, `AudioSession.startAudioSession()`, `LiveKitRoom` + PTT. |
| HZ-37 | Battery tuning | M4/M5 | L | Adaptive GPS rate when stationary, map dimming when idle, measured with voice on. |

## 🟢 Low

| Id | Task | Cx | Notes |
|---|---|---|---|
| HZ-38 | Heading arrows on markers | S | 🚫 Blocked on HZ-24. |
| HZ-39 | Reconnect backoff jitter | XS | All riders retry in lockstep after a restart. Harmless at 15 riders; a one-line fix. |
| HZ-40 | Refresh the read deadline on data frames | XS | Only pongs refresh it, so a chatty client with lost pongs still dies at 60 s. |
| HZ-41 | Offline fallback page | S | No `navigateFallback` customization. |
| HZ-42 | Fix the maskable icon safe zone | XS | `gen-icons.mjs:33-46` draws to 87% of the canvas; Android's adaptive mask crops it. Redraw inside the 80% safe zone or generate a separate maskable icon. |
| HZ-43 | Queue GPS fixes during reconnect | M | `sendLoc` silently no-ops when the socket isn't open. A small ring buffer would preserve the gap — but verify it's worth it after HZ-8. |
| HZ-44 | Metrics endpoint | M | Prometheus-style connection / room / message counters. `docs/SYSTEM_DESIGN.md` §9 scaling path. |
| HZ-45 | Per-rider visibility control | M | No way to go temporarily invisible during a ride. Privacy feature; see [RISK-S4](#security). |

---

# Technical Debt

Work on **existing** code that adds no new capability. Each item is a real finding from
`docs/ARCHITECTURE_REVIEW.md` §7.

## 🔴 Critical

All three critical debt items are scheduled in Sprint 01 and registered as bugs — see
[HZ-1](#hz-1--add-cors-middleware-to-the-go-backend), [HZ-2](#hz-2--evict-the-zombie-connection-on-rejoin-ghost-rider),
[HZ-3](#hz-3--room-garbage-collection--join-code-registry). Nothing else is Critical.

## 🟠 High

| Id | Item | Fixed by | Cx |
|---|---|---|---|
| **DEBT-H1** | **Standings are non-functional and silently plausible.** `Room.route` is never written (no setter, endpoint 501), so `hasRoute` is permanently false, `distAlong` is permanently `0`, and `pos` is **alphabetical order by rider id**. The UI renders a confident "1 / 2 / 3" that means nothing. Failure mode is a *wrong* answer, not a missing one. | HZ-10 + HZ-14 | L |
| **DEBT-H2** | **`DistAlongRoute` recomputes every segment length on every call** — three haversines per segment per rider per tick. At 15 riders × 4 Hz × a 3000-point ORS route that's ≈540k haversine evaluations/sec, each with ~4 transcendental calls. Precomputing cumulative lengths when the route is set removes two-thirds immediately. **Lands the moment Milestone 2 ships.** | HZ-11 | S |
| **DEBT-H3** | **Heavy `distAlong` math runs inside `r.mu.RLock()`** (`room.go:97`), directly blocking `loc` ingest for the whole room. Snapshot under the lock, compute after releasing. One-line restructure now; a subtle regression risk later. | HZ-12 | S |
| **DEBT-H4** | **Zero automated tests anywhere.** Every change is verified by running the app by hand. | HZ-6, then incrementally | M |
| **DEBT-H5** | **No observability.** One startup log line. | HZ-5 | S |
| **DEBT-H6** | **No panic recovery, no graceful shutdown, no server timeouts.** | HZ-32, HZ-33 | S |
| **DEBT-H7** | **Three independent copies of the wire protocol** — Go structs, `web/src/types.ts`, and soon mobile — with no shared schema and no conformance test. `heading` has already drifted. Needs a golden-fixture test both sides parse. | new task at M4 planning | M |

## 🟡 Medium

| Id | Item | Cx |
|---|---|---|
| **DEBT-M1** | **`math/rand` for join codes and rider ids** (`hub.go:101,108`) — predictable tokens. Switch to `crypto/rand`. The 32⁶ ≈ 1.07 B space is fine against blind guessing, but it matters the moment codes become meaningful (i.e. after HZ-3). Branch `refactor/crypto-rand-tokens`. |
| **DEBT-M2** | **Ranking logic lives in `room.broadcast()`** (`room.go:104-111`), not `standings` — domain logic embedded in transport code, which is also why it can't be unit-tested without a `Room`. Branch `refactor/ranking-into-standings`. |
| **DEBT-M3** | **`heading` and `ts` are dead protocol fields** — defined, transmitted, parsed, discarded. Either use them (HZ-24) or remove them. As-is they mislead every future reader. |
| **DEBT-M4** | **No ESLint or Prettier for TypeScript.** `CLAUDE.md` mandates `go fmt` + `go vet` for Go and nothing for the clients. Branch `feature/eslint-config`. |
| **DEBT-M5** | **No CI.** Nothing enforces `go vet`, `go test`, `tsc -b`, or formatting. Branch `feature/ci-pipeline`. Cheap and high-leverage once HZ-6 gives it something to run. |
| **DEBT-M6** | **Setup docs embed full copies of source files** and have already drifted — `docs/SETUP_BACKEND.md:308-313` describes the rejoin TODO differently from `room.go:58-69`. Every backend edit needs a doc edit or the docs actively mislead. Should trend toward *pointing at* files rather than copying them. Branch `docs/setup-guides-point-not-copy`. |
| **DEBT-M7** | **`web/tsconfig.app.tsbuildinfo` and `tsconfig.node.tsbuildinfo` are tracked in git** and absent from `web/.gitignore`. Pure diff noise on every build. Branch `bugfix/untrack-tsbuildinfo`. XS. |
| **DEBT-M8** | **The concurrency invariants are undocumented.** The `delete`-before-`close(send)` ordering and the fact that `Room.mu` guards per-`Client` fields are both correct and both uncommented — one careless refactor from a panic that kills every ride. Fix as a comment-only PR alongside HZ-2. |

## 🟢 Low

| Id | Item |
|---|---|
| **DEBT-L1** | `Hub.mu` is an `RWMutex` used only via `Lock()` — `RLock` is never called, so the `RW` is decorative and misleading. |
| **DEBT-L2** | Unchecked `w.Write` / `json.Encode` errors (`main.go:18,44`). |
| **DEBT-L3** | `useRideSocket`'s effect depends on `[name]`, so a future "change name" feature would silently tear down and rebuild the socket. |
| **DEBT-L4** | `devOptions.enabled: true` runs the service worker in `vite dev` — a well-known source of stale-asset confusion. |
| **DEBT-L5** | `broadcast()` marshals and sends `{"riders":[]}` to nobody 4×/s for every empty room. Subsumed by HZ-3. |
| **DEBT-L6** | Mobile template cruft to delete: `explore.tsx`, `web-badge`, `animated-icon`, `hint-row`, `collapsible`, `reset-project.js`, tutorial images. Folded into HZ-17. |
| **DEBT-L7** | Setup docs reference `C:\Data\Projects\Horizon`; the repo lives at `E:\Project Horizon\Horizon`. |
| **DEBT-L8** | `heading ?? 0` and `speed ?? 0` conflate "unavailable" with "due north" and "stopped". Many devices report `null` when stationary or Wi-Fi-positioned. |
| **DEBT-L9** | No WebSocket compression negotiated. Payloads are small enough that it doesn't matter yet. |
| **DEBT-L10** | `centeredRef` in `Map.tsx` is never reset when `selfId` changes, so a reconnect that mints a new id won't re-centre. |

---

# Known Bugs

The defect registry: symptom, root cause, blast radius. The fix plan lives in the linked task.

### BUG-01 · Ghost rider
**Severity** 🔴 Critical · **Fixed by** [HZ-2](#hz-2--evict-the-zombie-connection-on-rejoin-ghost-rider) · **Status** Open

**Symptom.** After riding through a tunnel or dead zone, a rider appears twice — on the map, in the
standings, and in the group count — for up to 60 seconds.

**Root cause.** `room.go:58-69`, `TODO(rejoin)`. The register path adds the new client without
evicting the old one holding the same rider id. The zombie survives until its 60 s read deadline.

**Blast radius.** Corrupts every downstream consumer at once: `broadcast()` emits two entries with
identical `id`; the standings tiebreak becomes non-deterministic between equal keys; `Ride.tsx`
renders two `<li>` with the same React key; `Map.tsx` overwrites `markersRef[id]` and **leaks the
first marker permanently**, because the `seen`-set cleanup can never remove a marker whose id is
still present.

> **Note.** Commit `1cf6f43` is titled *"fix: ghost users"*. It shipped the **client-side** identity
> plumbing and the staleness UI and explicitly left the **server-side** eviction undone. The bug
> reads as fixed in `git log` and is not. This is the anti-example in `docs/DEVELOPMENT_GUIDE.md` §6.

---

### BUG-02 · Standings are meaningless
**Severity** 🔴 Critical *(product correctness)* · **Fixed by** [HZ-10](#hz-10--post-ridescoderoute--ors-cycling-proxy) + [HZ-14](#hz-14--web-route-line-layer--route-fetch--destination-picker) · **Status** Open

**Symptom.** The standings list shows a confident 1 / 2 / 3 that does not reflect who is ahead.

**Root cause.** `Room.route` is never written — the route endpoint is a 501 stub and there is no
setter. So `hasRoute` is always false, `distAlong` is always `0`, and the sort falls through to the
stable-by-`id` branch (`room.go:107`). **The `pos` shipping to clients today is alphabetical order by
rider id.**

**Blast radius.** One of the three stated product goals is wrong rather than missing — the worst kind
of failure, because the UI renders it faithfully and it looks functional.

---

### BUG-03 · Room goroutine + memory leak
**Severity** 🔴 Critical · **Fixed by** [HZ-3](#hz-3--room-garbage-collection--join-code-registry) · **Status** Open

**Symptom.** Memory and goroutine count grow monotonically for the process lifetime. Never observed
yet because nothing has run long enough.

**Root cause.** `hub.go:29`, `TODO(later)`. No destruction path. A room created once keeps its map
entry, its goroutine, and its 250 ms ticker forever — calling `broadcast()` 4×/s, allocating an empty
`[]riderState`, marshalling `{"type":"state","ride":"X","riders":[]}`, and sending it to nobody.

**Blast radius.** Memory leak + CPU leak + GC churn proportional to rooms-ever-created. The first
thing that will actually bite in a long-running deployment (HZ-7).

---

### BUG-04 · Unauthenticated unbounded room creation
**Severity** 🔴 Critical *(security)* · **Fixed by** [HZ-3](#hz-3--room-garbage-collection--join-code-registry) + [HZ-7](#hz-7--deploy-koyeb--cloudflare-tunnel-https-and-wss) · **Status** Open

**Symptom.** `GET /ws?ride=<any string>` creates a permanent room. Join codes minted by `POST /rides`
are never registered, so they are unvalidated tokens.

**Root cause.** `hub.go:31` creates on demand with no registry check, combined with
`CheckOrigin: func(*http.Request) bool { return true }` (`hub.go:25`).

**Blast radius.** A trivially reachable DoS *and* classic cross-site WebSocket hijacking: any page a
rider visits can open sockets to the server, allocate rooms without limit, join any ride, and read
the live locations of real people. This is the most serious security issue in the repo.

---

### BUG-05 · CORS blocks ride creation from the browser
**Severity** 🔴 Critical · **Fixed by** [HZ-1](#hz-1--add-cors-middleware-to-the-go-backend) · **Status** Open

**Symptom.** "Start a ride" fails with *"Couldn't reach the server. Is the backend running?"* while
the backend is running and has already minted a code.

**Root cause.** No `Access-Control-Allow-Origin` header on `POST /rides`. `createRide()` issues a
*simple* cross-origin POST (no custom headers, no body ⇒ no preflight), so the request reaches the
server and succeeds — but the browser blocks the *response* from JavaScript.

**Blast radius.** Breaks the primary entry point of the only working client, while reporting a
misleading cause. It hides because the WebSocket join path is exempt from CORS and any string creates
a room, so the whole pipe is testable via "Join". The documented workaround in `docs/SETUP_WEB.md:62`
(`VITE_BACKEND_HTTP=http://192.168.1.50:8080`) is **still cross-origin and does not fix it.** It
self-masks in production behind a single reverse proxy, then breaks again on every dev machine.

---

### BUG-06 · Geolocation denial is invisible
**Severity** 🟡 Medium · **Fixed by** [HZ-21](#-medium) · **Status** Open

`useGeo.ts:35` sends errors to `console.warn` and stops. A rider who denies location permission sees
*"Waiting for a GPS fix… (allow location access)"* forever, with no way to tell whether the browser
refused, the device has no fix, or the socket is down. **The single worst UX gap in the web client.**

---

### BUG-07 · Wake-lock refusal is invisible
**Severity** 🟡 Medium · **Fixed by** [HZ-22](#-medium) · **Status** Open

`useWakeLock.ts:18` swallows failures — the user agent can refuse on low battery. On a real ride a
silently-refused wake lock means the screen sleeps, GPS stops, and the rider vanishes from everyone's
map with no warning to them or anyone else. The wake lock is the *entire* mitigation for
foreground-only tracking, so a silent failure defeats the PWA strategy outright.

---

### BUG-08 · Mobile native build fails
**Severity** 🟠 High · **Fixed by** [HZ-4](#hz-4--fix-mobile-config-drift) · **Status** Open

`app.config.ts:19` lists the `expo-location` plugin; `package.json` has neither `expo-location` nor
`expo-task-manager`. `npx expo config`, `prebuild`, and `eas build` all fail to resolve it. A missing
`scheme` compounds it for expo-router deep links. A hard blocker on all of Milestone 4 — and a
five-minute fix that will otherwise be discovered at the worst possible moment.

---

### BUG-09 · Join accepts codes that can't exist
**Severity** 🟢 Low · **Fixed by** [HZ-3](#hz-3--room-garbage-collection--join-code-registry) · **Status** Open

`App.tsx:32` requires ≥4 characters; codes are exactly 6. A 4- or 5-character typo silently creates a
brand-new empty room server-side instead of erroring, so the rider sits alone in a valid-looking ride
wondering where everyone is.

---

### BUG-10 · Marker leak on duplicate rider id
**Severity** 🟡 Medium · **Fixed by** [HZ-2](#hz-2--evict-the-zombie-connection-on-rejoin-ghost-rider) · **Status** Open

Downstream of BUG-01. When two clients share an id, `Map.tsx` overwrites `markersRef[id]`; the
`seen`-set cleanup can never collect the orphan because the id is still present. The MapLibre marker
leaks for the lifetime of the page.

---

### BUG-11 · Location data travels in plaintext
**Severity** 🟠 High · **Fixed by** [HZ-7](#hz-7--deploy-koyeb--cloudflare-tunnel-https-and-wss) · **Status** Open

Dev uses `ws://` and `http://`, often over a café network. `docs/SYSTEM_DESIGN.md:366` mandates `wss://` in
production; nothing enforces it, and `net/config.ts:15` will happily use `ws://` whenever the page is
served over HTTP. Live location is the most sensitive data class in the app.

---

### BUG-12 · Misleading commit history
**Severity** 🟢 Low *(process)* · **Fixed by** `docs/DEVELOPMENT_GUIDE.md` §6 · **Status** Convention adopted

HEAD `56a8482` is titled *"Implement new feature for user authentication and improve error handling"*
and adds exactly one file: `docs/ARCHITECTURE_REVIEW.md`. **No authentication exists in this repository**
— it is explicitly out of scope per `CLAUDE.md`. Combined with BUG-01's misleading `fix: ghost users`,
two of the last three commit messages misrepresent their diffs. No code fix; the Conventional Commits
convention exists to stop it recurring. Do not rewrite history to correct these — note and move on.

---

# Completed Features

30 features shipped and verified. Grouped by area; every one is live in `main`.

## Backend — the core pipe

| ✅ | Feature | Location |
|---|---|---|
| 1 | HTTP server with `PORT` from env | `main.go:32-39` |
| 2 | `GET /healthz` liveness | `main.go:16` |
| 3 | WebSocket upgrade + query validation | `hub.go:48` |
| 4 | Room create-on-demand, keyed by join code | `hub.go:31` |
| 5 | `welcome` message, guaranteed first frame | `hub.go:84` |
| 6 | `loc` ingest with server-side timestamping | `client.go:62-65` |
| 7 | Fixed 4 Hz `state` fan-out, decoupled from ingest | `room.go:79-80` |
| 8 | `ageSec` staleness computation on the server clock | `room.go:95` |
| 9 | Per-client backpressure — drop-on-full, never block the room | `room.go:121` |
| 10 | Ping/pong keepalive (54 s ping, 60 s deadline) | `client.go:47-51, 86-91` |
| 11 | Multi-room isolation | keyed by code |
| 12 | Stable rider-id validation (`^[A-Za-z0-9_-]{8,64}$`) | `hub.go:117` |
| 13 | Join-code minting from an ambiguity-free alphabet | `hub.go:96` |
| 14 | Haversine + segment projection + `DistAlongRoute` | `standings.go` — correct, untested, **unexercised** |
| 15 | Deadlock-free concurrency model, one lock at a time | `hub.go`, `room.go` |

**Backend total: ~340 lines of Go, one third-party dependency.**

## Web PWA

| ✅ | Feature | Location |
|---|---|---|
| 16 | WebSocket client + message routing | `net/ws.ts` |
| 17 | Exponential reconnect backoff (1→15 s cap) | `net/ws.ts:51` |
| 18 | Stable per-tab rider id with fallback | `net/identity.ts` |
| 19 | GPS capture throttled to 1 Hz | `location/useGeo.ts` |
| 20 | Screen wake lock with `visibilitychange` re-acquire | `location/useWakeLock.ts:22` |
| 21 | MapLibre + OpenFreeMap rendering | `map/Map.tsx` |
| 22 | Keyed per-rider marker reconciliation (create/update/remove) | `map/Map.tsx:40` |
| 23 | Single-site `[lng, lat]` boundary conversion | `map/Map.tsx:53,57` |
| 24 | Self-highlighting — `.self` class + "(you)" | `Map.tsx`, `Ride.tsx` |
| 25 | Stale greying on map and list at 10 s | `types.ts:16` |
| 26 | Standings list UI | `Ride.tsx:45` |
| 27 | Connection status indicator, four states | `Ride.tsx` topbar |
| 28 | Leave ride with full store reset | `store/ride.ts` |
| 29 | One-time auto-centre on first self fix | `map/Map.tsx:76` |
| 30 | Zustand store as single client source of truth | `store/ride.ts` |

## Web PWA — installability

| ✅ | Feature | Location |
|---|---|---|
| 31 | Manifest + service worker via `vite-plugin-pwa` | `vite.config.ts:9` |
| 32 | **PWA icons generated from code** — a hand-rolled PNG encoder on `node:zlib`, so the repo carries zero binary assets | `scripts/gen-icons.mjs` |
| 33 | iOS home-screen meta tags | `index.html:14-18` |
| 34 | Safe-area insets for notched devices | `index.css:161,205` |

## Mobile — foundation only

| ✅ | Feature | Location |
|---|---|---|
| 35 | Expo project with dev-client and EAS profiles | `app.config.ts`, `eas.json` |
| 36 | **Native permissions + background config already written** — iOS `UIBackgroundModes: ["location","audio"]`, `NSMicrophoneUsageDescription`, Android background-location and foreground-service flags. The hard part `docs/SYSTEM_DESIGN.md:328` warns will eat real time. | `app.config.ts` |
| 37 | Native deps installed: MapLibre RN, LiveKit RN + WebRTC, zustand | `package.json` |
| 38 | Strict TypeScript with `@/*` path aliases | `tsconfig.json` |

> ⚠️ `mobile/` contains **zero Horizon application code** — it is the stock `create-expo-app`
> template with Horizon's native dependencies pre-installed. Items 35–38 are configuration, not
> features. See [BUG-08](#bug-08--mobile-native-build-fails).

## Documentation

`docs/SYSTEM_DESIGN.md` (the why) · `CLAUDE.md` (the rules) · `README.md` (the entry point) ·
`docs/SETUP_BACKEND.md` / `docs/SETUP_WEB.md` / `docs/SETUP_MOBILE.md` (checkpointed setup) ·
`docs/ARCHITECTURE_REVIEW.md` (the system as built) · and this handbook set.

**Unusually strong for a project this size — and that creates a specific hazard.** The docs describe
the *target*; in three places they describe as done what is in fact scaffolded (the rejoin policy,
the standings, the mobile app). A reader who trusts the docs will build on a foundation that isn't
there. This board exists to be the corrective.

---

# Future Roadmap

Detail lives in [`docs/ROADMAP.md`](./ROADMAP.md) — objectives, deliverables, risks, dependencies, and
success criteria per milestone. This table is the index, mapping the original
`docs/SYSTEM_DESIGN.md` §11 phases onto delivery milestones.

| Phase | `docs/SYSTEM_DESIGN.md` deliverable | Milestone | Status |
|---|---|---|---|
| **0** | Map shows your own dot; server echoes WS | — | ✅ Done (web) |
| **1** | Two phones see each other live — *the core pipe* | **[M1 — Stable Realtime Platform](./ROADMAP.md#milestone-1--stable-realtime-platform)** | ⚠️ **Reopened.** Marked ✅ in `README.md`, but CORS, ghost riders, and the room leak mean it isn't solid. Sprint 01 closes it for real, then deploys it and rides it. |
| **2** | Route + 1st/2nd/3rd standings | **[M2 — Route Intelligence](./ROADMAP.md#milestone-2--route-intelligence)** | 🔜 Backend 501-stubbed. The math exists, is correct, and never runs. |
| **3** | Push-to-talk voice | **[M3 — Voice Communication](./ROADMAP.md#milestone-3--voice-communication)** | 🔜 Backend 501-stubbed. `livekit-client` not installed on web. |
| **4** | Background location, reconnect hardening, battery | **[M4 — Native Experience](./ROADMAP.md#milestone-4--native-experience)** | 🚫 Blocked on BUG-08. The one thing a browser cannot do. |
| — | Hardening, observability, real-device validation | **[M5 — Production Ready](./ROADMAP.md#milestone-5--production-ready)** | 🔜 New. Was implicit; now explicit. |

## Long term — deliberately deferred

Auth, a database, Redis Pub/Sub, and self-hosted tiles/ORS/LiveKit are the documented scaling path
(`docs/SYSTEM_DESIGN.md` §9) and are explicitly forbidden in v1 by `CLAUDE.md`. **Do not pull these
forward.** They are additive: nothing in the v1 design blocks any of them. See
[docs/ROADMAP.md → Beyond M5](./ROADMAP.md#beyond-m5--the-deferred-scaling-path) for the trigger
conditions that would justify each.

---

## Maintaining this board

- Update it **in the same PR** as the work. A board that lags the code is worse than no board.
- New work gets an id and a row before it gets a branch.
- When a task is done, move it to Completed Features with its file locations.
- When the road test (HZ-8) produces findings, file them all — then **re-prioritize the backlog
  against them.** That is the point of the road test.
