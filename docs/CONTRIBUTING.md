# Contributing to Horizon

Welcome. This document gets you from a fresh clone to a merged pull request.

**It covers mechanics — the commands, the process, the gates.** The *reasoning* behind our standards
lives in [`docs/DEVELOPMENT_GUIDE.md`](./DEVELOPMENT_GUIDE.md), and each section below links to the
canonical rules rather than restating them. Read the handbook once; keep this page open while you
work.

## Before your first PR, read

| Document | Why | Time |
|---|---|---|
| [`README.md`](../README.md) | What Horizon is | 3 min |
| [`CLAUDE.md`](../CLAUDE.md) | The hard rules — deliberately short | 5 min |
| [`docs/DEVELOPMENT_GUIDE.md`](./DEVELOPMENT_GUIDE.md) §1–3 | Philosophy, principles, folder rules | 15 min |
| [`docs/PROJECT_BOARD.md`](./PROJECT_BOARD.md) | What's broken, what's next | 10 min |

Skim [`docs/SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md) and [`docs/ADR/`](./ADR/) when you hit a "why is it
like this?" moment. Read [`docs/ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md) before touching the
backend concurrency model.

**Two things to know up front, because they will confuse you otherwise:**

1. **"Start a ride" is currently broken** in local dev — a missing CORS header, not your setup. Use
   **Join** with any code to test. See [BUG-05](./PROJECT_BOARD.md#bug-05--cors-blocks-ride-creation-from-the-browser).
2. **Standings are currently meaningless** — `pos` is alphabetical order by rider id, because no
   route can be set yet. See [BUG-02](./PROJECT_BOARD.md#bug-02--standings-are-meaningless).

---

# 1. Repository setup

## Prerequisites

| Tool | Version | Needed for | Cost |
|---|---|---|---|
| **Go** | 1.26+ | `backend/` | free |
| **Node.js** | 20+ | `web/`, `mobile/` | free |
| **Git** | any | everything | free |
| A modern browser | Chrome/Edge/Safari | `web/` | free |

**No account, no signup, and no credit card is required to run the current system.** Map tiles come
from OpenFreeMap, which needs no key. See [ADR-006](./ADR/ADR-006.md) — this is a hard project
constraint, not a coincidence.

Credentials you'll eventually need (both free, email signup only, **no card**):

- [OpenRouteService](https://openrouteservice.org/dev/#/signup) — Milestone 2, cycling directions
- [LiveKit Cloud](https://cloud.livekit.io) — Milestone 3, voice

## Clone

```bash
git clone <repo-url>
cd Horizon
```

## Backend — the Go realtime server

```bash
cd backend
cp .env.example .env      # all values may stay blank for local dev
go mod download
go run .
# → horizon backend listening on :8080
```

Verify:

```bash
curl http://localhost:8080/healthz     # → ok
node wstest.mjs                        # WebSocket smoke test: loc in → state out
```

`.env` is gitignored. **Never commit real secrets** — add new variables to `.env.example` with blank
values instead ([P8](./DEVELOPMENT_GUIDE.md#p8--secrets-never-leave-the-server)).

Full walkthrough: [`docs/SETUP_BACKEND.md`](./SETUP_BACKEND.md).

## Web — the PWA (this is the v1 client)

In a second terminal, with the backend running:

```bash
cd web
npm install
npm run dev
# → http://localhost:5173  (also prints a LAN URL, e.g. http://192.168.1.50:5173)
```

Open the URL, **allow location access**, and you should see the OpenFreeMap basemap centre on your
dot. PWA icons are generated from code by the `predev` hook — there are no binary assets in the repo.

**To test the core pipe you need two riders.** Open two browser windows (one normal, one private —
rider identity is per-tab via `sessionStorage`), enter different names, and **Join** the same code.

By default the app assumes the backend is on `:8080` of the same host. Override in `web/.env` if it
isn't:

```
VITE_BACKEND_HTTP=http://192.168.1.50:8080
VITE_BACKEND_WS=ws://192.168.1.50:8080
```

Full walkthrough: [`docs/SETUP_WEB.md`](./SETUP_WEB.md).

## Mobile — deferred

**`mobile/` contains no Horizon application code.** It is a stock `create-expo-app` template with
Horizon's native dependencies pre-installed and the iOS/Android permission config already written.

**It does not currently build.** `app.config.ts` references the `expo-location` plugin, which isn't in
`package.json` ([BUG-08](./PROJECT_BOARD.md#bug-08--mobile-native-build-fails), fixed by
[HZ-4](./PROJECT_BOARD.md#hz-4--fix-mobile-config-drift)). Don't set it up unless you're picking up
that task or Milestone 4.

When you do: **it requires a custom Expo dev client, never Expo Go** — MapLibre and LiveKit need
native code. Read `mobile/AGENTS.md` first; the versioned Expo v56 docs are a standing requirement.
Full walkthrough: [`docs/SETUP_MOBILE.md`](./SETUP_MOBILE.md).

## Verify your whole environment

- [ ] `cd backend && go build ./...` succeeds
- [ ] `go run .` serves `ok` at `/healthz`
- [ ] `node backend/wstest.mjs` passes
- [ ] `cd web && npm run build` succeeds (runs `tsc -b`)
- [ ] `npm run dev` renders a map with your dot on it
- [ ] Two windows joining the same code see each other's dots and standings

If the last one works, your environment is correct — that's the core pipe end to end.

## Editor setup

- **Go:** the official Go extension. Enable format-on-save (`gofmt`) and `go vet` on save.
- **TypeScript:** use the workspace TypeScript version. ESLint and Prettier configs don't exist yet
  ([DEBT-M4](./PROJECT_BOARD.md#-medium-1)) — **match the surrounding code**: 2-space indent, double
  quotes, semicolons, trailing commas in multiline literals.
- **Line endings:** LF. On Windows, `git config --global core.autocrlf input`.

---

# 2. Development workflow

The full pipeline, with the reasoning for each stage, is
[`docs/DEVELOPMENT_GUIDE.md` §4](./DEVELOPMENT_GUIDE.md#4-development-workflow). In brief:

```
Feature Request → Architecture Discussion → Branch → Implementation
    → Testing → Code Review → Merge → Delete Branch
```

## Picking up work

1. Open [`docs/PROJECT_BOARD.md`](./PROJECT_BOARD.md) and pick a task. **Sprint 01 tasks come first** —
   they unblock everything else. `HZ-4` (XS) and `HZ-6` (S) are good first contributions.
2. If your work isn't on the board, **add it there first** with an `HZ-<n>` id. No unrecorded work.
3. Set the task to **In Progress** and note who's on it.

## Does it need an ADR?

Write [an ADR](./ADR/README.md) *before* the code if your change:

- adds a third-party service or a backend dependency,
- changes the WebSocket protocol,
- moves a computation between client and server,
- changes the concurrency model,
- reverses a decision already recorded in `docs/ADR/`.

**Everything else goes straight to a branch.** Most work does not need an ADR — don't gold-plate this.

## While you work

- **One task, one branch.** Found a second bug? File it on the board, fix it in a second branch.
- **Update docs in the same commit as the code.** A protocol change that doesn't touch `CLAUDE.md`
  is incomplete.
- **Past ~400 changed lines**, stop and ask whether this should be two branches.
- Run formatters and vet as you go, not at the end.

---

# 3. Branch workflow

```bash
git checkout main && git pull --ff-only
git checkout -b bugfix/ghost-rider-rejoin-eviction
# ... work ...
git push -u origin bugfix/ghost-rider-rejoin-eviction
```

**`main` is protected by convention: no direct commits, ever.** Branch from an up-to-date `main`, not
from another feature branch.

Naming is `<type>/<short-kebab-case-description>` using exactly five prefixes — `feature/`,
`bugfix/`, `hotfix/`, `refactor/`, `docs/`. The full convention, with worked examples drawn from
current board tasks, is
[`docs/DEVELOPMENT_GUIDE.md` §5](./DEVELOPMENT_GUIDE.md#5-branch-naming-convention).

Keeping up to date with `main`:

```bash
git checkout main && git pull --ff-only
git checkout your-branch && git rebase main
```

Rebase while the branch is yours alone. Once someone else has pulled it, merge instead.

After merge:

```bash
git branch -d your-branch
git push origin --delete your-branch
```

**Then move the task to Completed in `docs/PROJECT_BOARD.md`.** A stale branch list is a lie about what's
in flight.

---

# 4. Code style

Full standards per platform — Go, web, mobile, plus naming, comments, error handling, logging,
concurrency, and state — are in
[`docs/DEVELOPMENT_GUIDE.md` §8](./DEVELOPMENT_GUIDE.md#8-coding-standards). The essentials:

## Go

```bash
cd backend
go fmt ./... && go vet ./...     # must be clean before every commit
go build ./...
go test ./...
go test -race ./...              # required for anything touching internal/hub/
```

- **`gofmt` is the entire style guide.** No second formatter, no debate.
- Standard library first. All packages under `internal/`. A new module needs an ADR.
- Handle or return errors — never both, never `_ = err`.
- **Document what every mutex guards.** Never hold a lock across computation or I/O. Never hold two
  at once. The `delete`-before-`close(send)` ordering in `room.go` is safety-critical — if you touch
  that code, restate the invariant in a comment.

## TypeScript (web and mobile)

```bash
cd web
npm run build                    # runs tsc -b; must be clean
```

- Match the surrounding code: 2-space indent, double quotes, semicolons, trailing commas, ~100 cols.
- `strict` stays on. **No `any`. No `!` non-null assertions** — narrow instead.
- Function components and hooks only. No class components.
- Shared state → the zustand store. Genuinely local UI state → `useState`.
- Every effect that subscribes must unsubscribe, and must be **StrictMode-safe** (it will mount
  twice in dev).
- **`console.warn` is not error handling.** Any failure a rider can cause or notice must reach the
  store and render as something actionable. This is the most common defect in the current client.

## Rules that will get a PR rejected

1. **A `[lng, lat]` literal outside `web/src/map/`.** The protocol uses named `lat`/`lng`; MapLibre
   and GeoJSON use positional `[lng, lat]`. Convert at exactly one boundary. `CLAUDE.md` calls this
   "a known trap" and it is the easiest way to put a rider in the ocean.
2. **Standings math outside `backend/internal/standings/`.** Clients never compute standings
   ([P2](./DEVELOPMENT_GUIDE.md#p2--clients-never-calculate-standings)).
3. **A protocol change that touches only one side.** Go structs, `web/src/types.ts`, and `CLAUDE.md`
   change together, in one PR ([P4](./DEVELOPMENT_GUIDE.md#p4--the-shared-protocol-is-a-contract)).
4. **A card-required third-party service** ([ADR-006](./ADR/ADR-006.md)). Hard constraint.
5. **A secret reaching a client.** `ORS_API_KEY` and `LIVEKIT_API_SECRET` are server-side only.
6. **A new dependency without justification** ([P5](./DEVELOPMENT_GUIDE.md#p5--keep-dependencies-minimal)).
   The backend has one; the web client has four.

---

# 5. Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body — why, not what>

Refs: HZ-<n>
```

Types: `feat` · `fix` · `refactor` · `perf` · `test` · `docs` · `build` · `ci` · `chore`.
Scopes: `backend` · `hub` · `room` · `ws` · `standings` · `route` · `voice` · `web` · `map` ·
`location` · `store` · `pwa` · `mobile` · `api` · `deps`.

```
feat(route): implement ORS route ingestion
fix(room): remove stale rider
refactor(ws): simplify reconnect logic
docs(api): update websocket protocol
```

Subject in the imperative mood, lowercase, no trailing period, ≤72 chars. Body explains *why* — the
diff already says what.

**The message must be true about what the diff does.** This repository has two commits that aren't:
`56a8482` *"Implement new feature for user authentication and improve error handling"* added one
documentation file and no authentication, and `1cf6f43` *"fix: ghost users"* shipped only the client
half of a fix whose server half is still an open TODO. Both are worked through in
[`docs/DEVELOPMENT_GUIDE.md` §6](./DEVELOPMENT_GUIDE.md#6-commit-message-convention), which has the full
convention and more examples.

Working commits on your branch can be messy — everything is squashed at merge.

---

# 6. Pull request process

## Opening

1. Push your branch and open a PR against `main`.
2. Title: the same format as the squash commit — `fix(room): evict the zombie connection on rejoin`.
3. Body: copy the checklist from
   [`docs/DEVELOPMENT_GUIDE.md` §7](./DEVELOPMENT_GUIDE.md#7-pull-request-checklist) and fill it in.
   It asks for what and why, how you tested, a note on Web/Mobile behaviour, and ten boxes.
   **An unticked box with a one-line reason is fine. A ticked box that isn't true is not.**
4. Link the board task: `Refs: HZ-<n>`.
5. Small PRs get reviewed fast. Under ~400 lines is the target.

## Review

At least one reviewer other than the author. Reviewers work through the 32 questions in
[`docs/DEVELOPMENT_GUIDE.md` §10](./DEVELOPMENT_GUIDE.md#10-code-review-checklist), which start with
architecture and end with security.

**As an author:** respond to every comment, push fixes as new commits (don't force-push mid-review —
it destroys the reviewer's diff), and re-request review when ready.

**As a reviewer:** approve when it's *better than what's there*, not when it's perfect. Prefix
non-blocking comments with **nit:**. Review the code, not the coder — "this function" not "you". If a
thread exceeds three round trips, take it to a call and record the outcome in the PR, or in an ADR if
it turned out to be a real decision.

## Merging

**Squash and merge.** One board task = one commit on `main`. Requirements:

- [ ] One approval, no unresolved blocking comments
- [ ] Green checks (once CI exists — [DEBT-M5](./PROJECT_BOARD.md#-medium-1))
- [ ] Branch up to date with `main`
- [ ] The squash message follows §5 and references the task id

Then delete the branch and update the board.

---

# 7. Testing requirements

Full guidance — what to test, what *not* to test, and both checklists — is in
[`docs/DEVELOPMENT_GUIDE.md` §9](./DEVELOPMENT_GUIDE.md#9-testing-guidelines).

**The repo currently has zero automated tests.** The only artifact is `backend/wstest.mjs`, a manual
smoke script. We are retrofitting from [HZ-6](./PROJECT_BOARD.md#hz-6--unit-tests-for-internalstandings)
onward. Don't let that lower your bar — let it raise your opportunity.

## Minimum bar for any PR

```bash
cd backend && go fmt ./... && go vet ./... && go test ./... && go build ./...
cd web && npm run build
```

Plus:

- **New pure functions ship with table-driven tests.** Non-negotiable for
  `backend/internal/standings/` — it's pure math and the single highest-value test target in the repo.
- **Anything touching `internal/hub/` runs `go test -race ./...` clean.**
- **Anything touching GPS, the map, standings, or reconnection runs the manual checklist**, and you
  say which sections in the PR. Automated tests cannot observe a dot on a map.

## The manual test that matters most

The reconnect test, because it catches the ghost-rider class of bug:

1. Two windows, two names, same join code
2. Confirm both riders appear on both maps
3. Kill the backend → both show "reconnecting"
4. Restart it → both reconnect within ~15 s
5. **Confirm exactly one entry per rider** — not two

## Real-device testing

Required for anything touching GPS, voice, battery, background behaviour, or reconnection: **two real
phones, outdoors, on mobile data.** Desk testing cannot reproduce GPS drift, tunnels, gloves, or a
four-hour battery curve.

This needs an HTTPS deployment ([HZ-7](./PROJECT_BOARD.md#hz-7--deploy-koyeb--cloudflare-tunnel-https-and-wss)) —
geolocation, wake lock, PWA install, and WebRTC all require a secure context. Use the real-world
checklist in the handbook and **file every observation as a board task.**

## What not to test

Third-party behaviour (MapLibre, gorilla/websocket, zustand, Expo), rendering snapshots, anything
needing a real GPS chip, and exact float equality on geometry — always use a tolerance in metres.

---

# 8. Documentation requirements

Documentation is part of the change, not a follow-up. **A PR that changes behaviour and no docs is
incomplete.**

## What to update, and when

| Change | Update |
|---|---|
| WebSocket protocol | `CLAUDE.md` **and** all client implementations, same PR |
| A working rule or convention | `CLAUDE.md` (keep it short enough to actually be read) |
| A design decision | A new ADR in `docs/ADR/`, and `docs/SYSTEM_DESIGN.md` if the architecture moved |
| Setup steps | The relevant `SETUP_*.md` |
| A new env var | `.env.example` with a blank value **and a comment**, plus the setup doc |
| Any task | `docs/PROJECT_BOARD.md` — status, and file anything newly discovered |
| Milestone scope or timing | `docs/ROADMAP.md` |
| Engineering process | `docs/DEVELOPMENT_GUIDE.md` |

**Never edit an accepted ADR's Decision.** Write a new ADR that supersedes it and cross-link both.
ADRs are append-only history.

## Which document owns what

Each file answers exactly one question. Adding content to the wrong one is how documentation rots.

| Question | Document |
|---|---|
| What is Horizon? | `README.md` |
| What are the hard rules? | `CLAUDE.md` |
| Why is the architecture like this? | `docs/SYSTEM_DESIGN.md`, `docs/ADR/` |
| What does the system look like today? | `docs/ARCHITECTURE_REVIEW.md` |
| How do we work? | `docs/DEVELOPMENT_GUIDE.md` |
| How do I set up and contribute? | this file, `SETUP_*.md` |
| What's next? | `docs/PROJECT_BOARD.md`, `docs/ROADMAP.md` |

## Code comments

Explain **why**, not what. Cite the governing document when encoding a rule — the existing code does
this well:

```go
// Dev-only: accept any origin. Tighten before any public deployment.
```

```ts
// Internal messages use lat/lng. MapLibre + GeoJSON use [lng, lat] — we convert at the
// map boundary (see map/Map.tsx), never here.
```

Every exported Go symbol gets a doc comment starting with its name. Use `TODO(topic):` with a
description of what "done" looks like, matching the existing `TODO(rejoin)` / `TODO(later)` style —
and **file a board task for it**, because the two TODOs currently in the code went unactioned long
enough to become critical bugs.

---

# 9. Definition of Done

A task is done when every box in
[`docs/DEVELOPMENT_GUIDE.md` §11](./DEVELOPMENT_GUIDE.md#11-definition-of-done) is true — code works, edge
cases handled, docs updated, no regressions, real devices tested where applicable, branch deleted,
board updated.

The short version:

> **If you would be uncomfortable having a friend rely on this feature to find you on a ride, it
> isn't done.**

---

# 10. Getting help

- **Stuck on setup?** Re-run the verification checklist in §1. Remember: "Start a ride" is *expected*
  to fail locally right now.
- **"Why is it like this?"** → [`docs/SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md), then
  [`docs/ADR/`](./ADR/).
- **"Is this a known problem?"** → [`docs/PROJECT_BOARD.md`](./PROJECT_BOARD.md) → Known Bugs. There are
  twelve registered, with root causes.
- **"Where does this code go?"** → [`docs/DEVELOPMENT_GUIDE.md` §3](./DEVELOPMENT_GUIDE.md#3-repository-structure).
  Every folder has a "Never" list.
- **Found something the docs get wrong?** That's a `docs/` branch and a valuable contribution. The
  documentation in this repo is unusually thorough and in three places describes as done what is
  actually scaffolded — corrections are welcome.

Thanks for contributing. 🚴
