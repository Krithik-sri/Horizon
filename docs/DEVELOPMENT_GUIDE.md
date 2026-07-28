# Development Guide — Horizon

> The engineering handbook. **How we build**, as opposed to *what* we're building
> ([`docs/PROJECT_BOARD.md`](./PROJECT_BOARD.md)), *why* the architecture is what it is
> ([`docs/SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md) and [`docs/ADR/`](./ADR/)), or *how to get set up*
> ([`docs/CONTRIBUTING.md`](./CONTRIBUTING.md)).
>
> Read this once before your first PR. Re-read the checklists every PR.

**Document ownership**

| Question | Document |
|---|---|
| What is Horizon and how do we work? | **this file** |
| What am I supposed to build next? | [`docs/PROJECT_BOARD.md`](./PROJECT_BOARD.md) |
| Why was this decided? | [`docs/ADR/`](./ADR/) · [`docs/SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md) |
| What does the system look like today? | [`docs/ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md) |
| Where are we going? | [`docs/ROADMAP.md`](./ROADMAP.md) |
| How do I get a dev environment? | [`docs/CONTRIBUTING.md`](./CONTRIBUTING.md) · `SETUP_*.md` |
| What are the hard rules? | [`CLAUDE.md`](../CLAUDE.md) |

---

## Contents

1. [Project Philosophy](#1-project-philosophy)
2. [Architecture Principles](#2-architecture-principles)
3. [Repository Structure](#3-repository-structure)
4. [Development Workflow](#4-development-workflow)
5. [Branch Naming Convention](#5-branch-naming-convention)
6. [Commit Message Convention](#6-commit-message-convention)
7. [Pull Request Checklist](#7-pull-request-checklist)
8. [Coding Standards](#8-coding-standards)
9. [Testing Guidelines](#9-testing-guidelines)
10. [Code Review Checklist](#10-code-review-checklist)
11. [Definition of Done](#11-definition-of-done)

---

# 1. Project Philosophy

## What Horizon is

A live group-tracking and voice app for bike rides. A group of friends joins a ride with a
6-character code; everyone sees everyone else as a moving dot on a shared map, talks over
push-to-talk, and gets a race-style "who's 1st / 2nd / 3rd" indicator based on distance along the
planned route.

Target scale is **≤15 riders per ride**, a friend group, not a product with users. Every decision in
this repo should be read against that number. A design that is correct at 15 riders and wrong at
15,000 is a *correct* design here.

## Engineering goals

1. **The core pipe must be boring and reliable.** Location in → location out. Everything else is a
   view on that stream. If the pipe is flaky, no feature above it can be trusted.
2. **A new contributor ships something real on day one.** Three commands to a running system, one
   file to read per concern.
3. **Zero-cost operation, permanently.** No paid service, no credit card — see
   [ADR-006](./ADR/ADR-006.md). This is a hard constraint, not a preference.
4. **Every feature works on both Web and Mobile.** The backend is client-agnostic and stays that
   way.
5. **The code fits in one person's head.** ~340 lines of Go and ~1,000 lines of TypeScript is a
   feature. Defend it.

## Design philosophy

**One data stream, many views.** Map dots, standings, and voice-room membership are all projections
of a single stream: each rider's live coordinates flowing through the Go server
(`docs/SYSTEM_DESIGN.md` §"Design principles"). When you add a feature, first ask *which view of the
stream is this?* If the answer is "a new stream", you are probably adding the wrong thing.

**Don't build what you can rent — but only rent what's free and open.** Map rendering, tiles,
routing, and WebRTC are deep, well-solved problems. We use MapLibre, OpenFreeMap, OpenRouteService,
and LiveKit. What we build ourselves is the one thing nobody sells us: the realtime location fan-out
and the race-position math.

**Correct beats fast; small beats clever; obvious beats both.** At this scale we have an enormous
performance budget. Spend it on readability.

**Failures should be loud.** The current codebase silently drops malformed frames, silently drops
GPS fixes while the socket is down, silently swallows wake-lock refusals, and silently discards
off-route distances. Every one of those is on the board as a bug. New code does not add to that list.

## What we optimize for

| We optimize for | Because |
|---|---|
| **Time to a working two-phone ride** | Nothing about this app is real until it survives an actual road test. |
| **Readability over abstraction** | The team is small; the reader is always a stranger to the code six weeks later. |
| **Server authority** | One computation, one answer, all clients agree. |
| **Dependency minimalism** | The whole backend has one third-party dependency. That is the target, not an accident. |
| **Fast local iteration** | PWA-first exists specifically so there is no native build in the inner loop ([ADR-004](./ADR/ADR-004.md)). |
| **Battery and data budget** | A rider's phone must survive a four-hour ride. |
| **Privacy of location data** | Live location is the most sensitive data class in the app. It is broadcast to the ride and stored nowhere. |

## What we intentionally avoid

| We avoid | Why | Escape hatch |
|---|---|---|
| **Paid or card-required services** | Hard constraint ([ADR-006](./ADR/ADR-006.md)). | None. Not negotiable in v1. |
| **A database** | Rides are ephemeral; in-memory rooms are correct at this scale. | Postgres + PostGIS, `docs/SYSTEM_DESIGN.md` §9. |
| **Auth and accounts** | The join code is the entire access-control model. | Documented scaling path, §9. |
| **Redis / horizontal scale** | One Go process handles 15 riders trivially. | Redis Pub/Sub, §9. |
| **Client-side standings** | Two clients would compute two answers. | None. This is a principle, not a trade-off. |
| **Custom WebRTC** | A reliable SFU is a multi-month project. | LiveKit, [ADR-005](./ADR/ADR-005.md). |
| **UI code in Go** | Go is the backend brain; TypeScript is everything the rider sees. | None. |
| **Frameworks and component libraries on the client** | Four components and 277 lines of hand-written CSS is the whole UI. | None yet. |
| **Premature optimization** | 4 Hz × 15 riders is nothing. | Measure first; `distAlong` is the one place we optimize *before* shipping, because it lands as an O(R·S) loop. |
| **Speculative generality** | Interfaces with one implementation, config for things that never vary, abstraction layers over one caller. | Add the second caller first. |

---

# 2. Architecture Principles

These are enforceable. A PR that violates one needs an ADR, not an argument in the review thread.

### P1 — The backend is the source of truth

Anything that must be the same for every rider is computed once, on the server, and broadcast.
Rankings, timestamps, group membership, staleness, and route geometry are all server-owned. A client
is a renderer of server state plus a producer of its own GPS fixes. Nothing else.

### P2 — Clients never calculate standings

Not "clients shouldn't" — clients *must not*. The server already holds every rider's coordinates and
the route. A client-side implementation would (a) disagree with other clients, (b) duplicate the
projection math three ways, and (c) drift silently. Standings live in
`backend/internal/standings/` and nowhere else (`CLAUDE.md` §"Conventions & rules").

**Corollary:** if a client needs a derived value, add it to the `state` payload rather than deriving
it locally. `pos`, `distAlong`, and `ageSec` are all examples of the server doing the derivation.

### P3 — One source of truth for rider state

Per layer, exactly one place owns rider state:

- **Server:** the `Room`'s rider set, guarded by `Room.mu`.
- **Web client:** the zustand store `web/src/store/ride.ts`.
- **Mobile client (future):** its zustand store, mirroring the same shape.

No component keeps a shadow copy of `riders`. No `useState` mirrors store state. The one deliberate
exception is `Map.tsx`'s `markersRef`, which is a handle cache for MapLibre DOM objects, not state —
it is reconciled *from* the store every tick and owns no truth.

### P4 — The shared protocol is a contract

The WebSocket message shapes in `CLAUDE.md` §"WebSocket protocol" are a contract between three
independent implementations: Go structs, `web/src/types.ts`, and (soon) the mobile client.

Rules:

- **Changing a field is a cross-cutting change.** Update every implementation in the *same PR*, plus
  `CLAUDE.md`. A protocol PR that touches only one side will be rejected.
- **Additive changes are safe; removals and renames are not.** Clients ignore unknown message types
  by design — use that.
- **No dead fields.** `heading` and `ts` are currently sent by the client, parsed by the server, and
  thrown away. That is a bug on the board, not a precedent.
- **Coordinate convention is invariant:** `lat`/`lng` named fields on the wire and in Go;
  `[lng, lat]` positional arrays *only* inside MapLibre/GeoJSON calls. Any `[lng, lat]` literal
  outside `web/src/map/` (or its mobile equivalent) is a bug.
- **Wire changes need a note in the PR description** stating whether old clients survive.

### P5 — Keep dependencies minimal

The backend has exactly **one** third-party dependency (`gorilla/websocket`). The web client has
**four** runtime dependencies (`react`, `react-dom`, `maplibre-gl`, `zustand`).

Before adding one, answer in the PR:

1. What does the standard library / platform API not do?
2. How many lines would writing it ourselves take? (Under ~100 → write it. `web/scripts/gen-icons.mjs`
   is a hand-rolled PNG encoder built on `node:zlib` precisely because of this rule.)
3. Is it free, unmetered, and card-free? ([ADR-006](./ADR/ADR-006.md))
4. **Native mobile deps only:** does this force a dev-client rebuild? Native deps are expensive;
   JS deps are cheap.

A new runtime dependency in `backend/` requires an ADR. A new one in `web/` or `mobile/` requires
reviewer sign-off in the PR.

### P6 — Simplicity over cleverness

- Prefer a longer, obvious function to a shorter, subtle one.
- Prefer duplication to the wrong abstraction. Extract on the third occurrence, not the second.
- No metaprogramming, no code generation, no reflection-driven dispatch.
- If a reviewer has to ask "why does this work?", the answer belongs in a comment — or the code
  should change.
- **Concurrency especially:** the current design holds at most one mutex at a time, so deadlock is
  structurally impossible. Any change that makes that untrue must justify itself explicitly.

### P7 — Every feature works for both Web and Mobile

The Go backend is client-agnostic and must stay that way: no browser-specific assumptions, no
`User-Agent` branching, no endpoint that only one client can call.

When you design a feature, state in the PR description how it works on both clients. Acceptable
answers include "identical", "same protocol, different SDK" (the normal case), and "web-only until
the native port, and here is why that's safe". Not acceptable: not having thought about it.

**The one legitimate asymmetry** is background location — the entire reason `mobile/` exists. Browser
geolocation dies when the screen locks; no service-worker trick changes that. Web mitigates with a
screen wake lock; mobile solves it with OS background modes. Everything else should be the same
feature twice, not two features.

### P8 — Secrets never leave the server

`ORS_API_KEY` and `LIVEKIT_API_SECRET` live in backend environment variables only. This is *why*
routing is proxied through Go and *why* LiveKit tokens are minted by Go. A client that talks
directly to a keyed third-party service is a design error, not a shortcut. OpenFreeMap is the
exception that proves the rule: it needs no key, so the client calls it directly.

### P9 — Rides are ephemeral

No location trail is persisted. Process restart loses all rides, and that is acceptable — clients
reconnect and repopulate within seconds. Do not add persistence to work around a bug; fix the bug.

> **Note:** routes are the current exception and a known gap. A route is server-only state that no
> client re-POSTs, so a restart loses it permanently. See `docs/PROJECT_BOARD.md` → Technical Debt.

---

# 3. Repository Structure

Every directory has one job. The **"Never"** row of each table is the enforceable part — those are
the lines reviewers look for.

> Rationale for these boundaries is in `docs/ARCHITECTURE_REVIEW.md` §9. This section is the operational
> rule set.

## Root

```
Horizon/
├── backend/              Go realtime server
├── web/                  installable PWA — the v1 client
├── mobile/               React Native (Expo) — future native path
├── docs/ADR/             architecture decision records
├── CLAUDE.md             enforceable rules (short by design)
├── docs/SYSTEM_DESIGN.md      why the architecture is what it is
├── docs/ARCHITECTURE_REVIEW.md  the system as built, with debt and risks
├── docs/DEVELOPMENT_GUIDE.md  this file
├── docs/CONTRIBUTING.md       setup + contribution mechanics
├── docs/PROJECT_BOARD.md      live task board
├── docs/ROADMAP.md            milestones
├── README.md             entry point
└── SETUP_{BACKEND,WEB,MOBILE}.md   step-by-step setup guides
```

| | |
|---|---|
| **Purpose** | Orientation and cross-cutting documentation. |
| **Responsibilities** | Every root file answers exactly one question (see the table at the top of this document). |
| **Belongs here** | Repo-wide docs, and eventually CI config (`.github/`). |
| **Never** | Source code. A build artifact. A fourth "getting started" document — extend an existing one. |

## `backend/`

| | |
|---|---|
| **Purpose** | The realtime location fan-out, the race-position math, and server-side custody of secrets. The only component that is genuinely this project's own work. |
| **Responsibilities** | WebSocket hub, room lifecycle, 4 Hz broadcast, standings, ORS proxy (Phase 2), LiveKit token minting (Phase 3). Ships as one static binary. |
| **Belongs here** | Anything authoritative (P1), anything shared across clients, anything touching a secret (P8), anything client-agnostic. |
| **Never** | UI, rendering, or presentation. Per-client preference. A database, Redis, or auth (`CLAUDE.md`). A second third-party dependency without an ADR (P5). |
| **Discipline** | `go fmt ./... && go vet ./...` clean before every commit. |

### `backend/main.go`

| | |
|---|---|
| **Purpose** | Composition root: read env, build the mux, start the server. |
| **Responsibilities** | Route registration, process configuration, and top-level middleware — CORS, panic recovery, request logging, and `http.Server` timeouts all belong here. |
| **Belongs here** | Wiring. Nothing else. |
| **Never** | Business logic. A handler body longer than ~3 lines — move it into a package. The current inline `POST /rides` closure is already at that limit. |

### `backend/internal/hub/`

`hub.go` (registry + upgrade) · `room.go` (membership + broadcast) · `client.go` (per-socket pumps)

| | |
|---|---|
| **Purpose** | Everything that knows what a *connection* is. `internal/` guarantees no external module imports it. |
| **Responsibilities** | HTTP→WS upgrade and query validation, room registry, per-socket read/write pumps, keepalive, the broadcast tick, and the room's mutable state (rider set + route). |
| **Belongs here** | Connection lifecycle, room membership, wire framing, the broadcast scheduler, and the Phase-2 route *setter* (room state is this package's property). |
| **Never** | Pure computation with no connection context — that goes to `standings/`. HTTP route *registration* — that's `main.go`. Outbound HTTP to ORS or LiveKit — those get their own packages so they can be stubbed without a socket. |
| **Concurrency contract** | `Room.mu` guards the rider set, the route, **and** the mutable `Client` fields (`lat`/`lng`/`speed`/`lastSeen`) written by read pumps. Do not add a second lock. Do not hold `Room.mu` across heavy computation or any I/O. |

### `backend/internal/standings/`

| | |
|---|---|
| **Purpose** | The "who's 1st" algorithm as pure, dependency-free, testable geometry. |
| **Responsibilities** | Haversine, segment projection, distance-along-route, and (Phase 2) cumulative-length precompute, windowed monotonic search, off-route thresholds, position smoothing. |
| **Belongs here** | Anything expressible as `func(inputs) outputs` with no clock, no network, no lock. **Ranking belongs here too** — the sort and `pos` assignment currently living in `room.broadcast()` is a known layering violation on the board. |
| **Never** | Anything needing a `Room`, a `Client`, a mutex, or wall-clock time. Zero imports beyond `math` and `sort`. |
| **Discipline** | This package is the highest-value test target in the repo. New functions here ship **with** table-driven tests. |

### `backend/` loose files

`go.mod` · `go.sum` · `.env.example` (blank values, committed) · `.gitignore` · `wstest.mjs` (Node
smoke script). Real secrets go in `.env`, which is gitignored and never committed.

## `web/`

| | |
|---|---|
| **Purpose** | The v1 client: an installable PWA. PWA-first because riders mount the phone screen-on, so a wake lock covers the use case ([ADR-004](./ADR/ADR-004.md)). |
| **Responsibilities** | Render the map and standings, acquire GPS, hold the socket, keep the screen awake, install to the home screen. |
| **Belongs here** | Browser-specific rendering, interaction, and browser-API bindings. |
| **Never** | Authoritative shared state (P1). A secret (P8). A reimplementation of standings (P2). |

### `web/src/` (root files)

`main.tsx` (bootstrap) · `App.tsx` (App + Lobby) · `Ride.tsx` (ride screen + standings) ·
`types.ts` (**the protocol contract**) · `index.css` (the entire stylesheet)

| | |
|---|---|
| **Purpose** | Application shell and screens. |
| **Belongs here** | Screen-level components, the protocol types, global styles. |
| **Never** | Anything that belongs in `net/`, `store/`, `location/`, or `map/`. `types.ts` in particular must mirror the Go structs exactly (P4) — it is not a place for client-only view models. |

### `web/src/net/`

`ws.ts` (socket lifecycle, backoff, `sendLoc`) · `api.ts` (REST) · `config.ts` (base URLs) ·
`identity.ts` (stable rider id)

| | |
|---|---|
| **Purpose** | All server communication and identity in one place, so the transport can change without touching UI. |
| **Belongs here** | WebSocket lifecycle, REST calls, endpoint configuration, rider identity. Phase-2 `setRoute()` and Phase-3 `voiceToken()` go in `api.ts`. |
| **Never** | Rendering. Owning domain state — `net/` pushes into the store and holds none itself. Hard-coded hosts: everything routes through `config.ts`. |

### `web/src/store/`

| | |
|---|---|
| **Purpose** | The single client-side source of truth (P3). Map and standings are both pure views of `riders`. |
| **Belongs here** | State read by more than one component, or written from outside React (the WS callbacks). Phase-2 route state and Phase-3 voice state go here. Connection and permission *error* state belongs here too — it currently doesn't exist, which is why failures are invisible. |
| **Never** | Genuinely local state (`Lobby`'s `busy`/`joinCode`/`error` are correctly `useState`). Derived values that a selector could compute. |

### `web/src/location/`

`useGeo.ts` · `useWakeLock.ts`

| | |
|---|---|
| **Purpose** | Isolate the two browser APIs that have no native equivalent and will be *replaced wholesale* — not ported — in the mobile app. |
| **Belongs here** | Wrappers around device-sensor and power-management APIs: geolocation, wake lock, and (if ever) orientation, motion, battery. |
| **Never** | Decisions about *what to do* with a fix. `useGeo` takes an `onFix` callback and knows nothing about WebSockets — keep that inversion. |

### `web/src/map/`

| | |
|---|---|
| **Purpose** | Quarantine MapLibre's imperative model behind one component, and be **the single site of the `lat/lng` → `[lng, lat]` conversion**. |
| **Belongs here** | Anything touching the MapLibre instance: sources, layers, markers, camera. The Phase-2 route line goes here. |
| **Never** | Non-map UI (the standings list is correctly in `Ride.tsx`). Coordinate conversion for a non-map purpose. **Any `[lng, lat]` literal outside this directory is a bug.** |

### `web/scripts/`

| | |
|---|---|
| **Purpose** | Build-time generation, so the repo carries zero binary assets. `gen-icons.mjs` rasterizes the PWA icons from code using only Node built-ins; it's wired to `predev`/`prebuild`. |
| **Belongs here** | Scripts that run at an npm lifecycle hook and produce gitignored output. |
| **Never** | Anything shipped to the browser. Anything needing a dependency — these are `node:`-built-ins only, deliberately. |

### `web/public/`

| | |
|---|---|
| **Purpose** | Static assets copied verbatim to the site root. Currently only `favicon.svg`; the three PNG icons are generated and gitignored. |
| **Belongs here** | Files that must be fetched by an exact URL and not processed by Vite. |
| **Never** | Anything the bundler could import and fingerprint (use `src/assets/`). Anything secret — `public/` is world-readable by definition. |

## `mobile/`

| | |
|---|---|
| **Purpose** | Exactly one capability: **true background location**. Pocketed, screen-off tracking is impossible in a browser at any price. Everything else in this directory is a re-implementation of code that already works in `web/`. |
| **Status** | Stock `create-expo-app` template with Horizon's native dependencies pre-installed and the hard permissions config already written. **No Horizon code yet.** |
| **Belongs here** | Code requiring a native module (MapLibre RN, LiveKit RN, WebRTC), an OS permission flow, or a background task — plus the RN equivalents of working web modules, during the actual port. |
| **Never** | A forked copy of protocol truth (share `types.ts`, don't duplicate it). A reimplementation of standings (P2). An experiment better run in the faster PWA loop. |
| **Cost rule** | Adding a **native** dependency forces a dev-client rebuild. Native deps are expensive; JS deps are cheap. |
| **Standing order** | Per `mobile/AGENTS.md`: read the versioned **Expo v56** docs before writing anything here. The SDK has changed. |

### `mobile/src/app/`

| | |
|---|---|
| **Purpose** | expo-router file-based routes — file path *is* URL path. |
| **Belongs here** | Screens and layouts only. |
| **Never** | Shared components, hooks, or services. Everything currently here is template scaffolding to be deleted. |

### `mobile/src/components/`, `src/constants/`, `src/hooks/`

| | |
|---|---|
| **Purpose** | Currently **100% Expo template scaffolding** (`themed-text`, `web-badge`, `animated-icon`, `hint-row`, `collapsible`, `constants/theme.ts`, `use-color-scheme`). |
| **Action** | Delete during the port. Do not build on top of it. |
| **Belongs here (after the port)** | `components/` — presentational RN components used by more than one screen. `hooks/` — reusable RN hooks. `constants/` — genuine constants, not configuration. |
| **Never** | Business logic, protocol types, or store definitions. Those follow the flat `web/`-style layout: `core/`, `state/`, `net/`, `location/`, `map/`. |

> **Open decision:** `docs/SYSTEM_DESIGN.md` §5.1 and `docs/SETUP_MOBILE.md` §12 propose a `features/` layout,
> while `web/` uses a flatter one. Resolve this *before* the port begins — two conventions in one
> repo is a maintenance tax. Recommendation on the board: copy `web/`'s flat structure, because it
> is proven. This will get an ADR when decided.

### `mobile/assets/`, `mobile/scripts/`

Template images and `reset-project.js`. Both are scaffolding; prune to the icons and splash actually
referenced by `app.config.ts` during the port.

## `docs/ADR/`

| | |
|---|---|
| **Purpose** | Immutable record of *why* a decision was made, at the time it was made. |
| **Belongs here** | One file per decision, numbered sequentially, in the [ADR template](./ADR/README.md) format. |
| **Never** | Edits to a superseded ADR's decision. Add a new ADR that supersedes it and cross-link the two. ADRs are append-only history. |

---

# 4. Development Workflow

```
   Feature Request
         │
         ▼
 Architecture Discussion  ── needs an ADR? ──►  write docs/ADR/ADR-00N.md first
         │
         ▼
  Create Feature Branch   ── from an up-to-date main
         │
         ▼
    Implementation        ── small commits, Conventional Commits
         │
         ▼
       Testing            ── automated + the manual checklist
         │
         ▼
     Code Review          ── §10 checklist
         │
         ▼
        Merge             ── squash to one Conventional Commit
         │
         ▼
    Delete Branch         ── local and remote
```

### 1. Feature request

Anything anyone wants: a bug, an idea, a debt item. It lands as a row in `docs/PROJECT_BOARD.md` before
it becomes code. **No unrecorded work** — if it's worth a branch, it's worth a line on the board.

A board entry needs: title, priority, dependencies, expected files, acceptance criteria, complexity.
Writing those forces the design thinking that would otherwise happen halfway through implementation.

### 2. Architecture discussion

Before writing code, check the change against §2. Escalate to a written ADR if it:

- adds a third-party service or a backend dependency,
- changes the WebSocket protocol,
- changes where a computation lives (client ↔ server),
- changes the concurrency model,
- reverses a decision already recorded in an ADR.

Everything else — a bug fix, a UI change, a new endpoint that follows existing patterns — goes
straight to a branch. **Do not gold-plate this step.** Most work does not need an ADR.

### 3. Create a feature branch

```bash
git checkout main && git pull --ff-only
git checkout -b feature/route-ors-proxy
```

Branch from current `main`, never from another feature branch (unless you genuinely depend on
unmerged work — say so in the PR).

`main` is protected by convention: **no direct commits, ever.** Today the repo has a single `main`
branch and a linear history of direct commits — that was bootstrapping. From here, branches.

### 4. Implementation

- Keep the branch **narrow**. One board task, one branch. If you find a second bug, put it on the
  board and fix it in a second branch.
- Commit early and often on your branch; the history is squashed at merge, so working commits are
  cheap.
- Run formatters and vet as you go, not at the end.
- **Update docs in the same commit as the change.** A protocol change that doesn't touch `CLAUDE.md`
  is incomplete.
- If the branch grows past ~400 changed lines, stop and ask whether it should be two branches.

### 5. Testing

Run everything in §9 that applies. For any change touching GPS, the map, standings, or reconnection,
the **manual checklist is mandatory** — automated tests cannot observe a dot on a map.

### 6. Code review

Open a PR with the §7 checklist filled in. At least one reviewer other than the author. The reviewer
works through §10.

Reviews are about the code, not the coder. Use "this function" not "you". Distinguish blocking
comments from suggestions — prefix non-blocking ones with **nit:**.

### 7. Merge

**Squash and merge.** One board task = one commit on `main`. The squash commit message follows §6
and must reference the board task id.

Requirements before merge: green checks (once CI exists), one approval, no unresolved blocking
comments, branch rebased or merged up to date with `main`.

### 8. Delete the branch

```bash
git branch -d feature/route-ors-proxy
git push origin --delete feature/route-ors-proxy
```

Then move the task to **Completed Features** in `docs/PROJECT_BOARD.md`. A stale branch list is a lie
about what's in flight.

---

# 5. Branch Naming Convention

```
<type>/<short-kebab-case-description>
```

Lowercase, hyphens, no underscores, no spaces, no author names. Aim for 2–5 words — descriptive
enough that the branch list reads like a changelog.

| Prefix | Use for | Branches from | Example |
|---|---|---|---|
| `feature/` | New capability that didn't exist | `main` | `feature/route-ors-proxy` |
| `bugfix/` | Fixing broken behaviour in `main` | `main` | `bugfix/ghost-rider-rejoin-eviction` |
| `hotfix/` | Urgent fix to a deployed build; jumps the queue | `main` (or the release tag) | `hotfix/ws-origin-check` |
| `refactor/` | Restructuring with **no** behaviour change | `main` | `refactor/ranking-into-standings` |
| `docs/` | Documentation only, no code | `main` | `docs/adr-livekit-voice` |

### Examples grounded in current work

```
feature/route-ors-proxy                 POST /rides/{code}/route → OpenRouteService
feature/standings-cumulative-precompute Precompute segment lengths when a route is set
feature/voice-token-endpoint            LiveKit JWT minting
feature/web-route-line-layer            GeoJSON source + LineLayer in Map.tsx
feature/backend-structured-logging      slog: connect / disconnect / room lifecycle
feature/standings-unit-tests            First Go tests in the repo
feature/ride-url-persistence            Ride code in the URL + sessionStorage rehydrate
feature/mobile-core-port                types → store → socket → identity

bugfix/cors-preflight-middleware        POST /rides is blocked from the browser
bugfix/ghost-rider-rejoin-eviction      TODO(rejoin) in room.go
bugfix/room-gc-and-code-registry        Rooms are never destroyed; any string creates one
bugfix/mobile-expo-location-dep         Plugin referenced but package not installed
bugfix/geolocation-denied-ux            Permission denial is invisible to the rider
bugfix/join-code-length-validation      Lobby accepts 4 chars; codes are 6

hotfix/ws-origin-check                  CheckOrigin returns true for every origin

refactor/ranking-into-standings         Move sort + pos out of room.broadcast()
refactor/crypto-rand-tokens             math/rand → crypto/rand for codes and ids

docs/adr-mobile-directory-layout        Resolve features/ vs flat
docs/setup-guides-point-not-copy        Stop embedding full source in SETUP_*.md
```

**Two edge cases, so nobody invents a sixth prefix:**

- **Test-only work** uses `feature/` when it adds a suite that didn't exist
  (`feature/standings-unit-tests`) and `refactor/` when it restructures existing tests.
- **Tooling and CI** use `feature/` for new tooling (`feature/eslint-config`, `feature/ci-pipeline`)
  and `bugfix/` for fixing broken tooling (`bugfix/untrack-tsbuildinfo`).

---

# 6. Commit Message Convention

We use [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(<scope>): <subject>

<body — why, not what>

<footer — refs, breaking changes>
```

- **Subject:** imperative mood ("add", not "added"/"adds"), lowercase, no trailing period, ≤72 chars.
- **Body:** optional; wrap at 80. Explain *why* and what alternatives were rejected. The diff already
  says what changed.
- **Footer:** `Refs: HZ-3`, `Closes: HZ-3`, or `BREAKING CHANGE: <description>`.

### Types

| Type | Use for |
|---|---|
| `feat` | A new capability |
| `fix` | A bug fix |
| `refactor` | Restructuring, no behaviour change |
| `perf` | A performance change |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |
| `build` | Build system, dependencies, tooling config |
| `ci` | CI pipeline |
| `chore` | Housekeeping that fits nothing above |

### Scopes

Use the smallest accurate one.

| Scope | Area |
|---|---|
| `backend` | Cross-cutting backend (`main.go`, middleware, config) |
| `hub` | `internal/hub/` — rooms, clients, upgrade |
| `room` | Room lifecycle and broadcast specifically |
| `ws` | The WebSocket layer on either side |
| `standings` | The ranking / geometry package |
| `route` | Route fetching, storage, rendering |
| `voice` | LiveKit / push-to-talk |
| `web` | Cross-cutting web client |
| `map` | Map rendering on either client |
| `location` | GPS acquisition, wake lock, background tracking |
| `store` | Client state |
| `pwa` | Manifest, service worker, icons, install |
| `mobile` | The Expo app |
| `api` | REST endpoints or the protocol contract |
| `docs` | Documentation (when `docs` is also the type, omit the scope) |
| `deps` | Dependency changes |

### Examples

```
feat(route): implement ORS route ingestion
fix(room): remove stale rider
refactor(ws): simplify reconnect logic
docs(api): update websocket protocol
```

Grounded in real work on the board:

```
feat(backend): add CORS middleware with OPTIONS preflight

Browsers block the POST /rides response in split-origin dev, so "Start a ride"
fails with "Couldn't reach the server" while the server is running fine. A Vite
proxy would fix dev only; the mobile client and any non-same-origin deployment
need real CORS headers.

Refs: HZ-1
```

```
fix(room): evict the zombie connection on rejoin

Implements TODO(rejoin). Under the existing write lock, find the client sharing
this rider id, delete it, close its send channel, and carry lat/lng/speed/
lastSeen across so the dot unfreezes instead of vanishing.

Duplicate ids corrupted the standings tiebreak, duplicated React keys, and
permanently leaked a MapLibre marker.

Closes: HZ-2
```

```
feat(standings): precompute cumulative segment lengths

Drops two of three haversines per segment per rider per tick. At 15 riders,
4 Hz and a 3000-point route this is ~540k -> ~180k haversines/sec.

Refs: HZ-11
```

```
perf(room): compute distAlong outside the read lock
test(standings): table-driven haversine and projection cases
build(deps): add livekit server-sdk-go for token minting
ci: run go vet, go test and tsc -b on every push
docs: add ADR-006 on the zero-paid-services constraint
```

### Anti-examples — real, from this repository

```
❌ Implement new feature for user authentication and improve error handling
```

That is commit `56a8482`. It added **one file: `docs/ARCHITECTURE_REVIEW.md`.** No authentication, no
error handling, no code at all. Anyone scanning `git log` for when auth arrived would be misled, and
anyone bisecting would waste time. The honest version:

```
✅ docs: add full architecture review
```

Others to avoid:

```
❌ update docs               → docs: correct WS protocol after ghost-rider changes
❌ fix: ghost users          → the client half shipped; the server TODO didn't. Say so:
                               fix(web): send a stable rider id on reconnect
                               (server-side eviction still TODO — see HZ-2)
❌ wip / asdf / final fix    → squash these away before the PR is reviewable
```

**The rule:** the message must be true about what the diff does. Aspirational and copy-pasted commit
messages are worse than terse ones.

---

# 7. Pull Request Checklist

Paste this into the PR description and tick honestly. An unticked box with a one-line reason is fine;
a ticked box that isn't true is not.

```markdown
## What & why
<!-- One paragraph. Link the board task: Refs HZ-N -->

## How it was tested
<!-- Commands run, and which manual checklist items were exercised -->

## Both-clients note
<!-- How this behaves on Web and Mobile (P7). "Identical" is a valid answer. -->

## Checklist
- [ ] **Architecture respected** — checked against DEVELOPMENT_GUIDE §2; no ADR needed, or the ADR is in this PR
- [ ] **Tests pass** — `go vet ./... && go test ./...` and `tsc -b` clean
- [ ] **Manual checklist run** for anything touching GPS, map, standings, or reconnect
- [ ] **Documentation updated** — CLAUDE.md if the protocol or a rule changed; SETUP_*.md if setup changed; docs/PROJECT_BOARD.md task status moved
- [ ] **No unnecessary dependencies** — new deps justified per P5, backend deps have an ADR
- [ ] **No duplicated logic** — especially no standings math outside `internal/standings/`, and no third copy of the protocol
- [ ] **Mobile compatibility considered** — the feature works, or is knowingly deferred, on the native client
- [ ] **No secrets** — nothing key-shaped in the diff; `.env.example` updated with a blank if a new var was added
- [ ] **No new silent failure** — every new error path is visible in the UI or in a log line
- [ ] **Branch and commits follow §5 / §6**
```

---

# 8. Coding Standards

## Backend — Go

**Formatting.** `gofmt` is the whole style guide. `go fmt ./... && go vet ./...` must be clean before
every commit; there is no second formatter and no debate.

**Dependencies.** Standard library first. All packages under `internal/`. A new module requires an
ADR (P5).

**Naming.** Standard Go: `MixedCaps`, short receivers (`h *Hub`, `r *Room`, `c *Client`), no stutter
(`hub.New()`, not `hub.NewHub()`). Export only what crosses a package boundary — `Hub.ServeWS` and
`Hub.CreateRide` are exported; `room`, `genCode`, `broadcast` are not. Keep it that way.

**Errors.** Handle or return; never both. Never `_ = err`. Check `w.Write` and `json.Encode`
(currently unchecked in `main.go` — a board item). Wrap with context when returning across a package
boundary: `fmt.Errorf("fetch route: %w", err)`. Never `panic` in request-handling code.

**Concurrency — the load-bearing rules:**

- **Document what every mutex guards**, in a comment on the field. `Room.mu` guards the rider set,
  the route, *and* the mutable `Client` fields written by read pumps — that unusual arrangement must
  stay commented.
- **One lock at a time.** Today it is structurally impossible to deadlock because no code path holds
  two mutexes. Preserve that.
- **Never hold a lock across heavy computation or I/O.** Snapshot under the lock, compute after
  releasing. (`distAlong` currently violates this and is on the board.)
- **The `delete`-before-`close(send)` invariant is safety-critical.** A broadcast iterates clients
  under `RLock` and non-blocking-sends; unregister deletes from the map and closes the channel under
  `Lock`. Because the delete precedes the close inside the same critical section, a closed channel
  can never be in the iterated set. Break that ordering and you get a `send on closed channel` panic
  that kills every ride. **Any change near this code must restate the invariant in a comment.**
- **Backpressure is drop, never block.** A slow client loses a frame; it must never stall the room.
  Every `state` frame is a complete snapshot, so a drop costs 250 ms of freshness and nothing else.
- **New goroutines need an owner and an exit path.** Say in a comment what stops it. The room
  goroutine currently has neither, which is exactly the leak on the board.

**Logging.** Structured, via `log/slog`, once the logging task lands. Log lifecycle events
(connect, disconnect, room create/destroy, dropped frame, upstream error) with `ride`, `rider`, and
`name` as fields. **Never log coordinates at info level** — location is sensitive data (P9); debug
level only, and never in a deployed build.

**Comments.** Explain *why*. Every exported symbol gets a doc comment starting with its name. Cite
the governing document when a rule is non-obvious — the existing code does this well
(`// Dev-only: accept any origin. Tighten before any public deployment.`). Use `TODO(topic):` with a
description of what "done" looks like, matching the existing `TODO(rejoin)` / `TODO(later)` style.

**Files.** One concern per file. Keep files under ~200 lines; if a file crosses it, that is a signal,
not a rule.

## Frontend — Web (React + TypeScript)

**Formatting.** Match the existing code: 2-space indent, double quotes, semicolons, trailing commas
in multiline literals, ~100-char lines. ESLint + Prettier configs are on the board; until they land,
the existing files are the reference.

**TypeScript.** `strict` stays on. No `any`. No non-null `!` assertions — narrow instead. Prefer
`interface` for object shapes and `type` for unions, matching `types.ts`. Use
`import type { … }` for type-only imports.

**Components.** Function components and hooks only — no classes (`CLAUDE.md`). PascalCase names in
`.tsx` files; one component per file except for a tiny co-located helper like `Lobby` in `App.tsx`.
Props are typed inline or as a local `interface`.

**Hooks.** `use` prefix, in `.ts` files (they render nothing). One concern per hook. **Invert the
dependency:** `useGeo(active, onFix)` knows nothing about WebSockets — keep that shape for every new
sensor hook. Store rapidly-changing callbacks in a ref updated each render so the effect can depend
on a stable key and avoid re-subscribing.

**Effects.** Every effect that subscribes must unsubscribe. Dependency arrays are exhaustive and
honest — do not silence the linter with a comment. **All effects must be StrictMode-safe**: they
mount, unmount, and remount in dev, and both the socket and the MapLibre instance already handle
this correctly. Match that bar.

**State management.** Shared or externally-written state → the zustand store (P3). Genuinely local
UI state → `useState`. Read from the store with selectors in components
(`useRideStore((s) => s.riders)`) and with `useRideStore.getState()` inside non-React callbacks to
avoid stale closures — both patterns are already in use and both are correct in their place. Keep
the store flat; no middleware unless there's a reason.

**Map code.** All MapLibre access lives in `web/src/map/`. The `[lng, lat]` conversion happens there
and is commented at the conversion site. Reconcile markers by keyed diff (create / update / remove
against a `seen` set) — never rebuild the marker set wholesale.

**Error handling.** **A `console.warn` is not error handling.** Any failure a rider can cause or
notice — geolocation denied, wake lock refused, socket down, ride creation failed — must land in the
store and render as something actionable. This is the single most common defect in the current client
and new code must not add to it.

**Performance.** Do not add `memo`/`useMemo`/`useCallback` speculatively. At 4 Hz and ≤15 rows the
full re-render is free. Optimize when a profile says so.

**Naming.** `camelCase` values, `PascalCase` types and components, `SCREAMING_SNAKE` for module-level
constants (`STALE_AFTER_SEC`). Directory names are lowercase and singular (`net`, `store`, `map`,
`location`).

**Comments.** A file-header comment stating what the module owns — `ws.ts` and `types.ts` both do
this well. Cite the governing doc (`// docs/SYSTEM_DESIGN.md §6`) when encoding a rule. Comment the
non-obvious: the `[lng, lat]` flip, the StrictMode double-mount, the round-trip echo of your own dot.

## Mobile — React Native / Expo

Everything under "Frontend — Web" applies, plus:

- **Read the versioned Expo v56 docs first** (`mobile/AGENTS.md`). This is a standing instruction, not
  advice.
- **Custom dev client, never Expo Go.** MapLibre and LiveKit need native code.
- **Native deps are expensive.** Adding or upgrading one forces a dev-client rebuild. Call it out in
  the PR title.
- **Port, don't rewrite.** `types.ts` and the zustand store copy over unchanged. `ws.ts` needs one
  change: swap the `sessionStorage` identity backend for AsyncStorage/SecureStore — note the
  semantics shift from *per-tab* to *per-install*, which is what the server's rejoin logic actually
  wants.
- **Replace, don't port, the `location/` hooks.** `useGeo` becomes `Location.watchPositionAsync`
  (throttling moves from JS into the OS, which is strictly better for battery); `useWakeLock` is
  deleted outright, replaced by real background modes.
- **Background tasks run in a separate JS context** and cannot reuse the React-owned WebSocket. This
  is the hardest unsolved design question in the mobile path — it needs an ADR before Milestone 4
  code is written, not during.
- **Config drift is a build failure.** Every plugin in `app.config.ts` must have its package in
  `package.json`. This is currently broken for `expo-location`.

## Cross-cutting

**Naming.** One vocabulary everywhere: *ride* (the event), *join code* / *code* (the 6-char token),
*rider* (a participant), *fix* (one GPS reading), *state* (the broadcast frame), *standings* (the
ordering), *distAlong* (metres along the route), *stale* (no fix for >10 s). Do not introduce
synonyms — no "session", "user", "player", "position update", or "leaderboard".

**Configuration.** Everything environment-specific comes from an env var (backend) or a `VITE_`
variable (web). No host or port literals outside `config.ts` and `main.go`. Every new backend var
gets a commented, blank entry in `.env.example`.

**Files and formatting.** UTF-8, LF line endings, a trailing newline, no trailing whitespace.

---

# 9. Testing Guidelines

The repo currently has **zero automated tests**. The only artifact is `backend/wstest.mjs`, a manual
Node smoke script. Everything below describes the bar we hold *new* code to, and the order in which
we retrofit.

## What should be tested

**Priority 1 — pure logic (unit tests, always).**

- `internal/standings/`: haversine against known great-circle distances; `projectOntoSegment`
  including the `t` clamp at both ends; `DistAlongRoute` on a straight line, an L-bend, and — as a
  documented failing/skipped case — an out-and-back. **This is the single highest-value test in the
  project**, because Phase 2's correctness is otherwise unverifiable by eye on a moving map.
- Ranking and `pos` assignment, once moved out of `room.broadcast()`.
- Cumulative-length precompute, off-route thresholds, hysteresis — all pure, all table-driven.
- Client-side: join-code validation, any protocol parsing/validation helper.

**Priority 2 — protocol conformance.** One test that asserts the Go structs and `web/src/types.ts`
agree — a golden JSON fixture that both sides parse. Three independent copies of the protocol with
no conformance check is how `heading` silently drifted.

**Priority 3 — concurrency.** Room join/leave/rejoin under `go test -race`. Specifically: a rejoin
with the same rider id leaves exactly one client; a full send buffer drops a frame rather than
blocking; unregister during broadcast never panics.

**Priority 4 — lifecycle and handlers.** `httptest` coverage for CORS preflight, `/ws` query
validation (missing `ride` → 400, invalid `rider` → minted id), room creation and GC, and the ORS /
LiveKit proxies with a stubbed upstream (which is *why* those get their own packages).

## What should not be tested

- **Third-party behaviour.** MapLibre rendering, gorilla/websocket framing, zustand, the Expo SDK.
- **Rendering snapshots.** Four components and hand-written CSS — snapshots would break on every
  style tweak and catch nothing.
- **Anything requiring a real GPS chip, a real radio, or a real screen lock.** Those are
  road-test items, not test-suite items.
- **The map.** You cannot assert "the dot looks right". Test the data feeding the map instead.
- **Getters, constructors, and wiring.** No coverage theatre.
- **Exact float equality on geometry.** Always assert within a tolerance (metres, not bits).

**Coverage targets:** `internal/standings/` should approach 100% because it is pure and cheap. There
is no repo-wide coverage number and there will not be one.

## Manual testing checklist

Run the relevant sections before opening a PR. Two browser windows on one machine covers most of it.

**Every change**

- [ ] `cd backend && go fmt ./... && go vet ./... && go build ./...`
- [ ] `cd web && npm run build` (runs `tsc -b`)
- [ ] Backend starts clean; `GET /healthz` returns `ok`
- [ ] No new console errors or warnings in the browser

**Lobby and join**

- [ ] "Start a ride" returns a code and enters the ride *(currently blocked by the CORS bug)*
- [ ] Joining with a valid code enters the ride
- [ ] Joining with a bad code fails visibly — it must not silently create an empty room
- [ ] "Leave ride" returns to the lobby and fully resets state

**Core pipe (two windows, two names)**

- [ ] Both riders appear on both maps within a few seconds
- [ ] Both appear in both standings lists
- [ ] Each rider's own dot is highlighted and labelled "(you)"
- [ ] Speed renders plausibly (km/h)
- [ ] Rider count is correct — **no duplicates**

**Reconnect (the highest-value manual test)**

- [ ] Kill the backend → status shows "reconnecting"
- [ ] Restart it → clients reconnect within ~15 s and dots resume
- [ ] After reconnect there is **exactly one entry per rider** (the ghost-rider check)
- [ ] Toggle airplane mode / DevTools offline → same result
- [ ] Reload the page mid-ride → document the behaviour (today: ejected to the lobby)

**Staleness**

- [ ] Stop sending fixes for one rider → they grey out at ~10 s
- [ ] The list shows "Ns ago" instead of a frozen speed
- [ ] Closing the tab removes that rider from everyone's map

**Map**

- [ ] Dots land at the correct coordinates — **a `[lng, lat]` flip puts you in the ocean; check the
      map, not the numbers**
- [ ] Departed riders' markers are removed, not orphaned
- [ ] Camera centres once on the first self fix

**Standings** *(from Milestone 2 on)*

- [ ] With no route set, ordering is stable and doesn't jump
- [ ] With a route, the rider furthest along is 1st
- [ ] Positions don't flicker between two closely-spaced riders

**PWA** *(if you touched `web/`)*

- [ ] Installs to the home screen
- [ ] Icons render correctly, including the Android adaptive-icon mask
- [ ] Safe-area insets are respected on a notched device

**Backend concurrency** *(if you touched `internal/hub/`)*

- [ ] `go test -race ./...` clean
- [ ] Two clients rapidly joining and leaving the same code doesn't panic
- [ ] `node wstest.mjs` still passes

## Real-world testing checklist

**No feature is done until it has survived a real ride.** Desk testing cannot reproduce GPS drift,
tunnels, one-handed use in gloves, or a four-hour battery curve.

**Prerequisites** — HTTPS/`wss://` deployment; two real phones on mobile data (not shared Wi-Fi); a
mount and a charger; a planned route.

**Before rolling**

- [ ] Both phones install the PWA and join the same code
- [ ] Both riders see both dots before starting
- [ ] Location permission granted; wake lock confirmed held
- [ ] Note starting battery percentage and time

**During the ride**

- [ ] Dots track smoothly at speed; no teleporting or trailing
- [ ] Standings match physical reality — the rider in front is 1st
- [ ] Ride through a tunnel or dead zone: rider greys out, then **rejoins as one rider, not two**
- [ ] Lock and unlock the screen: does the wake lock survive? does tracking resume?
- [ ] Switch apps and return: tracking resumes
- [ ] Take a phone call mid-ride, then return to the app
- [ ] Voice *(Milestone 3)*: PTT is audible at speed, over wind, without cutting the map
- [ ] The phone doesn't overheat in direct sun

**After**

- [ ] Battery drain per hour, recorded
- [ ] Mobile data used, recorded
- [ ] Any moment a rider vanished, froze, or duplicated — with the wall-clock time, so it can be
      matched against server logs
- [ ] File every observation as a board task before the next ride

**Log the results.** A short "Ride N — date, route, riders, findings" note in the PR or the board
turns one afternoon into durable engineering data. The findings from the first real ride should
re-prioritize the backlog; that is their purpose.

---

# 10. Code Review Checklist

Questions every reviewer asks before approving. Work top to bottom — the early ones are the ones
that cost the most to fix later.

**Architecture**

1. Does this belong in this layer, or in the folder's **"Never"** list (§3)?
2. Does it violate a §2 principle? Most importantly: **is any authoritative computation happening on
   a client?**
3. Is there now more than one source of truth for the same value?
4. Should this have been an ADR — a new service, a protocol change, a moved computation, a
   concurrency change?
5. Does it make the mobile port harder, or add a browser-only assumption to the backend (P7)?

**Correctness**

6. What happens on the unhappy path — network down, permission denied, malformed frame, upstream 500?
7. What happens with **zero** riders? With **one**? With **fifteen**?
8. What happens on reconnect, and on a duplicate rider id?
9. Are coordinates in the right order at every boundary? Is any `[lng, lat]` literal outside `map/`?
10. Are units explicit — metres, m/s, seconds, degrees — and consistent at every call site?
11. Is there a new silent failure? Every dropped frame, swallowed exception, and ignored error is a
    future 2 a.m. debugging session.

**Concurrency (backend)**

12. What guards each field this code touches? Is that documented?
13. Is a lock held across computation or I/O?
14. Could two locks now be held at once?
15. Does every new goroutine have a defined exit path?
16. Is the `delete`-before-`close(send)` invariant still intact?

**State (clients)**

17. Should this be store state or local state — and is it in the right one?
18. Does every effect clean up? Is it StrictMode-safe?
19. Are dependency arrays honest?

**Simplicity**

20. Could this be shorter and more obvious? Is there an abstraction with exactly one caller?
21. Is there a new dependency, and is it justified (P5)?
22. Is duplicated logic being introduced — a second copy of the protocol, a second projection
    implementation?
23. Will a stranger understand this in six weeks without asking the author?

**Contract and docs**

24. If the protocol changed, did **all** implementations and `CLAUDE.md` change together?
25. Are new env vars in `.env.example`? Do setup docs still match reality?
26. Is the board task updated?

**Testing**

27. Is there a pure function here that should have a test?
28. Was the manual checklist actually run for GPS / map / standings / reconnect changes?
29. How would we know if this broke in production? Is there a log line?

**Security and privacy**

30. Any secret in the diff, or any key-shaped value reaching a client?
31. Does this widen what an unauthenticated caller can do — create rooms, allocate resources, mint
    tokens?
32. Is location data being logged, persisted, or sent anywhere new?

**Reviewer conduct.** Approve when it's better than what's there, not when it's perfect. Prefix
non-blocking comments with **nit:**. If a discussion exceeds three round trips, take it to a call and
record the outcome in the PR — or in an ADR if it turned out to be a real decision.

---

# 11. Definition of Done

A task is **not** done when the code works. It is done when every line below is true.

### Code works

- [ ] The acceptance criteria on the board task are met — all of them
- [ ] It works in the two-window local setup
- [ ] It works against a real backend, not a mock
- [ ] Nothing on the board's Known Bugs list got worse

### Edge cases handled

- [ ] Zero, one, and fifteen riders
- [ ] Disconnect, reconnect, and rejoin with the same rider id
- [ ] Permission denied — location, microphone, wake lock
- [ ] Malformed or hostile input: bad JSON, missing fields, an oversized frame, a wrong-length code
- [ ] Upstream failure — ORS or LiveKit down, slow, or rate-limited
- [ ] **Every failure is visible** to the rider, in a log, or both. Nothing fails silently.

### Documentation updated

- [ ] `CLAUDE.md` if the protocol or a rule changed
- [ ] `docs/SYSTEM_DESIGN.md` if a design decision changed, with an ADR for the decision itself
- [ ] `SETUP_*.md` if setup steps changed
- [ ] `.env.example` if a new variable was introduced
- [ ] `docs/PROJECT_BOARD.md` — task moved to Completed, and any newly discovered work filed
- [ ] Code comments explain the non-obvious parts, citing the governing doc

### No regressions

- [ ] `go fmt`, `go vet`, `go test ./...` clean
- [ ] `go test -race ./...` clean for anything touching `internal/hub/`
- [ ] `tsc -b` clean; web build succeeds
- [ ] The manual checklist sections relevant to this change were run
- [ ] No new console errors, no new dropped frames, no new goroutine that outlives its purpose

### Tested on real devices if applicable

Required for anything touching GPS, the map, voice, battery, background behaviour, or reconnection:

- [ ] Exercised on **two real phones**, outdoors, on mobile data
- [ ] Both iOS and Android if the change touches a platform API
- [ ] Battery impact observed over at least 30 minutes of real use
- [ ] Findings recorded on the board

### Merged and cleaned up

- [ ] Squashed to one Conventional Commit referencing the task id
- [ ] Branch deleted locally and remotely
- [ ] Board updated

> **The honest version of "done":** if you would be uncomfortable having a friend rely on this
> feature to find you on a ride, it isn't done.
