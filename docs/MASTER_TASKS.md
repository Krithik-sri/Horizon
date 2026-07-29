# Master Tasks — Horizon

> **The single source of truth for development.** Every piece of remaining work in this repository,
> broken into atomic tasks, ordered in the exact sequence they should be implemented.
>
> If a task isn't here, it isn't planned. If you're about to write code, it starts with a task id.

| | |
|---|---|
| **Generated** | 2026-07-28 |
| **Repo state** | branch `main`, clean tree, HEAD `56a8482` |
| **Total tasks** | 110 |
| **Done** | 3 |
| **Supersedes** | the task lists in [`docs/PROJECT_BOARD.md`](./PROJECT_BOARD.md) — see [ID migration](#id-migration) |

## How to use this document

1. **Work top to bottom.** [The execution sequence](#execution-sequence) is ordered to minimise
   rework. Deviating is allowed; doing so without checking the dependency column is not.
2. **One task, one branch, one PR, one squashed commit.** Every task here is independently
   completable — none requires a second task to land in the same branch, except where explicitly
   marked **bundle**.
3. **Find the detail** in [the task catalogue](#task-catalogue), grouped by area.
4. **Update `Status` in the same PR as the work.** A plan that lags the code is worse than no plan.

Companion documents — this file does not repeat them:

| Question | Document |
|---|---|
| How do I build this well? | [`docs/DEVELOPMENT_GUIDE.md`](./DEVELOPMENT_GUIDE.md) |
| How do I set up and submit? | [`docs/CONTRIBUTING.md`](./CONTRIBUTING.md) |
| Why is the architecture like this? | [`docs/ADR/`](./ADR/) · [`docs/SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md) |
| What does the system look like today? | [`docs/ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md) |
| What are the milestone-level goals and risks? | [`docs/ROADMAP.md`](./ROADMAP.md) |
| Bug root-cause detail | [`docs/PROJECT_BOARD.md`](./PROJECT_BOARD.md) → Known Bugs |

## Conventions

**ID** — `HZ-001`…`HZ-110`, assigned in initial implementation order, **permanent and never reused**.
If the sequence is later reordered, ids do *not* renumber; the `Seq` column is what moves.

**Priority**

| | Meaning |
|---|---|
| 🔴 **Critical** | Blocks other work, or a shipped path is broken |
| 🟠 **High** | Required for the current milestone |
| 🟡 **Medium** | Required eventually; nobody is blocked |
| 🟢 **Low** | Worth doing when the file is already open |

**Effort** — `S` up to half a day · `M` about a day · `L` two to four days · `XL` a week or more,
**and should be re-split before starting**.

**Status** — `Todo` · `In Progress` · `Done`. Nothing else. Blocked work stays `Todo` with its
dependency unmet.

**Group** — Infrastructure · Backend · Web · Mobile · Voice · Maps · Standings · Performance ·
Documentation · Deployment.

**bundle** — a handful of tasks are marked as needing to ship in the *same* PR as a named sibling,
because splitting them would mean validating the same behaviour twice. They are still specified
separately so the work is legible.

---

# Execution sequence

Twelve stages. **Each stage has a gate** — do not start the next until it passes. The gates are
where rework gets prevented.

## Stage 0 — Unblock the entry point

*Hours. The app's primary button does not work; nothing else can be manually tested through it.*

| Seq | ID | Task | Group | Pri | Eff | Depends on |
|---|---|---|---|---|---|---|
| 1 | HZ-001 | CORS middleware + OPTIONS preflight | Backend | 🔴 | S | — |
| 2 | HZ-002 | Untrack `.tsbuildinfo`, extend `.gitignore` | Infrastructure | 🟢 | S | — |
| 3 | HZ-003 | `.editorconfig` + line-ending policy | Infrastructure | 🟢 | S | — |

**Gate:** "Start a ride" returns a code in a browser, and `git status` is clean after a build.

## Stage 1 — Server guardrails and observability

*Before changing any hub behaviour. You cannot safely modify what you cannot observe, and a panic
in any handler currently destroys every in-progress ride.*

| Seq | ID | Task | Group | Pri | Eff | Depends on |
|---|---|---|---|---|---|---|
| 4 | HZ-004 | Panic recovery middleware | Backend | 🟠 | S | HZ-001 |
| 5 | HZ-005 | `http.Server` timeouts + graceful shutdown | Backend | 🟠 | S | HZ-001 |
| 6 | HZ-006 | Structured logging (`log/slog`) + request logging | Backend | 🟠 | M | HZ-004 |
| 7 | HZ-007 | Document the concurrency invariants (comment-only) | Backend | 🟠 | S | — |
| 8 | HZ-008 | Check unchecked `w.Write` / `json.Encode` errors | Backend | 🟢 | S | HZ-006 |

**Gate:** a panic in a handler returns 500 and the process survives; connect and disconnect appear
in the log with `ride` and `rider` fields.

## Stage 2 — Fix the core pipe

*The three critical defects. Every later feature compounds on top of these, and two of them corrupt
the exact data structures Stage 8 will sort.*

| Seq | ID | Task | Group | Pri | Eff | Depends on |
|---|---|---|---|---|---|---|
| 9 | HZ-009 | Rejoin eviction — the ghost-rider bug | Backend | 🔴 | M | HZ-007 |
| 10 | HZ-010 | Hub/room concurrency tests under `-race` | Backend | 🔴 | M | HZ-009 |
| 11 | HZ-011 | Join-code registry — reject unminted codes | Backend | 🔴 | M | HZ-010 |
| 12 | HZ-012 | Room garbage collection | Backend | 🔴 | M | HZ-011 |
| 13 | HZ-013 | Join-code TTL sweep | Backend | 🟡 | S | HZ-011 |
| 14 | HZ-014 | Web: exact 6-char join validation + unknown-code error | Web | 🟡 | S | HZ-011 |
| 15 | HZ-015 | `crypto/rand` for join codes and rider ids | Backend | 🟡 | S | HZ-011 |
| 16 | HZ-016 | `Hub.mu` `RWMutex` → `Mutex` | Backend | 🟢 | S | HZ-012 |

**Gate:** two clients, one killed and restored, produce **exactly one** rider entry; the last rider
leaving returns goroutine count to baseline; an unminted code is rejected; `go test -race ./...`
clean.

## Stage 3 — Test and tooling foundation

*Before writing the code these will validate. Cheap now, expensive to retrofit.*

| Seq | ID | Task | Group | Pri | Eff | Depends on |
|---|---|---|---|---|---|---|
| 17 | HZ-017 | `internal/standings` unit tests | Standings | 🟠 | M | — |
| 18 | HZ-018 | ESLint + Prettier for `web/` | Infrastructure | 🟡 | S | HZ-003 |
| 19 | HZ-019 | CI pipeline — vet, race tests, `tsc -b`, lint | Infrastructure | 🟠 | M | HZ-010, HZ-017, HZ-018 |
| 20 | HZ-020 | Protocol conformance golden fixture | Infrastructure | 🟠 | M | HZ-019 |
| 21 | HZ-021 | Mobile: install `expo-location` + `expo-task-manager` | Mobile | 🟠 | S | — |
| 22 | HZ-022 | Mobile: restore `scheme`, `version`, icon, splash | Mobile | 🟡 | S | HZ-021 |

**Gate:** CI is green on `main` and blocks merge on failure; `npx expo config` resolves.

## Stage 4 — Make failures visible

*Before the road test. Every failure mode currently in the client is silent, and a road test that
cannot tell you why something broke is a wasted afternoon.*

| Seq | ID | Task | Group | Pri | Eff | Depends on |
|---|---|---|---|---|---|---|
| 23 | HZ-023 | Store: error + permission state slice | Web | 🟠 | S | HZ-018 |
| 24 | HZ-024 | Geolocation denial and failure UX | Web | 🟠 | M | HZ-023 |
| 25 | HZ-025 | Wake-lock status indicator | Web | 🟠 | M | HZ-023 |
| 26 | HZ-026 | Runtime validation of inbound messages | Web | 🟡 | S | HZ-020 |
| 27 | HZ-027 | Reconnect backoff jitter | Web | 🟢 | S | — |
| 28 | HZ-028 | Refresh the read deadline on data frames | Backend | 🟢 | S | HZ-010 |

**Gate:** denying location permission and forcing a wake-lock refusal both produce visible,
actionable UI.

## Stage 5 — Harden for public exposure, then deploy

*HTTPS is a hard prerequisite for geolocation, wake lock, PWA install **and** WebRTC. Until this
stage lands, every feature is being validated in desk tabs. Caps and origin checks come first
because deploying is the moment the server becomes reachable by strangers.*

| Seq | ID | Task | Group | Pri | Eff | Depends on |
|---|---|---|---|---|---|---|
| 29 | HZ-029 | Rate limiting + connection and room caps | Backend | 🟠 | M | HZ-012 |
| 30 | HZ-030 | `CheckOrigin` allowlist | Backend | 🔴 | S | HZ-001 |
| 31 | HZ-031 | Readiness endpoint | Backend | 🟡 | S | HZ-006 |
| 32 | HZ-032 | Deploy the backend to Koyeb | Deployment | 🔴 | M | HZ-029, HZ-030, HZ-031 |
| 33 | HZ-033 | Cloudflare Tunnel — HTTPS and `wss://` | Deployment | 🔴 | M | HZ-032 |
| 34 | HZ-034 | Host the web build; production config | Deployment | 🔴 | M | HZ-033 |
| 35 | HZ-035 | Uptime monitoring + log access | Deployment | 🟡 | S | HZ-033 |
| 36 | HZ-036 | Deployment runbook | Documentation | 🟡 | S | HZ-034 |

**Gate:** the PWA installs from an HTTPS URL on a real phone, joins a ride over `wss://`, and a
cross-origin page is refused by `CheckOrigin`.

## Stage 6 — Ride it

*A development step, not QA. Everything after this should be prioritised against what it reveals.*

| Seq | ID | Task | Group | Pri | Eff | Depends on |
|---|---|---|---|---|---|---|
| 37 | HZ-037 | Ride log template | Documentation | 🟡 | S | — |
| 38 | HZ-038 | **Road test #1 — the core pipe on real roads** | Deployment | 🔴 | M | HZ-034, HZ-037 |
| 39 | HZ-039 | Triage findings and re-sequence the plan | Documentation | 🔴 | S | HZ-038 |

**Gate:** a completed ride log exists, and every observation is a task in this file.

## Stage 7 — Ride usability

*Ordered as written, but **HZ-039 may reorder this entire stage** — that is its purpose.*

| Seq | ID | Task | Group | Pri | Eff | Depends on |
|---|---|---|---|---|---|---|
| 40 | HZ-040 | Persist the ride across a reload | Web | 🟠 | M | HZ-039 |
| 41 | HZ-041 | Ride code in the URL — shareable join link | Web | 🟠 | M | HZ-040 |
| 42 | HZ-042 | Follow camera + recentre control | Maps | 🟠 | M | HZ-039 |
| 43 | HZ-043 | Fit-bounds-to-group control | Maps | 🟡 | S | HZ-042 |
| 44 | HZ-044 | Marker position interpolation | Maps | 🟡 | M | HZ-042 |
| 45 | HZ-045 | Queue GPS fixes across a reconnect | Web | 🟡 | M | HZ-039 |
| 46 | HZ-046 | Service-worker update prompt | Web | 🟡 | S | HZ-034 |
| 47 | HZ-047 | Runtime tile caching | Web | 🟡 | S | HZ-046 |
| 48 | HZ-048 | Maskable icon safe zone + manifest completeness | Web | 🟢 | S | — |

**Gate:** Milestone 1 success criteria in [`docs/ROADMAP.md`](./ROADMAP.md#milestone-1--stable-realtime-platform)
are all met.

## Stage 8 — Route and standings

*The largest stage. Three tasks are **bundled** with the route endpoint because the performance
cost lands the instant the endpoint does, and retrofitting means validating standings twice.*

| Seq | ID | Task | Group | Pri | Eff | Depends on |
|---|---|---|---|---|---|---|
| 49 | HZ-049 | ORS client package with a stubbable interface | Backend | 🟠 | M | HZ-017 |
| 50 | HZ-050 | `standings.Route` with precomputed cumulative lengths | Performance | 🟠 | M | HZ-017 |
| 51 | HZ-051 | Benchmark `distAlong` against a realistic route | Performance | 🟠 | S | HZ-050 |
| 52 | HZ-052 | Route setter on `Room` + documented lock convention | Backend | 🟠 | S | HZ-050 |
| 53 | HZ-053 | `POST /rides/{code}/route` — ORS proxy | Backend | 🟠 | L | HZ-049, HZ-052 |
| 54 | HZ-054 | Once-per-ride fetch enforcement + response cache | Backend | 🟠 | S | HZ-053 |
| 55 | HZ-055 | Compute `distAlong` outside `r.mu.RLock()` — **bundle with HZ-053** | Performance | 🟠 | S | HZ-053 |
| 56 | HZ-056 | Move ranking and `pos` into `standings` | Standings | 🟡 | M | HZ-055 |
| 57 | HZ-057 | Store: route slice | Web | 🟠 | S | HZ-053 |
| 58 | HZ-058 | `net/api.setRoute()` | Web | 🟠 | S | HZ-057 |
| 59 | HZ-059 | Route line layer on the map | Maps | 🟠 | M | HZ-058 |
| 60 | HZ-060 | Destination picker — deliberately crude | Maps | 🟠 | M | HZ-059 |
| 61 | HZ-061 | Standings UI: `distAlong` and gap | Web | 🟡 | S | HZ-059 |
| 62 | HZ-062 | Restore the route after a server restart | Web | 🟡 | M | HZ-060 |
| 63 | HZ-063 | Protocol: add `accuracy` | Backend | 🟡 | M | HZ-020 |
| 64 | HZ-064 | GPS outlier rejection | Standings | 🟡 | M | HZ-063 |
| 65 | HZ-065 | Windowed monotonic projection | Standings | 🟠 | L | HZ-060, HZ-064 |
| 66 | HZ-066 | Off-route detection — stop discarding `bestDist` | Standings | 🟠 | M | HZ-065 |
| 67 | HZ-067 | Off-route indication in the UI | Web | 🟡 | S | HZ-066 |
| 68 | HZ-068 | Standings hysteresis | Standings | 🟡 | M | HZ-071 |
| 69 | HZ-069 | Protocol: add `heading` to `state` | Backend | 🟡 | S | HZ-020 |
| 70 | HZ-070 | Heading arrows on markers | Maps | 🟢 | S | HZ-069 |
| 71 | HZ-071 | **Road test #2 — standings on a real route** | Deployment | 🔴 | M | HZ-066 |

**Note on HZ-068:** hysteresis depends on the road test, not the reverse. You cannot tune the
threshold until you have watched real standings flicker.

**Gate:** the rider physically in front is shown as 1st, for a whole ride, on a real route.

## Stage 9 — Voice

*Last of the three product goals, and deliberately so: it is the only feature fully independent of
the location pipe, which makes it the safest to defer.*

| Seq | ID | Task | Group | Pri | Eff | Depends on |
|---|---|---|---|---|---|---|
| 72 | HZ-072 | LiveKit account + env wiring | Voice | 🟠 | S | — |
| 73 | HZ-073 | `POST /rides/{code}/voice-token` — mint the JWT | Voice | 🟠 | M | HZ-011, HZ-072 |
| 74 | HZ-074 | Token endpoint tests | Voice | 🟠 | S | HZ-073 |
| 75 | HZ-075 | Store: voice slice | Voice | 🟡 | S | HZ-073 |
| 76 | HZ-076 | Web: connect to the LiveKit room | Voice | 🟠 | M | HZ-075 |
| 77 | HZ-077 | Push-to-talk control + iOS gesture gate | Voice | 🟠 | M | HZ-076 |
| 78 | HZ-078 | Speaking indicators and participant list | Voice | 🟡 | S | HZ-077 |
| 79 | HZ-079 | Voice failure isolation + error UX | Voice | 🟡 | S | HZ-077 |
| 80 | HZ-080 | Battery measurement with voice active | Performance | 🟠 | M | HZ-077 |
| 81 | HZ-081 | **Road test #3 — voice at speed** | Deployment | 🟠 | M | HZ-079, HZ-080 |

**Gate:** two riders held a conversation on a real ride, and a LiveKit outage degrades voice only.

## Stage 10 — Native client

*Port working code; do not rewrite it. Two ADRs must land before any porting starts.*

| Seq | ID | Task | Group | Pri | Eff | Depends on |
|---|---|---|---|---|---|---|
| 82 | HZ-082 | ADR-007 — mobile directory layout | Documentation | 🟠 | S | — |
| 83 | HZ-083 | Delete the Expo template scaffolding | Mobile | 🟡 | S | HZ-082 |
| 84 | HZ-084 | Build and distribute the dev client | Mobile | 🟠 | M | HZ-022, HZ-083 |
| 85 | HZ-085 | Port the protocol types — shared, not forked | Mobile | 🟠 | S | HZ-020, HZ-084 |
| 86 | HZ-086 | Port the zustand store | Mobile | 🟠 | S | HZ-085 |
| 87 | HZ-087 | Port `net/config` — emulator and LAN hosts | Mobile | 🟠 | S | HZ-085 |
| 88 | HZ-088 | Port identity to persistent storage | Mobile | 🟠 | S | HZ-087 |
| 89 | HZ-089 | Port the WebSocket client | Mobile | 🟠 | M | HZ-086, HZ-088 |
| 90 | HZ-090 | Foreground location via `expo-location` | Mobile | 🟠 | M | HZ-089 |
| 91 | HZ-091 | Port the map | Mobile | 🟠 | L | HZ-089 |
| 92 | HZ-092 | Port the lobby and ride screens | Mobile | 🟠 | M | HZ-090, HZ-091 |
| 93 | HZ-093 | Port the standings UI | Mobile | 🟡 | S | HZ-092 |
| 94 | HZ-094 | ADR-008 — background task ↔ socket ownership | Documentation | 🔴 | M | HZ-089 |
| 95 | HZ-095 | Background location + foreground service | Mobile | 🔴 | XL | HZ-092, HZ-094 |
| 96 | HZ-096 | `registerGlobals()` + `AudioSession` | Mobile | 🟠 | S | HZ-092 |
| 97 | HZ-097 | Native voice + PTT | Voice | 🟠 | L | HZ-077, HZ-096 |
| 98 | HZ-098 | **Road test #4 — pocket test, mixed clients** | Deployment | 🔴 | M | HZ-095 |

**Gate:** a rider pockets the phone for an hour and stays visible; a native rider and a PWA rider
share one ride with zero backend changes.

## Stage 11 — Production ready

*Hardening. The easiest work to defer forever, which is why it is a named stage with a gate.*

| Seq | ID | Task | Group | Pri | Eff | Depends on |
|---|---|---|---|---|---|---|
| 99 | HZ-099 | Metrics endpoint | Backend | 🟡 | M | HZ-035 |
| 100 | HZ-100 | Adaptive GPS rate when stationary | Performance | 🟠 | M | HZ-098 |
| 101 | HZ-101 | Dim the map when idle | Performance | 🟡 | S | HZ-100 |
| 102 | HZ-102 | Measure mobile data usage per ride hour | Performance | 🟡 | S | HZ-098 |
| 103 | HZ-103 | Per-rider visibility control | Web | 🟡 | M | HZ-098 |
| 104 | HZ-104 | Honour the `POST /rides` body — ride metadata | Backend | 🟢 | S | HZ-020 |
| 105 | HZ-105 | Setup docs: point at files, stop copying source | Documentation | 🟡 | M | — |
| 106 | HZ-106 | Fix stale path references in setup docs | Documentation | 🟢 | S | — |
| 107 | HZ-107 | Reconcile the README phase table | Documentation | 🟡 | S | HZ-048 |
| 108 | HZ-108 | Operations runbook | Documentation | 🟡 | M | HZ-099 |
| 109 | HZ-109 | **Five-ride reliability gate** | Deployment | 🔴 | L | HZ-100 |
| 110 | HZ-110 | Critical-zero audit | Documentation | 🟠 | S | HZ-109 |

**Gate:** five real rides with no rider-visible failure, and no Critical task open.

---

# Progress

| Stage | Tasks | Todo | In Progress | Done |
|---|---|---|---|---|
| 0 — Unblock | 3 | 0 | 0 | 3 |
| 1 — Guardrails | 5 | 5 | 0 | 0 |
| 2 — Core pipe | 8 | 8 | 0 | 0 |
| 3 — Tooling | 6 | 6 | 0 | 0 |
| 4 — Visible failures | 6 | 6 | 0 | 0 |
| 5 — Deploy | 8 | 8 | 0 | 0 |
| 6 — Ride it | 3 | 3 | 0 | 0 |
| 7 — Usability | 9 | 9 | 0 | 0 |
| 8 — Standings | 23 | 23 | 0 | 0 |
| 9 — Voice | 10 | 10 | 0 | 0 |
| 10 — Native | 17 | 17 | 0 | 0 |
| 11 — Production | 12 | 12 | 0 | 0 |
| **Total** | **110** | **107** | **0** | **3** |

By group: Backend 25 · Stage-8 Standings 6 · Web 18 · Mobile 15 · Documentation 10 · Deployment 9 ·
Voice 9 · Performance 7 · Maps 6 · Infrastructure 5.

---

# Task catalogue

Grouped by area. **Ids are not contiguous within a group** — they follow the execution sequence
above, so a group's tasks are scattered across stages by design. Each entry reads:

> `Group` · Priority · Effort · Status · branch name

---

## Infrastructure

### HZ-002 · Untrack `.tsbuildinfo`, extend `.gitignore`
`Infrastructure` · 🟢 Low · **S** · **Done ✅** · `bugfix/untrack-tsbuildinfo`
**Depends on:** —
**Why:** `web/tsconfig.app.tsbuildinfo` and `web/tsconfig.node.tsbuildinfo` are tracked and absent
from `web/.gitignore`, so every build dirties the tree and every diff carries noise. Doing this
first keeps all 109 later diffs clean.
**Files**
- `web/.gitignore` — add `*.tsbuildinfo`
- `git rm --cached web/tsconfig.app.tsbuildinfo web/tsconfig.node.tsbuildinfo`

**Acceptance**
- [x] Both files are removed from the index but remain on disk
- [x] `*.tsbuildinfo` is ignored
- [x] `git status` is clean after `npm run build`

**Testing**
- [x] `cd web && npm run build && git status --short` prints nothing — verified: the build
      regenerated both `.tsbuildinfo` files and `dist/`, and none of them appear in `git status`
- [x] A fresh clone builds without the files present — verified by deleting both files and
      rebuilding; `tsc -b` does a full build and regenerates them

**Implemented beyond the original scope** *(the file was open; each rule was verified with
`git check-ignore`)*

The task as written covered only `web/.gitignore`. The audit that preceded this work found the
same class of gap across all four ignore files, so they were closed together:

- **Root `.gitignore` rewritten** to hold repo-wide concerns only — OS junk (`.DS_Store`,
  `Thumbs.db`, `desktop.ini`), editor swap/backup files (`*.swp`, `*.swo`, `*~`), un-anchored
  `.idea/`, a `**/.vscode/*` rule with negations for the four files a team shares deliberately,
  root-level secrets, and logs/temp files. Its three duplicated subpackage rules
  (`/web/node_modules`, `/web/dist`, `/mobile/node_modules`) were dropped — each package already
  ignores its own build output, and two files having to agree forever is how they drift.
- **`backend/.gitignore`** — added `*.test`, `*.out`, `coverage.*` (HZ-019's CI needs coverage
  ignored) and `*.exe`; anchored `server` → `/server`, which previously also matched a *directory*
  named `server` at any depth.
- **`mobile/.gitignore`** — anchored `example` → `/example`. Unanchored it matched any file or
  directory named `example` at any depth, so a future `mobile/src/components/example/` would have
  vanished silently.
- **`web/.gitignore`** — `*.tsbuildinfo` (the task item), plus `.eslintcache` and `coverage/`.

Verified that no currently-tracked file became ignored: `git ls-files | git check-ignore --stdin`
returns empty. All three `.env.example` files remain trackable.

---

### HZ-003 · `.editorconfig` and line-ending policy
`Infrastructure` · 🟢 Low · **S** · **Done ✅** · `feature/editorconfig`
**Depends on:** —
**Why:** The repo is developed on Windows and deployed on Linux. Without a stated policy, CRLF/LF
churn will eventually produce a diff that touches every line of a file.
**Files**
- `.editorconfig` *(new)* — UTF-8, LF, trailing newline, no trailing whitespace; 2-space for
  `*.{ts,tsx,js,mjs,json,css,md}`, tabs for `*.go`
- `.gitattributes` *(new)* — `* text=auto eol=lf`
- `docs/CONTRIBUTING.md` — note `core.autocrlf input` for Windows contributors

**Acceptance**
- [x] `.editorconfig` matches the existing style of `web/src/` and `backend/` — tabs for `*.go`
      (gofmt already produces them), 2-space for TS/TSX/JS/JSON/CSS/MD (what `web/src/` already
      uses). `*.md` opts out of `trim_trailing_whitespace`: two trailing spaces are a hard line
      break in Markdown, and the docs are Markdown-heavy
- [x] `.gitattributes` normalises line endings on commit — `* text=auto eol=lf`
- [x] No existing file is reformatted by this change

**Testing**
- [x] `git diff --stat` after adding shows only the two new files — plus the ignore and doc files
      this branch also changes; **zero** tracked source content changed
- [ ] Editing a `.go` and a `.tsx` file in an EditorConfig-aware editor produces no style drift —
      **pending**, needs a human in an editor

**Note on the premise — normalisation was not required**

The task anticipated CRLF/LF churn. The audit found the index was **already 100% LF**
(`git ls-files --eol`: 90 text files, 21 binary, 0 `i/crlf`). The CRLF was only ever in the
working tree, put there by `core.autocrlf=true` in `C:/Program Files/Git/etc/gitconfig` — the Git
for Windows *system* default, not repo or user config.

So `.gitattributes` changed no tracked content and needed no `git add --renormalize` and no
history rewrite. What it fixes is real and immediate: **all seven `backend/*.go` files were failing
`gofmt -l` purely because gofmt read CRLF**, which would have failed HZ-019's `go fmt` diff check
in CI. That resolves on the next checkout, when the files materialise as LF.

`docs/CONTRIBUTING.md` was updated to describe `.gitattributes` as the canonical policy rather
than `core.autocrlf input` — attributes take precedence over that config, so telling contributors
to set it was advice that could not be relied on and is no longer needed.

---

### HZ-018 · ESLint + Prettier for `web/`
`Infrastructure` · 🟡 Medium · **S** · Todo · `feature/eslint-prettier-config`
**Depends on:** HZ-003
**Why:** `CLAUDE.md` mandates `go fmt` + `go vet` for Go and nothing for TypeScript. The client has
no linter and no formatter, so style is enforced by reviewer attention alone.
**Files**
- `web/eslint.config.js` *(new)* — flat config: `typescript-eslint`, `eslint-plugin-react-hooks`,
  `eslint-plugin-react-refresh`
- `web/.prettierrc` *(new)* — 2-space, double quotes, semicolons, trailing commas, 100 cols
- `web/package.json` — `lint`, `lint:fix`, `format`, `format:check` scripts + devDependencies
- `docs/DEVELOPMENT_GUIDE.md` §8 — replace "configs don't exist yet" with the commands

**Acceptance**
- [ ] Config encodes the *existing* style; running `format` reformats nothing meaningful
- [ ] `react-hooks/exhaustive-deps` is an **error**, not a warning — honest dependency arrays are a
      stated standard
- [ ] `no-explicit-any` and `no-non-null-assertion` are errors
- [ ] `npm run lint` passes on the current tree, or every exception is inline-justified
- [ ] Dev-dependencies only; no runtime dependency added

**Testing**
- [ ] `npm run lint` exits 0
- [ ] `npm run format:check` exits 0
- [ ] Introducing a deliberate `any` fails the lint
- [ ] `npm run build` still succeeds

---

### HZ-019 · CI pipeline
`Infrastructure` · 🟠 High · **M** · Todo · `feature/ci-pipeline`
**Depends on:** HZ-010, HZ-017, HZ-018
**Why:** Nothing currently enforces `go vet`, `go test`, `tsc -b`, or formatting. Every gate in this
document is honour-system until CI exists.
**Files**
- `.github/workflows/ci.yml` *(new)* — two jobs, `backend` and `web`
- `.github/pull_request_template.md` *(new)* — the checklist from `docs/DEVELOPMENT_GUIDE.md` §7
- `README.md` — CI badge

**Acceptance**
- [ ] Backend job: `go fmt` diff check, `go vet ./...`, `go build ./...`, `go test -race ./...`
- [ ] Web job: `npm ci`, `npm run lint`, `npm run format:check`, `npm run build`
- [ ] Runs on push to `main` and on every PR
- [ ] Fails the PR on any non-zero exit
- [ ] Dependency caching for Go modules and npm
- [ ] Completes in under 5 minutes

**Testing**
- [ ] A PR with a formatting violation fails
- [ ] A PR with a failing test fails
- [ ] A PR with a data race fails the race detector
- [ ] A clean PR passes

---

### HZ-020 · Protocol conformance golden fixture
`Infrastructure` · 🟠 High · **M** · Todo · `feature/protocol-conformance-test`
**Depends on:** HZ-019
**Why:** The wire format is defined independently in Go structs and `web/src/types.ts`, and the
mobile port will make it three. There is no shared schema and no test asserting they agree —
`heading` has already drifted with only two implementations. **Land this before the mobile port,
not after.**
**Files**
- `protocol/fixtures/*.json` *(new)* — canonical `loc`, `welcome`, and `state` payloads
- `backend/internal/hub/protocol_test.go` *(new)* — marshal/unmarshal each fixture, assert exact
  field sets
- `web/src/types.test.ts` *(new)* — parse each fixture against the TypeScript types
- `.github/workflows/ci.yml` — run both
- `CLAUDE.md` — point the protocol section at the fixtures as the canonical example

**Acceptance**
- [ ] One fixture directory is the single canonical example, consumed by every implementation
- [ ] Go test fails if a struct tag is renamed, added, or removed
- [ ] Web test fails if a field is missing or mistyped
- [ ] Adding a field to one side and not the other fails CI
- [ ] The fixtures are referenced from `CLAUDE.md` so the docs cannot drift silently

**Testing**
- [ ] Rename a JSON tag in `riderState` → the Go test fails
- [ ] Remove a field from `Rider` in `types.ts` → the web test fails
- [ ] Both suites pass on the current tree

---

## Backend

### HZ-001 · CORS middleware with `OPTIONS` preflight
`Backend` · 🔴 Critical · **S** · **Done ✅** · `bugfix/cors-preflight-middleware`
**Depends on:** —
**Why:** `POST /rides` sends no `Access-Control-Allow-Origin`. The dev page is at `:5173` and the API
at `:8080`, so the browser blocks the response, the promise rejects, and the lobby reports
*"Couldn't reach the server"* — while the server is running and has already minted a code. **The
primary entry point of the only working client does not work.** It hides because WebSocket
handshakes are exempt from CORS and any string creates a room, so the pipe is testable via Join.
**Files**
- `backend/internal/httpx/middleware.go` *(new)* — `CORS(allowed []string) func(http.Handler) http.Handler`
- `backend/main.go` — wrap the mux; register `OPTIONS` handling
- `backend/.env.example` — `ALLOWED_ORIGINS` with a comment
- `docs/SETUP_BACKEND.md` — document the variable

**Acceptance**
- [x] `POST /rides` from `http://localhost:5173` succeeds and the code reaches the UI —
      *server side verified; the "reaches the UI" half is pending browser verification below*
- [x] `OPTIONS` returns 204 with `Allow-Origin`, `Allow-Methods`, `Allow-Headers`
- [x] Preflighted `Content-Type: application/json` requests pass — HZ-053 and HZ-073 need this
- [x] Origins come from `ALLOWED_ORIGINS`; empty means permissive **and logs a warning**
- [x] The middleware wraps the whole mux, so `/ws` and future routes inherit it
- [x] No third-party dependency added

**Testing**
- [x] `httptest`: simple POST carries the allow-origin header
- [x] `httptest`: preflight returns 204 with the right headers
- [x] `httptest`: a disallowed origin is refused when `ALLOWED_ORIGINS` is set
- [ ] Manual: "Start a ride" works in the browser with backend and web on different ports
      — **pending**

**Verification** *(audited 2026-07-29 against `backend/` at branch `feature/hz-001-cors-middleware`)*

- **Unit tests — pass.** `backend/internal/httpx/middleware_test.go`, 27 subtests across
  `TestParseOrigins` and `TestCORS`. `go test -count=1 ./...`, `go vet ./...` and
  `go build ./...` are all clean. Coverage goes past the list above: `Origin: null` is denied,
  matching is case-exact, the headers survive an inner 500, and `Allow-Origin` is never `*`.
  `-race` was **not** run — it needs `CGO_ENABLED=1` and a C toolchain; HZ-019's CI will cover it.
- **Runtime verification — pass.** Against a running binary with
  `ALLOWED_ORIGINS=http://localhost:5173,http://192.168.1.50:5173`: an allowed origin gets
  `200` + the echoed `Access-Control-Allow-Origin`; a disallowed origin gets `200` with **no**
  allow-origin header (the browser discards it, which is how CORS refuses) and a disallowed
  *preflight* gets `403`; an allowed preflight on `/rides/{code}/route` returns `204` with the
  full header set — proving it terminates in the middleware and never reaches the
  `501` stub. Blank `ALLOWED_ORIGINS` logs the startup warning and allows every origin.
- **WebSocket verification — pass.** A real handshake through the middleware returns
  `101 Switching Protocols` followed by `welcome` and the 4 Hz `state` frames, so the
  `http.Hijacker` assertion in `gorilla/websocket` is intact. Nothing in `httpx` wraps
  `http.ResponseWriter`, and the package doc states that constraint for whoever adds request
  logging.
- **Manual browser verification — pending.** Not yet performed. `POST /rides` from
  `web/src/net/api.ts` is a *simple* request (no `Content-Type`, no body), so it exercises the
  simple-request path rather than the preflight path; the equivalent call has been confirmed by
  hand, but "Start a ride" has not been clicked in a browser. Close this box before the Stage 0
  gate is called.

---

### HZ-004 · Panic recovery middleware
`Backend` · 🟠 High · **S** · Todo · `feature/backend-panic-recovery`
**Depends on:** HZ-001
**Why:** There is no recovery anywhere. A panic in any handler goroutine kills the process, and
because all state is in memory, **every in-progress ride is destroyed with it.**
**Files**
- `backend/internal/httpx/middleware.go` — add `Recover(next http.Handler) http.Handler`
- `backend/main.go` — outermost wrapper, outside CORS

**Acceptance**
- [ ] A panic in a handler returns 500 and the process survives
- [ ] The panic value and stack are logged
- [ ] Recovery is the outermost middleware
- [ ] Panics in the read/write pumps are recovered too, or their absence is explicitly justified in
      a comment — they run outside the HTTP handler chain

**Testing**
- [ ] `httptest`: a handler that panics yields 500 and the test process survives
- [ ] The stack trace appears in the log output
- [ ] Manual: a panicking test route does not drop other clients' WebSockets

---

### HZ-005 · `http.Server` timeouts and graceful shutdown
`Backend` · 🟠 High · **S** · Todo · `feature/backend-server-lifecycle`
**Depends on:** HZ-001
**Why:** `http.ListenAndServe` leaves `ReadHeaderTimeout`, `ReadTimeout`, and `IdleTimeout` unset, so
a slow-loris client can hold connections indefinitely. There is also no drain on SIGTERM, which
matters the moment HZ-032 deploys to a platform that restarts containers.
**Files**
- `backend/main.go` — construct an `http.Server`; `signal.NotifyContext`; `srv.Shutdown(ctx)`

**Acceptance**
- [ ] `ReadHeaderTimeout` set (5s); `IdleTimeout` set (120s)
- [ ] **No `WriteTimeout`, or one long enough not to kill WebSockets** — a naive `WriteTimeout`
      breaks long-lived connections. Whichever is chosen, comment why.
- [ ] SIGTERM/SIGINT stops accepting, drains with a bounded grace period, then exits 0
- [ ] Active WebSockets receive a close frame during shutdown rather than being cut
- [ ] Startup and shutdown are logged

**Testing**
- [ ] A WebSocket held open for >2 minutes with no data is not killed by a server timeout
- [ ] SIGTERM during an active ride closes cleanly; clients report a normal close and reconnect
- [ ] A connection that sends no headers is dropped after `ReadHeaderTimeout`

---

### HZ-006 · Structured logging and request logging
`Backend` · 🟠 High · **M** · Todo · `feature/backend-structured-logging`
**Depends on:** HZ-004
**Why:** The backend emits exactly one `log.Printf`, at startup. When a rider says *"I vanished
halfway up the climb"* there is no data to distinguish GPS loss, wake-lock refusal, socket drop, a
dropped frame, or ghost-rider confusion. **This must exist before Stage 8** — standings cannot be
debugged from a moving bicycle.
**Files**
- `backend/main.go` — `slog` handler, level from env
- `backend/internal/httpx/middleware.go` — request logging (method, path, status, duration)
- `backend/internal/hub/hub.go` — connect, upgrade failure, unknown code
- `backend/internal/hub/room.go` — room create/destroy, rejoin eviction, dropped frame
- `backend/internal/hub/client.go` — disconnect with reason, malformed message
- `backend/.env.example` — `LOG_LEVEL`

**Acceptance**
- [ ] `log/slog` with a JSON handler; level from `LOG_LEVEL`, default `info`
- [ ] Info: connect, disconnect (with reason), room create, room destroy
- [ ] Warn: dropped frame (**rate-limited — 4 Hz × N clients must not flood**), malformed message,
      unknown ride code, upgrade failure
- [ ] Every hub line carries `ride` and `rider` as structured fields
- [ ] **No coordinates above debug level.** Location is the most sensitive data class in the app;
      debug must never be enabled in a deployed build
- [ ] Zero third-party logging dependencies

**Testing**
- [ ] Connect and disconnect a client; both lines appear with correct fields
- [ ] Send malformed JSON; a warn line appears and the connection survives
- [ ] Set `LOG_LEVEL=debug`; coordinates appear. Set `info`; they do not
- [ ] Fill a client's send buffer; the dropped-frame warning is rate-limited, not per-frame

---

### HZ-007 · Document the concurrency invariants
`Backend` · 🟠 High · **S** · Todo · `docs/backend-concurrency-invariants`
**Depends on:** —
**Why:** Two safety-critical properties are correct and **entirely uncommented**. Both are one
careless refactor from a crash that takes down every ride, and HZ-009 through HZ-012 are about to
edit exactly this code. **Comment-only — no behaviour change.**
**Files**
- `backend/internal/hub/room.go` — document the `delete`-before-`close(send)` ordering, and that
  `Room.mu` guards the rider set, the route, *and* per-`Client` mutable fields
- `backend/internal/hub/client.go` — expand the `// Latest fix — guarded by room.mu` note to say
  *which* goroutine writes them and under which lock
- `backend/internal/hub/hub.go` — state that `h.mu` is released before `room.register <- c`, which
  is why no deadlock is possible

**Acceptance**
- [ ] A comment states: broadcast iterates under `RLock` and non-blocking-sends; unregister deletes
      **then** closes under `Lock`; because the delete precedes the close in the same critical
      section, a closed channel can never be in the iterated set
- [ ] A comment states that only one mutex is ever held at a time and that this is what makes
      deadlock structurally impossible
- [ ] A comment warns against adding a per-`Client` mutex
- [ ] `git diff` contains **no non-comment changes**
- [ ] `go vet ./...` clean

**Testing**
- [ ] `go build ./...` produces an identical binary hash, or the diff is provably comments-only
- [ ] A reviewer unfamiliar with the code can state the invariant after reading only the comments

---

### HZ-008 · Check unchecked write errors
`Backend` · 🟢 Low · **S** · Todo · `bugfix/checked-response-writes`
**Depends on:** HZ-006
**Why:** `main.go:18` (`w.Write`) and `main.go:44` (`json.NewEncoder(w).Encode`) discard their
errors, so a failed response is invisible.
**Files**
- `backend/main.go` — check both; log at warn

**Acceptance**
- [ ] Both call sites handle their error
- [ ] Failures are logged with the path, not silently dropped
- [ ] No error is returned to the client after headers are written

**Testing**
- [ ] `go vet ./...` clean
- [ ] `httptest` with a writer that fails produces a log line

---

### HZ-009 · Rejoin eviction — the ghost-rider bug
`Backend` · 🔴 Critical · **M** · Todo · `bugfix/ghost-rider-rejoin-eviction`
**Depends on:** HZ-007
**Why:** `room.go` carries a `TODO(rejoin)` describing exactly what to do, then does none of it —
`r.rider[c] = true` just adds. Every dead-zone reconnect seats a **second** client with the same
rider id, and the zombie survives its full 60 s read deadline. It corrupts every downstream
consumer at once: two `state` entries with the same `id`, a non-deterministic standings tiebreak,
duplicate React keys, and a **permanently leaked MapLibre marker** the `seen`-set cleanup can never
collect. Mobile networks drop constantly on real rides.
**Files**
- `backend/internal/hub/room.go` — the `register` case in `run()`
- `backend/internal/hub/client.go` — helper for carrying the last fix, if needed

**Acceptance**
- [ ] On register, scan `r.rider` for a client with the same `id`; if found, `delete` it and
      `close(old.send)` — **in that order**, under the existing write lock
- [ ] Carry `lat`, `lng`, `speed`, `lastSeen` from the old client to the new one, so the dot
      unfreezes rather than vanishing until the next fix
- [ ] The evicted connection's pumps exit cleanly; no `send on closed channel` panic
- [ ] The double-unregister guard still makes the zombie's later unregister a no-op
- [ ] `state` contains exactly one entry per rider id, always
- [ ] The eviction is logged (HZ-006)
- [ ] The `TODO(rejoin)` comment is replaced by a description of the implemented policy

**Testing**
- [ ] Unit: register two clients with the same id → one remains, the first's channel is closed
- [ ] Unit: the survivor inherits the evicted client's last fix
- [ ] `go test -race ./...` clean
- [ ] Manual: two browser windows, kill one's network, restore → **one** rider, dot resumes
- [ ] Manual: the two-tab test still works — `sessionStorage` gives each tab its own id, so tabs
      must **not** evict each other

---

### HZ-010 · Hub and room concurrency tests under `-race`
`Backend` · 🔴 Critical · **M** · Todo · `feature/hub-concurrency-tests`
**Depends on:** HZ-009
**Why:** The most safety-critical code in the repo has no tests, and HZ-011 and HZ-012 are about to
add a teardown race to it. `-race` has never been run against anything.
**Files**
- `backend/internal/hub/room_test.go` *(new)*
- `backend/internal/hub/hub_test.go` *(new)*
- `backend/internal/hub/export_test.go` *(new, if unexported access is needed)*

**Acceptance**
- [ ] Register / unregister / rejoin lifecycle covered
- [ ] A full send buffer drops a frame rather than blocking the room
- [ ] Unregister concurrent with broadcast never panics
- [ ] Broadcast with zero riders, one rider, and fifteen riders
- [ ] Riders with `lastSeen` zero are excluded from the payload
- [ ] `ageSec` is computed from the server clock
- [ ] Tests use fake or injected clients — no real network sockets
- [ ] All pass under `-race`, repeatably (`-count=10`)

**Testing**
- [ ] `go test -race -count=10 ./internal/hub/...` clean
- [ ] Deliberately reversing `delete` and `close(send)` makes a test fail — proving the suite
      actually guards the invariant

---

### HZ-011 · Join-code registry — reject unminted codes
`Backend` · 🔴 Critical · **M** · Todo · `bugfix/join-code-registry`
**Depends on:** HZ-010
**Why:** `CreateRide()` mints a string and records nothing, and `h.room(code)` creates on demand, so
`GET /ws?ride=<any string>` allocates a permanent room. Combined with the wide-open `CheckOrigin`,
this is an unauthenticated unbounded resource-allocation primitive — and it is why a 4-character
typo silently drops a rider into their own empty ride.
**Files**
- `backend/internal/hub/hub.go` — a `codes` map with mint time; validate in `ServeWS`
- `backend/internal/hub/hub_test.go` — coverage

**Acceptance**
- [ ] `CreateRide()` registers the code before returning it
- [ ] `/ws` with an unregistered code returns **404 before the upgrade** and creates no room
- [ ] A registered code still creates its room lazily on first join
- [ ] Registry access is guarded by `h.mu`
- [ ] Rejections are logged at warn with the attempted code
- [ ] Code comparison is case-normalised to match the client's uppercasing

**Testing**
- [ ] Unit: unminted code → 404, `len(h.rooms)` unchanged
- [ ] Unit: minted code → 101 and a room appears
- [ ] Unit: lowercase form of a minted code is accepted
- [ ] `go test -race ./...` clean
- [ ] Manual: typing a random 6-character code shows an error instead of an empty ride

---

### HZ-012 · Room garbage collection
`Backend` · 🔴 Critical · **M** · Todo · `bugfix/room-garbage-collection`
**Depends on:** HZ-011
**Why:** `hub.go` carries `TODO(later)`. A room, once created, is never destroyed: it keeps a map
entry, a goroutine, and a 250 ms ticker that marshals `{"riders":[]}` and sends it to nobody, four
times a second, forever. Memory leak, CPU leak, and GC churn proportional to rooms-ever-created —
the first thing that will bite in the long-running deployment HZ-032 creates.
**Files**
- `backend/internal/hub/room.go` — signal emptiness; stop the ticker and return from `run()`
- `backend/internal/hub/hub.go` — remove from `h.rooms` under `h.mu` with a re-check
- `backend/internal/hub/hub_test.go` — GC and race coverage

**Acceptance**
- [ ] The last rider leaving stops the ticker, ends the `run()` goroutine, and deletes the room
- [ ] **The join-during-teardown race is handled:** a rider arriving between the emptiness check
      and the delete must not be seated in a dying room. Do the check and the delete under `h.mu`
      with a re-check; document the ordering in a comment
- [ ] A short linger (suggest 30 s) before teardown, so a whole-group reconnect doesn't churn
- [ ] Room create and destroy are logged
- [ ] Goroutine count returns to baseline after a ride ends

**Testing**
- [ ] Unit: create a room, join, leave → room removed and goroutine exits
- [ ] Unit: join concurrently with teardown, repeated 1000× under `-race`, never panics and never
      seats a rider in a dead room
- [ ] `runtime.NumGoroutine()` before and after a simulated ride is equal
- [ ] Manual: create and abandon 50 rides; memory and goroutines return to baseline

---

### HZ-013 · Join-code TTL sweep
`Backend` · 🟡 Medium · **S** · Todo · `feature/join-code-ttl`
**Depends on:** HZ-011
**Why:** HZ-011's registry grows forever otherwise — every code ever minted, including the ones
nobody joined. Smaller than the room leak, same shape.
**Files**
- `backend/internal/hub/hub.go` — periodic sweep, or lazy expiry on lookup
- `backend/.env.example` — `RIDE_CODE_TTL`

**Acceptance**
- [ ] Codes expire after a configurable TTL, default 24 h
- [ ] **A code with an active room never expires** while riders are connected
- [ ] The sweep goroutine has a documented exit path, or lazy expiry is used instead
- [ ] Expiry is logged at debug

**Testing**
- [ ] Unit: an expired code is rejected by `/ws`
- [ ] Unit: a code with an active room survives past its TTL
- [ ] Unit with an injected clock — no `time.Sleep` in tests
- [ ] `go test -race ./...` clean

---

### HZ-015 · `crypto/rand` for join codes and rider ids
`Backend` · 🟡 Medium · **S** · Todo · `refactor/crypto-rand-tokens`
**Depends on:** HZ-011
**Why:** `genCode()` and `genID()` use `math/rand`, so both are predictable from the seed. The 32⁶ ≈
1.07 B code space is adequate against blind guessing, but codes only became meaningful in HZ-011 —
before that, guessing was pointless because any string worked.
**Files**
- `backend/internal/hub/hub.go` — `genCode()`, `genID()`; drop the `math/rand` import

**Acceptance**
- [ ] Both use `crypto/rand`
- [ ] The ambiguity-free alphabet is preserved (no `O`/`0`, no `I`/`1`)
- [ ] **Modulo bias is avoided** — the 32-character alphabet divides 256 evenly, so a direct
      `b[i] % 32` is safe; note that in a comment so a future alphabet change doesn't silently
      reintroduce bias
- [ ] A `crypto/rand` failure is fatal, not silently degraded
- [ ] `math/rand` no longer appears in the backend

**Testing**
- [ ] Unit: 10,000 generated codes are all 6 chars from the alphabet, with no duplicates
- [ ] Unit: generated ids satisfy `validRiderID`
- [ ] Chi-squared or simple frequency check shows roughly uniform character distribution
- [ ] `go vet ./...` clean

---

### HZ-016 · `Hub.mu` `RWMutex` → `Mutex`
`Backend` · 🟢 Low · **S** · Todo · `refactor/hub-mutex-type`
**Depends on:** HZ-012
**Why:** `Hub.mu` is declared `sync.RWMutex` and `RLock` is never called — the `RW` is decorative and
implies a concurrency property that doesn't exist. Do it after HZ-012, once the final access
pattern is known.
**Files**
- `backend/internal/hub/hub.go` — the field and all call sites

**Acceptance**
- [ ] Changed to `sync.Mutex`, **or** kept as `RWMutex` with genuine `RLock` readers introduced by
      HZ-011/HZ-012 — whichever the final code justifies
- [ ] The decision is recorded in a one-line comment
- [ ] No behaviour change

**Testing**
- [ ] `go test -race ./...` clean
- [ ] `go vet ./...` clean

---

### HZ-028 · Refresh the read deadline on data frames
`Backend` · 🟢 Low · **S** · Todo · `bugfix/read-deadline-on-data`
**Depends on:** HZ-010
**Why:** `readPump` refreshes the 60 s read deadline only in the pong handler. A client sending
`loc` at 1 Hz whose pong frames are lost is still killed at 60 s, despite being demonstrably alive.
**Files**
- `backend/internal/hub/client.go` — extend the deadline after a successful read

**Acceptance**
- [ ] A successful `ReadMessage` extends the deadline by `pongWait`
- [ ] Pong handling is unchanged
- [ ] A genuinely silent client is still disconnected at 60 s
- [ ] A comment explains why both refresh paths exist

**Testing**
- [ ] Unit: a client sending data with no pongs survives past 60 s
- [ ] Unit: a client sending nothing is disconnected at ~60 s
- [ ] `go test -race ./...` clean

---

### HZ-029 · Rate limiting and connection caps
`Backend` · 🟠 High · **M** · Todo · `feature/backend-rate-limits`
**Depends on:** HZ-012
**Why:** There is no max riders per room, no max rooms, no connection cap, and no message-rate
limit. A client can send `loc` in a tight loop and **each message takes the room-wide write lock**,
throttling ingest for everyone. This must land before HZ-032 makes the server publicly reachable.
**Files**
- `backend/internal/hub/hub.go` — room count and per-room rider caps
- `backend/internal/hub/client.go` — per-connection message-rate limit
- `backend/internal/httpx/middleware.go` — per-IP rate limit on `POST /rides`
- `backend/.env.example` — `MAX_ROOMS`, `MAX_RIDERS_PER_ROOM`, `MAX_LOC_HZ`

**Acceptance**
- [ ] Per-room rider cap (default 20 — headroom over the stated ≤15 target); joining a full room
      returns a clear error before the upgrade
- [ ] Global room cap; exceeding it refuses new rides rather than degrading existing ones
- [ ] Per-connection `loc` rate limit (default ~5 Hz) — **excess messages are dropped, not
      disconnected**, so a buggy client degrades instead of flapping
- [ ] Ride creation is rate-limited per IP
- [ ] Every rejection is logged with a reason
- [ ] Limits are env-configurable with sane defaults

**Testing**
- [ ] Unit: the (cap+1)-th rider is refused with the documented status
- [ ] Unit: a client sending at 100 Hz has messages dropped and stays connected
- [ ] Unit: exceeding the room cap refuses cleanly
- [ ] `go test -race ./...` clean
- [ ] Manual: normal 1 Hz use is completely unaffected

---

### HZ-030 · `CheckOrigin` allowlist
`Backend` · 🔴 Critical · **S** · Todo · `hotfix/ws-origin-check`
**Depends on:** HZ-001
**Why:** `CheckOrigin` returns `true` for every request — the comment says *"Dev-only… tighten before
any public deployment"*, and HZ-032 is that deployment. Left as-is it is textbook cross-site
WebSocket hijacking: any page a rider visits can open a socket, join any ride, and read the live
locations of real people.
**Files**
- `backend/internal/hub/hub.go` — the `upgrader`
- `backend/main.go` — pass the allowlist through
- `backend/.env.example` — reuse `ALLOWED_ORIGINS` from HZ-001

**Acceptance**
- [ ] The origin is checked against the same allowlist as CORS
- [ ] An empty allowlist permits everything **and logs a loud warning at startup** — dev
      convenience must be visibly unsafe
- [ ] A missing `Origin` header (native clients send none) is permitted; this is commented as
      deliberate, because the mobile client depends on it
- [ ] Rejections are logged with the offending origin
- [ ] The dev-only comment is replaced

**Testing**
- [ ] Unit: a disallowed origin fails the upgrade
- [ ] Unit: an allowed origin succeeds
- [ ] Unit: no `Origin` header succeeds
- [ ] Manual: a WebSocket opened from an unrelated page's console is refused

---

### HZ-031 · Readiness endpoint
`Backend` · 🟡 Medium · **S** · Todo · `feature/readiness-endpoint`
**Depends on:** HZ-006
**Why:** `/healthz` is liveness only — it returns `ok` whether or not the server can do anything
useful. HZ-035's monitoring and Koyeb's health checks need something that reflects actual state.
**Files**
- `backend/main.go` — `GET /readyz`
- `docs/SETUP_BACKEND.md` — document both endpoints

**Acceptance**
- [ ] `/readyz` returns 200 with JSON: uptime, room count, connection count
- [ ] Returns 503 while shutting down (ties into HZ-005's drain)
- [ ] `/healthz` is unchanged — liveness stays trivially cheap
- [ ] **No coordinates and no rider names** in the payload
- [ ] Not rate-limited, so monitoring can poll it

**Testing**
- [ ] `curl /readyz` returns valid JSON with plausible counts
- [ ] During shutdown it returns 503
- [ ] The payload contains no personal data

---

### HZ-049 · ORS client package with a stubbable interface
`Backend` · 🟠 High · **M** · Todo · `feature/ors-client-package`
**Depends on:** HZ-017
**Why:** The route endpoint needs an outbound HTTP client to OpenRouteService. It gets its own
package specifically so it can be stubbed in tests without a socket — `docs/ARCHITECTURE_REVIEW.md` §9 is
explicit that outbound calls do not belong in `internal/hub/`.
**Files**
- `backend/internal/ors/client.go` *(new)* — `type Client interface { Route(ctx, []standings.Pt) ([]standings.Pt, error) }`
- `backend/internal/ors/client_test.go` *(new)* — against a recorded response fixture
- `backend/.env.example` — `ORS_API_KEY` already present; add `ORS_BASE_URL` for stubbing

**Acceptance**
- [ ] An interface with a real HTTP implementation and a test double
- [ ] Cycling profile; waypoints in, decoded polyline out as `[]standings.Pt` (lat/lng named fields)
- [ ] `ORS_API_KEY` read from env, **never logged**, never returned to a caller
- [ ] Context-aware with a request timeout (suggest 10 s)
- [ ] Upstream errors are wrapped with context and classified — quota exhausted, bad waypoints, and
      unavailable are distinguishable by the caller
- [ ] No third-party dependency; `net/http` and `encoding/json` only

**Testing**
- [ ] Unit: a recorded ORS response decodes to the expected point count
- [ ] Unit: a 429 surfaces as a distinguishable quota error
- [ ] Unit: a timeout surfaces as a timeout, not a generic failure
- [ ] Unit: the API key never appears in any error string
- [ ] Manual: one real ORS call with a real key returns a plausible cycling route

---

### HZ-052 · Route setter on `Room` with a documented lock convention
`Backend` · 🟠 High · **S** · Todo · `feature/room-route-setter`
**Depends on:** HZ-050
**Why:** `Room.route` exists and is **never written** — there is no setter and no stated locking
convention. The naive implementation (assigning `room.route` from the HTTP handler goroutine) is an
unsynchronised data race against `broadcast()`. Establish the convention before anything calls it.
**Files**
- `backend/internal/hub/room.go` — `SetRoute` / `Route` accessors
- `backend/internal/hub/hub.go` — a way to reach a room by code from an HTTP handler
- `backend/internal/hub/room_test.go` — race coverage

**Acceptance**
- [ ] `SetRoute` takes `r.mu.Lock()`; the accessor takes `RLock`
- [ ] Stores the precomputed `standings.Route` from HZ-050, not a raw slice
- [ ] A comment states that the HTTP handler goroutine is the writer and the broadcast loop the
      reader, and that this is the only cross-goroutine write to room state besides membership
- [ ] Looking up a room by code for a *non-WebSocket* caller does not create one
- [ ] Setting a route logs the ride code and point count

**Testing**
- [ ] Unit: set a route, assert the accessor returns it
- [ ] Unit: `SetRoute` hammered concurrently with `broadcast()` 1000× under `-race`, clean
- [ ] Unit: setting a route on an unknown code returns an error, creating nothing

---

### HZ-053 · `POST /rides/{code}/route` — ORS proxy
`Backend` · 🟠 High · **L** · Todo · `feature/route-ors-proxy`
**Depends on:** HZ-049, HZ-052
**Why:** The 501 stub that keeps standings meaningless. With no route, `hasRoute` is permanently
false, `distAlong` is permanently `0`, and `pos` is **alphabetical order by rider id** — a confident
wrong answer rendered faithfully by the UI.
> **Bundle:** ship HZ-055 in this same PR. The O(R×S) cost lands the instant this endpoint does, and
> retrofitting the lock change means validating standings twice.

**Files**
- `backend/internal/hub/routes.go` *(new)* — the handler
- `backend/main.go` — replace `notImplemented`
- `backend/internal/hub/routes_test.go` *(new)*
- `CLAUDE.md` — confirm the documented request/response shape matches

**Acceptance**
- [ ] Accepts `{"waypoints":[[lat,lng],…]}`, validates 2–10 waypoints and plausible ranges
- [ ] Calls ORS via HZ-049 with the cycling profile
- [ ] Stores the precomputed route on the room via HZ-052
- [ ] **Returns the polyline as `[lng,lat]`** so MapLibre can consume it directly — and a comment
      states this is the one place the wire format is positional, matching `docs/SETUP_MOBILE.md`
- [ ] Unknown ride code → 404 (HZ-011's registry)
- [ ] ORS quota exhaustion → 503 with a distinguishable body, not a generic 500
- [ ] `ORS_API_KEY` never reaches the response or the logs
- [ ] Requires the CORS preflight path from HZ-001 (`Content-Type: application/json`)

**Testing**
- [ ] `httptest` + stubbed ORS: valid waypoints → 200, route stored on the room
- [ ] `httptest`: unknown code → 404
- [ ] `httptest`: 1 waypoint and 50 waypoints → 400
- [ ] `httptest`: stubbed quota error → 503
- [ ] Unit: the returned polyline is `[lng,lat]` and the stored route is lat/lng named fields
- [ ] `go test -race ./...` clean
- [ ] Manual: set a route from the browser, confirm `distAlong` becomes non-zero in `state`

---

### HZ-054 · Once-per-ride fetch enforcement and response cache
`Backend` · 🟠 High · **S** · Todo · `feature/route-fetch-once-per-ride`
**Depends on:** HZ-053
**Why:** `CLAUDE.md` requires fetching a route **once per ride, not once per rider**, to protect the
free ORS daily quota — but nothing in the code enforces it. It is currently a convention that 15
clients can each violate.
**Files**
- `backend/internal/hub/routes.go` — reject or serve-from-cache on repeat
- `backend/internal/hub/room.go` — track whether a route has been set

**Acceptance**
- [ ] A second route request for a ride with an identical waypoint set returns the cached polyline
      **without calling ORS**
- [ ] A request with *different* waypoints is allowed (riders can change destination) but is
      rate-limited per ride — suggest one change per minute
- [ ] Cache hits and upstream calls are logged distinguishably, so quota use is auditable
- [ ] The cache lives on the room and dies with it (HZ-012), so it cannot leak

**Testing**
- [ ] Unit: two identical requests → one ORS call
- [ ] Unit: a differing-waypoint request within the window → 429
- [ ] Unit: a differing-waypoint request after the window → a second ORS call
- [ ] Unit: 15 concurrent identical requests → exactly one ORS call
- [ ] `go test -race ./...` clean

---

### HZ-063 · Protocol: add `accuracy`
`Backend` · 🟡 Medium · **M** · Todo · `feature/protocol-accuracy-field`
**Depends on:** HZ-020
**Why:** `GeolocationCoordinates.accuracy` is available on every fix and thrown away. A ±500 m
urban-canyon fix currently feeds the standings projection with exactly the same confidence as a ±3 m
one — and post-HZ-053 that projection determines race position.
> Protocol change: Go, `web/src/types.ts`, the HZ-020 fixtures, and `CLAUDE.md` all change in this
> one PR ([P4](./DEVELOPMENT_GUIDE.md#p4--the-shared-protocol-is-a-contract)).

**Files**
- `backend/internal/hub/client.go` — `locMsg.Accuracy`; store on `Client` under `room.mu`
- `backend/internal/hub/room.go` — `riderState.Accuracy`
- `web/src/types.ts` — `LocMsg.accuracy`, `Rider.accuracy`
- `web/src/location/useGeo.ts` — pass `coords.accuracy` through
- `web/src/net/ws.ts` — `sendLoc` signature
- `web/src/Ride.tsx` — call site
- `protocol/fixtures/*.json`, `CLAUDE.md`

**Acceptance**
- [ ] `accuracy` (metres) travels client → server → all clients
- [ ] **Additive and backward-compatible** — an old client omitting it must still work; document the
      absent-value semantics (suggest `-1` or omitted meaning unknown, **not** `0`, which is a valid
      and excellent accuracy)
- [ ] Stored under `room.mu` alongside the other fix fields
- [ ] All three implementations and the fixtures change together
- [ ] The PR states explicitly whether old clients survive

**Testing**
- [ ] HZ-020 conformance tests pass with the new field
- [ ] Unit: a `loc` without `accuracy` is accepted and marked unknown
- [ ] Manual: a real browser fix reports a plausible accuracy in `state`
- [ ] Manual: an old client build still joins and appears

---

### HZ-069 · Protocol: add `heading` to `state`
`Backend` · 🟡 Medium · **S** · Todo · `feature/protocol-heading-in-state`
**Depends on:** HZ-020
**Why:** `heading` is sent by the client, parsed into `locMsg.Heading`, and **never used** — the wire
struct promises more than the system delivers, and `ts` has the same problem. Dead protocol fields
mislead every future reader; this is also the concrete drift that HZ-020 exists to prevent.
**Files**
- `backend/internal/hub/client.go` — store `heading` on `Client` under `room.mu`
- `backend/internal/hub/room.go` — add to `riderState`
- `web/src/types.ts`, `protocol/fixtures/*.json`, `CLAUDE.md`

**Acceptance**
- [ ] `heading` is stored on ingest and re-broadcast in `state`
- [ ] **`heading ?? 0` is fixed at the same time** — `0` is a valid heading (due north), so
      "unavailable" and "north" must be distinguishable. Use `null`/omitted, or `-1`
- [ ] A decision is recorded for `ts`: either use it or delete it from the protocol. Do not leave a
      second dead field
- [ ] All implementations and fixtures change together
- [ ] Additive and backward-compatible

**Testing**
- [ ] Conformance tests pass
- [ ] Unit: a `loc` with heading 0 is distinguishable from one with heading absent
- [ ] Manual: a moving rider's heading appears in `state` and is plausible
- [ ] Manual: a stationary rider reporting `null` heading does not render as "north"

---

### HZ-099 · Metrics endpoint
`Backend` · 🟡 Medium · **M** · Todo · `feature/metrics-endpoint`
**Depends on:** HZ-035
**Why:** `docs/SYSTEM_DESIGN.md` §9 lists metrics as step 5 of the scaling path. Logs answer "what
happened to this rider"; metrics answer "is the service healthy right now" — which is what HZ-108's
runbook and HZ-109's five-ride gate need.
**Files**
- `backend/internal/metrics/metrics.go` *(new)* — hand-rolled counters and gauges
- `backend/main.go` — `GET /metrics`
- `backend/internal/hub/*.go` — instrumentation points

**Acceptance**
- [ ] Gauges: active connections, active rooms, registered codes
- [ ] Counters: connections opened, connections closed by reason, rejoin evictions, frames dropped,
      malformed messages, rooms created, rooms destroyed, ORS calls, voice tokens minted
- [ ] Histogram or simple buckets for broadcast duration — the early-warning signal for HZ-051's
      `distAlong` cost
- [ ] Prometheus text exposition format, so any scraper works, **with no third-party dependency**
      ([P5](./DEVELOPMENT_GUIDE.md#p5--keep-dependencies-minimal)) — the format is simple enough to
      emit by hand
- [ ] `/metrics` is not publicly exposed, or is behind a shared secret
- [ ] **No per-rider or per-ride labels** — unbounded cardinality, and rider ids are personal data

**Testing**
- [ ] `curl /metrics` parses as valid Prometheus exposition
- [ ] Connecting and disconnecting moves the gauges correctly
- [ ] A forced frame drop increments its counter
- [ ] Counters survive with no rooms active
- [ ] `go test -race ./...` clean

---

### HZ-104 · Honour the `POST /rides` body — ride metadata
`Backend` · 🟢 Low · **S** · Todo · `feature/ride-metadata`
**Depends on:** HZ-020
**Why:** `docs/SYSTEM_DESIGN.md` §6 specifies `POST /rides {"name":"Sunday loop"}`, and the handler
ignores its body entirely. Either honour the documented contract or remove it from the spec — a
documented field that silently vanishes is worse than no field.
**Files**
- `backend/main.go` — decode the body
- `backend/internal/hub/hub.go` — store the name with the registered code
- `backend/internal/hub/room.go` — optionally include it in `state`
- `web/src/net/api.ts`, `web/src/App.tsx` — send an optional name
- `CLAUDE.md`, `docs/SYSTEM_DESIGN.md` — reconcile whichever way is chosen

**Acceptance**
- [ ] An empty or absent body is still valid — the current client must not break
- [ ] A supplied name is length-capped server-side (suggest 60) and stored with the code
- [ ] If broadcast, the field is added to the fixtures and all implementations together
- [ ] If the decision is to *remove* the field, `docs/SYSTEM_DESIGN.md` §6 is corrected instead
- [ ] The decision is stated in the PR description

**Testing**
- [ ] `httptest`: no body → 200, code minted
- [ ] `httptest`: `{"name":"Sunday loop"}` → 200, name retrievable
- [ ] `httptest`: a 10 KB name → rejected or truncated, never stored whole
- [ ] Conformance tests pass if the wire format changed

---

## Web

### HZ-014 · Exact 6-char join validation and unknown-code error
`Web` · 🟡 Medium · **S** · Todo · `bugfix/join-code-length-validation`
**Depends on:** HZ-011
**Why:** `App.tsx` requires ≥4 characters while codes are exactly 6. Before HZ-011 a typo silently
created a brand-new empty room, so the rider sat alone in a valid-looking ride. After HZ-011 the
server returns 404 — the client must now surface that instead of retrying forever.
**Files**
- `web/src/App.tsx` — `Lobby` validation and error rendering
- `web/src/net/ws.ts` — distinguish a 404-style rejection from a transient failure
- `web/src/index.css` — error styling if needed

**Acceptance**
- [ ] Join accepts exactly 6 characters from the code alphabet, uppercased, whitespace trimmed
- [ ] Characters outside the ambiguity-free alphabet are rejected with a specific message
- [ ] An unknown code shows *"No ride with that code"* — **and does not enter the reconnect loop**
- [ ] Transient failures still reconnect normally; the two paths are visibly different to the user
- [ ] Paste of a code with surrounding spaces works

**Testing**
- [ ] Manual: a 4-char code is rejected client-side
- [ ] Manual: a well-formed but unminted code shows the unknown-ride message and stops retrying
- [ ] Manual: killing the backend mid-ride still shows "reconnecting" and recovers
- [ ] Manual: lowercase and padded paste both work

---

### HZ-023 · Store: error and permission state slice
`Web` · 🟠 High · **S** · Todo · `feature/store-error-state`
**Depends on:** HZ-018
**Why:** The store has no error representation at all. Lobby errors are local `useState`, and
connection failures and geolocation-permission failures have nowhere to live. HZ-024 and HZ-025
both need this first — build the slot before the two features that fill it.
**Files**
- `web/src/store/ride.ts` — add `geoStatus`, `wakeLockStatus`, `lastError`, and their setters
- `web/src/types.ts` — the status unions

**Acceptance**
- [ ] `geoStatus: "idle" | "prompting" | "granted" | "denied" | "unavailable" | "error"`
- [ ] `wakeLockStatus: "unsupported" | "requesting" | "held" | "refused" | "released"`
- [ ] `lastError: { scope: "lobby" | "socket" | "geo" | "route" | "voice"; message: string } | null`
- [ ] `leaveRide()` resets all of it
- [ ] The slice is flat, matching the existing store — no middleware introduced
- [ ] No component reads these yet; this task only adds the slot

**Testing**
- [ ] `tsc -b` clean; `npm run lint` clean
- [ ] Manual: existing behaviour is completely unchanged
- [ ] Manual: `leaveRide()` clears every new field

---

### HZ-024 · Geolocation denial and failure UX
`Web` · 🟠 High · **M** · Todo · `bugfix/geolocation-denied-ux`
**Depends on:** HZ-023
**Why:** `useGeo` sends errors to `console.warn` and stops. A rider who denies location permission
sees *"Waiting for a GPS fix… (allow location access)"* **forever**, with no way to tell whether the
browser refused, the device has no fix, or the socket is down. `docs/ARCHITECTURE_REVIEW.md` calls this
the single worst UX gap in the web client.
**Files**
- `web/src/location/useGeo.ts` — surface `PERMISSION_DENIED`, `POSITION_UNAVAILABLE`, `TIMEOUT`
  distinctly into the store
- `web/src/Ride.tsx` — render the state
- `web/src/index.css` — banner styling

**Acceptance**
- [ ] The three `GeolocationPositionError` codes map to distinct store states and distinct messages
- [ ] Denial shows platform-specific recovery guidance (iOS Safari and Android Chrome differ) and a
      **retry affordance** — not a dead end
- [ ] `POSITION_UNAVAILABLE` and `TIMEOUT` show "still searching", not "denied" — they are recoverable
- [ ] The banner clears automatically once a fix arrives
- [ ] Missing `navigator.geolocation` entirely is handled as `unavailable`
- [ ] `console.warn` is removed, not merely supplemented

**Testing**
- [ ] Manual: deny permission in Chrome DevTools → specific message + retry appears
- [ ] Manual: re-grant and retry → tracking resumes without a page reload
- [ ] Manual: DevTools "location unavailable" → the searching message, not the denial message
- [ ] Manual: a normal fix shows no banner
- [ ] Manual: works in an installed PWA on a real phone, not just a desktop tab

---

### HZ-025 · Wake-lock status indicator
`Web` · 🟠 High · **M** · Todo · `bugfix/wake-lock-visibility`
**Depends on:** HZ-023
**Why:** `useWakeLock` swallows failures — a user agent can refuse on low battery. On a real ride a
silently-refused lock means the screen sleeps, GPS stops, and the rider vanishes from everyone's map
with no warning to anyone. **The wake lock is the entire mitigation for the PWA's one known
limitation ([ADR-004](./ADR/ADR-004.md)), so a silent failure defeats the strategy outright.**
**Files**
- `web/src/location/useWakeLock.ts` — report acquire, refuse, and release into the store
- `web/src/Ride.tsx` — indicator, next to the connection pill
- `web/src/index.css`

**Acceptance**
- [ ] Successful acquisition, refusal, and release are all reflected in the store
- [ ] Refusal shows a **persistent, non-dismissable warning** — "your screen may sleep and you will
      disappear from the group" — because the consequence is invisible to the rider otherwise
- [ ] Re-acquisition on `visibilitychange` still works and updates the indicator
- [ ] Browsers without Wake Lock show "unsupported" rather than "refused" — the two mean different
      things to the rider
- [ ] A manual re-request control exists
- [ ] Failures are no longer swallowed

**Testing**
- [ ] Manual: normal case shows "screen locked awake"
- [ ] Manual: force a rejected `wakeLock.request` → the warning appears
- [ ] Manual: background and foreground the tab → the lock re-acquires and the indicator updates
- [ ] Manual: Safari without Wake Lock shows "unsupported" and does not crash
- [ ] Manual: on a real phone with battery saver on, observe the actual behaviour and record it

---

### HZ-026 · Runtime validation of inbound messages
`Web` · 🟡 Medium · **S** · Todo · `feature/runtime-message-validation`
**Depends on:** HZ-020
**Why:** `ws.onmessage` does `JSON.parse` and nothing else. The `ServerMsg` union is compile-time
only, so a malformed `state` whose `riders` isn't an array is stored as-is and crashes the render.
**Files**
- `web/src/types.ts` — hand-written type guards
- `web/src/net/ws.ts` — validate before dispatching to the store

**Acceptance**
- [ ] `isWelcomeMsg` and `isStateMsg` guards validate shape and field types
- [ ] An invalid message is dropped and counted, and does not reach the store
- [ ] Unknown `type` values are still ignored silently — forward compatibility is deliberate
- [ ] Repeated invalid messages surface a diagnostic to the user, so a protocol mismatch after a
      deploy isn't silent
- [ ] **Hand-written guards — no `zod`** ([P5](./DEVELOPMENT_GUIDE.md#p5--keep-dependencies-minimal))
- [ ] The guards are exercised by the HZ-020 fixtures, so they cannot drift from the contract

**Testing**
- [ ] Unit: valid fixtures pass every guard
- [ ] Unit: `riders` as an object, a missing `id`, a string `lat` → all rejected
- [ ] Unit: an unknown message type is ignored without error
- [ ] Manual: a hand-crafted bad frame does not crash the app

---

### HZ-027 · Reconnect backoff jitter
`Web` · 🟢 Low · **S** · Todo · `bugfix/reconnect-backoff-jitter`
**Depends on:** —
**Why:** Backoff is `min(1000 · 2^retry, 15000)` with **no jitter**, so every rider reconnects in
lockstep after a server restart. Harmless at 15 riders; a one-line fix; and it becomes a real
thundering herd the moment HZ-032 puts the server behind a platform that restarts containers.
**Files**
- `web/src/net/ws.ts` — the `onclose` delay calculation

**Acceptance**
- [ ] Full jitter applied — a random value in `[0, computedDelay]`, or ±25% around it
- [ ] The 15 s ceiling still holds
- [ ] `retryRef` still resets on `onopen`
- [ ] **A connection that opens then immediately dies no longer loops at 1 s forever** — either
      require a minimum connected duration before resetting the counter, or floor the delay
- [ ] A comment explains why jitter exists

**Testing**
- [ ] Unit or manual: ten reconnects produce visibly different delays
- [ ] Manual: kill and restart the backend with three windows open — they reconnect at staggered
      times
- [ ] Manual: a server that accepts and immediately closes does not produce a 1 Hz retry loop

---

### HZ-040 · Persist the ride across a reload
`Web` · 🟠 High · **M** · Todo · `feature/ride-persistence`
**Depends on:** HZ-039
**Why:** The store is entirely in memory, so a page reload drops you to the lobby mid-ride. This
also makes `net/identity.ts`'s stated rationale — *"sessionStorage… survives a page reload
mid-ride"* — currently false: the rider **id** survives, but there is no ride to survive into.
**Files**
- `web/src/store/ride.ts` — hydrate `code` and `name` on init; persist on change
- `web/src/net/identity.ts` — reuse the storage helper; keep the per-tab semantics
- `web/src/App.tsx` — render the ride directly when hydrated

**Acceptance**
- [ ] `code` and `name` persist to `sessionStorage` and rehydrate on load
- [ ] **`sessionStorage`, not `localStorage`** — per-tab isolation is load-bearing for the two-tab
      test and for HZ-009's eviction; comment this
- [ ] `leaveRide()` clears the persisted values
- [ ] Rehydration reconnects automatically and shows "connecting"
- [ ] Corrupt or stale stored values fail safe to the lobby
- [ ] Hydration happens before first paint, so there is no lobby flash

**Testing**
- [ ] Manual: reload mid-ride → still in the ride, socket reconnects, dots return
- [ ] Manual: leave the ride, reload → lobby
- [ ] Manual: two tabs in different rides stay independent
- [ ] Manual: corrupt the stored value by hand → lands in the lobby, no crash
- [ ] Manual: works in an installed PWA, where "reload" means relaunch

---

### HZ-041 · Ride code in the URL — shareable join link
`Web` · 🟠 High · **M** · Todo · `feature/ride-url-routing`
**Depends on:** HZ-040
**Why:** The code never appears in the URL, so there is no shareable join link — sharing a ride means
reading six characters aloud, which is real friction for the actual use case. The browser back
button also leaves the app rather than the ride.
**Files**
- `web/src/App.tsx` — read the code from the URL on mount; `pushState` on join; `popstate` handling
- `web/src/store/ride.ts` — keep URL and store in sync
- `web/src/Ride.tsx` — a share/copy-link control

**Acceptance**
- [ ] Joining a ride pushes `/?ride=ABC123` (or a hash) without a reload
- [ ] Loading that URL joins the ride directly, prompting only for a name if unset
- [ ] Back from a ride returns to the lobby and disconnects cleanly
- [ ] A share control copies the full URL, using the Web Share API where available
- [ ] **No router dependency** — `pushState`/`popstate` only; two screens do not justify one
- [ ] Deep-link and HZ-040 rehydration agree; the URL wins on conflict
- [ ] An invalid code in the URL routes to the lobby with HZ-014's error

**Testing**
- [ ] Manual: join → the URL updates; copy it to another browser → lands in the same ride
- [ ] Manual: back button leaves the ride, forward re-enters
- [ ] Manual: `/?ride=ZZZZZZ` (unminted) shows the unknown-ride error
- [ ] Manual: share on a phone opens the native share sheet
- [ ] Manual: reload on a deep link keeps you in the ride

---

### HZ-045 · Queue GPS fixes across a reconnect
`Web` · 🟡 Medium · **M** · Todo · `feature/gps-fix-queue`
**Depends on:** HZ-039
**Why:** `sendLoc` silently no-ops whenever the socket isn't `OPEN` — no queue, no replay, no
indication that data is being lost. Every fix generated during a 15 s backoff simply disappears.
> Validate against HZ-038's findings before building. If the road test shows reconnects are short
> and gaps are invisible, **close this as not-needed** rather than adding machinery.

**Files**
- `web/src/net/ws.ts` — a small bounded ring buffer, flushed on `onopen`
- `web/src/types.ts` — a batched message shape, if the protocol needs one
- `backend/internal/hub/client.go` — accept a batch, if introduced
- `CLAUDE.md`, `protocol/fixtures/` — if the protocol changes

**Acceptance**
- [ ] A bounded buffer (suggest 30 fixes ≈ 30 s) — **bounded, so a long outage cannot grow memory**
- [ ] Oldest fixes are dropped first when full
- [ ] The buffer is flushed on reconnect, oldest first
- [ ] **The server ignores stale fixes**: `lastSeen` must reflect the most recent position, and
      replaying old fixes must never move a rider backwards or corrupt `distAlong`
- [ ] If batching changes the protocol, all implementations and fixtures change together
- [ ] Buffered-and-dropped counts are visible in dev

**Testing**
- [ ] Unit: the buffer caps at its limit and drops oldest first
- [ ] Manual: go offline 10 s, come back → the trail fills in, final position is correct
- [ ] Manual: go offline 5 minutes → memory is flat and the app recovers
- [ ] Manual: a replayed old fix does not make the rider's dot jump backwards
- [ ] `go test -race ./...` clean if the backend changed

---

### HZ-046 · Service-worker update prompt
`Web` · 🟡 Medium · **S** · Todo · `feature/sw-update-prompt`
**Depends on:** HZ-034
**Why:** `registerType: "autoUpdate"` lets a new service worker take over silently — **mid-ride**.
The app can swap versions under a rider who is depending on it to be found.
**Files**
- `web/vite.config.ts` — `registerType: "prompt"`
- `web/src/sw-update.ts` *(new)* — registration + update hook
- `web/src/main.tsx`, `web/src/Ride.tsx` — mount the prompt
- `web/src/index.css`

**Acceptance**
- [ ] A waiting service worker surfaces a non-blocking "Update available — reload" prompt
- [ ] **The prompt is suppressed, or explicitly deferred, while a ride is active** — that is the
      whole point of this task
- [ ] Dismissing keeps the current version running until the next launch
- [ ] Accepting activates the new worker and reloads once
- [ ] Offline behaviour is unchanged

**Testing**
- [ ] Manual: deploy a change, open the old build → the prompt appears
- [ ] Manual: mid-ride, the prompt does not force a reload
- [ ] Manual: accepting reloads once and lands on the new version
- [ ] Manual: dismissing does not re-prompt in a loop

---

### HZ-047 · Runtime tile caching
`Web` · 🟡 Medium · **S** · Todo · `feature/tile-runtime-caching`
**Depends on:** HZ-046
**Why:** Only the app shell is precached, so offline the app loads and shows a blank map. OpenFreeMap
is a donation-funded community service ([ADR-003](./ADR/ADR-003.md)) and every rider currently
pulls from it directly with no CDN — caching is both useful to us and polite to them.
**Files**
- `web/vite.config.ts` — Workbox `runtimeCaching` for `tiles.openfreemap.org`

**Acceptance**
- [ ] `CacheFirst` for tile and glyph requests, with a bounded entry count and a max age
- [ ] The style JSON is cached with a shorter TTL than the tiles
- [ ] **The cache is size-capped** so a long ride cannot fill device storage
- [ ] A revisited area renders from cache with no network request
- [ ] Offline shows previously-visited tiles rather than a blank map
- [ ] Attribution still renders

**Testing**
- [ ] Manual: load a map area, go offline, reload → tiles still render
- [ ] Manual: the Network tab shows cache hits on revisit
- [ ] Manual: pan across a large area → cache size stays within the cap
- [ ] Manual: an entirely new area while offline degrades gracefully, without crashing

---

### HZ-048 · Maskable icon safe zone and manifest completeness
`Web` · 🟢 Low · **S** · Todo · `bugfix/pwa-icon-and-manifest`
**Depends on:** —
**Why:** The 512 px icon does double duty as `any` and `maskable`, but `gen-icons.mjs` draws from 13%
to 87% of the canvas — right at the crop boundary, so Android's adaptive mask clips the artwork. The
manifest is also missing `id`, `scope`, `categories`, and `screenshots`.
**Files**
- `web/scripts/gen-icons.mjs` — emit a separate maskable icon drawn inside the 80% safe zone
- `web/vite.config.ts` — manifest fields; separate `any` and `maskable` entries
- `web/.gitignore` — ignore the new generated file

**Acceptance**
- [ ] A dedicated maskable icon with all artwork inside the central 80%
- [ ] `any` and `maskable` are separate entries, not one file serving both
- [ ] `id`, `scope`, and `categories` added
- [ ] Generation still uses only `node:` built-ins — **no image dependency**
      ([P5](./DEVELOPMENT_GUIDE.md#p5--keep-dependencies-minimal))
- [ ] All generated icons stay gitignored; the repo keeps zero binary assets

**Testing**
- [ ] `npm run gen-icons` produces every icon
- [ ] Chrome DevTools → Application → Manifest reports no icon warnings
- [ ] Manual: install on Android with a circular mask → nothing is clipped
- [ ] Manual: install on iOS → the touch icon is correct
- [ ] Lighthouse PWA audit passes the installability checks

---

### HZ-057 · Store: route slice
`Web` · 🟠 High · **S** · Todo · `feature/store-route-slice`
**Depends on:** HZ-053
**Why:** The store has no slot for Phase-2 data. HZ-058 through HZ-062 all need somewhere to put the
route; build the slot first so four tasks don't each invent their own.
**Files**
- `web/src/store/ride.ts` — `route`, `routeStatus`, `waypoints`, setters
- `web/src/types.ts` — the route type

**Acceptance**
- [ ] `route: [number, number][] | null` holding the server's `[lng,lat]` polyline **verbatim** —
      the conversion boundary stays at the server response, and a comment says so
- [ ] `routeStatus: "none" | "fetching" | "set" | "error"`
- [ ] `waypoints` retained so HZ-062 can re-POST after a restart
- [ ] `leaveRide()` clears all of it
- [ ] No component reads it yet

**Testing**
- [ ] `tsc -b` and lint clean
- [ ] Manual: existing behaviour unchanged
- [ ] Manual: `leaveRide()` clears the route

---

### HZ-058 · `net/api.setRoute()`
`Web` · 🟠 High · **S** · Todo · `feature/api-set-route`
**Depends on:** HZ-057
**Why:** `api.ts` has exactly one function, `createRide()`. The route endpoint needs a client, and
`docs/ARCHITECTURE_REVIEW.md` §9 places it in `net/` so the transport stays out of the UI.
**Files**
- `web/src/net/api.ts` — `setRoute(code, waypoints)`
- `web/src/store/ride.ts` — status transitions

**Acceptance**
- [ ] `POST`s `{"waypoints":[[lat,lng],…]}` — **lat/lng named order on the way up**, matching the
      protocol, while the response is `[lng,lat]` for MapLibre. Comment the asymmetry; it is the
      most likely place to introduce a coordinate bug
- [ ] Distinguishes 404 (unknown ride), 429 (rate-limited), and 503 (ORS quota) with specific
      messages
- [ ] Sets `routeStatus` through its lifecycle and writes failures to `lastError`
- [ ] Uses `httpBase` from `config.ts` — no hard-coded host

**Testing**
- [ ] Manual: a successful call populates the store and flips status to `set`
- [ ] Manual: an unknown code surfaces the 404 message
- [ ] Manual: a simulated 503 surfaces the quota message, not a generic failure
- [ ] Manual: the waypoints sent match what the backend expects — verify in the Network tab

---

### HZ-061 · Standings UI: `distAlong` and gap
`Web` · 🟡 Medium · **S** · Todo · `feature/standings-ui-distance`
**Depends on:** HZ-059
**Why:** The standings list renders `pos`, name, and speed. Once `distAlong` is real, "2nd, 340 m
back" is far more useful than "2nd" — and it is the fastest way for a human to sanity-check that
the standings math is working.
**Files**
- `web/src/Ride.tsx` — the standings list
- `web/src/index.css`

**Acceptance**
- [ ] Each row shows the gap to the leader in metres or km, sensibly rounded
- [ ] The gap is hidden entirely when no route is set — **never show a gap derived from
      `distAlong: 0`**, which is what would make the pre-route state look meaningful again
- [ ] Stale riders still grey out and show "Ns ago" instead of a gap
- [ ] The leader shows a leader marker rather than "0 m back"
- [ ] Layout does not shift as numbers change width

**Testing**
- [ ] Manual: with no route, no gaps appear and the list looks as it does today
- [ ] Manual: with a route, gaps appear and match the map visually
- [ ] Manual: a stale rider's row is correct
- [ ] Manual: the list is readable one-handed on a phone in sunlight

---

### HZ-062 · Restore the route after a server restart
`Web` · 🟡 Medium · **M** · Todo · `feature/route-restore-on-reconnect`
**Depends on:** HZ-060
**Why:** Rider positions repopulate within seconds of a restart because clients keep sending fixes.
**A route does not** — it is server-only state that no client re-POSTs, so a restart mid-ride
silently reverts standings to meaningless while the UI keeps rendering a confident order.
**Files**
- `web/src/net/ws.ts` — detect a reconnect where the server has no route
- `web/src/store/ride.ts` — retain waypoints
- `web/src/Ride.tsx` — re-POST logic
- `backend/internal/hub/room.go` — optionally signal route presence in `state`

**Acceptance**
- [ ] The client retains the waypoints it submitted, surviving HZ-040's persistence
- [ ] On reconnect, if the server reports no route and the client has waypoints, it re-POSTs **once**
- [ ] **Exactly one client re-POSTs**, not fifteen — HZ-054's cache makes duplicates cheap, but the
      client should still not stampede. Jitter the attempt or gate it on the leader
- [ ] A failed restore surfaces an error rather than leaving stale standings on screen
- [ ] Signalling route presence, if added, goes through the protocol change process

**Testing**
- [ ] Manual: set a route, restart the backend, reconnect → the route reappears and standings recover
- [ ] Manual: with three clients connected, count the ORS calls after a restart — at most one
- [ ] Manual: with the route endpoint failing, the UI reports it instead of showing false standings
- [ ] `go test -race ./...` clean if the backend changed

---

### HZ-067 · Off-route indication in the UI
`Web` · 🟡 Medium · **S** · Todo · `feature/off-route-ui`
**Depends on:** HZ-066
**Why:** HZ-066 computes the off-route signal; without a UI it is invisible. A rider who took a wrong
turn should be shown as off-route rather than given a confident, meaningless position.
**Files**
- `web/src/Ride.tsx` — standings rows
- `web/src/map/Map.tsx` — marker state
- `web/src/index.css` — an off-route style
- `web/src/types.ts` — the new field

**Acceptance**
- [ ] An off-route rider is visually distinct in both the list and the map
- [ ] Their `pos` is **suppressed or de-emphasised** rather than shown as a confident rank
- [ ] The rider sees their *own* off-route state prominently — they are the one who can act on it
- [ ] The state clears automatically on returning to the route
- [ ] Off-route and stale are visually distinguishable; they mean different things

**Testing**
- [ ] Manual: simulate a fix far from the route → that rider is marked off-route on both clients
- [ ] Manual: return to the route → the state clears
- [ ] Manual: a rider both stale and off-route renders sensibly
- [ ] Manual: check the styling is legible in sunlight on a real phone

---

### HZ-103 · Per-rider visibility control
`Web` · 🟡 Medium · **M** · Todo · `feature/rider-visibility-control`
**Depends on:** HZ-098
**Why:** Live location broadcasts to everyone in the room with no consent gate, no per-rider control,
and **no way to go temporarily invisible** — for the most sensitive data class in the app. Fine among
friends; the first thing that must exist if Horizon is ever shared more widely.
**Files**
- `web/src/store/ride.ts` — a visibility flag
- `web/src/Ride.tsx` — the control
- `web/src/location/useGeo.ts` or `web/src/net/ws.ts` — stop sending when hidden
- `backend/internal/hub/room.go` — exclude hidden riders from `state`
- `web/src/types.ts`, `CLAUDE.md`, `protocol/fixtures/` — protocol change

**Acceptance**
- [ ] A rider can go invisible and return, at any time, in one tap
- [ ] While invisible, **fixes are not sent at all** — suppressing on the server would still put the
      location in server memory and in logs. Client-side suppression is the stronger guarantee, and
      the choice must be stated in the PR
- [ ] Other riders see them leave the map rather than freeze at a stale position
- [ ] The rider's own UI makes their invisible state unmistakable, so it isn't left on by accident
- [ ] The state does not persist across rides
- [ ] Protocol change made across all implementations together

**Testing**
- [ ] Manual: go invisible → disappear from the other client within one tick
- [ ] Manual: while invisible, confirm in the Network tab that no `loc` frames are sent
- [ ] Manual: return to visible → reappear promptly
- [ ] Manual: leaving and rejoining a ride resets to visible
- [ ] Conformance tests pass

---

## Maps

> **Every task in this group touches the `[lng, lat]` boundary.** `web/src/map/` is the only place in
> the web client permitted to use positional coordinate arrays. A `[lng, lat]` literal appearing
> outside it is a bug, not a style issue.

### HZ-042 · Follow camera and recentre control
`Maps` · 🟠 High · **M** · Todo · `feature/map-follow-camera`
**Depends on:** HZ-039
**Why:** `centeredRef` performs exactly one `easeTo` on the first self fix and never again. Ride 2 km
and your own dot leaves the viewport with no way back. There is also no recentre button and no
fit-to-group.
**Files**
- `web/src/map/Map.tsx` — follow mode, camera effect, control
- `web/src/index.css` — control styling

**Acceptance**
- [ ] Follow mode keeps the self marker centred as fixes arrive
- [ ] **A manual pan or zoom disables follow mode** — the camera must never fight the user
- [ ] A recentre control re-enables it, and is visually distinct when follow is off
- [ ] Camera moves are eased, not jumped
- [ ] Follow state survives a reconnect
- [ ] **`centeredRef` is reset when `selfId` changes** — today a reconnect that mints a new id never
      re-centres
- [ ] The control is large enough to hit one-handed with gloves

**Testing**
- [ ] Manual: simulate movement → the camera follows
- [ ] Manual: pan away → follow disables and stays disabled
- [ ] Manual: tap recentre → follow re-enables and the camera returns
- [ ] Manual: reconnect with a new rider id → the camera still finds you
- [ ] Manual: usable one-handed on a real phone

---

### HZ-043 · Fit-bounds-to-group control
`Maps` · 🟡 Medium · **S** · Todo · `feature/map-fit-group`
**Depends on:** HZ-042
**Why:** There is no way to see the whole group at once — the core question the app exists to answer
("where is everyone?") currently requires manual panning and zooming.
**Files**
- `web/src/map/Map.tsx` — a `fitBounds` control

**Acceptance**
- [ ] One control fits all non-stale riders in view with sensible padding
- [ ] Handles the degenerate cases: one rider, and all riders at the same point (don't zoom to
      maximum)
- [ ] Stale riders are excluded, or included behind an explicit choice that is documented
- [ ] Using it disables follow mode, consistently with HZ-042
- [ ] Respects safe-area insets so the fit isn't hidden under the topbar

**Testing**
- [ ] Manual: two riders far apart → both visible after tapping
- [ ] Manual: one rider → sensible zoom, not maximum
- [ ] Manual: all riders co-located → sensible zoom
- [ ] Manual: on a notched phone, nothing is fitted under the topbar or standings panel

---

### HZ-044 · Marker position interpolation
`Maps` · 🟡 Medium · **M** · Todo · `feature/marker-interpolation`
**Depends on:** HZ-042
**Why:** `setLngLat` teleports every dot every 250 ms, which reads as jittery rather than smooth.
Interpolating between fixes is the standard fix and is roughly 20 lines.
**Files**
- `web/src/map/Map.tsx` — per-marker interpolation via `requestAnimationFrame`

**Acceptance**
- [ ] Markers animate between successive positions instead of jumping
- [ ] Interpolation duration matches the broadcast interval, with a cap so a late frame doesn't
      cause a long slow glide
- [ ] **A large jump (a genuine GPS outlier or a rejoin) snaps rather than gliding across the map**
- [ ] The animation loop is cancelled on unmount and when a marker is removed — no leaked rAF
- [ ] **CPU cost is measured**; this runs continuously on a battery-constrained device
- [ ] Stale riders stop animating

**Testing**
- [ ] Manual: movement looks smooth, not stepped
- [ ] Manual: a teleport-sized jump snaps
- [ ] Manual: leaving the ride cancels every animation — verify no rAF callbacks remain
- [ ] Manual: profile CPU with 15 markers before and after; record the delta
- [ ] Manual: confirm on a mid-range phone, not just a laptop

---

### HZ-059 · Route line layer
`Maps` · 🟠 High · **M** · Todo · `feature/map-route-line`
**Depends on:** HZ-058
**Why:** Even with the backend endpoint built, Phase 2 is invisible without a GeoJSON source and a
`LineLayer`. It is also the fastest way to verify by eye that standings are correct.
**Files**
- `web/src/map/Map.tsx` — GeoJSON source + `LineLayer`, added below the markers
- `web/src/index.css` — route colour

**Acceptance**
- [ ] The route renders as a line beneath the rider markers
- [ ] Consumes the server's `[lng,lat]` polyline **directly, with no conversion** — and a comment
      states that this is why the endpoint returns that order
- [ ] Adding, replacing, and clearing a route all work without recreating the map
- [ ] The source is added after `map.load`, and re-added correctly if the style reloads
- [ ] Line width and colour are legible in sunlight and distinct from map roads
- [ ] A 3,000-point route renders without a visible frame hitch

**Testing**
- [ ] Manual: set a route → the line appears in the right place
- [ ] Manual: the line follows actual roads, not straight lines between waypoints
- [ ] Manual: replace the route → the old line is gone, the new one is correct
- [ ] Manual: leave and rejoin → no duplicate layer, no console error
- [ ] Manual: a long real ORS route renders smoothly

---

### HZ-060 · Destination picker
`Maps` · 🟠 High · **M** · Todo · `feature/destination-picker`
**Depends on:** HZ-059
**Why:** Without a way to choose a destination, the route endpoint is unreachable from the UI.
**Keep this deliberately crude** — `docs/SETUP_WEB.md` is right that a friend group can paste coordinates
at first, and this is the single most likely place in the project for scope creep.
**Files**
- `web/src/map/Map.tsx` — long-press to drop a destination
- `web/src/Ride.tsx` — a paste-coordinates input and a "Set route" action
- `web/src/index.css`

**Acceptance**
- [ ] Paste-coordinates input accepting `lat,lng`, forgiving about whitespace
- [ ] Long-press on the map sets a destination, with a visible marker
- [ ] The rider's current position is the implicit origin
- [ ] Clear feedback for fetching, success, and each failure mode from HZ-058
- [ ] A way to clear the route
- [ ] **Explicitly out of scope:** search, geocoding, waypoint reordering, drag-to-reroute,
      multi-stop editing. Any of those is a separate task with its own ADR discussion

**Testing**
- [ ] Manual: paste valid coordinates → a route appears
- [ ] Manual: paste garbage → a clear error, no request sent
- [ ] Manual: long-press → destination marker and route
- [ ] Manual: clear → route and marker both removed
- [ ] Manual: long-press does not fire during a normal pan or pinch

---

### HZ-070 · Heading arrows on markers
`Maps` · 🟢 Low · **S** · Todo · `feature/marker-heading-arrows`
**Depends on:** HZ-069
**Why:** Blocked until now because the server discarded `heading`. With HZ-069 shipped, showing which
way a rider is facing is a cheap, genuinely useful addition on a shared map.
**Files**
- `web/src/map/Map.tsx` — marker rotation
- `web/src/index.css` — arrow styling

**Acceptance**
- [ ] Markers rotate to the reported heading
- [ ] **A rider whose heading is unknown shows no arrow** — not an arrow pointing north. This is the
      whole reason HZ-069 fixed the `?? 0` conflation
- [ ] Stale riders drop the arrow, since their heading is stale too
- [ ] Rotation interpolates with HZ-044 rather than snapping
- [ ] Rotation crosses 0°/360° by the short way

**Testing**
- [ ] Manual: a moving rider's arrow matches their direction of travel
- [ ] Manual: a stationary rider reporting no heading shows no arrow
- [ ] Manual: crossing north rotates the short way, not 350° around
- [ ] Manual: arrows are legible at normal zoom on a phone

---

## Standings

### HZ-017 · `internal/standings` unit tests
`Standings` · 🟠 High · **M** · Todo · `feature/standings-unit-tests`
**Depends on:** —
**Why:** 66 lines of pure math with no I/O and **zero tests** — the highest-value, lowest-effort test
target in the repository, and exactly the code whose bugs are hardest to spot by eye on a moving map.
Writing these before HZ-053 gives that endpoint something to validate against. This is also the
first test file the project will have.
**Files**
- `backend/internal/standings/standings_test.go` *(new)*

**Acceptance**
- [ ] `Haversine` against known great-circle distances, within 0.5%
- [ ] `Haversine` for identical points returns 0, and is symmetric
- [ ] `projectOntoSegment` with the point beyond each endpoint, verifying the `t` clamp at 0 and 1
- [ ] `projectOntoSegment` for a zero-length segment does not divide by zero
- [ ] `DistAlongRoute` on a straight line, an L-bend, and a rider exactly on a vertex
- [ ] `DistAlongRoute` with an empty and a single-point route returns 0 without panicking
- [ ] **An out-and-back case documented and `t.Skip`-ped with a reference to HZ-065**, so the known
      non-monotonicity is recorded in code rather than folklore
- [ ] Table-driven; **tolerance-based, never exact float equality**
- [ ] `go test -cover` reports >90% for the package

**Testing**
- [ ] `go test ./internal/standings/...` passes
- [ ] `go test -race ./...` clean
- [ ] Deliberately breaking the haversine constant makes tests fail
- [ ] The skipped out-and-back test runs and fails when un-skipped, confirming it tests something

---

### HZ-056 · Move ranking and `pos` into `standings`
`Standings` · 🟡 Medium · **M** · Todo · `refactor/ranking-into-standings`
**Depends on:** HZ-055
**Why:** The sort and `pos` assignment live in `room.broadcast()` — domain logic embedded in
transport code, which is also why they cannot be unit-tested without constructing a `Room`.
`standings` owns *distance*; ranking is the same domain and belongs beside it.
**Files**
- `backend/internal/standings/rank.go` *(new)* — `Rank(entries) []Ranked`
- `backend/internal/standings/rank_test.go` *(new)*
- `backend/internal/hub/room.go` — call it

**Acceptance**
- [ ] Ranking is a pure function: positions in, ordered positions with `pos` out
- [ ] Both branches preserved — by `distAlong` descending when a route exists, stable by `id`
      otherwise
- [ ] **No behaviour change** — output is byte-identical to today for the same input
- [ ] `standings` still imports nothing but `math` and `sort`
- [ ] Table-driven tests including ties, one rider, and zero riders
- [ ] `broadcast()` gets measurably simpler

**Testing**
- [ ] Unit: ranking matches the previous implementation across a generated input set
- [ ] Unit: ties are ordered deterministically
- [ ] Unit: zero and one rider
- [ ] `go test -race ./...` clean
- [ ] Manual: standings look identical before and after

---

### HZ-064 · GPS outlier rejection
`Standings` · 🟡 Medium · **M** · Todo · `feature/gps-outlier-rejection`
**Depends on:** HZ-063
**Why:** A single wild fix teleports a dot across the map and — post-HZ-053 — can reorder the entire
standings. There is no smoothing and no plausibility check anywhere in the pipeline.
**Files**
- `backend/internal/standings/filter.go` *(new)* — a pure plausibility check
- `backend/internal/standings/filter_test.go` *(new)*
- `backend/internal/hub/client.go` — apply on ingest, under the existing lock discipline

**Acceptance**
- [ ] A fix implying an impossible speed since the previous fix is rejected (suggest >150 km/h)
- [ ] A fix whose `accuracy` (HZ-063) exceeds a threshold is rejected or flagged
- [ ] **Rejection is not silent** — count it, log at debug, and never let a rider be frozen out by a
      run of rejections. After N consecutive rejections, accept anyway and re-baseline
- [ ] The check is a pure function; the per-rider previous fix lives on `Client` under `room.mu`
- [ ] The first fix after connect is always accepted
- [ ] Thresholds are named constants with a comment, not magic numbers

**Testing**
- [ ] Unit: a 500 km/h jump is rejected
- [ ] Unit: normal cycling speeds are accepted
- [ ] Unit: a stationary rider with jittery fixes is not rejected
- [ ] Unit: N consecutive rejections re-baseline instead of freezing the rider
- [ ] Unit: a ±500 m accuracy fix is rejected when the threshold is set
- [ ] `go test -race ./...` clean
- [ ] Manual: replay a real GPS trace from HZ-038 and confirm nothing legitimate is dropped

---

### HZ-065 · Windowed monotonic projection
`Standings` · 🟠 High · **L** · Todo · `feature/standings-monotonic-projection`
**Depends on:** HZ-060, HZ-064
**Why:** Nearest-segment snapping is non-monotonic. A rider on the return leg of an out-and-back can
snap to the **outbound** leg and appear to lose kilometres — `standings.go` documents the fix
(constrain the search to a window around the previous `distAlong`) and notes it needs per-rider state
that does not exist. Placed after HZ-060 because you need a route drawn on screen to see the fix
working.
**Files**
- `backend/internal/standings/standings.go` — a windowed variant taking a previous `distAlong`
- `backend/internal/standings/standings_test.go` — un-skip the out-and-back case
- `backend/internal/hub/client.go` — `lastDistAlong` on `Client`, guarded by `room.mu`
- `backend/internal/hub/room.go` — thread it through

**Acceptance**
- [ ] The segment search is constrained to a window around the rider's previous `distAlong`
- [ ] The window is wide enough to absorb a dropped-signal gap (suggest ±500 m, tuned against real
      traces from HZ-038)
- [ ] **A rider with no previous value falls back to a full search** — first fix, and after a rejoin
- [ ] **A rider genuinely off-route or restarting does not get stuck in a stale window** — define and
      test the recovery path explicitly; this is the failure mode that makes windowed search worse
      than naive search when it goes wrong
- [ ] `lastDistAlong` carries across a rejoin (HZ-009), so a reconnect doesn't reset progress
- [ ] The previously-skipped out-and-back test now passes
- [ ] The Phase-2 comment in `standings.go` is replaced with a description of what was built

**Testing**
- [ ] Unit: out-and-back — progress increases monotonically on the return leg
- [ ] Unit: a figure-eight route does not collapse at the crossing
- [ ] Unit: a rider who jumps 2 km forward (a signal gap) recovers within the defined path
- [ ] Unit: first fix with no previous value works
- [ ] Unit: a rider who leaves and rejoins the route recovers
- [ ] `go test -race ./...` clean
- [ ] Manual: ride an out-and-back and confirm standings never go backwards

---

### HZ-066 · Off-route detection
`Standings` · 🟠 High · **M** · Todo · `feature/off-route-detection`
**Depends on:** HZ-065
**Why:** `DistAlongRoute` computes `bestDist` — the perpendicular distance to the route — and then
**throws it away**. That value is exactly the "this rider has left the route" signal, and without it
a rider 3 km off-course still receives a confident `distAlong`.
**Files**
- `backend/internal/standings/standings.go` — return `bestDist` alongside the distance
- `backend/internal/standings/standings_test.go`
- `backend/internal/hub/room.go` — `offRoute` in `riderState`
- `web/src/types.ts`, `protocol/fixtures/`, `CLAUDE.md` — protocol change

**Acceptance**
- [ ] The perpendicular distance is returned instead of discarded
- [ ] A rider beyond a threshold is flagged off-route (suggest 100 m, tuned against real traces)
- [ ] **Hysteresis on the flag itself** — going off-route and back must not flap at 4 Hz. Use
      separate enter and exit thresholds
- [ ] An off-route rider's `distAlong` is still computed but marked untrustworthy, so HZ-067 can
      suppress the rank rather than showing a wrong one
- [ ] Protocol change made across all implementations and fixtures together
- [ ] The threshold is a named constant with a comment

**Testing**
- [ ] Unit: a rider on the route is not flagged
- [ ] Unit: a rider 500 m away is flagged
- [ ] Unit: a rider oscillating around the threshold does not flap, thanks to the two thresholds
- [ ] Unit: with no route set, nobody is flagged
- [ ] Conformance tests pass
- [ ] Manual: deliberately ride off-route and confirm the flag appears and clears

---

### HZ-068 · Standings hysteresis
`Standings` · 🟡 Medium · **M** · Todo · `feature/standings-hysteresis`
**Depends on:** HZ-071
**Why:** With GPS jitter of a few metres, two riders within jitter distance have their `pos` swap
back and forth **at 4 Hz** — the UI visibly flickers between 1st and 2nd, which reads as broken even
when the math is right.
> **Deliberately depends on the road test, not the reverse.** The threshold cannot be tuned until
> you have watched real standings flicker on real riders.

**Files**
- `backend/internal/standings/rank.go` — hysteresis in the ranking function
- `backend/internal/standings/rank_test.go`
- `backend/internal/hub/room.go` — retain the previous ranking

**Acceptance**
- [ ] A position swap requires a margin (suggest 10 m) **or** a sustained lead (suggest 2 s)
- [ ] Thresholds are named constants tuned against HZ-071's observations, with the reasoning in a
      comment
- [ ] **A genuine overtake still shows promptly** — a rider who passes and stays ahead must not be
      stuck behind for seconds. State the worst-case delay and test it
- [ ] Previous-ranking state lives on the room under `r.mu`, not in the pure function
- [ ] The pure function remains testable without a `Room`
- [ ] A new or departing rider does not corrupt retained state

**Testing**
- [ ] Unit: two riders jittering ±3 m around each other never swap
- [ ] Unit: a genuine overtake swaps within the stated delay
- [ ] Unit: a rider joining mid-ride is ranked correctly immediately
- [ ] Unit: a rider leaving does not leave stale state behind
- [ ] `go test -race ./...` clean
- [ ] Manual: on a real ride, positions are stable and overtakes still register

---

## Performance

### HZ-050 · `standings.Route` with precomputed cumulative lengths
`Performance` · 🟠 High · **M** · Todo · `feature/standings-route-precompute`
**Depends on:** HZ-017
**Why:** `DistAlongRoute` calls `Haversine(a,b)` **twice per segment** — once for `best`, once for
`cum` — plus one for `Haversine(p, proj)`. That is three haversines × S segments × R riders × 4 Hz.
An ORS cycling route for a 50 km ride is easily 2,000–5,000 points, so 15 riders at 4 Hz against a
3,000-point route is **≈540,000 haversine evaluations per second**, each with four transcendental
calls. Precomputing segment lengths once when the route is set removes two thirds of that
immediately. **Build this before the route endpoint, not after.**
**Files**
- `backend/internal/standings/route.go` *(new)* — `Route` type with points + cumulative lengths
- `backend/internal/standings/standings.go` — a `DistAlong` method using the precompute
- `backend/internal/standings/route_test.go` *(new)*

**Acceptance**
- [ ] `NewRoute([]Pt) Route` computes cumulative lengths once
- [ ] `DistAlong` performs **one** haversine per segment, not three
- [ ] Results are numerically equivalent to the current implementation within tolerance
- [ ] The `Route` value is immutable once built, so it can be read concurrently without a lock
- [ ] Empty and single-point routes are handled without panicking
- [ ] The old `DistAlongRoute` is kept or removed deliberately — state which in the PR
- [ ] `standings` still imports nothing beyond `math` and `sort`

**Testing**
- [ ] Unit: the same inputs produce the same distances as the old function, within tolerance
- [ ] Unit: cumulative lengths sum to the total route length
- [ ] Unit: empty, one-point, and two-point routes
- [ ] `go test -race ./...` clean

---

### HZ-051 · Benchmark `distAlong` against a realistic route
`Performance` · 🟠 High · **S** · Todo · `feature/standings-benchmarks`
**Depends on:** HZ-050
**Why:** HZ-050's improvement is currently an estimate. A benchmark turns it into a number, and gives
HZ-055 and HZ-099 a baseline to defend against regressions. **Benchmark against a real ORS route, not
a synthetic straight line** — segment count and geometry both matter.
**Files**
- `backend/internal/standings/bench_test.go` *(new)*
- `backend/internal/standings/testdata/route-50km.json` *(new)* — a recorded ORS polyline

**Acceptance**
- [ ] Benchmarks for 100, 1,000, and 3,000-point routes
- [ ] Benchmarks for 1, 5, and 15 riders, reflecting a full broadcast tick
- [ ] A recorded real ORS route is committed as testdata — small, and the only data file in the repo
- [ ] Before/after numbers for HZ-050 recorded in the PR description
- [ ] A comment states the per-tick budget: a full broadcast must complete well inside 250 ms

**Testing**
- [ ] `go test -bench=. ./internal/standings/...` runs and reports
- [ ] The measured improvement from HZ-050 is at least 2×
- [ ] The 15-rider, 3,000-point case is comfortably under the tick budget
- [ ] Benchmarks do not run during normal `go test`

---

### HZ-055 · Compute `distAlong` outside `r.mu.RLock()`
`Performance` · 🟠 High · **S** · Todo · ships with `feature/route-ors-proxy`
**Depends on:** HZ-053 · **bundle with HZ-053**
**Why:** `broadcast()` computes `distAlong` for every rider **inside the read lock**, so heavy route
math directly blocks every read pump's `Lock()` for `loc` ingestion. With a large route this is a
genuine ingest stall — and the read lock is the same one every incoming GPS fix must wait on. It is a
one-line restructure now and a subtle regression risk later.
**Files**
- `backend/internal/hub/room.go` — `broadcast()`

**Acceptance**
- [ ] Positions and the route handle are snapshotted under `RLock`, then the lock is released
- [ ] All `distAlong` computation happens **after** `RUnlock`
- [ ] The route value is immutable (HZ-050), so holding a reference after unlocking is safe — and a
      comment says exactly that
- [ ] No behaviour change in the emitted payload
- [ ] The existing two-phase-lock behaviour (a rider joining between phases may miss a frame) is
      unchanged and still commented as harmless

**Testing**
- [ ] Unit: broadcast output is unchanged for the same inputs
- [ ] Unit: concurrent `loc` ingest during a broadcast with a 3,000-point route is not blocked —
      measure ingest latency with and without
- [ ] `go test -race ./...` clean
- [ ] Benchmark: HZ-051's numbers do not regress

---

### HZ-080 · Battery measurement with voice active
`Performance` · 🟠 High · **M** · Todo · `feature/battery-measurement-voice`
**Depends on:** HZ-077
**Why:** Continuous WebRTC audio on top of continuous high-accuracy GPS and a screen-on wake lock is
**the heaviest combination the app will ever run**, and it is entirely unmeasured.
`docs/SYSTEM_DESIGN.md` §10 names battery as a known sharp edge. **Measure before tuning** — HZ-100 and
HZ-101 are meaningless without a baseline.
**Files**
- `docs/measurements/battery.md` *(new)* — recorded results
- `HZ-037`'s ride log template — battery fields

**Acceptance**
- [ ] Four scenarios measured over ≥30 minutes each on the same device: idle app; map + GPS; map +
      GPS + wake lock; all of that + voice connected
- [ ] Both iOS and Android, on real hardware
- [ ] Percentage per hour recorded, plus device model, OS version, screen brightness, and ambient
      temperature
- [ ] A conclusion stated: is an external battery required for a typical ride, yes or no
- [ ] Results committed, not just discussed
- [ ] Any surprising finding filed as a new task

**Testing**
- [ ] Each scenario run at least twice for consistency
- [ ] Brightness held constant across runs
- [ ] Airplane-mode-off baseline recorded for comparison
- [ ] Results reproducible within ~20%

---

### HZ-100 · Adaptive GPS rate when stationary
`Performance` · 🟠 High · **M** · Todo · `feature/adaptive-gps-rate`
**Depends on:** HZ-098
**Why:** `enableHighAccuracy: true, maximumAge: 0` is **the most expensive possible geolocation
configuration**, applied unconditionally — `maximumAge: 0` forbids reusing even a 200 ms-old cached
fix. A rider stopped at a café burns full-rate GPS. `docs/SYSTEM_DESIGN.md` §10 explicitly recommends
lowering the rate when stationary.
**Files**
- `web/src/location/useGeo.ts` — adaptive interval and `maximumAge`
- `mobile/src/features/location/tracker.ts` — the native equivalent via `timeInterval` /
  `distanceInterval`
- `docs/measurements/battery.md` — before/after

**Acceptance**
- [ ] Detects stationarity from speed and position delta over a short window
- [ ] Reduces the update rate when stationary (suggest 1 Hz → 0.2 Hz) and restores it immediately on
      movement
- [ ] Allows a small `maximumAge` when stationary, so a cached fix can be reused
- [ ] **Resuming full rate is fast** — a rider setting off must not be stale for several seconds.
      State and test the worst-case resume latency
- [ ] The rider still appears fresh to others while stationary — `ageSec` must not creep past the
      10 s stale threshold
- [ ] Native uses OS-level throttling rather than dropping fixes in JS, which is strictly better
- [ ] Measured battery improvement recorded

**Testing**
- [ ] Manual: stand still for 5 minutes → rate drops, and you do not grey out on another client
- [ ] Manual: start moving → full rate resumes within the stated latency
- [ ] Manual: measure battery over 30 minutes stationary, before and after
- [ ] Manual: verify on both clients
- [ ] Manual: a slow walking pace is not misdetected as stationary

---

### HZ-101 · Dim the map when idle
`Performance` · 🟡 Medium · **S** · Todo · `feature/map-idle-dimming`
**Depends on:** HZ-100
**Why:** Four re-renders per second plus four `setLngLat` calls, each triggering a MapLibre repaint,
is continuous GPU and CPU work **even when nobody is moving**. The screen is also the single largest
battery consumer on a mounted phone.
**Files**
- `web/src/map/Map.tsx` — reduce repaint work when idle
- `web/src/Ride.tsx` — screen dimming affordance
- `web/src/index.css`

**Acceptance**
- [ ] When no rider has moved for a period, marker updates and repaints are throttled
- [ ] An optional dimmed display mode reduces brightness while keeping the map legible
- [ ] **Any touch or any rider movement restores full rendering immediately**
- [ ] Dimming never releases the wake lock — the screen must stay on
- [ ] The rider can disable dimming entirely
- [ ] Measured GPU/CPU reduction recorded

**Testing**
- [ ] Manual: idle for 2 minutes → repaint rate drops, verified in a performance profile
- [ ] Manual: touch the screen → full rendering resumes instantly
- [ ] Manual: another rider moves while you are idle → their dot still updates
- [ ] Manual: the wake lock stays held throughout
- [ ] Manual: dimmed mode is still readable in direct sunlight

---

### HZ-102 · Measure mobile data usage per ride hour
`Performance` · 🟡 Medium · **S** · Todo · `feature/data-usage-measurement`
**Depends on:** HZ-098
**Why:** Riders are on mobile data, often with a capped plan. The system sends 4 `state` frames per
second per client plus map tiles plus, from Milestone 3, continuous audio — and nobody has measured
what an hour actually costs.
**Files**
- `docs/measurements/data-usage.md` *(new)*
- `HZ-037`'s ride log template — data fields

**Acceptance**
- [ ] Measured per hour, broken down by WebSocket, map tiles, and voice
- [ ] Measured with 2 riders and with the maximum group size
- [ ] Both a fresh install (cold tile cache) and a warm cache after HZ-047
- [ ] A conclusion stated on whether any reduction is needed
- [ ] If reduction is warranted, a follow-up task filed — candidates are WebSocket compression, a
      lower tick rate, and delta encoding. **Do not implement any of them speculatively**

**Testing**
- [ ] Measured with OS-level per-app data counters, and cross-checked in the browser Network panel
- [ ] Cold and warm tile cache both recorded
- [ ] Voice on and off both recorded
- [ ] Results reproducible across two runs

---

## Voice

### HZ-072 · LiveKit account and env wiring
`Voice` · 🟠 High · **S** · Todo · `feature/livekit-env-setup`
**Depends on:** —
**Why:** LiveKit Cloud's free tier needs an email signup and no card ([ADR-006](./ADR/ADR-006.md)).
The env slots already exist in `.env.example`; nothing reads them. Small, and it unblocks HZ-073.
**Files**
- `backend/.env.example` — already lists `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`;
  expand the comments
- `backend/main.go` — read and validate at startup
- `docs/SETUP_BACKEND.md` — signup steps
- `README.md` — confirm the accounts list is accurate

**Acceptance**
- [ ] Startup validates that all three are set **together or not at all**, and fails fast on a
      partial configuration
- [ ] Voice is cleanly disabled when unconfigured — the endpoint returns a clear 503, not a 500
- [ ] **The secret is never logged**, including at debug and including in startup diagnostics
- [ ] `.env` stays gitignored; only `.env.example` with blank values is committed
- [ ] Setup docs state clearly that no credit card is required

**Testing**
- [ ] Startup with none set → server runs, voice reports disabled
- [ ] Startup with only the key set → fails fast with a clear message
- [ ] Startup with all three → voice reports enabled
- [ ] `grep` the full log output for the secret → no match

---

### HZ-073 · `POST /rides/{code}/voice-token`
`Voice` · 🟠 High · **M** · Todo · `feature/voice-token-endpoint`
**Depends on:** HZ-011, HZ-072
**Why:** The second 501 stub. The Go backend must mint the LiveKit JWT so `LIVEKIT_API_SECRET` never
touches a client ([P8](./DEVELOPMENT_GUIDE.md#p8--secrets-never-leave-the-server)). This is the
**first new backend dependency since `gorilla/websocket`** — justified because hand-rolling JWT
claims for an external service is exactly what we should not do.
> This endpoint mints a *cryptographically signed credential* from a claimed rider id and a ride
> code. It depends on HZ-011 specifically so the code is validated first.

**Files**
- `backend/internal/voice/token.go` *(new)* — LiveKit Go SDK wrapper
- `backend/internal/hub/routes.go` — the handler
- `backend/main.go` — replace `notImplemented`
- `backend/go.mod`, `go.sum` — the SDK
- `docs/ADR/ADR-005.md` — a note recording the dependency count change

**Acceptance**
- [ ] Returns `{"token":"…","url":"wss://…"}`
- [ ] **Room name = ride code**, identity = rider id, so voice and location membership line up
      automatically
- [ ] **Short TTL** (suggest 10 minutes), with the client re-requesting as needed
- [ ] Grants are minimal: join the one room, publish and subscribe audio. **No wildcard, no room
      creation, no recording**
- [ ] Unknown ride code → 404 via HZ-011's registry
- [ ] Voice unconfigured → 503 with a clear body
- [ ] The secret never appears in a response, a log, or an error string
- [ ] Rate-limited per rider, so it cannot be used as a token mint

**Testing**
- [ ] `httptest`: valid code and rider → a well-formed JWT with the expected claims
- [ ] Unit: decode the token and assert room, identity, grants, and expiry
- [ ] `httptest`: unknown code → 404
- [ ] `httptest`: unconfigured → 503
- [ ] Unit: the secret is absent from every response and error path
- [ ] Manual: the minted token actually joins a real LiveKit room

---

### HZ-074 · Token endpoint tests
`Voice` · 🟠 High · **S** · Todo · `feature/voice-token-tests`
**Depends on:** HZ-073
**Why:** This is the only endpoint that produces a signed credential to an external service. It
warrants explicit adversarial coverage beyond HZ-073's happy path — and it is the natural place to
pin down the security properties before they drift.
**Files**
- `backend/internal/voice/token_test.go` *(new)*
- `backend/internal/hub/routes_test.go` — endpoint-level cases

**Acceptance**
- [ ] Tokens are signed with the configured secret and verify against it
- [ ] Expiry is enforced and matches the configured TTL
- [ ] Grants are exactly the minimal set — a test that **fails if a wildcard grant is ever added**
- [ ] A rider id that failed `validRiderID` never reaches the token
- [ ] An oversized or hostile `name` cannot be injected into a claim
- [ ] Two different rides produce tokens for different rooms

**Testing**
- [ ] `go test ./internal/voice/...` passes
- [ ] `go test -race ./...` clean
- [ ] Adding a wildcard grant by hand makes a test fail
- [ ] Changing the TTL makes the expiry test fail

---

### HZ-075 · Store: voice slice
`Voice` · 🟡 Medium · **S** · Todo · `feature/store-voice-slice`
**Depends on:** HZ-073
**Why:** The store has no slot for Phase-3 data. Four voice tasks need somewhere to put connection
state, mic state, and speaking participants; build the slot once.
**Files**
- `web/src/store/ride.ts` — voice fields and setters
- `web/src/types.ts` — the status union

**Acceptance**
- [ ] `voiceStatus: "off" | "connecting" | "connected" | "error"`
- [ ] `micActive: boolean`, `speakers: string[]` keyed by rider id
- [ ] `leaveRide()` clears all of it and is the single teardown point
- [ ] Flat, matching the existing store; no middleware
- [ ] Voice errors route through `lastError` with `scope: "voice"` (HZ-023)
- [ ] No component reads it yet

**Testing**
- [ ] `tsc -b` and lint clean
- [ ] Manual: existing behaviour unchanged
- [ ] Manual: `leaveRide()` clears every voice field

---

### HZ-076 · Web: connect to the LiveKit room
`Voice` · 🟠 High · **M** · Todo · `feature/web-voice-connect`
**Depends on:** HZ-075
**Why:** The client half of voice. `livekit-client` is not yet installed. Connect with `audio: false`
so the mic starts muted and stays that way until the rider presses to talk.
**Files**
- `web/package.json` — add `livekit-client`
- `web/src/voice/useVoice.ts` *(new)* — connection lifecycle
- `web/src/net/api.ts` — `voiceToken(code)`
- `web/src/Ride.tsx` — mount the hook

**Acceptance**
- [ ] Fetches a token, connects, and subscribes to everyone else's audio
- [ ] **Connects with `audio: false`** — the mic must never be live on connect
- [ ] Token refresh before expiry, without dropping the connection
- [ ] Disconnects cleanly on leave and on unmount; StrictMode-safe
- [ ] **A voice failure never affects the location pipe** — the three-wire independence from
      [ADR-005](./ADR/ADR-005.md) is the property being protected here
- [ ] `livekit-client` is the only dependency added, and its size impact is noted in the PR

**Testing**
- [ ] Manual: two browsers join voice and hear each other
- [ ] Manual: kill LiveKit connectivity → voice degrades, dots and standings keep working
- [ ] Manual: leave the ride → the room is left and the mic is released
- [ ] Manual: StrictMode double-mount does not create two connections
- [ ] Manual: let a token expire → refresh happens without a gap

---

### HZ-077 · Push-to-talk control with iOS gesture gate
`Voice` · 🟠 High · **M** · Todo · `feature/web-voice-ptt`
**Depends on:** HZ-076
**Why:** Push-to-talk is the product requirement: publish only while held, always subscribed to
others. **iOS requires a user gesture to start audio**, so voice cannot auto-connect — that
constraint has to be designed around rather than fought.
**Files**
- `web/src/voice/PttButton.tsx` *(new)*
- `web/src/voice/useVoice.ts` — `setMicrophoneEnabled`
- `web/src/Ride.tsx`, `web/src/index.css`

**Acceptance**
- [ ] Mic enables on press and disables on release, via `setMicrophoneEnabled`
- [ ] **Voice connection is gated behind an explicit "Join voice" tap** — required on iOS, and
      better everywhere because it makes mic activation intentional
- [ ] The button is **large enough to hit one-handed with gloves, without looking**
- [ ] Unambiguous transmitting state — colour, and haptics where available
- [ ] Pointer, touch, and mouse events all work; `pointercancel` and losing focus mid-press
      **release the mic**, so it cannot get stuck open
- [ ] Optional latch mode for sustained talking, clearly distinct from momentary
- [ ] Releasing always wins over any race — the failure mode must be a stuck-closed mic, never a
      stuck-open one

**Testing**
- [ ] Manual: hold to talk, release to stop; the other rider hears exactly that
- [ ] Manual: drag a finger off the button mid-press → the mic releases
- [ ] Manual: an incoming phone call mid-press → the mic releases
- [ ] Manual: works on iOS Safari after the gesture gate
- [ ] Manual: usable with gloves on a mounted phone

---

### HZ-078 · Speaking indicators and participant list
`Voice` · 🟡 Medium · **S** · Todo · `feature/voice-speaking-indicators`
**Depends on:** HZ-077
**Why:** Without an indicator, riders talk over each other and cannot tell whether their own
transmission is being heard — the most common complaint about any push-to-talk system.
**Files**
- `web/src/voice/useVoice.ts` — active-speaker events into the store
- `web/src/Ride.tsx` — indicators in the standings list
- `web/src/map/Map.tsx` — optional marker state
- `web/src/index.css`

**Acceptance**
- [ ] Active speakers are highlighted in the rider list
- [ ] The rider's own transmitting state is unmistakable
- [ ] Riders connected to voice are distinguishable from those who are not
- [ ] **LiveKit identity is mapped back to rider id** so voice and location refer to the same person
      — this works only because the identity is the rider id (HZ-073)
- [ ] Indicators clear promptly when speech stops
- [ ] No layout shift as indicators appear and disappear

**Testing**
- [ ] Manual: one rider talks → highlighted on the other's screen
- [ ] Manual: two riders talk at once → both highlighted
- [ ] Manual: a rider not in voice is shown as such
- [ ] Manual: indicators clear within a second of silence
- [ ] Manual: legible while riding

---

### HZ-079 · Voice failure isolation and error UX
`Voice` · 🟡 Medium · **S** · Todo · `feature/voice-error-handling`
**Depends on:** HZ-077
**Why:** Voice depends on a third party ([ADR-005](./ADR/ADR-005.md)) and on microphone
permission. Both can fail, and neither should take the ride down or fail silently — the same defect
class as BUG-06 and BUG-07.
**Files**
- `web/src/voice/useVoice.ts` — error paths into `lastError`
- `web/src/Ride.tsx` — error UI and retry
- `web/src/index.css`

**Acceptance**
- [ ] Microphone permission denial is surfaced with platform-specific recovery guidance and a retry
- [ ] A token fetch failure, a LiveKit connection failure, and an unconfigured server are three
      distinct messages
- [ ] **Voice reconnects on its own with backoff**, independently of the location socket
- [ ] Any voice failure leaves the map, standings, and location socket **completely unaffected** —
      test this explicitly rather than assuming it
- [ ] A rider can retry or disable voice for the rest of the ride
- [ ] No `console.warn`-only paths

**Testing**
- [ ] Manual: deny microphone permission → clear message and retry
- [ ] Manual: block LiveKit at the network level → voice errors, location keeps working
- [ ] Manual: unconfigured backend → voice reports unavailable, ride works normally
- [ ] Manual: restore connectivity → voice reconnects without a page reload
- [ ] Manual: disable voice mid-ride → no residual errors

---

### HZ-097 · Native voice and PTT
`Voice` · 🟠 High · **L** · Todo · `feature/mobile-voice-ptt`
**Depends on:** HZ-077, HZ-096
**Why:** The native equivalent of HZ-076 through HZ-079, using `@livekit/react-native`. The plugin
config is already written in `app.config.ts` — `audioType: "communication"`,
`NSMicrophoneUsageDescription`, and `UIBackgroundModes: ["location","audio"]` are all present.
**Files**
- `mobile/src/features/voice/Voice.tsx` *(new)*
- `mobile/src/features/voice/PttButton.tsx` *(new)*
- `mobile/src/state/useRide.ts` — the voice slice
- `mobile/src/net/api.ts` — `voiceToken`

**Acceptance**
- [ ] Connects to the same room as the web client, via the same endpoint, and **interoperates in one
      ride**
- [ ] PTT via `setMicrophoneEnabled`, matching web semantics exactly
- [ ] `AudioSession.startAudioSession()` is called before connecting (HZ-096)
- [ ] Audio continues correctly when the app is backgrounded, using the configured background mode
- [ ] Audio routing behaves with Bluetooth headsets and on speaker
- [ ] Interruptions — an incoming call, another audio app — are handled and recovered from
- [ ] The same error handling as HZ-079

**Testing**
- [ ] Manual: a native rider and a web rider hold a conversation in one ride
- [ ] Manual: background the app mid-conversation → audio continues
- [ ] Manual: take a phone call → voice suspends and recovers
- [ ] Manual: connect a Bluetooth headset mid-ride → routing follows
- [ ] Manual: on both iOS and Android
- [ ] Manual: PTT usable one-handed while riding

---

## Mobile

> `mobile/` exists for **exactly one capability: true background location**
> ([ADR-004](./ADR/ADR-004.md)). Everything else here is a re-implementation of code that
> already works in `web/`. **Port it; do not rewrite it.** Per `mobile/AGENTS.md`, read the versioned
> Expo v56 docs before writing anything in this directory.

### HZ-021 · Install `expo-location` and `expo-task-manager`
`Mobile` · 🟠 High · **S** · Todo · `bugfix/mobile-expo-location-dep`
**Depends on:** —
**Why:** `app.config.ts` lists the `expo-location` plugin and `package.json` contains neither
`expo-location` nor `expo-task-manager`. **`npx expo config`, `prebuild`, and `eas build` all fail to
resolve the plugin — the mobile project does not build at all.** Do it now precisely because it is
not urgent: it is a five-minute fix that will otherwise be discovered under pressure at the start of
Stage 10.
**Files**
- `mobile/package.json`, `mobile/package-lock.json` — `npx expo install expo-location expo-task-manager`

**Acceptance**
- [ ] Both packages present at Expo-56-compatible versions, installed via `expo install` (not plain
      `npm install`) so versions are SDK-matched
- [ ] `npx expo config --type public` resolves with no error
- [ ] The existing plugin configuration is unchanged — the config was already correct; only the
      dependency was missing
- [ ] `npx expo-doctor` reports no new issues

**Testing**
- [ ] `npx expo config --type public` succeeds and lists the location plugin
- [ ] `npx expo-doctor` output recorded in the PR
- [ ] `npx tsc --noEmit` still clean

---

### HZ-022 · Restore `scheme`, `version`, icon, and splash
`Mobile` · 🟡 Medium · **S** · Todo · `bugfix/mobile-app-config-completeness`
**Depends on:** HZ-021
**Why:** The original `app.json` was deleted and replaced with a minimal `app.config.ts` that omits
`scheme`, `version`, `orientation`, `icon`, `splash`, and `userInterfaceStyle`. **expo-router and
expo-dev-client need a `scheme` for deep linking**, and the template's `assets/images/icon.png` and
`splash-icon.png` are now orphaned.
**Files**
- `mobile/app.config.ts` — the missing fields

**Acceptance**
- [ ] `scheme: "horizon"` set, so deep links and the dev client resolve
- [ ] `version`, `orientation: "portrait"`, and `userInterfaceStyle` set, matching the PWA's manifest
      where they overlap
- [ ] `icon` and `splash` reference files that **actually exist** in `mobile/assets/`
- [ ] iOS and Android identity blocks unchanged — `com.krithik.horizon` on both
- [ ] The existing `UIBackgroundModes`, microphone description, and Android background-location and
      foreground-service flags are **untouched**; that config is the hard part and it is already
      correct

**Testing**
- [ ] `npx expo config --type public` shows every field
- [ ] `npx uri-scheme list` (or equivalent) shows the scheme registered after a prebuild
- [ ] `npx expo-doctor` clean
- [ ] The referenced asset paths resolve on disk

---

### HZ-083 · Delete the Expo template scaffolding
`Mobile` · 🟡 Medium · **S** · Todo · `refactor/mobile-remove-template`
**Depends on:** HZ-082
**Why:** `mobile/src/` is **100% stock `create-expo-app` template** — a welcome screen, a docs-links
tab, themed components, tutorial images, and a reset script. None of it is Horizon code. Deleting it
first means the port lands in a clean directory instead of being woven through demo code.
**Files**
- Delete `mobile/src/app/index.tsx`, `explore.tsx`, `_layout.tsx`
- Delete `mobile/src/components/` (themed-text, themed-view, collapsible, animated-icon, app-tabs,
  hint-row, web-badge, external-link and their `.web` variants and CSS module)
- Delete `mobile/src/constants/theme.ts`, `mobile/src/hooks/`
- Delete `mobile/scripts/reset-project.js` and its `package.json` script
- Delete template images: `expo-badge*`, `expo-logo`, `react-logo*`, `logo-glow`, `tutorial-web`,
  `tabIcons/`, `assets/expo.icon/`
- Add a minimal `mobile/src/app/_layout.tsx` and `index.tsx` placeholder so the app still boots

**Acceptance**
- [ ] No file references Expo documentation, tutorials, or demo content
- [ ] **Icon and splash assets referenced by `app.config.ts` (HZ-022) are kept** — check before
      deleting anything in `assets/images/`
- [ ] The app still builds and boots to a blank or placeholder screen
- [ ] `mobile/README.md` and `LICENSE` are reviewed — replace the template README
- [ ] `mobile/AGENTS.md` and `mobile/CLAUDE.md` are kept unchanged
- [ ] Directory layout follows the HZ-082 decision

**Testing**
- [ ] `npx tsc --noEmit` clean — no dangling imports
- [ ] `npx expo start` boots without error
- [ ] `grep -ri "expo-badge\|tutorial\|reset-project"` in `mobile/src` returns nothing
- [ ] `npx expo config` still resolves

---

### HZ-084 · Build and distribute the dev client
`Mobile` · 🟠 High · **M** · Todo · `feature/mobile-dev-client-build`
**Depends on:** HZ-022, HZ-083
**Why:** MapLibre and LiveKit need native code, so this is a **custom Expo dev client, never Expo
Go**. The build must succeed once before any porting starts — discovering a native build failure
mid-port is the expensive version of this task.
**Files**
- `mobile/eas.json` — verify the existing `development`, `preview`, and `production` profiles
- `docs/SETUP_MOBILE.md` — record the actual commands and any surprises

**Acceptance**
- [ ] An Android dev client builds and installs on a real device
- [ ] An iOS dev client builds via **EAS cloud** — the dev host is Windows, so local iOS builds are
      not possible
- [ ] `npx expo start --dev-client` connects and hot-reloads JS
- [ ] MapLibre, LiveKit, and WebRTC native modules all resolve at runtime
- [ ] Build times and any required EAS configuration are recorded, so the next person is not
      surprised
- [ ] It is documented that a rebuild is required **only** when native dependencies change

**Testing**
- [ ] `eas build --profile development --platform android` succeeds and the artifact installs
- [ ] `eas build --profile development --platform ios` succeeds
- [ ] The app launches on both platforms without a native module error
- [ ] A JS edit hot-reloads without a rebuild
- [ ] Location and microphone permission prompts appear with the configured strings

---

### HZ-085 · Port the protocol types — shared, not forked
`Mobile` · 🟠 High · **S** · Todo · `feature/mobile-protocol-types`
**Depends on:** HZ-020, HZ-084
**Why:** `web/src/types.ts` **is the contract**. Copying it creates a third independent definition
with no conformance check — precisely how `heading` drifted with only two. HZ-020 exists so this task
can be safe.
**Files**
- `mobile/src/core/types.ts` *(new)* or a shared module — per the HZ-082 decision
- `mobile/src/core/types.test.ts` *(new)* — parse the HZ-020 fixtures
- `protocol/fixtures/` — reused, not duplicated

**Acceptance**
- [ ] Types are **shared with `web/`** via a workspace package or a build-time copy with a drift
      check — a hand-maintained fork is explicitly not acceptable
- [ ] If a copy is unavoidable, CI fails when the two diverge
- [ ] The mobile client validates against the **same** HZ-020 fixture files
- [ ] `STALE_AFTER_SEC` and every constant come from the shared source
- [ ] The chosen mechanism is documented in the PR and in HZ-082's ADR

**Testing**
- [ ] `npx tsc --noEmit` clean
- [ ] Fixture parsing tests pass on mobile
- [ ] Editing `web/src/types.ts` without updating mobile fails CI
- [ ] All three implementations agree on every fixture

---

### HZ-086 · Port the zustand store
`Mobile` · 🟠 High · **S** · Todo · `feature/mobile-store`
**Depends on:** HZ-085
**Why:** `web/src/store/ride.ts` is framework-agnostic zustand — it copies with **no changes**. This
is the easiest task in Stage 10 and it proves the port strategy works before anything harder.
**Files**
- `mobile/src/state/useRide.ts` *(new)*

**Acceptance**
- [ ] Identical shape to the web store: name, code, selfId, status, riders, plus the error, route,
      and voice slices from HZ-023, HZ-057, and HZ-075
- [ ] Identical action names and semantics, so knowledge transfers between clients
- [ ] Flat, no middleware, matching web
- [ ] Any deliberate divergence is commented with a reason — the default is zero divergence

**Testing**
- [ ] `npx tsc --noEmit` clean
- [ ] Unit: `startRide` uppercases the code, exactly as web does
- [ ] Unit: `leaveRide` resets every field
- [ ] A side-by-side diff against the web store shows only intended differences

---

### HZ-087 · Port `net/config` for emulator and LAN
`Mobile` · 🟠 High · **S** · Todo · `feature/mobile-config`
**Depends on:** HZ-085
**Why:** `web/src/net/config.ts` derives the backend host from `location.hostname`, which does not
exist in React Native. Native needs `expo-constants` plus the emulator rule: **`10.0.2.2` for the
Android emulator, a LAN IP for physical devices** (`docs/SETUP_BACKEND.md` §11).
**Files**
- `mobile/src/core/config.ts` *(new)*
- `mobile/app.config.ts` — an `extra` block for the backend URL
- `docs/SETUP_MOBILE.md` — how to point at a local backend

**Acceptance**
- [ ] `httpBase` and `wsBase` exported with the same names and semantics as web
- [ ] Android emulator resolves the host machine correctly
- [ ] Physical devices use a configurable LAN IP or the deployed URL
- [ ] Production defaults to the deployed HTTPS/`wss://` origin from HZ-033
- [ ] Overridable without a rebuild — via `extra` or an env-driven config
- [ ] **No host or port literals anywhere else in `mobile/`**

**Testing**
- [ ] Android emulator reaches a local backend
- [ ] A physical Android device on the same Wi-Fi reaches it
- [ ] A physical iOS device reaches it
- [ ] A production build points at the deployed URL
- [ ] `npx tsc --noEmit` clean

---

### HZ-088 · Port identity to persistent storage
`Mobile` · 🟠 High · **S** · Todo · `feature/mobile-identity`
**Depends on:** HZ-087
**Why:** `web/src/net/identity.ts` uses `sessionStorage`, which does not exist in React Native. The
semantics shift from **per-tab to per-install** — and that is *better*, because a stable per-install
id is exactly what HZ-009's rejoin eviction wants.
**Files**
- `mobile/src/core/identity.ts` *(new)*
- `mobile/package.json` — `expo-secure-store` or `@react-native-async-storage/async-storage`

**Acceptance**
- [ ] A stable id persists across app restarts and satisfies `validRiderID` (8–64 chars of
      `[A-Za-z0-9_-]`)
- [ ] Generated with a proper UUID source, with a safe fallback
- [ ] A comment records the **per-install vs per-tab** semantic difference and why it is preferable
- [ ] Storage failure falls back to an in-memory id rather than crashing
- [ ] The id is not exposed in logs
- [ ] Whether this is a **native** dependency is checked — if so, it forces a dev-client rebuild and
      must be called out in the PR title

**Testing**
- [ ] The id survives an app restart
- [ ] The id survives a JS reload
- [ ] The generated id passes the server's `validRiderID`
- [ ] Two installs on two devices produce different ids
- [ ] A simulated storage failure does not crash the app

---

### HZ-089 · Port the WebSocket client
`Mobile` · 🟠 High · **M** · Todo · `feature/mobile-websocket-client`
**Depends on:** HZ-086, HZ-088
**Why:** `web/src/net/ws.ts` uses only the global `WebSocket`, which React Native provides — the
**only** required change is swapping the identity backend. **The Go backend requires zero changes**,
which is the single strongest validation of
[P7](./DEVELOPMENT_GUIDE.md#p7--every-feature-works-for-both-web-and-mobile) the project will run.
**Files**
- `mobile/src/core/wsClient.ts` *(new)*
- `mobile/src/state/useRide.ts` — wire message routing

**Acceptance**
- [ ] Same URL shape, same three query params, same `encodeURIComponent` escaping
- [ ] Same exponential backoff with HZ-027's jitter and the 15 s ceiling
- [ ] Same `welcome` and `state` routing into the store
- [ ] HZ-026's runtime validation is applied here too, not just on web
- [ ] Cleanup on unmount; no leaked sockets across a fast refresh
- [ ] **Reconnects when the app returns to the foreground** — `AppState` handling has no web
      equivalent and must be added
- [ ] **Zero backend changes required** — state this explicitly in the PR

**Testing**
- [ ] A native client joins a ride and appears on a web client's map
- [ ] A web client appears on the native map, in the same ride
- [ ] Kill Wi-Fi and restore → reconnects with backoff
- [ ] Background the app for 2 minutes and return → reconnects
- [ ] Confirm no backend change was needed
- [ ] Fast refresh does not leave a second socket open

---

### HZ-090 · Foreground location via `expo-location`
`Mobile` · 🟠 High · **M** · Todo · `feature/mobile-foreground-location`
**Depends on:** HZ-089
**Why:** `useGeo` is **replaced, not ported**. `Location.watchPositionAsync` with `timeInterval` and
`distanceInterval` moves throttling **into the OS**, which is strictly better than the web's approach
of dropping fixes in JS *after* the expensive acquisition has already happened.
**Files**
- `mobile/src/features/location/tracker.ts` *(new)*
- `mobile/src/features/ride/` — wire to `sendLoc`

**Acceptance**
- [ ] `watchPositionAsync` with `accuracy: High`, `timeInterval: 1000`, `distanceInterval: 5`
- [ ] Permission requested with the strings already configured in `app.config.ts`
- [ ] Denial and restriction surface into the store, matching HZ-024's states — **the native client
      must not repeat the silent-failure defect**
- [ ] Foreground only in this task; background is HZ-095
- [ ] The subscription is removed on unmount and on leaving the ride
- [ ] `accuracy` (HZ-063) and `heading` (HZ-069) are both sent
- [ ] **No `useWakeLock` equivalent** — it is deliberately dropped, replaced by real background modes

**Testing**
- [ ] A native rider's dot appears and moves on a web client's map
- [ ] Deny permission → the same clear UI as web
- [ ] Grant after denial → tracking starts without an app restart
- [ ] Fix rate is approximately 1 Hz — verify against server logs
- [ ] On both iOS and Android
- [ ] Leaving the ride stops GPS — confirm via the OS location indicator

---

### HZ-091 · Port the map
`Mobile` · 🟠 High · **L** · Todo · `feature/mobile-map`
**Depends on:** HZ-089
**Why:** MapLibre React Native is **declarative** where MapLibre GL JS is imperative — same style
URL, same `[lng, lat]` convention, same coordinate trap, different API shape. This is the largest
single port task.
**Files**
- `mobile/src/features/map/RideMap.tsx` *(new)* — `MapView`, `Camera`, `ShapeSource`, `LineLayer`
- `mobile/src/features/map/RiderDot.tsx` *(new)* — `PointAnnotation` per rider
- `mobile/src/features/map/` — camera logic mirroring HZ-042

**Acceptance**
- [ ] The **same OpenFreeMap style URL** as web — `https://tiles.openfreemap.org/styles/liberty`,
      no key, no signup ([ADR-003](./ADR/ADR-003.md))
- [ ] One marker per rider, keyed by id, created and removed correctly
- [ ] Self highlighting and stale greying match web's visual language
- [ ] **`[lng, lat]` conversion confined to `features/map/`** — any positional literal elsewhere in
      `mobile/` is a bug, exactly as on web
- [ ] Follow camera and recentre, matching HZ-042's behaviour including pan-to-disable
- [ ] The route line renders from the same `[lng,lat]` polyline the server returns
- [ ] Attribution is present
- [ ] Performance is acceptable with 15 markers on a mid-range device

**Testing**
- [ ] The map renders with tiles on both platforms
- [ ] Riders appear at correct coordinates — **verify visually; a `[lng,lat]` flip puts you in the
      ocean**
- [ ] Departed riders' markers are removed
- [ ] Follow camera and recentre behave as on web
- [ ] A route line renders correctly
- [ ] Profile with 15 markers on a mid-range Android device

---

### HZ-092 · Port the lobby and ride screens
`Mobile` · 🟠 High · **M** · Todo · `feature/mobile-screens`
**Depends on:** HZ-090, HZ-091
**Why:** The last piece needed for a usable native client: name entry, create, join, the ride screen,
and leave — with the same state model as `App.tsx` and `Ride.tsx`.
**Files**
- `mobile/src/app/index.tsx` — lobby
- `mobile/src/app/ride.tsx` *(new)* — ride screen
- `mobile/src/app/_layout.tsx` — navigation
- `mobile/src/features/ride/` — lifecycle

**Acceptance**
- [ ] Name entry, "Start a ride", and join-by-code, matching web's behaviour including HZ-014's
      6-character validation
- [ ] Ride screen composes map, connection status, and standings
- [ ] Leave fully resets the store, matching web
- [ ] Deep links via the HZ-022 scheme join a ride directly, mirroring HZ-041's shareable link
- [ ] Safe-area insets respected
- [ ] The error UI from HZ-024, HZ-025, and HZ-079 is present — the native client must not reintroduce
      silent failures
- [ ] Navigation state survives a background and return

**Testing**
- [ ] Create a ride on native, join it from web → both riders visible
- [ ] Join by typed code, and by deep link
- [ ] Leave → returns to the lobby, socket closed, GPS stopped
- [ ] Background and return mid-ride → still in the ride
- [ ] On a notched device, nothing is obscured
- [ ] On both platforms

---

### HZ-093 · Port the standings UI
`Mobile` · 🟡 Medium · **S** · Todo · `feature/mobile-standings-ui`
**Depends on:** HZ-092
**Why:** The last of the three product goals to appear on native. It renders server-computed values
only — **no client-side standings math**
([P2](./DEVELOPMENT_GUIDE.md#p2--clients-never-calculate-standings)).
**Files**
- `mobile/src/features/standings/Standings.tsx` *(new)*

**Acceptance**
- [ ] Renders `pos`, name, speed, and HZ-061's gap, matching web
- [ ] Stale riders grey out at `STALE_AFTER_SEC` from the shared constant
- [ ] Self is highlighted and labelled
- [ ] Off-route state from HZ-067 is shown
- [ ] **Zero ranking or distance computation on the client** — every value comes from `state`
- [ ] Readable one-handed, in sunlight, on a mounted phone

**Testing**
- [ ] Standings match the web client's, rider for rider, in the same ride
- [ ] A stale rider greys out correctly
- [ ] `grep` for sort or distance logic in the component returns nothing
- [ ] Legible on a real phone outdoors

---

### HZ-095 · Background location and foreground service
`Mobile` · 🔴 Critical · **XL** · Todo · `feature/mobile-background-location`
**Depends on:** HZ-092, HZ-094
**Why:** **The entire reason `mobile/` exists.** Pocketed, screen-off tracking is impossible in a
browser at any price. The permission config in `app.config.ts` is already written; the hard part is
the architecture, which HZ-094's ADR must settle first.
> **XL — re-split before starting.** Expect at minimum: the task registration, the socket-ownership
> mechanism from HZ-094, the Android foreground-service notification, and iOS "Always" permission
> handling. Prototype the HZ-094 decision against a real device before committing to it.

**Files**
- `mobile/src/features/location/backgroundTask.ts` *(new)* — `TaskManager.defineTask`
- `mobile/src/features/location/tracker.ts` — `startLocationUpdatesAsync`
- `mobile/src/core/wsClient.ts` — restructured per HZ-094
- `mobile/app.config.ts` — foreground-service notification config

**Acceptance**
- [ ] `TaskManager.defineTask` + `Location.startLocationUpdatesAsync` deliver fixes with the app
      backgrounded and the screen locked
- [ ] **The HZ-094 decision is implemented exactly as recorded** — the background task runs in a
      *separate JS context* and cannot reuse the React-owned WebSocket. Either the socket lives
      outside React and is reachable from the task, or fixes are queued and handed off
- [ ] Android shows a foreground-service notification with appropriate text
- [ ] iOS "Always" permission requested at the right moment, with graceful handling of a downgrade
      to "While Using"
- [ ] Updates stop completely when the ride ends — **no background GPS after leaving**, verified via
      the OS indicator
- [ ] Battery impact measured and compared against the PWA baseline from HZ-080
- [ ] App kill and restart behaviour is defined and documented
- [ ] Tested on multiple Android OEMs — Samsung, Xiaomi, and OnePlus battery managers are the usual
      offenders

**Testing**
- [ ] Lock the phone, pocket it, ride 2 km → fixes continue and the rider stays visible
- [ ] Android: the notification appears and tapping it returns to the app
- [ ] iOS: works with "Always"; degrades clearly with "While Using"
- [ ] Leave the ride → background updates stop, confirmed by the OS location indicator
- [ ] Force-kill the app mid-ride → the documented behaviour occurs
- [ ] Battery over an hour, screen off, compared with HZ-080's screen-on baseline
- [ ] At least two Android OEMs and one iPhone

---

### HZ-096 · `registerGlobals()` and `AudioSession`
`Mobile` · 🟠 High · **S** · Todo · `feature/mobile-livekit-globals`
**Depends on:** HZ-092
**Why:** `@livekit/react-native` requires `registerGlobals()` at app entry and
`AudioSession.startAudioSession()` before connecting (`docs/SETUP_MOBILE.md` §6). Neither is called
anywhere today, and skipping them produces confusing runtime failures rather than clear errors.
**Files**
- `mobile/src/app/_layout.tsx` — `registerGlobals()` at entry
- `mobile/src/features/voice/audioSession.ts` *(new)* — session lifecycle

**Acceptance**
- [ ] `registerGlobals()` is called **once**, at the earliest entry point, before any LiveKit import
      is used
- [ ] `AudioSession.startAudioSession()` before connecting; `stopAudioSession()` on leave
- [ ] Idempotent — a fast refresh or remount must not start two sessions
- [ ] `audioType: "communication"` from `app.config.ts` takes effect
- [ ] No effect on the app when voice is never used
- [ ] Failure is surfaced, not swallowed

**Testing**
- [ ] The app boots with no LiveKit global errors
- [ ] Audio session starts and stops around a voice connection
- [ ] Fast refresh does not produce duplicate sessions
- [ ] Not joining voice leaves the audio session untouched
- [ ] On both platforms

---

## Documentation

### HZ-036 · Deployment runbook
`Documentation` · 🟡 Medium · **S** · Todo · `docs/deployment-runbook`
**Depends on:** HZ-034
**Why:** HZ-032 through HZ-035 will be performed once, by one person, and then forgotten. Without a
runbook the next deploy is archaeology.
**Files**
- `docs/RUNBOOK.md` *(new)* — deploy, roll back, rotate secrets, read logs
- `docs/SETUP_BACKEND.md` — link to it, replacing the aspirational deployment section
- `README.md` — link

**Acceptance**
- [ ] Exact commands to deploy backend and web from a clean checkout
- [ ] How to roll back to the previous version
- [ ] Where every environment variable is set, and how to rotate `ORS_API_KEY` and
      `LIVEKIT_API_SECRET` **without committing anything**
- [ ] How to read logs and check `/healthz` and `/readyz`
- [ ] What "the site is down" looks like and the first three things to check
- [ ] **Written so someone who did not perform the original deployment can follow it**

**Testing**
- [ ] A second person follows it end to end and successfully deploys
- [ ] Every command is copy-pasteable and correct
- [ ] The rollback procedure is actually executed once, not just written down
- [ ] No secret value appears in the document

---

### HZ-037 · Ride log template
`Documentation` · 🟡 Medium · **S** · Todo · `docs/ride-log-template`
**Depends on:** —
**Why:** Four road tests are planned (HZ-038, HZ-071, HZ-081, HZ-098) plus HZ-109's five-ride gate.
Without a template each produces incomparable notes, and **a ride's findings are the highest-value
data this project generates**.
**Files**
- `docs/rides/TEMPLATE.md` *(new)*
- `docs/rides/README.md` *(new)* — index and instructions
- `docs/DEVELOPMENT_GUIDE.md` §9 — link from the real-world checklist

**Acceptance**
- [ ] Captures date, route, distance, duration, riders, devices, OS versions, and app version/commit
- [ ] Battery percentage before and after, per device, plus mobile data used
- [ ] A structured observations section: **wall-clock time, what happened, which rider, expected vs
      actual** — timestamps matter because they are what makes server logs correlatable
- [ ] A pass/fail line for each item in the real-world checklist
- [ ] A findings section that maps directly to new task entries
- [ ] Short enough to complete on a phone immediately after a ride, while memory is fresh

**Testing**
- [ ] A dry run filling it in from a simulated ride takes under 10 minutes
- [ ] Every field has an unambiguous meaning
- [ ] The findings section maps cleanly onto this document's task format

---

### HZ-039 · Triage road-test findings and re-sequence
`Documentation` · 🔴 Critical · **S** · Todo · `docs/road-test-1-triage`
**Depends on:** HZ-038
**Why:** **This is the point of HZ-038.** A road test whose findings are not converted into
prioritised, sequenced work is an afternoon of cycling. Everything in Stage 7 is provisional until
this task runs.
**Files**
- `docs/MASTER_TASKS.md` — new tasks, re-prioritised existing ones, a re-ordered Stage 7
- `docs/rides/ride-001.md` — the completed log
- `docs/ROADMAP.md` — milestone adjustments if the findings warrant them

**Acceptance**
- [ ] Every observation in the ride log is either a new task, a change to an existing task, or an
      explicit "no action" with a reason
- [ ] New tasks get ids continuing from `HZ-110` and are inserted at the right point in the sequence
- [ ] **Stage 7 is re-ordered against reality** — the pre-written order is a guess
- [ ] Anything invalidating a milestone assumption is reflected in `docs/ROADMAP.md`
- [ ] Anything invalidating an ADR is called out — particularly [ADR-004](./ADR/ADR-004.md) if
      wake-lock refusals proved common on real hardware
- [ ] The rationale for the re-sequencing is written down, not just the result

**Testing**
- [ ] Every ride-log observation traces to a task id or a documented decision
- [ ] The updated sequence's dependencies are still consistent
- [ ] Task counts and the progress table are updated

---

### HZ-082 · ADR-007 — mobile directory layout
`Documentation` · 🟠 High · **S** · Todo · `docs/adr-mobile-directory-layout`
**Depends on:** —
**Why:** `docs/SYSTEM_DESIGN.md` §5.1 and `docs/SETUP_MOBILE.md` §12 both prescribe a `features/` layout, while
`web/` uses a flatter one (`net/`, `store/`, `location/`, `map/`). **Unresolved, this yields two
conventions in one repository.** Decide before the port begins, not during it.
**Files**
- `docs/ADR/ADR-007.md` *(new)*
- `docs/ADR/README.md` — index row
- `docs/SYSTEM_DESIGN.md` §5.1, `docs/SETUP_MOBILE.md` §12 — reconcile with the decision
- `docs/DEVELOPMENT_GUIDE.md` §3 — resolve the "Open decision" note

**Acceptance**
- [ ] Follows the ADR template: Context, Decision, Alternatives, Consequences, Trade-offs, Future
      Revisions
- [ ] A decision is actually made — "we will decide later" is not a valid ADR
- [ ] **Recommendation on record: copy `web/`'s flat structure, because it is proven** — argue
      against it if you disagree, but argue explicitly
- [ ] Addresses where shared protocol types live (HZ-085 depends on this)
- [ ] The two prescriptive documents are updated to match, so no third convention can appear
- [ ] Status `Accepted`, cross-linked from the index

**Testing**
- [ ] A reviewer can state the chosen layout after reading only the ADR
- [ ] No document still prescribes the rejected layout
- [ ] Every link resolves

---

### HZ-094 · ADR-008 — background task ↔ socket ownership
`Documentation` · 🔴 Critical · **M** · Todo · `docs/adr-background-socket-ownership`
**Depends on:** HZ-089
**Why:** **The hardest unsolved design question in the project.** An `expo-task-manager` background
task runs in a **separate JS context** and cannot reuse the React-owned WebSocket. `docs/SETUP_MOBILE.md`
§8 says "forward `locations[0].coords` up the WebSocket" and glosses over the fact that there is no
WebSocket to forward it up. **Decide in an ADR before HZ-095 writes any code.**
**Files**
- `docs/ADR/ADR-008.md` *(new)*
- `docs/ADR/README.md` — index row
- `docs/SETUP_MOBILE.md` §8 — correct the misleading instruction
- `docs/MASTER_TASKS.md` — re-split HZ-095 per the decision

**Acceptance**
- [ ] The problem is stated precisely, including why the naive approach cannot work
- [ ] At minimum these alternatives are evaluated: (a) socket owned outside React in a module
      singleton reachable from both contexts; (b) background fixes queued to persistent storage and
      flushed by the foreground; (c) the background task opens its own short-lived socket per batch;
      (d) HTTP POST from the background instead of WebSocket
- [ ] Battery, latency, reliability across an app kill, and complexity compared for each
- [ ] **The chosen approach is prototyped against a real device before the ADR is marked Accepted** —
      this is not a decision to make on paper
- [ ] Consequences for the server are stated — option (c) or (d) may need a backend change, which
      would break the "zero backend changes" property and must be called out
- [ ] HZ-095 is re-split into concrete subtasks reflecting the decision

**Testing**
- [ ] A prototype demonstrating the chosen approach delivers a background fix to the server
- [ ] The prototype survives the screen locking
- [ ] Behaviour after an app kill is documented from observation, not assumption
- [ ] A reviewer can implement HZ-095 from the ADR alone

---

### HZ-105 · Setup docs: point at files, stop copying source
`Documentation` · 🟡 Medium · **M** · Todo · `docs/setup-guides-point-not-copy`
**Depends on:** —
**Why:** `docs/SETUP_BACKEND.md` and `docs/SETUP_MOBILE.md` **embed full copies of source files**, and they have
already drifted — `docs/SETUP_BACKEND.md` §4 describes the rejoin TODO differently from `room.go`. Every
backend edit needs a doc edit, or the docs actively mislead. After HZ-009 through HZ-012 rewrote that
code, the drift is now substantial.
**Files**
- `docs/SETUP_BACKEND.md` — replace embedded listings with file references and explanation
- `docs/SETUP_MOBILE.md` — same
- `docs/SETUP_WEB.md` — audit for the same pattern

**Acceptance**
- [ ] Setup guides explain **what each file does and why**, and point at it, rather than reproducing
      it
- [ ] Short illustrative snippets are allowed; **full file listings are not**
- [ ] Every remaining code reference is verified accurate against the current source
- [ ] The checkpoint structure is preserved — it is genuinely useful for onboarding
- [ ] Where a guide describes a TODO or a limitation, it matches the code as it now stands
- [ ] A note explains the policy, so the pattern does not come back

**Testing**
- [ ] A new contributor follows `docs/SETUP_BACKEND.md` end to end and gets a running server
- [ ] Every file path and line reference in the guides resolves
- [ ] `grep` for large embedded Go and TSX blocks finds none
- [ ] No guide describes behaviour that no longer exists

---

### HZ-106 · Fix stale path references in setup docs
`Documentation` · 🟢 Low · **S** · Todo · `docs/fix-path-references`
**Depends on:** —
**Why:** Setup docs reference `C:\Data\Projects\Horizon` while the repository lives at
`E:\Project Horizon\Horizon`. A new contributor copy-pasting the commands lands in the wrong place.
**Files**
- `docs/SETUP_BACKEND.md`, `docs/SETUP_WEB.md`, `docs/SETUP_MOBILE.md`

**Acceptance**
- [ ] No absolute machine-specific path remains in any document
- [ ] Commands use **relative paths from the repository root**, which works on every machine
- [ ] Where an absolute path is unavoidable, a placeholder like `<repo-root>` is used
- [ ] PowerShell and bash variants are both correct where both are given

**Testing**
- [ ] `grep -r "C:\\\\Data"` across the repo returns nothing
- [ ] Every command in the setup docs runs from a fresh clone at any location
- [ ] Both shells were checked

---

### HZ-107 · Reconcile the README phase table
`Documentation` · 🟡 Medium · **S** · Todo · `docs/readme-phase-reconciliation`
**Depends on:** HZ-048
**Why:** `README.md` marks Phases 0 and 1 ✅, but they were reopened because CORS, ghost riders, and
the room leak meant the core pipe was not solid. Once Stage 7 completes they are genuinely done —
**and the README should say so only then.** Until this task runs, the README is the most-read
document in the repo and it is wrong.
**Files**
- `README.md` — the build-order table
- `docs/PROJECT_BOARD.md` — mark the discrepancy resolved
- `docs/ROADMAP.md` — confirm the milestone mapping still matches

**Acceptance**
- [ ] The phase table reflects actual, verified state
- [ ] Phases 0 and 1 are marked complete **only if** Milestone 1's success criteria in
      `docs/ROADMAP.md` are all met
- [ ] Phase status is expressed consistently with milestones — one vocabulary, not two
- [ ] The documentation map added earlier still lists every document
- [ ] A note explains that phase status now tracks `docs/ROADMAP.md`, so this cannot drift again

**Testing**
- [ ] Every ✅ in the README is traceable to a met success criterion
- [ ] No document contradicts another on phase status
- [ ] Every link in the README resolves

---

### HZ-108 · Operations runbook
`Documentation` · 🟡 Medium · **M** · Todo · `docs/operations-runbook`
**Depends on:** HZ-099
**Why:** HZ-036 covers deploying. This covers **running** — what the metrics mean, what normal looks
like, and what to do when a rider reports a problem. `docs/SYSTEM_DESIGN.md` §9 lists observability as
step 5 of the scaling path; this is what makes it useful rather than decorative.
**Files**
- `docs/RUNBOOK.md` — an operations section, or a separate `docs/OPERATIONS.md`

**Acceptance**
- [ ] Every HZ-099 metric documented: what it means and what a normal value looks like
- [ ] **A diagnostic procedure for "rider X vanished at time T"** — which logs to read, in what
      order, and how to distinguish GPS loss, wake-lock refusal, socket drop, dropped frames, and
      ghost-rider confusion. This exact scenario is why HZ-006 exists
- [ ] What to do when ORS quota is exhausted, and when LiveKit is unavailable
- [ ] How to identify the room leak recurring, or a goroutine leak generally
- [ ] Escalation: what is worth waking up for (nothing, for a hobby app) and what waits
- [ ] A capacity note: at what point the single-process design becomes the limit

**Testing**
- [ ] Simulate a rider dropping out; follow the procedure and correctly identify the cause
- [ ] Every metric named exists in `/metrics`
- [ ] Someone who did not build the system can follow it
- [ ] Normal-value ranges match what HZ-109's rides actually produced

---

### HZ-110 · Critical-zero audit
`Documentation` · 🟠 High · **S** · Todo · `docs/critical-zero-audit`
**Depends on:** HZ-109
**Why:** The closing gate. Milestone 5 completes when no Critical work remains open and the
documentation matches the code — and the only way to know that is to check deliberately rather than
assume.
**Files**
- `docs/MASTER_TASKS.md` — statuses and the progress table
- `docs/PROJECT_BOARD.md` — reconcile
- `docs/ROADMAP.md` — mark milestones complete
- `docs/ARCHITECTURE_REVIEW.md` — a dated addendum noting which findings are resolved

**Acceptance**
- [ ] Every task is `Done`, or explicitly deferred with a reason and a trigger
- [ ] **No Critical task is open**
- [ ] Every ARCHITECTURE_REVIEW finding — C1–C3, H1–H6, M1–M10, L1–L14, and every risk id — is marked
      resolved, still open, or accepted, with a one-line status
- [ ] Every ADR still reflects reality; any that does not is superseded by a new one, **not edited**
- [ ] Every `TODO` in the source has a corresponding task, or is removed
- [ ] The two misleading commit messages are noted as historical and left unrewritten
- [ ] A new contributor can go from clone to merged PR using only the documentation

**Testing**
- [ ] `grep -rn "TODO" backend/ web/ mobile/src/` — every hit traces to a task
- [ ] Every internal documentation link resolves
- [ ] The progress table matches the actual statuses
- [ ] A dry-run onboarding with someone unfamiliar with the project succeeds without verbal help

---

<!-- CATALOGUE-10 -->
