# Roadmap — Horizon

> Where we're going, in five milestones. Each is a **capability the product either has or doesn't** —
> not a time box, and not a list of tasks.
>
> Task-level detail lives in [`docs/PROJECT_BOARD.md`](./PROJECT_BOARD.md); this document references task
> ids (`HZ-n`) rather than restating them. The reasoning behind the architecture is in
> [`docs/ADR/`](./ADR/) and [`docs/SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md).

## The shape of the plan

```
M1  Stable Realtime Platform    the core pipe, deployed, ridden, and trusted
     │
M2  Route Intelligence          standings that mean something
     │
M3  Voice Communication         push-to-talk
     │
M4  Native Experience           background location — the one thing a browser can't do
     │
M5  Production Ready            it survives contact with reality, repeatedly
```

**Milestones are sequential and each gates the next.** That is deliberate: `CLAUDE.md`'s governing
rule is *"prefer completing the current phase over adding later-phase features."* The dependency
chains are real, not bureaucratic — M2's standings can't be validated without M1's road test, M3's
WebRTC needs M1's HTTPS, and M4's port needs a proven M1 reference implementation.

## Mapping to the original phases

`docs/SYSTEM_DESIGN.md` §11 defines Phases 0–4. Milestones map onto them, with two changes:

| Original | Milestone | What changed |
|---|---|---|
| Phase 0 — own dot, WS echo | — | ✅ Done |
| Phase 1 — two phones see each other | **M1** | **Reopened.** `README.md` marks it ✅, but three critical defects mean the pipe isn't solid. M1 also absorbs deployment and the first real road test, which were previously unscoped. |
| Phase 2 — route + standings | **M2** | Unchanged |
| Phase 3 — voice | **M3** | Unchanged |
| Phase 4 — background location, reconnect, battery | **M4** + **M5** | **Split.** M4 is the native app and background location. M5 is production hardening, which was implicit and is now explicit. |

## Current position

| | |
|---|---|
| **Active milestone** | **M1** — Sprint 01 in flight |
| **Feature tally** | 30 complete · 9 partial · 42 missing · 4 blocked |
| **Automated tests** | 0 |
| **Deployed** | no |
| **Ridden on a real road** | no |
| **Biggest risk right now** | Everything downstream is being planned against a pipe that has never been outdoors. **HZ-8 is the highest-information action available to this project.** |

---

# Milestone 1 — Stable Realtime Platform

> **Two riders can start a ride from their phones, see each other move on a real road, ride through a
> tunnel, and come back as two riders — not four.**

The core pipe is the whole product in miniature. Everything else is a view on it. It currently
*claims* to work, and three defects mean it doesn't.

## Objectives

1. **Make the shipped path actually work.** `README.md` marks Phases 0 and 1 ✅, but ride creation is
   broken from the browser, reconnection duplicates riders, and rooms leak forever.
2. **Get it onto HTTPS.** Not for polish — geolocation, wake lock, PWA install, *and* WebRTC all
   require a secure context. Until this is done, **every feature is validated in desk tabs instead of
   on phones.**
3. **Ride it.** Convert desk assumptions into measured facts.
4. **Make the foundation testable.** First tests, first logs. You cannot debug standings from a
   moving bicycle without either.
5. **Make failures visible.** Geolocation denial and wake-lock refusal are currently silent, and the
   wake lock is the *entire* mitigation for the PWA's known limitation
   ([ADR-004](./ADR/ADR-004.md)).

## Deliverables

| Deliverable | Tasks |
|---|---|
| CORS middleware — "Start a ride" works from a browser | HZ-1 |
| Rejoin eviction — one rider per rider, always | HZ-2 |
| Room GC + join-code registry — no leak, no unbounded creation | HZ-3 |
| Structured logging across the connection lifecycle | HZ-5 |
| First automated tests (`internal/standings`) | HZ-6 |
| Deployment: Koyeb + Cloudflare Tunnel, `wss://`, real `CheckOrigin` | HZ-7 |
| **A real two-phone road test, with findings filed** | HZ-8 |
| Ride persistence + shareable join URL | HZ-9 |
| Visible failure states — geolocation, wake lock | HZ-21, HZ-22 |
| Follow-camera and recentre | HZ-23 |
| Server hardening — panic recovery, timeouts, graceful shutdown | HZ-32, HZ-33 |
| Mobile config unblocked (so M4 isn't discovered broken) | HZ-4 |

## Dependencies

- **Nothing external.** No new accounts, no new services, no credentials. Everything in M1 is our own
  code plus a free hosting tier.
- **Internal ordering:** HZ-1 first (every manual test goes through that button) → HZ-2 → HZ-3 (same
  edit surface) → HZ-5 → HZ-6 → HZ-7 → **HZ-8** → HZ-9, HZ-21, HZ-22 re-prioritized by what the ride
  reveals.
- **Two real phones and somewhere to ride** for HZ-8.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **HZ-8 invalidates downstream planning.** The road test surfaces a fundamental problem — GPS accuracy in traffic, wake lock unreliable on the actual phones, battery unacceptable. | High | **This is the milestone's purpose, not a failure mode.** Do it as early as HTTPS allows. Discovering it now costs a re-plan; discovering it after M3 costs three milestones of work. |
| **Wake lock proves unreliable on real hardware.** The PWA bet ([ADR-004](./ADR/ADR-004.md)) depends on it, and it can be silently refused. | High | HZ-22 makes refusal visible. If refusals are common, [ADR-004](./ADR/ADR-004.md) is weakened and M4 moves up the plan. |
| **Free-tier hosting cold-starts or hits memory limits**, especially with the room leak. | Medium | HZ-3 removes the leak before HZ-7 deploys. Health checks and log-based monitoring from HZ-5. |
| **HZ-3's join-during-teardown race introduces a new bug** in the most safety-critical code in the repo. | Medium | Land HZ-2 first for a reviewable diff. `go test -race` required. Document the `delete`-before-`close(send)` invariant while in the file (DEBT-M8). |
| Battery drain makes multi-hour rides impractical. | Medium | Measure in HZ-8. External power is an acceptable v1 answer; tuning is M5. |
| Cloudflare Tunnel drops long-lived WebSockets. | Low | Detectable in HZ-8. Fallback: a different free tunnel, or direct HTTPS on the host. |

## Success criteria

**The milestone is complete when all of these are true:**

- [ ] A rider taps "Start a ride" in a browser and gets a code — no CORS error
- [ ] Two riders join and see each other's dots and standings within seconds
- [ ] A rider disconnects and reconnects, and **appears exactly once**, with their dot resuming rather than vanishing
- [ ] The last rider leaving a room destroys it — goroutine count returns to baseline
- [ ] An unminted join code is rejected instead of silently creating a room
- [ ] The app is reachable over HTTPS with `wss://`, and `CheckOrigin` enforces an allowlist
- [ ] Reloading mid-ride keeps you in the ride; the code is in the URL and shareable
- [ ] Denying location permission produces a visible, actionable message
- [ ] A refused wake lock is visible to the rider
- [ ] `go test ./...` passes with real tests; `go test -race ./...` is clean
- [ ] Server logs show connect, disconnect, room create, and room destroy with `ride` and `rider` fields
- [ ] **A real ride has happened**, on two phones, outdoors, on mobile data — findings filed on the board
- [ ] `mobile/` builds a dev client without error

**The one-sentence test:** *two friends can ride together using the app, and neither of them has to
know how it works.*

---

# Milestone 2 — Route Intelligence

> **`pos` means "who is furthest along the route" instead of "alphabetical order by rider id".**

One of the three stated product goals currently ships a wrong answer rather than a missing one — the
UI renders a confident 1 / 2 / 3 that is meaningless
([BUG-02](./PROJECT_BOARD.md#bug-02--standings-are-meaningless)). The geometry to fix it already
exists, is correct, and has never once executed.

## Objectives

1. **Make standings real.** Fetch a route, store it on the room, project riders onto it, sort by
   distance along it.
2. **Make the route visible.** A line on the map, so riders can see where they're going and so
   standings can be sanity-checked by eye.
3. **Make standings *trustworthy* on real routes.** Correct on a straight line is not the bar. Loops,
   out-and-backs, wrong turns, and GPS jitter all have to behave.
4. **Don't create a CPU cliff.** The moment a route exists, `distAlong` becomes O(riders × segments)
   per tick — and currently runs inside the read lock that gates GPS ingest.

## Deliverables

| Deliverable | Tasks |
|---|---|
| `POST /rides/{code}/route` — ORS cycling proxy, key server-side, once per ride | HZ-10 |
| Cumulative segment-length precompute — **ships in the same change** | HZ-11 |
| `distAlong` computed outside the read lock — **same change** | HZ-12 |
| Route line on the map + route fetch + a deliberately crude destination picker | HZ-14 |
| Windowed monotonic projection + off-route detection | HZ-13 |
| Standings hysteresis — no 4 Hz flicker between close riders | HZ-20 |
| `heading` and `accuracy` in the protocol; GPS outlier rejection | HZ-24, HZ-25, HZ-26 |
| Route survives a server restart | HZ-35 |

**Sequencing note:** HZ-10, HZ-11, and HZ-12 ship as **one change**. Retrofitting the precompute or
the lock restructure later means validating standings twice, and the performance problem lands the
instant the endpoint does — 15 riders × 4 Hz × a 3,000-point route is ≈540k haversine evaluations per
second before the precompute.

## Dependencies

- **An OpenRouteService API key** — free, email signup, no card ([ADR-003](./ADR/ADR-003.md)).
  The first external credential the project needs.
- **M1 complete.** Specifically: HZ-6 (so the endpoint has tests to validate against), HZ-5 (you
  cannot debug standings on a bicycle without logs), and HZ-8 (real GPS traces to reason about).
- HZ-13 depends on HZ-14 — you need the route drawn on screen to see the fix working.
- HZ-20 comes last: **the hysteresis threshold cannot be tuned until you've watched real standings on
  a real ride.**

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **`distAlong` becomes a CPU wall** — O(R×S) per tick with three haversines per segment, inside `r.mu.RLock()`, blocking all GPS ingest. | High | HZ-11 and HZ-12 ship *with* HZ-10, not after. Precompute removes two-thirds of the work; moving it out of the lock removes the ingest coupling. Measure with a real ORS route, not a synthetic one. |
| **Nearest-segment snapping is non-monotonic.** A rider on the return leg of an out-and-back snaps to the outbound leg and appears to lose kilometres. | High | HZ-13's windowed search. Note it needs per-rider state (`lastDistAlong` on `Client`) that doesn't exist yet. HZ-6 records the failing case as a skipped test so it can't be forgotten. |
| **GPS accuracy poisons standings.** A ±500 m urban-canyon fix feeds the projection as if it were exact; one wild fix can reorder the whole field. | High | HZ-25 puts `accuracy` on the wire; HZ-26 rejects outliers. Neither is optional once standings are load-bearing. |
| **Standings flicker at 4 Hz** between riders within GPS jitter of each other, which reads as broken even when the math is right. | Medium | HZ-20 hysteresis. Tune from real ride data. |
| **ORS quota exhausted or the service is down.** Free tier, donation-funded, hard daily cap. | Medium | Enforce once-per-ride in code (not by convention). Cache responses server-side. Degrade to no-route mode rather than failing the ride. Escape hatch: self-host Valhalla ([ADR-003](./ADR/ADR-003.md)). |
| **A route is lost on server restart** — it's server-only state no client re-POSTs, so a restart mid-ride silently reverts standings to meaningless. | Medium | HZ-35: client caches the route and re-POSTs on reconnect. |
| **The destination picker scope-creeps** into a search UI, waypoint editing, and drag-to-reroute. | Medium | Deliberately crude. Pasted coordinates first; long-press second. `docs/SETUP_WEB.md` is right that a friend group can paste coordinates. |
| A route write from the HTTP handler races `broadcast()`. | Medium | The setter takes `r.mu.Lock()`. There is no setter today and no stated convention — the naive implementation is a data race. Document it in the same PR. |

## Success criteria

- [ ] A ride can have a cycling route set through the backend; `ORS_API_KEY` never reaches a client
- [ ] The route renders as a line on the map on both clients' code paths
- [ ] With a route set, `pos` reflects **actual position along the route**, verified on a real ride
- [ ] A rider on the return leg of an out-and-back does not lose distance
- [ ] A rider 500 m off-route is detectable — `bestDist` is used, not discarded
- [ ] Positions don't flicker between two riders riding side by side
- [ ] Segment lengths are precomputed once when the route is set, not per tick
- [ ] `distAlong` runs outside `r.mu.RLock()`; GPS ingest is not blocked by route math
- [ ] A 3,000-point route with 15 riders shows no measurable ingest latency increase
- [ ] One ORS request per ride, enforced in code
- [ ] A server restart mid-ride restores the route
- [ ] `standings` test coverage includes the monotonic and off-route cases — previously skipped tests now pass

**The one-sentence test:** *the rider physically in front is shown as 1st, on a real route, for a
whole ride.*

---

# Milestone 3 — Voice Communication

> **Riders hold a button and talk to the group, hands on the bars.**

The third product goal, and **deliberately the last of the three to build** — it is the only feature
fully independent of the location pipe, which makes it the safest thing to defer and the one that
most benefits from HTTPS and deployment already being done.

## Objectives

1. **Push-to-talk group audio** for up to ~15 riders, with the LiveKit room name equal to the ride
   join code so voice and location membership line up automatically.
2. **Keep the secret server-side.** The Go backend mints the JWT; `LIVEKIT_API_SECRET` never touches a
   client.
3. **Make it usable at speed** — one-handed, gloved, over wind noise.
4. **Measure the real load.** GPS + screen + WebRTC simultaneously is the heaviest the app will ever
   run, and it is currently unmeasured.

## Deliverables

| Deliverable | Tasks |
|---|---|
| `POST /rides/{code}/voice-token` — LiveKit JWT, short TTL, room = ride code | HZ-15 |
| Web voice + PTT — `livekit-client`, `audio: false`, mic on press | HZ-16 |
| Voice state in the store; connection and speaking indicators | HZ-16 |
| Battery measurement with voice active | HZ-37 (started) |

## Dependencies

- **A LiveKit Cloud account** — free tier, email signup, no card ([ADR-005](./ADR/ADR-005.md)).
- **The LiveKit Go server SDK** — the first new backend dependency since `gorilla/websocket`, taking
  the backend from one dependency to two. Justified: hand-rolling JWT claims for an external service
  is exactly what we shouldn't do.
- **HTTPS (HZ-7)** — WebRTC requires a secure context. Hard blocker.
- **HZ-3 (join-code registry)** — the token endpoint must not mint a signed credential for an
  arbitrary unvalidated code.
- **M1 and M2 complete.** Voice on top of an unreliable pipe just adds a second thing that's broken.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **The token endpoint inherits every auth weakness in the system.** It mints a signed credential to an external service based on a claimed rider id and a ride code — the first time our "the join code is the whole access-control model" stance produces cryptographic material. | High | Depend on HZ-3 so the code is validated. Short TTL. Identity = rider id, room = ride code, no wildcard grants. Revisit if the trust model ever tightens. |
| **Battery becomes unacceptable.** Continuous WebRTC audio on top of continuous high-accuracy GPS and a screen-on wake lock. | High | HZ-37: **measure before tuning.** External power may be the honest v1 answer. Adaptive GPS rate and map dimming are M5. |
| **iOS audio requires a user gesture** — voice cannot auto-connect. | Medium | Gate behind an explicit "Join voice" tap. Known and documented in `docs/SETUP_WEB.md`; design the UI around it rather than fighting it. |
| **Voice quality at speed is poor** — wind, road noise, one-handed operation. | Medium | Tune noise suppression and codec settings; don't change vendors over it ([ADR-005](./ADR/ADR-005.md)). Large, glove-usable PTT target. Validate on a real ride, not at a desk. |
| **LiveKit's free tier changes or the service is unreliable.** | Medium | Self-hosting is a URL and credentials change, not a rewrite — that is why LiveKit won. But it costs money, which breaks [ADR-006](./ADR/ADR-006.md). Fallback ordering: reduce usage → cut the feature → pay. |
| **Voice failure takes down location.** | Medium | Architecturally prevented: three independent wires. Voice media never passes through the Go server. **Preserve this** — a PR that couples them should be rejected. |
| Mobile WebRTC bloats app size and dev-client build time. | Low | Already accepted. The plugin config is written; the cost lands at M4. |

## Success criteria

- [ ] A rider taps "Join voice" and connects to a LiveKit room named for the ride code
- [ ] Holding the PTT button transmits; releasing stops. Others are always audible
- [ ] `LIVEKIT_API_SECRET` exists only in backend env — verified absent from every client bundle
- [ ] Tokens are short-lived and scoped to one rider and one ride
- [ ] Voice works on iOS behind an explicit user gesture
- [ ] A LiveKit outage degrades voice only — dots, standings, and the map keep working
- [ ] **Two riders held a conversation on a real ride at speed**
- [ ] Battery drain per hour is measured with voice active and recorded

**The one-sentence test:** *two riders can talk to each other while riding, without taking a hand off
the bars.*

---

# Milestone 4 — Native Experience

> **A rider pockets their phone, the screen locks, and they stay on the map.**

The single capability a browser cannot provide at any price. This milestone exists for exactly one
reason, and it is worth stating plainly: **everything else in `mobile/` is a re-implementation of
code that already works in `web/`.**

## Objectives

1. **Background location** — the whole point.
2. **Port the proven client**, don't rewrite it. `web/` is the reference implementation.
3. **Two clients, one backend, zero backend changes.** The strongest test of
   [P7](./DEVELOPMENT_GUIDE.md#p7--every-feature-works-for-both-web-and-mobile) the project will ever run.
4. **Better battery behaviour than the PWA** — native `timeInterval`/`distanceInterval` pushes GPS
   throttling into the OS, rather than dropping fixes in JS *after* the expensive part already
   happened.

## Deliverables

| Deliverable | Tasks |
|---|---|
| Buildable dev client (config drift fixed) | HZ-4 *(pulled forward into M1)* |
| ADR: `features/` vs flat directory layout — **decided before porting** | HZ-18 |
| ADR + implementation: background task ↔ WebSocket ownership | HZ-19 |
| Core port: types → store → socket → identity → location → map → standings | HZ-17 |
| Background location: `TaskManager` + `startLocationUpdatesAsync` + foreground-service notification | HZ-19 |
| Native voice: `registerGlobals()`, `AudioSession`, `LiveKitRoom` + PTT | HZ-36 |
| Template scaffolding deleted | DEBT-L6 |

## Dependencies

- **M1, M2, and M3 complete.** The port copies working code; porting half-built features doubles the
  work.
- **HZ-4** — without it, no dev client builds at all.
- **HZ-18 before HZ-17.** `docs/SYSTEM_DESIGN.md` §5.1 and `docs/SETUP_MOBILE.md` §12 prescribe a `features/`
  layout; `web/` uses a flatter one. Unresolved, this yields two conventions in one repo.
  Recommendation: copy `web/`'s flat structure, because it is proven.
- **HZ-19's ADR before HZ-19's code.**
- **EAS build access** — free tier, email signup. The dev host is Windows, so Android builds locally
  and **iOS requires EAS cloud builds**.
- Physical iOS and Android devices. Background location cannot be tested in a simulator.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **The background task runs in a separate JS context and cannot reuse the React-owned WebSocket.** This is the hardest unsolved design question in the project, and `docs/SETUP_MOBILE.md:249` glosses over it. | **Critical** | HZ-19: decide in an ADR *before* writing code. Either the socket moves outside React and becomes reachable from the task, or fixes are queued and handed off. Prototype both against a real device early — this is not a detail to discover during implementation. |
| **iOS "Always" location permission is hostile.** Users must be prompted correctly, iOS may downgrade the grant, and the app can be killed for background abuse. | High | The permission config is already written in `app.config.ts`. Budget real time — `docs/SYSTEM_DESIGN.md` §10 calls background location "the #1 pain" and it is identical on every framework. |
| **Android requires a persistent foreground-service notification**, which some users find intrusive and some OEM battery managers kill anyway. | High | Config flags are already set. Test on multiple OEMs — Samsung, Xiaomi, and OnePlus are the usual offenders. |
| **The port drifts from the web client**, producing two divergent clients and a third copy of the protocol. | High | Port, don't rewrite. `types.ts` and the store copy unchanged. DEBT-H7's conformance test should land **before** the port, not after — three implementations with no shared schema is how `heading` drifted with only two. |
| **`mobile/` has already rotted** into unbuildability once (BUG-08). | Medium | HZ-4 in M1. Then keep it buildable: any PR touching `mobile/` proves `npx expo config` still resolves. |
| Dev-client rebuild cycles slow iteration dramatically vs. the PWA loop. | Medium | Rebuild only on native dependency changes; JS hot-reloads. Batch native dep changes. |
| Scope creep into "make the native app nicer than the PWA". | Medium | The native app exists for background location. Feature parity is the goal; feature *superiority* is not. |

## Success criteria

- [ ] A dev client builds and installs on Android and iOS
- [ ] The native app joins a ride and appears on the PWA's map — **and vice versa, in the same ride**
- [ ] **The Go backend required zero changes** to support it
- [ ] A rider locks the phone, puts it in a pocket, rides 2 km, and stays visible with fresh fixes
- [ ] Android shows an appropriate foreground-service notification during a ride
- [ ] iOS continues tracking with "Always" permission and the screen off
- [ ] Native voice PTT works, and interoperates with web voice in the same room
- [ ] Battery drain with the screen off is **measurably better** than the PWA with the screen on
- [ ] `types.ts` and the zustand store are shared or provably identical — not a third fork
- [ ] All Expo template scaffolding is deleted
- [ ] A real ride was completed with one rider on native and one on the PWA

**The one-sentence test:** *a rider puts their phone in a jersey pocket for an hour and their friends
still see them.*

---

# Milestone 5 — Production Ready

> **Real people can rely on this for a real ride, repeatedly, without you watching it.**

Previously implicit in "Phase 4: production-readiness". Made explicit because *shipping features* and
*being trustworthy* are different kinds of work, and the second kind never happens if it isn't on the
plan.

## Objectives

1. **Survive contact with reality, repeatedly.** Not one successful ride — a season of them.
2. **Know what's happening without being there.** Metrics and logs sufficient to diagnose "I vanished
   halfway up the climb" after the fact.
3. **Be defensible.** Rate limits, caps, origin checks, and unguessable tokens.
4. **Be maintainable by someone who didn't write it.** CI, linting, and docs that match the code.
5. **Be kind to the phone.** Adaptive GPS, map dimming, measured drain.

## Deliverables

| Deliverable | Tasks |
|---|---|
| CI: `go vet`, `go test -race`, `tsc -b`, formatting on every push | DEBT-M5 |
| ESLint + Prettier for TypeScript | DEBT-M4 |
| Protocol conformance test across all implementations | DEBT-H7 |
| Rate limits, connection caps, room-size caps | HZ-31 |
| `crypto/rand` for join codes and rider ids | DEBT-M1 |
| Metrics endpoint — connections, rooms, messages/sec, dropped frames | HZ-44 |
| Battery tuning — adaptive GPS rate, map dimming when idle | HZ-37 |
| Marker interpolation, runtime message validation, tile caching, SW update prompt | HZ-27, HZ-28, HZ-29, HZ-30 |
| Ranking moved into `standings`; setup docs point at files instead of copying them | DEBT-M2, DEBT-M6 |
| Per-rider visibility control | HZ-45 |

## Dependencies

- **M1–M4 complete.** Hardening a moving target is wasted work.
- **Repeated real rides** — the only source of truth for what actually needs hardening. Everything
  here should be prioritized against ride findings, not against this list.
- No new external services.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **This milestone never happens.** Hardening is the easiest work to defer indefinitely, and the app "works" without it. | High | It's a named milestone with success criteria for exactly this reason. Pull individual items forward whenever a ride exposes the need. |
| **Privacy debt comes due.** Live location broadcasts to everyone in a room with no consent gate, no visibility control, and no way to go temporarily invisible — for the most sensitive data class in the app. | High | HZ-45. If Horizon is ever shared beyond the original friend group, this stops being optional and becomes the *first* thing to build. |
| **Single-process, in-memory state remains a hard ceiling.** Two instances share nothing; a restart destroys every ride. | Medium (accepted) | Documented and deliberate ([ADR-001](./ADR/ADR-001.md), `docs/SYSTEM_DESIGN.md` §9). Redis Pub/Sub is the escape hatch, and it is additive. Do not pull it forward. |
| **Protocol drift becomes a real bug** across three implementations. | Medium | DEBT-H7's golden-fixture conformance test — ideally before M4's port, not after. |
| Free-tier hosting proves inadequate for sustained use. | Medium | Measure. Fallback ordering is in [ADR-006](./ADR/ADR-006.md): switch provider → reduce usage → cut a feature → pay. |
| Perfectionism — hardening a hobby app to product standards. | Medium | The bar is "a friend can rely on it", not "it passes an audit". ≤15 riders remains the design target. |

## Success criteria

- [ ] CI runs `go vet`, `go test -race`, and `tsc -b` on every push, and blocks merge on failure
- [ ] TypeScript has a linter and formatter, enforced in CI
- [ ] A single conformance test asserts every protocol implementation agrees
- [ ] Rate limits and caps exist: max riders per room, max rooms, max connections, max message rate
- [ ] Join codes and rider ids come from `crypto/rand`
- [ ] Metrics show live connection count, room count, messages/sec, and dropped frames
- [ ] A rider reporting "I vanished at 14:32" can be diagnosed **from logs alone**
- [ ] Battery drain is measured and documented for a full ride, with GPS and voice active
- [ ] Adaptive GPS rate reduces drain measurably when stationary
- [ ] A rider can make themselves temporarily invisible
- [ ] **Five real rides completed with no rider-visible failure**
- [ ] A new contributor can go from clone to a merged PR using only the docs — no verbal help
- [ ] No item on the board is Critical

**The one-sentence test:** *you can hand the join code to a friend without explaining any caveats.*

---

# Beyond M5 — the deferred scaling path

Everything below is **explicitly out of scope** and forbidden in v1 by `CLAUDE.md`. It is documented
in `docs/SYSTEM_DESIGN.md` §9 as the path if Horizon ever outgrows a friend group.

**Do not pull these forward.** The v1 design blocks none of them — they are all additive, which is
precisely why deferring them is safe. Each has a specific trigger.

| Deferred | Trigger that would justify it | First step |
|---|---|---|
| **Auth and accounts** | Riders who aren't friends, or a need for persistent identity and ride history. Also the moment [ADR-005](./ADR/ADR-005.md)'s token endpoint needs a real trust model. | Firebase Auth (fastest) or Go-native auth. Requires revisiting [ADR-006](./ADR/ADR-006.md). |
| **Persistence (Postgres + PostGIS)** | Ride history, opt-in trails, or routes that must survive a restart in a way HZ-35 can't cover. | Postgres for rides and routes; PostGIS only if geo queries are actually needed. |
| **Horizontal scale (Redis Pub/Sub)** | One Go process is no longer enough — many concurrent rides, not many riders per ride. | Redis Pub/Sub between instances so a rider on A reaches a rider on B in the same room. |
| **Self-hosted tiles / ORS / LiveKit** | A free tier disappears, a rate limit becomes binding, or usage exceeds community-service etiquette. | All three are open source. LiveKit is Go, so self-hosting stays in one ecosystem. Costs money — see [ADR-006](./ADR/ADR-006.md). |
| **Full observability (Prometheus, tracing)** | HZ-44's metrics stop being enough to diagnose problems. | Prometheus metrics, then tracing if request paths get deep enough to need it. |
| **Turn-by-turn navigation** | Riders want directions, not just a route line. Currently an explicit non-goal. | Large. Would need a new ADR and probably a different directions provider. |
| **Offline maps** | Riding somewhere with no signal. Currently an explicit non-goal. | Bundled regional PMTiles. Large change; revisit [ADR-003](./ADR/ADR-003.md) properly. |
| **App-store distribution** | Public distribution rather than sideloading and TestFlight. | Apple $99/yr, Google $25 once — the only money in the entire project, and it breaks [ADR-006](./ADR/ADR-006.md). |

**The condition that unlocks all of it** is the same one in [ADR-006](./ADR/ADR-006.md):
**Horizon stops being a friend-group hobby app.** Until then, the constraint is the feature — it is
what keeps the backend at 340 lines and the whole system comprehensible in an afternoon.

---

## Maintaining this roadmap

- **Milestones change slowly.** Update this file when scope or ordering genuinely moves, not when a
  task does — that's [`docs/PROJECT_BOARD.md`](./PROJECT_BOARD.md)'s job.
- **Every milestone gets reviewed against reality at its end**, especially after HZ-8. Real rides
  outrank plans.
- **No dates.** This is a hobby project maintained in spare time; dates would be fiction and would
  create false pressure. Milestones complete when their success criteria are met.
- **If a milestone's success criteria stop making sense**, change them deliberately and say why —
  don't quietly drop them.
