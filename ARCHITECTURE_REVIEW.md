# Architecture Review — Horizon

> A complete architectural review of the Horizon repository: how the system works today, what
> exists, what doesn't, where the debt and the risks are, and the order in which the remaining
> work should be built.
>
> **Analysis only — no code was changed.**

| | |
|---|---|
| **Reviewed** | 2026-07-27 |
| **Repo** | `E:\Project Horizon\Horizon` (git, branch `main`, clean tree) |
| **Commit** | `1cf6f43` — *fix: ghost users* |
| **Scope** | `CLAUDE.md`, `SYSTEM_DESIGN.md`, `README.md`, `SETUP_*.md`, `backend/`, `web/`, `mobile/` |
| **Target scale** | ≤15 riders per ride, friend-group hobby app |
| **Hard constraint** | Zero paid services, no credit card (`CLAUDE.md` §"What this is") |

**Related documents:** [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md) is the source of truth for *why*;
[`CLAUDE.md`](./CLAUDE.md) holds the enforceable rules; the `SETUP_*.md` files hold setup steps.
This document describes the system *as built* and is subordinate to those where they disagree —
except where it explicitly notes that they have drifted apart.

---

## Contents

1. [High Level Architecture](#1-high-level-architecture)
2. [Backend Analysis](#2-backend-analysis)
3. [Web Analysis](#3-web-analysis)
4. [Mobile Analysis](#4-mobile-analysis)
5. [Shared Protocol](#5-shared-protocol)
6. [Current Feature Status](#6-current-feature-status)
7. [Technical Debt](#7-technical-debt)
8. [Architecture Risks](#8-architecture-risks)
9. [File Ownership](#9-file-ownership)
10. [Recommended Development Order](#10-recommended-development-order)
11. [Closing Observations](#11-closing-observations)

---

# 1. High Level Architecture

## 1.1 The spine

The whole system is one idea, stated in `SYSTEM_DESIGN.md:61`: **every feature is a view on one
data stream — each rider's live coordinates flowing through the Go server.** Map dots, standings,
and (later) voice-room membership are all projections of that single pipe.

There are exactly **three wires out of a rider's phone**, and they are deliberately independent:

| Wire | Endpoint | Auth | Status |
|---|---|---|---|
| Map tiles | OpenFreeMap `https://tiles.openfreemap.org/styles/liberty` | none (no key, no signup) | live |
| Realtime state | Go server `GET /ws` (WebSocket) | join code only | live |
| Voice media | LiveKit Cloud (WebRTC) | JWT minted by Go | not built |

Only the middle wire is code the team owns. Tiles and voice are rented; routing (ORS) is proxied
through Go purely so the API key stays server-side.

```
                    ┌──────────────────────────────────────────┐
                    │  Rider phone — installable PWA (web/)     │
                    │  Map.tsx      useGeo/useWakeLock   (voice)│
                    │  MapLibre GL  navigator.geolocation  TBD  │
                    └───┬──────────────┬────────────────┬───────┘
      tiles (no key)    │      WS      │                │ WebRTC (not built)
                        ▼              ▼                ▼
                ┌────────────┐  ┌───────────────┐  ┌──────────┐
                │OpenFreeMap │  │  Go server    │  │ LiveKit  │
                └────────────┘  │ hub→room→cli  │  │  (TBD)   │
                                └───────┬───────┘  └──────────┘
                                        │ 501 stub
                                        ▼
                                OpenRouteService (TBD)
```

## 1.2 Request flow

**A. Ride creation (HTTP).** `App.tsx:24` → `createRide()` (`net/api.ts:6`) → `POST /rides` →
`main.go:23` → `hub.CreateRide()` (`hub.go:44`) → `genCode()` returns a 6-char code from an
ambiguity-free alphabet (`hub.go:96`). **No room is created here** — `CreateRide` only mints a
string. The room materialises lazily on the first `/ws` join (`hub.go:31`). Consequence: join codes
are unvalidated tokens; joining *any* arbitrary string creates a room.

**B. Joining (WebSocket).** `startRide(code)` sets `code` in the zustand store → `App.tsx:8` swaps
`<Lobby/>` for `<Ride/>` → `useRideSocket()` (`net/ws.ts:18`) opens
`ws://host:8080/ws?ride=CODE&name=NAME&rider=UUID`. Server side (`hub.go:48`):

1. Validate `?ride=` present (400 if not).
2. Default `name` to `"rider"`.
3. Validate `?rider=` against `validRiderID` (8–64 chars of `[A-Za-z0-9_-]`); mint one if invalid (`hub.go:117`).
4. Upgrade the connection (`CheckOrigin` currently returns `true` for everything).
5. `h.room(code)` — get-or-create the room, starting `room.run()` as a goroutine.
6. Construct `Client` with a 16-slot buffered `send` channel.
7. Queue `{"type":"welcome","id":…}` into `send` *before* the pumps start (safe because the channel is buffered).
8. `room.register <- c`, then `go writePump()`, `go readPump()`.

**C. GPS ingest.** `Ride.tsx:24` wires `useGeo(true, f => sendLoc(...))`. `useGeo`
(`location/useGeo.ts:22`) calls `navigator.geolocation.watchPosition` with
`enableHighAccuracy: true, maximumAge: 0`, and **throttles in JS** to ≥1000 ms between accepted
fixes (`useGeo.ts:25`). Each accepted fix → `sendLoc` (`ws.ts:68`) → JSON `loc` frame, dropped
silently if the socket isn't `OPEN`.

**D. Server ingest.** `readPump` (`client.go:53`) reads, `json.Unmarshal`s, discards anything where
`type != "loc"`, then takes `c.room.mu.Lock()` and writes `lat/lng/speed` plus
`lastSeen = time.Now()` — **the server's clock, not the phone's** (`client.go:64`). The
client-supplied `ts` is parsed into `locMsg.Ts` and then never used. `heading` is likewise parsed
and discarded.

**E. Fan-out.** Ingest and broadcast are decoupled. `room.run()` (`room.go:51`) is a single
goroutine `select`ing over `register`, `unregister`, and a **250 ms ticker (~4 Hz)**. On each tick,
`broadcast()` (`room.go:85`):

- `RLock`, build `[]riderState`, skipping riders whose `lastSeen.IsZero()` (never sent a fix — avoids a dot at (0,0)).
- Compute `ageSec = now - lastSeen`.
- If a route exists (`len(route) > 1`), compute `distAlong` per rider.
- `RUnlock`, sort (by `distAlong` desc if a route exists, else stable by `id`), assign `pos = i+1`.
- Marshal once, then `RLock` again and non-blocking-send the *same* byte slice to every client's `send` channel; **full queue ⇒ drop the frame** (`room.go:121`) rather than block the room.

**F. Client render.** `ws.onmessage` (`ws.ts:35`) routes `welcome` → `setSelfId`, `state` →
`setRiders`. Two independent views subscribe to the store: `Map.tsx:40` reconciles one MapLibre
marker per rider (converting `lat/lng` → `[lng, lat]` at that single boundary), and `Ride.tsx:45`
renders the standings `<ol>`.

## 1.3 How a GPS update moves from rider A to rider B

```
A's device GPS
  └─ watchPosition callback                       (useGeo.ts:22)
     └─ throttle: skip if <1000ms since last      (useGeo.ts:25)
        └─ sendLoc(lat,lng,heading,speed)         (Ride.tsx:24 → ws.ts:68)
           └─ ws.send({type:"loc",...,ts})        ← heading & ts sent
              ═══ network (ws://, no TLS in dev) ═══
              └─ A.readPump ReadMessage           (client.go:54)
                 └─ unmarshal, require type=="loc"
                    └─ room.mu.Lock()             ← ROOM-WIDE write lock
                       A.lat/lng/speed = …
                       A.lastSeen = time.Now()    ← server clock
                       room.mu.Unlock()
                                                  ⟂ asynchronous ⟂
        every 250ms: room.run() ticker            (room.go:79)
           └─ broadcast()                         (room.go:85)
              ├─ RLock → snapshot ALL riders incl. A
              ├─ ageSec, distAlong (if route)
              ├─ sort → pos
              ├─ json.Marshal ONCE
              └─ RLock → for each client: send <- msg (drop if full)
                 └─ B.writePump                   (client.go:77)
                    └─ conn.WriteMessage(TextMessage)
                       ═══ network ═══
                       └─ B ws.onmessage          (ws.ts:35)
                          └─ setRiders(msg.riders) (store/ride.ts:33)
                             ├─ Map.tsx effect → marker.setLngLat([lng,lat])
                             └─ Ride.tsx → standings row
```

**Key properties of this path:**

- **No direct A→B path.** All state passes through the room's shared mutable rider set. A never learns of B except via a `state` frame.
- **Latency budget:** up to 1000 ms client throttle + ≤250 ms tick + 2× network RTT. At bike speeds (~20 km/h ≈ 5.5 m/s) the worst case ≈ 7 m of positional error, which `SYSTEM_DESIGN.md:305` correctly calls irrelevant.
- **Message rate is O(1) per client, not O(N).** N riders at 1 Hz produce exactly 4 frames/s to each client regardless of N — this is the central scaling decision (`SYSTEM_DESIGN.md:303`).
- **Every rider's own dot is a round-trip.** A's dot on A's own screen comes back from the server; there is no local echo. If the server is down, you don't see yourself. This is why `welcome`/`selfId` exists.
- **Lossy by design.** Both the throttle and the full-queue drop discard data silently. There is no sequence number, no ack, no replay.

## 1.4 Major components

| Component | Location | Responsibility |
|---|---|---|
| `Hub` | `backend/internal/hub/hub.go` | Owns `map[code]*Room`; HTTP→WS upgrade; id/code minting; input validation |
| `Room` | `backend/internal/hub/room.go` | One per join code; owns rider set + route; runs the 4 Hz broadcast loop; computes standings ordering |
| `Client` | `backend/internal/hub/client.go` | One per socket; read pump (ingest) + write pump (egress + keepalive); holds latest fix |
| `standings` | `backend/internal/standings/standings.go` | Pure geometry: haversine, segment projection, distance-along-route |
| `main` | `backend/main.go` | Route table, `PORT`, JSON helper, 501 stubs |
| zustand store | `web/src/store/ride.ts` | Single client-side source of truth |
| `useRideSocket` | `web/src/net/ws.ts` | WS lifecycle, backoff, message routing, `sendLoc` |
| `useGeo` / `useWakeLock` | `web/src/location/` | GPS acquisition + screen-awake |
| `Map` | `web/src/map/Map.tsx` | MapLibre instance + imperative marker reconciliation; the *only* `[lng,lat]` conversion site |
| `mobile/` | — | Untouched Expo template + pre-installed native deps. No Horizon code. |

---

# 2. Backend Analysis

## 2.1 Package structure

```
backend/
  main.go                     package main   — 49 lines, wiring only
  go.mod                      module github.com/krithik/horizon/backend, go 1.26.4
                              single dep: github.com/gorilla/websocket v1.5.3
  internal/hub/               hub.go (131) · room.go (125) · client.go (93)
  internal/standings/         standings.go (66) — zero deps beyond math
  .env.example                PORT, LIVEKIT_API_KEY/SECRET/URL, ORS_API_KEY
  wstest.mjs                  Node smoke test (the only test in the repo)
```

Total production Go: **~340 lines.** This adheres to `CLAUDE.md:117` ("standard library first; keep
packages under `internal/`"). The only third-party dependency in the entire backend is
`gorilla/websocket`.

`standings` is correctly isolated: pure functions, no I/O, no knowledge of rooms or clients. It is
the one package that is trivially unit-testable — and has zero tests.

## 2.2 Responsibilities

- **`main`** — pure composition root. Uses Go 1.22+ method-pattern routing (`"GET /healthz"`, `"POST /rides/{code}/route"`). No middleware chain, no CORS, no logging middleware, no graceful shutdown, no timeouts on the `http.Server` (it uses the `ListenAndServe` convenience form, so `ReadHeaderTimeout` etc. are all unset).
- **`hub`** — two concerns fused: room registry *and* HTTP upgrade handling. At this size that's fine; if auth or ride metadata arrives, `ServeWS` will want to split out.
- **`room`** — three concerns fused: membership lifecycle, broadcast scheduling, and standings ordering. The sort/`pos` assignment living inside `broadcast()` (`room.go:104-111`) rather than in `standings` is a mild layering smell — `standings` owns *distance*, `room` owns *ranking*.
- **`client`** — protocol framing and per-connection liveness.

## 2.3 WebSocket lifecycle

**Setup** (`hub.go:48-91`): query parse → validate → upgrade → construct → queue `welcome` →
register → spawn 2 goroutines.

**Read pump** (`client.go:41`):

- `SetReadLimit(1024)` — a frame over 1 KB kills the connection. `loc` frames are ~100 bytes, so ample, but a future protocol addition could silently trip this.
- `SetReadDeadline(now + 60s)`, refreshed **only** in the pong handler (`client.go:48`). Notably, receiving a `loc` does *not* extend the deadline. A client sending data at 1 Hz whose pong frames are lost will still be killed at 60 s.
- Loop: any unmarshal failure or non-`loc` type is silently `continue`d — no error frame, no logging, no metric. A client with a protocol bug gets zero feedback.
- `defer`: `unregister <- c` then `conn.Close()`.

**Write pump** (`client.go:69`):

- Ticker at `pingPeriod = 54s` (9/10 of `pongWait`).
- Drains `send`; a closed channel (`ok == false`) means the room evicted us → send Close frame and exit.
- `writeWait = 10s` deadline per write.
- **This is the single writer for the connection**, which is what makes the design safe — `gorilla/websocket` permits only one concurrent writer, and nothing else ever touches `conn` for writing.

**Teardown paths:**

1. Client closes → `ReadMessage` errors → `unregister` → room deletes + `close(send)` → write pump sees `!ok` → both goroutines exit.
2. Write fails/times out → write pump `return`s + `conn.Close()` → read pump's `ReadMessage` errors → `unregister`. Converges correctly.
3. Room evicts (currently only via unregister) → `close(send)` → write pump exits → conn closed → read pump errors → `unregister` again, but the `if _, ok := r.rider[c]` guard (`room.go:74`) makes the second unregister a no-op. **Double-close of `send` is correctly prevented.**

## 2.4 Room lifecycle

**Creation:** lazy, on first `/ws` for a code (`hub.go:31`), under `h.mu.Lock()`. Immediately spawns
`go r.run()`.

**Destruction: none.** This is the explicitly-acknowledged `TODO(later)` at `hub.go:29`. A room,
once created:

- stays in `h.rooms` forever,
- keeps a goroutine alive forever,
- keeps a 250 ms `time.Ticker` firing forever,
- calls `broadcast()` 4×/second forever, which allocates a zero-length `[]riderState`, marshals `{"type":"state","ride":"X","riders":[]}`, and sends it to nobody.

Because **any** `?ride=` string creates a room, this is an unauthenticated unbounded
resource-allocation primitive. See §8.

## 2.5 Goroutines

| Goroutine | Count | Lifetime |
|---|---|---|
| `http.Server` accept + per-request handler | 1 + N transient | — |
| `room.run()` | 1 per room ever created | **forever** (leak) |
| `client.readPump()` | 1 per connection | until read error |
| `client.writePump()` | 1 per connection | until write error / channel close |

Steady state for one ride of 15 riders: 1 room goroutine + 30 pump goroutines. Trivial. The leak is
on the room axis, not the client axis.

## 2.6 Concurrency model

A **hybrid** of the two canonical Go patterns, which is worth calling out explicitly because it's
unusual:

- **CSP/actor half:** `register`/`unregister` are unbuffered channels serialized by the single `run()` goroutine, and the broadcast ticker lives in that same loop.
- **Shared-memory half:** the actual mutation of `r.rider` happens under `r.mu`, and `r.mu` *also* guards per-`Client` fields (`lat/lng/speed/lastSeen`, documented at `client.go:34`) which are written from a *different* goroutine (the read pump) entirely outside the channel discipline.

So the channels don't actually provide the exclusion — the mutex does. The channels exist only to
fold membership events into the same `select` as the ticker. The design is correct but
**redundant**: either the mutex or the channels could be removed. The mutex is load-bearing (read
pumps need it); the channels are convenience.

**A notable structural choice:** a *room-level* lock guards *client-level* fields. This means every
`loc` from every rider takes a room-wide write lock. At 15 riders × 1 Hz = 15 Lock/Unlock per second
against a 4 Hz reader — negligible now, but it means ingest throughput is bounded by the slowest
thing that holds `r.mu`. See the §2.9 note about `distAlong` under `RLock`.

## 2.7 Synchronization strategy

| Primitive | Guards | Notes |
|---|---|---|
| `Hub.mu` (`RWMutex`) | `h.rooms` | **Only `Lock()` is ever used** (`hub.go:33`). `RLock` is never called, so the `RW` is decorative. |
| `Room.mu` (`RWMutex`) | `r.rider`, `r.route`, and all mutable `Client` fields | Genuinely uses both modes. |
| `send chan []byte` (cap 16) | per-client backpressure | Non-blocking send with `default:` drop (`room.go:121`). 16 frames ≈ 4 s of buffer at 4 Hz. |
| `register`/`unregister` (unbuffered) | membership events | Sender blocks until `run()` picks up. Bounded because `broadcast()` never blocks. |

**Lock ordering:** only one mutex is ever held at a time; `h.mu` is released before
`room.register <- c`. **No deadlock is possible** in the current code.

**Race-freedom of the drop-on-full send:** `broadcast()` sends to `c.send` while holding `RLock`;
`unregister` does `delete` + `close(send)` while holding `Lock`. Because the delete precedes the
close under the same exclusive lock, and `broadcast` only iterates the map under `RLock`, a closed
channel can never be in the iterated set. **No send-on-closed-channel panic.** This is correct but
*implicit* — it depends on `delete` and `close` being in the same critical section, which no comment
states.

**Broadcast does two separate `RLock` sections** (`room.go:87-101` build, `room.go:117-124` send).
Between them the set may change: a rider who joined can miss the frame, a rider who left can be sent
one. Both are harmless.

## 2.8 API endpoints & route handling

| Method | Path | Handler | Status |
|---|---|---|---|
| `GET` | `/healthz` | inline (`main.go:16`) | ✅ returns `ok`. Liveness only, no readiness/dependency check. |
| `GET` | `/ws` | `h.ServeWS` | ✅ the spine. |
| `POST` | `/rides` | inline (`main.go:23`) | ⚠️ mints a code. **Request body is entirely ignored** — `SYSTEM_DESIGN.md:245` specifies `{"name":"Sunday loop"}`; that field is dropped. **No `Access-Control-Allow-Origin` header.** |
| `POST` | `/rides/{code}/route` | `notImplemented` | ❌ `501` |
| `POST` | `/rides/{code}/voice-token` | `notImplemented` | ❌ `501` |

Routing uses `net/http` 1.22 patterns. There is no `OPTIONS` handler anywhere, no 404
customization, no request logging, no panic recovery middleware — **an unrecovered panic in any
handler kills the whole process**, taking down every in-progress ride (in-memory state is
unrecoverable).

## 2.9 Standings implementation

`standings.go` provides three functions:

- **`Haversine(a,b)`** (`:15`) — textbook great-circle, `earthRadiusM = 6371000`, correctly clamped with `math.Min(1, …)` before `Asin`.
- **`projectOntoSegment(a,b,p)`** (`:27`) — converts to a local planar frame using `mPerDegLat = 111320` and `mPerDegLng = 111320·cos(lat_a)`, does a standard dot-product projection, clamps `t` to `[0,1]`, and returns the point **interpolated in degree space**. Correct at city scale; the equirectangular approximation degrades near the poles and over long segments, neither of which applies here.
- **`DistAlongRoute(route, p)`** (`:53`) — linear scan over all segments, tracking cumulative length; returns `cum + t·len(segment)` for the segment whose projection is nearest to `p`.

**Correctness gaps:**

1. **Non-monotonic on loops and out-and-backs.** Nearest-segment snapping means a rider on the return leg of an out-and-back can snap to the outbound leg and have their `distAlong` collapse. This is documented as a Phase-2 refinement at `standings.go:50-52` (constrain the search to a window around the previous `distAlong`) — but implementing it requires per-rider state that doesn't exist yet (`Client` has no `lastDistAlong` field).
2. **No off-route detection.** `bestDist` (the perpendicular distance to the route) is computed and then *thrown away*. A rider 3 km off-route still gets a confident `distAlong`. That value is the natural signal for "rider has left the route", and it's currently discarded.
3. **No hysteresis.** With GPS jitter of a few metres, two riders within jitter distance of each other will have their `pos` flip back and forth at 4 Hz. The UI will visibly flicker between 1st and 2nd.

**Performance gaps:**

4. **Segment lengths are recomputed every call.** `Haversine(a,b)` is called once for `best` and once for `cum` — *two* haversines per segment per rider per tick, plus one for `Haversine(p, proj)`. Three haversines × S segments × R riders × 4 Hz. An ORS cycling route for a 50 km ride can easily be 2000–5000 points. At 15 riders × 4 Hz × 3000 segments × 3 haversines ≈ **540,000 haversine evaluations per second**, each with ~4 transcendental calls. Precomputing a cumulative-length array once when the route is set eliminates two-thirds of that immediately.
5. **The computation runs inside `r.mu.RLock()`** (`room.go:97`). Holding the read lock through heavy math blocks every read pump's `Lock()` for `loc` ingestion. With a large route this becomes a genuine ingest stall.

**Current runtime status:** `r.route` is **never written** — there is no setter, and the only writer
would be the 501'd route endpoint. So `hasRoute` is always `false`, `distAlong` is always `0`, and
the sort always falls through to the stable-by-`id` branch (`room.go:107`). **The `pos` field
shipping to clients today is alphabetical order by rider id, not race position.** The standings UI
renders it faithfully, which makes it look functional while being semantically meaningless.

## 2.10 Technical debt (backend)

1. **No CORS** → `POST /rides` is unusable from the browser in split-origin dev (§7 Critical).
2. **`TODO(rejoin)` unimplemented** (`room.go:58-69`) — the ghost-rider bug. The `fix: ghost users` commit shipped the client-side identity plumbing and the staleness UI but explicitly left the server-side eviction undone.
3. **No room GC** (`hub.go:29`) — unbounded goroutine + memory growth.
4. **No `route` setter** — the field exists with no way to populate it, and no locking convention established for the writer.
5. **`math/rand` for security-relevant tokens** (`hub.go:101, 108`) — join codes and rider ids are predictable. Should be `crypto/rand`.
6. **`CheckOrigin: true`** (`hub.go:25`) — explicitly labelled dev-only.
7. **Zero Go tests.** `standings` is pure math and trivially testable.
8. **No structured logging.** One `log.Printf` at startup. No connection/disconnection/error logs — debugging a live ride is impossible.
9. **No graceful shutdown / no `http.Server` timeouts.**
10. **No panic recovery** — one bad frame path and every ride dies.
11. **`Hub.mu` is an `RWMutex` used only as a `Mutex`.**
12. **Ranking logic lives in `room.broadcast()`, not `standings`.**
13. **`heading` and `ts` are parsed then discarded** — the wire struct promises more than the system delivers.
14. **`POST /rides` ignores its body**, diverging from the documented protocol.
15. **`w.Write` / `json.Encode` errors unchecked** (`main.go:18, 44`).

## 2.11 Explicit TODOs in the codebase

| Location | TODO | Impact |
|---|---|---|
| `hub.go:29` | `TODO(later)`: garbage-collect empty rooms | leak + DoS surface |
| `room.go:58-69` | `TODO(rejoin)`: kick the zombie client with the same id; optionally carry its last fix over | duplicate rider for up to 60 s after every dead zone |
| `standings.go:50-52` | Phase 2: windowed segment search for monotonic progress | wrong standings on loops |
| `hub.go:21` | "Dev-only: accept any origin. Tighten before any public deployment." | CSWSH |
| `main.go:27,29` | Phase 2 / Phase 3 stubs | features missing |

## 2.12 Scalability concerns

- **Single process, no horizontal path.** All state is in-memory; two instances share nothing. `SYSTEM_DESIGN.md:318` names Redis Pub/Sub as the escape hatch. This is a deliberate, documented v1 choice — not accidental debt.
- **Process restart = total state loss.** Acceptable per `SYSTEM_DESIGN.md:299` (clients reconnect and repopulate within seconds) — but note that clients repopulate only their *position*; a ride's route would be lost with no way to recover it, since routes aren't persisted and the client doesn't re-POST.
- **Room goroutine leak** is the first thing that will actually bite in a long-running deployment.
- **Broadcast is O(R) per tick and marshals once** — good. But it marshals the *same* payload for everyone, meaning there's no per-client filtering (viewport culling, etc.). Fine at 15; irrelevant beyond.
- **`distAlong` is O(R·S) per tick** — the real CPU cliff, and it lands the moment Phase 2 ships.
- **No connection limit, no rate limit, no room-size cap.** Nothing stops 10,000 sockets on one code.
- **Read-limit of 1 KB** caps per-message damage but nothing caps message *frequency* — a client can send `loc` at 10 kHz and each one takes the room-wide write lock.

---

# 3. Web Analysis

## 3.1 Application flow

```
main.tsx (StrictMode → createRoot)
  └─ App.tsx
     ├─ code === null → <Lobby/>   name input · "Start a ride" · join-code input
     └─ code !== null → <Ride/>    <Map/> · topbar · standings
```

`Lobby` (`App.tsx:11`) holds three pieces of *local* state (`joinCode`, `busy`, `error`) and pushes
only `name` and the eventual `code` into the store. `onCreate` awaits `createRide()`; on failure it
shows a generic message. `onJoin` requires ≥4 chars — note this doesn't match the 6-char code
format, so a 4- or 5-char typo silently creates a brand-new empty room server-side rather than
erroring.

`Ride` (`Ride.tsx:15`) is where the three side-effect hooks are mounted, in a deliberate order:
`useRideSocket()` first (to have `sendLoc` available), then `useGeo` wired to it, then
`useWakeLock`.

## 3.2 React architecture

- **React 19.1**, function components only, no class components (per `CLAUDE.md:118`).
- **Four components total:** `App`, `Lobby`, `Ride`, `Map`. No component library, no CSS-in-JS — one hand-written `index.css` (277 lines) with CSS custom properties for the dark palette.
- **No `React.memo`, no `useMemo`, no `useCallback`** except the one in `ws.ts:68`. At 4 Hz the entire `Ride` subtree re-renders 4×/second. With ≤15 rows this is genuinely fine; it's worth knowing it's unoptimized rather than optimized.
- **The map is deliberately non-React.** `Map.tsx` renders a single empty `<div>` and manipulates MapLibre imperatively through refs. This is the correct pattern — reconciling markers through React would fight MapLibre's own DOM.
- **`StrictMode` is on** (`main.tsx:7`), so in dev every effect mounts twice: the WebSocket connects, disconnects, and reconnects; the MapLibre instance is created, `.remove()`d, and recreated. Both cleanups are correct, so this is harmless — but it does mean dev sees a transient second connection, and with the ghost-rider bug unfixed that transient can briefly appear as a duplicate rider.

## 3.3 Zustand store

`web/src/store/ride.ts` — 34 lines, one flat slice, no middleware (no `persist`, no `devtools`, no
`immer`), no slicing pattern.

| Field | Type | Meaning |
|---|---|---|
| `name` | `string` | rider display name |
| `code` | `string \| null` | **doubles as the router** — `null` = lobby |
| `selfId` | `string \| null` | from `welcome` |
| `status` | `"idle" \| "connecting" \| "connected" \| "reconnecting"` | connection state |
| `riders` | `Rider[]` | latest `state` payload, replaced wholesale |

Actions: `setName`, `startRide` (uppercases the code, sets `connecting`, clears riders), `leaveRide`
(full reset), `setStatus`, `setSelfId`, `setRiders`.

**Observations:**

- Accessed two ways: hook selectors in components, and `useRideStore.getState()` inside WS callbacks (`ws.ts:25,32,42`) to avoid stale closures. Both are idiomatic.
- `setRiders` always installs a **new array identity**, so every subscriber re-renders every tick regardless of whether anything changed.
- **Nothing is persisted.** A page reload drops you to the lobby mid-ride. This directly undercuts the stated rationale in `net/identity.ts:5` ("sessionStorage… survives a page reload mid-ride") — the rider *id* survives the reload but the ride *code* doesn't, so there's nothing to survive *into*. Until `code` and `name` are persisted, sessionStorage buys nothing over a module-level variable.
- **No error state in the store.** Lobby errors are local `useState`; connection errors and geolocation-permission failures have no store representation at all.
- **No `route`, no voice state** — the store has no slot for Phase 2/3 data yet.

## 3.4 Custom hooks

**`useRideSocket()`** — `net/ws.ts:10`. Owns the single WebSocket.

- Effect keyed on `[code, name]`. Changing `name` tears down and rebuilds the connection — currently unreachable (the name input is lobby-only) but a live footgun for a future "edit name" feature.
- Three refs: `sockRef` (current socket), `retryRef` (backoff exponent), `closedRef` (intentional-close guard).
- **Backoff:** `min(1000 · 2^retry, 15000)` — 1s, 2s, 4s, 8s, 15s, 15s… **No jitter** (all riders reconnect in lockstep after a server restart — a thundering herd, though at 15 riders it doesn't matter). `retryRef` resets to 0 on `onopen`, so a connection that opens and immediately dies loops at 1 s forever.
- `onerror → ws.close()` funnels everything into the single `onclose` reconnect path. Clean.
- Cleanup sets `closedRef`, clears the pending timer, closes the socket.
- **`sendLoc` silently no-ops** when the socket isn't `OPEN` — fixes during a reconnect are lost with no queue and no user feedback.

**`useGeo(active, onFix, minIntervalMs=1000)`** — `location/useGeo.ts:14`.

- Stores `onFix` in a ref updated on every render (`:16`) so the effect can depend only on `[active]` and never re-subscribe `watchPosition`. This is the right call — re-subscribing GPS is expensive and causes an accuracy re-acquisition.
- Throttles by wall clock (`:25`), dropping fixes rather than debouncing (last-write-wins would be marginally better; dropping means you send a slightly older fix).
- `heading ?? 0` and `speed ?? 0` — note that `0` is a *valid* heading/speed, so "unavailable" and "stationary/due-north" are indistinguishable downstream. Doesn't matter today since the server discards heading.
- **Errors go to `console.warn` only** (`:35`). A user who denies location permission sees "Waiting for a GPS fix… (allow location access)" forever with no actionable feedback and no retry affordance. This is the single worst UX gap in the web client.

**`useWakeLock(active)`** — `location/useWakeLock.ts:7`.

- Requests `navigator.wakeLock.request("screen")`, and — critically — **re-acquires on `visibilitychange`** (`:22`), because the OS silently drops the sentinel whenever the tab is hidden. Without this the lock is lost on the first app-switch and never comes back.
- Failures are swallowed (`:18`) — the UA can refuse on low battery.
- Feature-detected (`:9`), so Safari versions without Wake Lock degrade to "screen may sleep" rather than crashing.
- **No UI indication** of whether the lock is actually held. On a real ride, a silently-refused wake lock means the screen sleeps, GPS stops, and the rider vanishes from everyone's map with no warning.

## 3.5 WebSocket integration

- URL built at `ws.ts:24` with all three params `encodeURIComponent`-escaped: `?ride=…&name=…&rider=…`.
- **Message parsing has no validation beyond `JSON.parse`** (`ws.ts:36-43`). A malformed `state` whose `riders` isn't an array would be stored as-is and crash the render. The `ServerMsg` discriminated union in `types.ts:43` is compile-time only — there's no runtime schema check (no zod).
- Unknown message types are silently ignored — good for forward compatibility.
- No client→server heartbeat: the browser auto-responds to the server's ping frames at the protocol level, which satisfies the server's 60 s read deadline.

## 3.6 Map rendering

`web/src/map/Map.tsx` — MapLibre GL JS v5.6, style
`https://tiles.openfreemap.org/styles/liberty` (`:9`).

- **Instance effect** (`:21`, deps `[]`): creates the map at `center:[0,20], zoom:1.5` (whole-world view until the first fix), adds `NavigationControl` without a compass, and on cleanup calls `map.remove()` and resets all refs.
- **Reconciliation effect** (`:40`, deps `[riders, selfId]`): for each rider, create-or-update a `maplibregl.Marker` keyed by id in `markersRef`; toggle `.self` and `.stale` classes; set `data-pos` and `title`. Then diff against a `seen` set and `.remove()` markers for departed riders. This is a correct keyed-reconciliation loop.
- **The `[lng, lat]` boundary is honoured and commented** (`:53, 57`) — `CLAUDE.md:110` calls this out as "a known trap", and `Map.tsx` is the only file in the web client that performs the conversion. The discipline holds.
- **Camera:** `centeredRef` (`:76`) does a one-time `easeTo` on the first self-fix at zoom 15. There is **no follow mode** — ride 2 km and your dot leaves the viewport with no recentre button. There's also no fit-bounds-to-group.
- **No route layer** — the `ShapeSource`/`LineLayer` equivalent for Phase 2 doesn't exist yet.
- **Markers are plain DOM divs styled by CSS** (`index.css:255-276`): 16 px blue dot, 20 px teal for self, grey at 60 % opacity when stale. No heading arrow (the server doesn't send heading), no name labels on the map, no clustering (unnecessary at 15).
- **Marker updates are teleports, not animations** — `setLngLat` jumps the dot every 250 ms. At 4 Hz this reads as slightly jittery rather than smooth. Interpolating between fixes is the standard fix.
- `centeredRef` is never reset when `selfId` changes, so a reconnect that mints a *new* id won't re-centre.

## 3.7 Routing

**There is none.** No `react-router`, no `wouter`, no History API usage. Navigation is a single
ternary on `code` (`App.tsx:8`).

Consequences:

- The ride code never appears in the URL → **no shareable join link**. Sharing a ride means verbally passing a 6-character code, which is a meaningful UX cost for the actual use case (friends coordinating before a ride).
- Browser back button doesn't leave the ride; it leaves the app.
- Reload = lobby (compounding the no-persistence issue in §3.3).
- No deep-link path for the future `?ride=ABC123` install-and-join flow.

Given the app has exactly two screens, adding a router is overkill — but a `pushState`/`popstate`
pair or even a hash fragment would buy shareable links cheaply.

## 3.8 State flow

```
        ┌──────────────── zustand (single source of truth) ────────────────┐
        │  name   code   selfId   status   riders                          │
        └──┬───────┬────────┬────────┬────────┬───────────────────────────┘
           │       │        │        │        │
   Lobby ──┘       │        │        │        └──► Map.tsx      (markers)
   (setName,       │        │        │        └──► Ride.tsx     (standings)
    startRide)     │        │        │
                   │        │        └── Ride.tsx topbar (status pill)
                   │        └── Map.tsx + Ride.tsx (label "you")
                   └── App.tsx (lobby vs ride) + ws.ts effect key

   ws.ts  ──welcome──► setSelfId
          ──state────► setRiders     (4 Hz)
          ──open/close► setStatus
   useGeo ──fix──────► sendLoc (bypasses the store entirely — direct to socket)
```

The one asymmetry worth noting: **outbound GPS never enters the store.** `useGeo` calls `sendLoc`
directly, and the client learns its own position only when the server echoes it back. This is
elegant (one code path for all dots) but means your own dot has full round-trip latency and
disappears entirely when the server is unreachable.

## 3.9 PWA implementation

Via `vite-plugin-pwa` ^1.0 (`vite.config.ts:9`), default Workbox `generateSW` strategy.

- **`registerType: "autoUpdate"`** — new service worker takes over silently. No "update available, reload?" prompt. Mid-ride, this means the app can swap versions under the rider.
- **Manifest** (`vite.config.ts:12-26`): name/short_name "Horizon", `display: standalone`, `orientation: portrait`, `start_url: "/"`, theme+background `#0f1419`, three icon entries (192, 512, 512-maskable). **Missing:** `id`, `scope`, `screenshots`, `shortcuts`, `categories`. The 512 icon does double duty as `any` and `maskable`, which will visibly crop on Android adaptive-icon masks since the artwork isn't drawn inside the 80 % safe zone (`gen-icons.mjs:33-46` draws the line from 13 % to 87 % of the canvas — right at the crop boundary).
- **Icons are generated from code** (`scripts/gen-icons.mjs`, 97 lines): a hand-rolled PNG encoder using only `node:zlib` (`deflateSync` + `crc32`) that rasterizes an RGBA buffer and emits IHDR/IDAT/IEND chunks. Wired to `predev`/`prebuild` so a fresh clone always has icons; the outputs are gitignored (`web/.gitignore:9-13`). This is a genuinely nice touch — zero binary assets in the repo, consistent with the project's minimalism.
- **`devOptions.enabled: true`** (`vite.config.ts:29`) — the SW runs in `vite dev`, which lets install/offline be tested locally but is a well-known source of stale-asset confusion during development.
- **iOS meta tags** in `index.html:14-18` (`apple-mobile-web-app-capable`, `black-translucent` status bar, title, touch icon) — required because iOS ignores much of the manifest.
- **Viewport** locks zoom (`user-scalable=no`) and uses `viewport-fit=cover`, with `env(safe-area-inset-*)` respected in the topbar and standings (`index.css:161, 205`).
- **No runtime caching strategy for map tiles.** Only the app shell is precached. Offline, the app loads and shows a blank map. Given that OpenFreeMap is a donation-funded community service, a `CacheFirst` runtime rule for tiles would be both polite and useful.
- **No offline fallback page**, no `navigateFallback` customization.

---

# 4. Mobile Analysis

## 4.1 Current implementation

**`mobile/` contains zero Horizon application code.** A grep for
`Horizon|WebSocket|ws://|8080|zustand` across `mobile/src/` returns only CSS-spacing false
positives. It is the stock `create-expo-app` default template with Horizon's *native dependencies
pre-installed and configured*.

Confirmed by `SETUP_MOBILE.md:22-26`: *"`mobile/` exists as an untouched `create-expo-app` default
template… none of the Horizon code below has been added yet."*

## 4.2 What already exists

**Configured and correct:**

- `app.config.ts` — Horizon identity (`com.krithik.horizon`), iOS `UIBackgroundModes: ["location","audio"]`, `NSMicrophoneUsageDescription`, and a plugin list covering `expo-dev-client`, MapLibre, `expo-location` (with `isAndroidBackgroundLocationEnabled` + `isAndroidForegroundServiceEnabled`), the LiveKit Expo plugin with `audioType: "communication"`, and `@config-plugins/react-native-webrtc`. **The hard part — the native permissions/background config that `SYSTEM_DESIGN.md:328` warns will eat real time — is already written.**
- `eas.json` — `development` (dev client, internal), `preview` (internal), `production` (autoIncrement) profiles.
- **Native deps installed:** `@maplibre/maplibre-react-native` ^11.3.4, `@livekit/react-native` ^2.11.1 + `@livekit/react-native-webrtc` ^144.1.1 + expo plugin + `livekit-client` ^2.19.2, `zustand` ^5.0.14. React Native 0.85.3, Expo ~56, React 19.2.3, expo-router ~56.2, reanimated 4.3.1.
- `tsconfig.json` — strict, with `@/*` → `./src/*` and `@/assets/*` path aliases.
- `mobile/AGENTS.md` — a one-line standing instruction: read the versioned Expo v56 docs before writing code. `mobile/CLAUDE.md` is just `@AGENTS.md`.

**Template scaffolding (to be deleted):** `src/app/index.tsx` (Expo welcome screen),
`src/app/explore.tsx` (docs links), `src/app/_layout.tsx` (theme provider + tabs),
`src/components/` (themed-text, themed-view, collapsible, animated-icon, app-tabs, hint-row,
web-badge, external-link), `src/constants/theme.ts`, `src/hooks/`, plus template images and
`scripts/reset-project.js`.

**Two concrete defects in the current config:**

1. **`expo-location` is listed as a plugin in `app.config.ts:19` but is NOT in `package.json` dependencies.** Neither is `expo-task-manager`. `SETUP_MOBILE.md:90` instructs installing both; that step was skipped while step 4 (the config) was completed. `npx expo config` / `prebuild` / `eas build` will fail to resolve the `expo-location` plugin. This must be fixed before any native build succeeds.
2. **`app.config.ts` has no `scheme`.** The original `app.json` was deleted (`SETUP_MOBILE.md:124`) and replaced with a minimal config that omits `scheme`, `version`, `orientation`, `icon`, `splash`, and `userInterfaceStyle`. `expo-router` + `expo-dev-client` need a `scheme` for deep linking, and the template's `assets/images/icon.png` / `splash-icon.png` are now orphaned.

Also absent: any call to LiveKit's `registerGlobals()` (required per `SETUP_MOBILE.md:200`), and no
AsyncStorage/SecureStore dependency for the stable per-install rider id that `SETUP_MOBILE.md:213`
calls for.

## 4.3 Future architecture

Per `SYSTEM_DESIGN.md:144-157` and `SETUP_MOBILE.md:344-357`:

```
mobile/
  app.config.ts
  src/
    core/       wsClient.ts · route.ts · models.ts · config.ts
    state/      useRide.ts                 # zustand — mirrors web/src/store/ride.ts
    features/
      ride/     join code + lifecycle
      map/      RideMap.tsx · RiderDot.tsx  (MapLibre RN: MapView/Camera/ShapeSource/LineLayer/PointAnnotation)
      location/ tracker.ts                 (expo-location foreground + expo-task-manager background)
      voice/    Voice.tsx · PttButton.tsx  (LiveKitRoom + setMicrophoneEnabled on press/release)
      standings/Standings.tsx
```

Note this proposed layout **differs from the web client's actual layout** (`web/src/` uses `net/`,
`location/`, `map/`, `store/` — no `features/` directory). The web client's structure is flatter
and, given it works, arguably the better template for the native app to copy. Deciding this now
avoids two divergent conventions.

**The single reason the native app exists** is true background location — `SETUP_WEB.md:176` is
explicit that no service-worker trick makes a browser keep `geolocation` alive with the screen off.
Everything else in the native app is a re-implementation of working web code. The
`UIBackgroundModes` + Android foreground-service config in `app.config.ts` is precisely the payload
that justifies the whole directory.

## 4.4 Integration plan with the backend

**The backend requires zero changes.** `SYSTEM_DESIGN.md:35` states this and the code bears it out:
`ServeWS` reads query params and speaks JSON; nothing is browser-specific. The protocol is
identical.

Sequenced integration:

1. **Fix the config defects** — `npx expo install expo-location expo-task-manager`; add `scheme`, `version`, icon/splash to `app.config.ts`.
2. **Build the dev client once** — `eas build --profile development --platform android` (Windows host ⇒ Android locally, iOS via EAS cloud per `SETUP_MOBILE.md:28`). Rebuild only when native deps change.
3. **Port the protocol types** — `web/src/types.ts` copies over verbatim. This file is the contract; it should ideally become shared rather than duplicated.
4. **Port the store** — `web/src/store/ride.ts` is framework-agnostic zustand; it copies with no changes.
5. **Port the socket layer** — `web/src/net/ws.ts` uses only the global `WebSocket`, which RN provides. The only change is the identity backend: swap `sessionStorage` (`net/identity.ts`) for AsyncStorage/SecureStore, and note the semantics shift from *per-tab* to *per-install*, which is actually what the server's rejoin logic wants.
6. **Config/base URL** — replace `net/config.ts`'s `location.hostname` logic with `expo-constants` + the emulator rule (`10.0.2.2` for Android emulator, LAN IP for physical devices — `SETUP_BACKEND.md:672`).
7. **Location** — replace `useGeo`'s `watchPosition` with `Location.watchPositionAsync({accuracy: High, timeInterval: 1000, distanceInterval: 5})`. Note RN's `timeInterval` moves the 1 Hz throttle from JS into the OS, which is more battery-efficient than the web's approach.
8. **Map** — replace `maplibre-gl` imperative markers with declarative `<MapView>/<Camera>/<PointAnnotation>`. Same `[lng, lat]` convention, same trap, different API shape.
9. **Wake lock → drop it.** Replaced by real background modes.
10. **Background task (the actual Phase 4 work)** — `TaskManager.defineTask` + `Location.startLocationUpdatesAsync` with a foreground-service notification. **Critical constraint:** a background task runs in a separate JS context from the UI; it cannot reuse the React-owned WebSocket. Either the socket must be owned outside React and reachable from the task, or fixes must be handed off via a queue. `SETUP_MOBILE.md:249` ("forward locations[0].coords up the WebSocket") glosses over this — it is the hardest unsolved design question in the mobile path.
11. **Voice (Phase 3)** — same `POST /rides/{code}/voice-token`, then `<LiveKitRoom audio={false}>` + PTT via `setMicrophoneEnabled`. Requires `AudioSession.startAudioSession()` and `registerGlobals()`.

---

# 5. Shared Protocol

All WebSocket messages are JSON objects with a `type` discriminator. **Internal wire format is
always `lat`/`lng` as named fields; `[lng, lat]` positional arrays appear only inside
MapLibre/GeoJSON at the client boundary.**

## 5.1 Client → server

### `loc` — position update, ~1×/sec

```json
{ "type": "loc", "lat": 12.9716, "lng": 77.5946, "heading": 45, "speed": 6.2, "ts": 1718700000 }
```

| Field | Type | Server behaviour |
|---|---|---|
| `type` | `"loc"` | **required**; anything else is silently dropped (`client.go:59`) |
| `lat` | float64 | stored |
| `lng` | float64 | stored |
| `heading` | float64, degrees | **parsed and discarded** — never re-broadcast |
| `speed` | float64, m/s | stored |
| `ts` | int64, unix seconds | **parsed and discarded** — server stamps its own receive time |

Constraints: ≤1024 bytes (`maxMessageSize`); text frames; no other client→server message type
exists. Malformed JSON is silently ignored with no error response.

## 5.2 Server → one client

### `welcome` — sent once, immediately on connect

```json
{ "type": "welcome", "id": "a1b2c3d4" }
```

The id is either the client's validated `?rider=` value or a server-minted 8-hex-char string. Queued
into the buffered `send` channel *before* the pumps start, so it is guaranteed to be the first
frame. Clients use it to identify their own dot within `state`.

## 5.3 Server → all clients in room

### `state` — broadcast on a fixed 250 ms tick (~4 Hz)

```json
{
  "type": "state",
  "ride": "ABC123",
  "riders": [
    { "id": "a1", "name": "Sam", "lat": 12.972, "lng": 77.595, "speed": 6.2, "ageSec": 0,  "pos": 1, "distAlong": 4120 },
    { "id": "b2", "name": "Raj", "lat": 12.961, "lng": 77.583, "speed": 5.1, "ageSec": 14, "pos": 2, "distAlong": 3880 }
  ]
}
```

| Field | Meaning |
|---|---|
| `ride` | the join code |
| `id` | rider id (matches `welcome.id` for self) |
| `name` | display name from `?name=`, defaulting to `"rider"` |
| `lat`/`lng` | last known fix |
| `speed` | m/s from the last fix (clients render `× 3.6` for km/h) |
| `ageSec` | integer seconds since last fix, **server clock**. Clients grey out past `STALE_AFTER_SEC = 10` |
| `pos` | 1-based rank. **Currently alphabetical by id**, since no route exists |
| `distAlong` | metres along the planned route. **Currently always `0`** |

**Exclusion rule:** riders whose `lastSeen` is zero (connected but no fix yet) are omitted entirely
(`room.go:91`).

**Drop rule:** if a client's 16-slot `send` buffer is full, that client's frame is dropped
(`room.go:121`). Frames are independent snapshots, so a drop costs 250 ms of freshness and nothing
else.

**No heading** in `state` — the protocol is asymmetric.

## 5.4 REST endpoints

| Method & path | Request | Response | Status |
|---|---|---|---|
| `GET /healthz` | — | `200 "ok"` (text/plain) | ✅ |
| `POST /rides` | body **ignored** (spec says `{"name":"…"}`) | `{"code":"ABC123"}` | ⚠️ no CORS header |
| `GET /ws?ride=&name=&rider=` | — | `101 Switching Protocols`, or `400` if `ride` missing | ✅ |
| `POST /rides/{code}/route` | `{"waypoints":[[lat,lng],…]}` | `{"polyline":[[lat,lng],…]}` | ❌ `501` |
| `POST /rides/{code}/voice-token` | rider identity | `{"token":"…","url":"wss://…"}` | ❌ `501` |

**Query parameters for `/ws`:**

- `ride` (**required**) — any non-empty string; **not validated against minted codes**, so any string creates a room.
- `name` (optional) — defaults to `"rider"`. No length cap server-side; the web input caps at 20 (`App.tsx:51`). Not sanitized, but it's rendered as React text so XSS isn't reachable from the current client.
- `rider` (optional) — must match `^[A-Za-z0-9_-]{8,64}$` or it's replaced by a minted id.

## 5.5 Message flow

```
Client                                          Server
  │                                               │
  │──── GET /ws?ride=&name=&rider= ──────────────►│  validate, upgrade
  │◄─── 101 ──────────────────────────────────────│
  │◄─── {"type":"welcome","id":"…"} ──────────────│  (first frame, always)
  │                                               │  register into room
  │                                               │
  │──── {"type":"loc",…} ────────────────────────►│  stamp lastSeen, store  ⎫ ~1 Hz
  │──── {"type":"loc",…} ────────────────────────►│                          ⎬ independent
  │                                               │                          ⎭ of ↓
  │◄─── {"type":"state","riders":[…]} ────────────│  ⎫
  │◄─── {"type":"state","riders":[…]} ────────────│  ⎬ every 250ms, unconditional
  │◄─── {"type":"state","riders":[…]} ────────────│  ⎭ (even with zero riders)
  │                                               │
  │◄─── PING (protocol frame) ────────────────────│  every 54s
  │──── PONG ────────────────────────────────────►│  refreshes 60s read deadline
  │                                               │
  │  ── disconnect ──                             │  ReadMessage err → unregister
  │                                               │  delete from set, close(send)
  │  (backoff 1,2,4,8,15,15s…)                    │  ⚠ old client NOT evicted on
  │──── GET /ws?…&rider=SAME_ID ─────────────────►│    rejoin — ghost until 60s
```

## 5.6 Synchronization rules

1. **The server clock is authoritative for freshness.** Client `ts` is informational only; `ageSec` derives from the server's receive time (`SYSTEM_DESIGN.md:250`). This makes staleness immune to phone clock skew.
2. **Ingest and fan-out are fully decoupled.** No `loc` triggers a broadcast; the ticker is unconditional. N riders at 1 Hz ⇒ 4 msg/s per client, independent of N.
3. **Fan-out is best-effort.** Full queue ⇒ drop. Since every `state` is a complete snapshot, there is no ordering or gap-recovery requirement.
4. **Stable rider ids are the reconnect key.** A client presents the same `?rider=` across reconnects so the room can replace rather than duplicate. **The server side of this rule is not implemented** (`room.go:58`), so the contract is currently client-honoured and server-ignored.
5. **Staleness threshold is 10 s** (`web/src/types.ts:16`). Past that, clients grey the dot and show "Ns ago" instead of a frozen speed. Riders are never auto-removed for silence — only for socket closure.
6. **Coordinate convention is invariant:** `lat`/`lng` named fields everywhere on the wire and in Go; `[lng, lat]` only inside MapLibre/GeoJSON calls. The single conversion point in the web client is `map/Map.tsx:54,57`.
7. **Liveness:** server pings every 54 s, requires a pong within 60 s. Data frames do **not** refresh the read deadline.
8. **One route per room, shared by all riders** (`CLAUDE.md:126`) — fetched once per ride to conserve ORS quota, not once per rider.

---

# 6. Current Feature Status

Legend: ✅ Completed · ⚠️ Partial · ❌ Missing · 🚫 Blocked

| # | Feature | Status | Detail |
|---|---|---|---|
| **Backend — core pipe** ||||
| 1 | HTTP server + `PORT` env | ✅ Completed | `main.go:32-39` |
| 2 | `GET /healthz` | ✅ Completed | Liveness only |
| 3 | Join-code minting (`POST /rides`) | ⚠️ Partial | Works server-side; **CORS-blocked from the browser**; body ignored; code not registered |
| 4 | WebSocket upgrade + query validation | ✅ Completed | `hub.go:48` |
| 5 | Room create-on-demand | ✅ Completed | `hub.go:31` |
| 6 | `welcome` message | ✅ Completed | `hub.go:84` |
| 7 | `loc` ingest + server-side timestamping | ✅ Completed | `client.go:62-65` |
| 8 | 4 Hz `state` fan-out | ✅ Completed | `room.go:79-80` |
| 9 | `ageSec` staleness computation | ✅ Completed | `room.go:95` |
| 10 | Per-client backpressure (drop-on-full) | ✅ Completed | `room.go:121` |
| 11 | Ping/pong keepalive | ✅ Completed | `client.go:47-51, 86-91` |
| 12 | Multi-room isolation | ✅ Completed | Keyed by code |
| 13 | Stable rider-id validation | ✅ Completed | `hub.go:117` |
| 14 | **Rejoin: evict zombie connection** | ❌ Missing | `TODO(rejoin)` `room.go:58` — the ghost-rider bug |
| 15 | Carry last fix across reconnect | ❌ Missing | Same TODO |
| 16 | Empty-room garbage collection | ❌ Missing | `TODO(later)` `hub.go:29` |
| 17 | CORS headers | ❌ Missing | **Blocks ride creation from the PWA** |
| 18 | Origin checking (`CheckOrigin`) | ❌ Missing | Returns `true` unconditionally |
| 19 | `heading` in `state` payload | ❌ Missing | Ingested then discarded |
| 20 | Ride name / metadata | ❌ Missing | `POST /rides` body ignored |
| 21 | Join-code validation / expiry | ❌ Missing | Any string is a valid room |
| 22 | Rate limiting / connection caps | ❌ Missing | — |
| 23 | Structured logging | ❌ Missing | One startup line |
| 24 | Metrics / observability | ❌ Missing | `SYSTEM_DESIGN.md:320` scaling path |
| 25 | Graceful shutdown, server timeouts | ❌ Missing | — |
| 26 | Panic recovery middleware | ❌ Missing | One panic ends all rides |
| 27 | Go unit tests | ❌ Missing | `standings` is pure and untested |
| **Backend — Phase 2/3** ||||
| 28 | `POST /rides/{code}/route` (ORS proxy) | ❌ Missing | 501 stub |
| 29 | Route storage on room | ⚠️ Partial | `route` field exists (`room.go:36`); no setter, no locking convention |
| 30 | Haversine / segment projection | ✅ Completed | `standings.go` — correct, untested, unexercised |
| 31 | `DistAlongRoute` | ⚠️ Partial | Implemented; **never runs** (no route); O(R·S) per tick; no cumulative precompute |
| 32 | Monotonic/windowed projection | ❌ Missing | Documented refinement, `standings.go:50` |
| 33 | Off-route detection | ❌ Missing | `bestDist` computed then discarded |
| 34 | Standings sort + `pos` assignment | ⚠️ Partial | Sorts correctly, but on `id` since `distAlong ≡ 0` |
| 35 | Position hysteresis / anti-flicker | ❌ Missing | — |
| 36 | `POST /rides/{code}/voice-token` | ❌ Missing | 501 stub |
| 37 | LiveKit Go SDK integration | ❌ Missing | Not a dependency |
| **Web PWA** ||||
| 38 | Lobby: name, create, join | ⚠️ Partial | UI complete; "Start a ride" fails on CORS; join accepts 4-char input vs 6-char codes |
| 39 | WebSocket client + message routing | ✅ Completed | `net/ws.ts` |
| 40 | Exponential reconnect backoff | ✅ Completed | 1→15 s cap; no jitter |
| 41 | Stable per-tab rider id | ✅ Completed | `net/identity.ts`, sessionStorage + fallback |
| 42 | GPS capture, throttled to 1 Hz | ✅ Completed | `useGeo.ts` |
| 43 | Screen wake lock + re-acquire | ✅ Completed | `useWakeLock.ts` |
| 44 | MapLibre + OpenFreeMap render | ✅ Completed | `Map.tsx` |
| 45 | Per-rider marker reconciliation | ✅ Completed | Create/update/remove keyed by id |
| 46 | `[lng,lat]` boundary conversion | ✅ Completed | Single site, commented |
| 47 | Self highlighting | ✅ Completed | `.self` class + "(you)" |
| 48 | Stale greying (map + list) | ✅ Completed | `STALE_AFTER_SEC = 10` |
| 49 | Standings list UI | ✅ Completed | Renders `pos`, name, speed/age |
| 50 | Connection status indicator | ✅ Completed | Four states, animated pulse |
| 51 | Leave ride | ✅ Completed | Full store reset |
| 52 | One-time auto-centre on self | ⚠️ Partial | Fires once; **no follow mode, no recentre button** |
| 53 | Route line rendering | ❌ Missing | Phase 2 |
| 54 | Destination / waypoint picking UI | ❌ Missing | Phase 2 |
| 55 | Voice / PTT | ❌ Missing | `livekit-client` not installed |
| 56 | Geolocation-denied error UX | ❌ Missing | `console.warn` only — user sees an infinite "waiting" hint |
| 57 | Ride persistence across reload | ❌ Missing | Store is in-memory; reload ⇒ lobby |
| 58 | URL routing / shareable join link | ❌ Missing | Ternary on `code`; code never in URL |
| 59 | Runtime message validation | ❌ Missing | Types are compile-time only |
| 60 | Marker position interpolation | ❌ Missing | Dots teleport at 4 Hz |
| 61 | Heading arrows on markers | 🚫 Blocked | Server doesn't send `heading` |
| 62 | PWA manifest + service worker | ✅ Completed | `vite-plugin-pwa`, autoUpdate |
| 63 | Generated PWA icons | ✅ Completed | `gen-icons.mjs`, zero binary assets |
| 64 | iOS home-screen meta tags | ✅ Completed | `index.html:14-18` |
| 65 | Safe-area insets | ✅ Completed | `index.css:161, 205` |
| 66 | Tile runtime caching / offline map | ❌ Missing | Shell-only precache |
| 67 | SW update prompt | ❌ Missing | Silent `autoUpdate` |
| 68 | Web tests / lint config | ❌ Missing | No ESLint, no test runner |
| **Mobile** ||||
| 69 | Expo project + dev-client config | ✅ Completed | `app.config.ts`, `eas.json` |
| 70 | Native deps (MapLibre, LiveKit, WebRTC, zustand) | ✅ Completed | Installed |
| 71 | `expo-location` / `expo-task-manager` deps | ❌ Missing | **Plugin referenced in config but not installed — native build will fail** |
| 72 | `scheme`, version, icon, splash in config | ❌ Missing | Lost when `app.json` was deleted |
| 73 | `registerGlobals()` for LiveKit | ❌ Missing | Required at entry |
| 74 | Any Horizon UI / logic | ❌ Missing | Pure `create-expo-app` template |
| 75 | Store / socket / map / location / voice modules | ❌ Missing | Not started |
| 76 | Stable per-install rider id (AsyncStorage) | ❌ Missing | No storage dep |
| 77 | Background location (Phase 4) | 🚫 Blocked | The reason `mobile/` exists; blocked on 71–75 |
| 78 | Dev-client build produced | ❌ Missing | Blocked on 71 |
| **Cross-cutting** ||||
| 79 | HTTPS / `wss://` deployment | ❌ Missing | Required for install, geolocation, wake lock, WebRTC |
| 80 | Deployment (Koyeb + Cloudflare Tunnel) | ❌ Missing | Planned, `SETUP_BACKEND.md:678` |
| 81 | Two-phone real-world test | 🚫 Blocked | Blocked on 79 |
| 82 | Auth / accounts | ❌ Missing | Deliberately out of scope (`CLAUDE.md:127`) |
| 83 | Database / persistence | ❌ Missing | Deliberately out of scope |
| 84 | CI / automated builds | ❌ Missing | — |
| 85 | Shared protocol types across clients | ❌ Missing | Will be duplicated web ↔ mobile |

**Totals:** 30 Completed · 9 Partial · 42 Missing · 4 Blocked.

---

# 7. Technical Debt

## 🔴 Critical

### C1. No CORS headers on the Go backend — `POST /rides` cannot succeed from the PWA

`main.go` serves a bare `mux` with no middleware and no `Access-Control-Allow-Origin` header. In dev
the page is at `http://host:5173` and the API at `http://host:8080` — different origins.
`createRide()` (`net/api.ts:6`) issues a *simple* cross-origin POST (no custom headers, no body ⇒ no
preflight), so the request reaches the server and a code is minted, but the browser **blocks the
response** from JavaScript, the promise rejects, and `App.tsx:26` renders *"Couldn't reach the
server. Is the backend running?"* — a misleading message, since the server is running and did its
job.

**Why critical:** it breaks the primary entry point of the only working client. Joining still works
(WebSocket handshakes are exempt from CORS — which is exactly why `CheckOrigin` exists), so the bug
hides: you can test the whole pipe by typing an arbitrary code into "Join", because any string
creates a room. Note that the documented workaround in `SETUP_WEB.md:62`
(`VITE_BACKEND_HTTP=http://192.168.1.50:8080`) is *still cross-origin* and does not fix it. Two real
fixes: add a CORS middleware in Go, or add `server.proxy` to `vite.config.ts`. It self-masks in
production because `httpBase` becomes `location.origin` behind a single reverse proxy — which means
it will look fine when deployed and break again on every dev machine.

### C2. The ghost-rider bug — `TODO(rejoin)` is unimplemented

`room.go:58-69` documents in detail exactly what to do (find the old client with the same id,
`delete` + `close(send)`, optionally carry the last fix over) and then does none of it:
`r.rider[c] = true` just adds. Every dead-zone reconnect seats a *second* client with the *same* id,
and the zombie survives until its 60 s read deadline expires.

**Why critical:** it corrupts every downstream consumer. `broadcast()` emits two entries with
identical `id`; the standings sort's `id` tiebreak is now non-deterministic between equal keys;
`Ride.tsx:47` renders two `<li>` with the same React `key`; `Map.tsx` overwrites `markersRef[id]`
and **leaks the first marker permanently** (the `seen`-set cleanup can never remove a marker whose
id is still present). It also inflates the group count for a full minute. Mobile networks drop
constantly on real rides — this fires often. And critically, the last commit is titled
`fix: ghost users`, so the bug reads as fixed when only its client-side scaffolding shipped.

### C3. Unauthenticated unbounded room creation + no room GC

Any WebSocket to `/ws?ride=<anything>` creates a permanent `Room`: a map entry, a goroutine, and a
`time.Ticker` that broadcasts to nobody 4×/second forever (`hub.go:31`, no destruction path).
Combined with `CheckOrigin: func(*http.Request) bool { return true }` (`hub.go:25`), *any* web page
a rider visits can open sockets to the server and allocate rooms without limit.

**Why critical:** this is simultaneously a memory leak (grows monotonically in any long-running
deployment), a CPU leak (idle rooms burn ticks), and a trivially-reachable DoS. All three are fixed
by the same two changes: shut down a room's goroutine when it empties, and reject `?ride=` codes
that were never minted.

## 🟠 High

**H1. Standings are entirely non-functional and silently plausible.** No route can be set (endpoint
501, no setter on `Room.route`), so `hasRoute` is permanently false, `distAlong` is permanently `0`,
and `pos` is alphabetical order by rider id. The UI renders a confident "1 / 2 / 3" that means
nothing. *Why high:* it's one of the three stated product goals, and its failure mode is a wrong
answer rather than a missing one.

**H2. `distAlong` will be an immediate CPU problem the moment Phase 2 lands.** `DistAlongRoute` is
O(S) per rider per tick with **three** haversines per segment, recomputing every segment length on
every call. At 15 riders × 4 Hz × 3000-point route ≈ 540 k haversines/sec. Worse, it runs **inside
`r.mu.RLock()`** (`room.go:97`), so it directly blocks `loc` ingest. Precomputing a cumulative-length
array when the route is set, and moving the computation out of the lock, are both cheap and should
happen *with* the route endpoint, not after.

**H3. Zero automated tests anywhere.** The only test artifact is `wstest.mjs`, a manual Node smoke
script. `standings` is pure math with no I/O — the single highest-value, lowest-effort test target in
the repo, and exactly the code whose bugs (non-monotonic projection, wrong distances) will be
hardest to spot by eye on a map.

**H4. Mobile native build is broken by config drift.** `app.config.ts:19` lists the `expo-location`
plugin; `package.json` doesn't have the package. `expo config`/`prebuild`/`eas build` will fail. The
missing `scheme` compounds it for expo-router deep links. *Why high:* it's a hard blocker on the
entire Phase 4 path, and it's a five-minute fix that will otherwise be discovered at the worst
moment.

**H5. No observability.** One `log.Printf` at startup. No connect/disconnect/error/room-count
logging. When a rider reports "I vanished from the map halfway up the climb", there is no data to
distinguish GPS loss, wake-lock refusal, socket drop, dropped frames, or ghost-rider confusion.

**H6. No panic recovery, no graceful shutdown, no server timeouts.** `http.ListenAndServe` with no
`http.Server` struct means no `ReadHeaderTimeout`/`IdleTimeout`. A panic in any handler goroutine
kills the process, and because all state is in-memory, every in-progress ride is destroyed with it.

## 🟡 Medium

**M1. Geolocation errors are invisible.** `useGeo.ts:35` logs to console and stops. A denied
permission leaves "Waiting for a GPS fix… (allow location access)" on screen indefinitely, with no
way to know whether the browser refused, the device has no fix, or the socket is down.

**M2. Wake-lock status is invisible.** `useWakeLock.ts:18` swallows refusals. A rider whose lock was
denied (low battery) will have their screen sleep and silently disappear from the group.

**M3. No ride persistence and no URL routing.** Reload ⇒ lobby. The ride code never enters the URL,
so there is no shareable join link — a real friction point for the actual use case. It also makes
`net/identity.ts`'s sessionStorage rationale ("survives a page reload mid-ride") currently
unrealized.

**M4. `math/rand` for join codes and rider ids.** `hub.go:101,108` — predictable. The 32⁶ ≈ 1.07 B
code space is fine against blind guessing, but combined with C3 (no code validation) it hardly
matters today; it does matter the moment codes become meaningful.

**M5. No route line rendering and no route-setting UI on the web.** Even with the backend endpoint
built, Phase 2 isn't visible without a GeoJSON source + `LineLayer` in `Map.tsx` and some way to
choose a destination.

**M6. No follow-camera.** One `easeTo` at first fix (`Map.tsx:76`) and never again. Ride 2 km and
you're off-screen with no recentre button.

**M7. Duplicated protocol definitions.** `web/src/types.ts` and
`backend/internal/hub/room.go`+`client.go` define the same wire format independently, and `mobile/`
will make it three. There is no shared schema and no test asserting they agree — drift will be
silent (`heading` already demonstrates it).

**M8. Ranking logic sits in `room.broadcast()`, not `standings`.** The sort and `pos` assignment
(`room.go:104-111`) are domain logic embedded in transport code, which is also why they can't be
unit-tested without a `Room`.

**M9. `heading` and `ts` are dead protocol fields.** Both are defined, transmitted, parsed — and
discarded. Either use them or remove them; as-is they mislead every future reader.

**M10. Web has no linter and no formatter config.** No ESLint, no Prettier. `CLAUDE.md:76` mandates
`go fmt` + `go vet` for Go but nothing for TypeScript.

## 🟢 Low

| ID | Item |
|---|---|
| L1 | `Hub.mu` is an `RWMutex` used only via `Lock()` — misleading. |
| L2 | `web/tsconfig.app.tsbuildinfo` and `tsconfig.node.tsbuildinfo` are **tracked in git** (both appear in the `fix: ghost users` commit stat) and aren't in `web/.gitignore`. Pure diff noise. |
| L3 | `useRideSocket`'s effect depends on `[name]`, so a future "change name" feature would silently reconnect the socket. |
| L4 | Reconnect backoff has no jitter — all riders retry in lockstep after a server restart. |
| L5 | Read deadline isn't refreshed by data frames, only by pongs (`client.go:48`) — a chatty client with lost pongs still dies at 60 s. |
| L6 | Join validation accepts ≥4 chars (`App.tsx:32`) while codes are exactly 6 — a typo silently creates a new empty room instead of erroring. |
| L7 | Unchecked `w.Write` / `json.Encode` errors (`main.go:18,44`). |
| L8 | `devOptions.enabled: true` for the service worker in dev invites stale-cache confusion. |
| L9 | The 512 px icon serves as both `any` and `maskable`, but `gen-icons.mjs:33-46` draws to 87 % of the canvas — outside the maskable safe zone, so Android will crop it. |
| L10 | Marker updates teleport rather than interpolate — visible 4 Hz jitter. |
| L11 | `SETUP_BACKEND.md` and `SETUP_MOBILE.md` embed full copies of source files; they have already drifted (`SETUP_BACKEND.md:308-313` describes the rejoin TODO differently from `room.go:58-69`). |
| L12 | Setup docs reference `C:\Data\Projects\Horizon` while the repo lives at `E:\Project Horizon\Horizon`. |
| L13 | Mobile template cruft (`explore.tsx`, `web-badge`, `animated-icon`, `hint-row`, `reset-project.js`, tutorial images) will need deleting. |
| L14 | `broadcast()` marshals and sends `{"riders":[]}` to nobody 4×/sec for every empty room. |

---

# 8. Architecture Risks

## Memory

| ID | Sev | Risk |
|---|---|---|
| R-M1 | High | Unbounded `h.rooms` growth — no GC, no eviction, no TTL. Every code ever connected to holds a `Room`, a goroutine stack, a ticker, and a map. Monotonic for the process's lifetime. |
| R-M2 | Medium | Ghost clients hold their `Client` struct, 16-slot channel, connection, and two goroutine stacks for up to 60 s past a reconnect. |
| R-M3 | Medium | `Map.tsx` leaks a MapLibre marker permanently whenever two clients share an id — the `seen`-set cleanup can never collect it because the id is still present. |
| R-M4 | Low | `broadcast` allocates a fresh `[]riderState` plus a JSON buffer every 250 ms per room, forever, regardless of occupancy. GC churn proportional to rooms-ever-created. |
| R-M5 | Low | A Phase-2 route polyline is stored on the room and never freed — combined with R-M1, dead rides retain their route geometry indefinitely. |

## Concurrency

| ID | Sev | Risk |
|---|---|---|
| R-C1 | Medium | The safety of the drop-on-full send depends on `delete` preceding `close(send)` inside the *same* critical section as `broadcast`'s iteration. Correct today but **undocumented** — one careless refactor from a `send on closed channel` panic that takes down every ride. |
| R-C2 | Medium | `r.mu` guards *both* the rider set and per-`Client` mutable fields. A future contributor adding a `Client` field and guarding it with a new per-client mutex would introduce a two-lock ordering problem where none exists today. |
| R-C3 | Medium | Phase 2's route writer must take `r.mu.Lock()`. There is no setter yet and no comment stating the convention — the naive implementation (assigning `room.route` from the HTTP handler goroutine) is an unsynchronized data race against `broadcast`. |
| R-C4 | Medium | Heavy `distAlong` math runs under `RLock`, throttling `loc` ingest for the whole room. |
| R-C5 | Low | `register`/`unregister` are unbuffered; senders block on `run()`. Bounded today because `broadcast` can't block — but any future blocking operation inside `run()` stalls every connecting and disconnecting client in that room. |
| R-C6 | Low | No `-race` testing has been run (there are no tests to run it against). |

## Security

| ID | Sev | Risk |
|---|---|---|
| R-S1 | High | `CheckOrigin` returns `true` for every request (`hub.go:25`) — classic cross-site WebSocket hijacking. Any page in a rider's browser can open a socket, join any ride, and read live locations of real people. |
| R-S2 | High | **No authentication or authorization of any kind.** The join code is a bearer token, and it isn't even checked — arbitrary strings are accepted. `?name=` and `?rider=` are unverified client assertions, so anyone can impersonate any rider id. |
| R-S3 | High | **`ws://` and `http://` in dev — location data in plaintext** over what will often be a coffee-shop network. `SYSTEM_DESIGN.md:366` mandates `wss://` in production; nothing enforces it, and `net/config.ts:15` will happily use `ws://` if the page is served over HTTP. |
| R-S4 | High | Live location is the most sensitive data class in the app (`SYSTEM_DESIGN.md:72`) and it is broadcast to everyone in a room with no consent gate, no per-rider visibility control, and no way to go temporarily invisible. |
| R-S5 | Medium | `math/rand` join codes are predictable given knowledge of the seeding, and the code space is enumerable at ~1 B with **no rate limiting**. |
| R-S6 | Medium | No input bounds on `?name=` server-side. Harmless with React's escaping today; a future non-React renderer or log-injection path changes that. |
| R-S7 | Medium | Phase 3's LiveKit token endpoint will mint room-join JWTs based purely on a claimed rider id and an unvalidated ride code — it inherits every weakness above, but now with a *cryptographically signed* credential to an external service. |
| R-S8 | Low | No secret is currently in the repo, and `.gitignore` correctly excludes `.env`/`.env.*` while keeping `.env.example`. The convention is sound; the risk is only that Phase 2/3 is where it first gets tested. |

## Scalability

| ID | Sev | Risk |
|---|---|---|
| R-Sc1 | High (accepted) | Single process, in-memory state, no horizontal path. Documented as the deliberate v1 choice with Redis Pub/Sub as the escape hatch (`SYSTEM_DESIGN.md:318`). |
| R-Sc2 | High | Process restart destroys all rides. Riders' positions repopulate within seconds; **a route does not** — it's server-only state that no client re-POSTs. |
| R-Sc3 | High | `distAlong` at O(riders × segments × 4 Hz) is the first genuine CPU wall. |
| R-Sc4 | Medium | No caps anywhere: no max riders per room, no max rooms, no max connections, no message-rate limit. A client can send `loc` in a tight loop and each one takes the room-wide write lock. |
| R-Sc5 | Medium | Every client gets a byte-identical `state`. Fine at 15; there's no viewport culling or delta encoding if that assumption ever changes. |
| R-Sc6 | Low | OpenFreeMap and ORS are donation-funded community services. ORS has a hard daily cap per key — mitigated by the once-per-ride fetch rule (`CLAUDE.md:126`), which is not yet enforced by any code. |
| R-Sc7 | Low | No CDN or caching in front of tiles; every rider pulls from OpenFreeMap directly. |

## Maintainability

| ID | Sev | Risk |
|---|---|---|
| R-Mt1 | High | Three independent copies of the wire protocol (Go structs, `web/src/types.ts`, future mobile) with no shared schema and no conformance test. `heading` already drifted. |
| R-Mt2 | High | No tests at all. Every change is verified by running the app by hand. |
| R-Mt3 | Medium | Setup docs duplicate full source files verbatim and have already drifted from the code (`SETUP_BACKEND.md:308` vs `room.go:58`). Every backend edit needs a doc edit or the docs actively mislead. |
| R-Mt4 | Medium | The web client's actual structure (`net/`, `location/`, `map/`, `store/`) differs from the `features/`-based layout prescribed for mobile in both `SYSTEM_DESIGN.md:144` and `SETUP_MOBILE.md:344`. Unresolved, this yields two conventions in one repo. |
| R-Mt5 | Medium | No ESLint/Prettier for TypeScript; no CI to enforce `go vet`, `tsc -b`, or formatting. |
| R-Mt6 | Low | Domain logic (ranking) embedded in transport code (`broadcast`). |
| R-Mt7 | Low | Committed `.tsbuildinfo` files add diff noise to every build. |

## Networking

| ID | Sev | Risk |
|---|---|---|
| R-N1 | High | No CORS ⇒ ride creation is broken from the browser in every split-origin configuration (C1). |
| R-N2 | Medium | Reconnect backoff without jitter — synchronized retry storms after a server restart. |
| R-N3 | Medium | Fixes generated while the socket is down are silently discarded (`ws.ts:70`) — no queue, no replay, no user-visible indication that data is being lost. |
| R-N4 | Medium | Read deadline is refreshed only by pongs, not by data. |
| R-N5 | Medium | Corporate/hotel proxies and captive portals often break long-lived WebSockets; there is no fallback transport (no SSE, no long-poll) and no diagnostic to distinguish "blocked" from "server down". |
| R-N6 | Low | Drop-on-full is invisible to both ends — a rider on a bad link degrades silently with no metric. |
| R-N7 | Low | No compression negotiated on the WebSocket; `state` payloads are small enough that it doesn't matter yet. |

## Battery

| ID | Sev | Risk |
|---|---|---|
| R-B1 | High | The PWA's core mechanism is *screen-on + continuous high-accuracy GPS*, which `SYSTEM_DESIGN.md:330` names as a known heavy drain. A long ride on a mounted phone will need external power. |
| R-B2 | Medium | `enableHighAccuracy: true, maximumAge: 0` (`useGeo.ts:36`) is the most expensive possible geolocation configuration, applied unconditionally. `maximumAge: 0` forbids reusing even a 200 ms-old cached fix. |
| R-B3 | Medium | No adaptive rate. `SYSTEM_DESIGN.md:330` explicitly recommends lowering the GPS rate when stationary and dimming the map when idle; neither is implemented. A rider stopped at a café burns full-rate GPS. |
| R-B4 | Medium | The client throttles in JS *after* the OS has already delivered the fix — the expensive part already happened. Native `timeInterval`/`distanceInterval` (mobile path) pushes throttling into the OS, which is strictly better. |
| R-B5 | Medium | Four re-renders per second of the React tree plus four marker `setLngLat` calls (each triggering MapLibre repaints) is continuous GPU/CPU work, even when nobody is moving. |
| R-B6 | Low | Phase 3 adds continuous WebRTC audio on top of all of the above. |

## GPS

| ID | Sev | Risk |
|---|---|---|
| R-G1 | High | **Foreground-only, by design.** Browsers suspend `geolocation` when the tab is hidden or the screen locks. The wake lock is the *entire* mitigation, and it can be silently refused (R-G2). Pocketed riding simply does not work — which is precisely why `mobile/` exists. |
| R-G2 | High | Silent wake-lock failure ⇒ screen sleeps ⇒ GPS stops ⇒ the rider becomes stale and then vanishes, with no warning to them or anyone else. |
| R-G3 | Medium | **No accuracy field anywhere.** `GeolocationCoordinates.accuracy` is available and discarded; the protocol has no slot for it. A ±500 m urban-canyon fix is rendered with the same confidence as a ±3 m one, and — critically — feeds the standings projection as if it were exact. |
| R-G4 | Medium | No outlier rejection or smoothing. A single wild fix teleports a dot across the map and, post-Phase-2, can reorder the entire standings. |
| R-G5 | Medium | Nearest-segment projection is non-monotonic on loops and out-and-backs — a rider on the return leg can snap to the outbound leg and appear to lose kilometres (`standings.go:50`). |
| R-G6 | Medium | No off-route detection, despite `bestDist` being computed and thrown away. A rider who takes a wrong turn keeps a confident, meaningless `distAlong`. |
| R-G7 | Medium | `heading ?? 0` and `speed ?? 0` conflate "unavailable" with "north" and "stopped". Many devices report `null` speed/heading when stationary or when derived from Wi-Fi positioning. |
| R-G8 | Low | No standings hysteresis — GPS jitter makes 1st/2nd flicker at 4 Hz between closely-matched riders. |
| R-G9 | Low | The first fix can take 15 s (the configured `timeout`); until then the rider isn't broadcast at all (`room.go:91`) and sees only "Waiting for a GPS fix…". |
| R-G10 | Low | Indoor/tunnel drift is not filtered; a stationary rider's dot will wander visibly. |

---

# 9. File Ownership

## `backend/`

**Why it exists.** The one component that is genuinely this project's own work: the realtime
location fan-out, the race-position math, and the server-side custody of secrets.
`SYSTEM_DESIGN.md:129` scopes it precisely — "Go = backend brain".

**Code goes here when:** it must be authoritative (rankings, timestamps, group membership), it must
be shared across all clients, or it touches a secret (`ORS_API_KEY`, `LIVEKIT_API_SECRET`). Also
anything client-agnostic, since the same server serves both PWA and native.

**Code does NOT go here when:** it's UI, rendering, or presentation (`CLAUDE.md:130` — "Don't write
the app UI in Go"); it's per-client preference; or it introduces a database, Redis, or auth
(`CLAUDE.md:127` — the documented scaling path, not v1). Third-party dependencies need a strong
justification: the whole backend has exactly one.

## `backend/internal/hub/`

**Why it exists.** Everything that knows what a *connection* is: the HTTP→WS upgrade, the room
registry, the per-socket pumps, and the broadcast scheduler. `internal/` enforces that no external
module can import it.

**Code goes here when:** it concerns connection lifecycle, room membership, the wire protocol's
framing, or the broadcast tick. The Phase-2 route *setter* belongs here (on `Room`), because room
state is this package's property.

**Code does NOT go here when:** it's pure computation with no connection context — that's
`standings/`. Nor HTTP route *registration* (that's `main.go`), nor outbound calls to ORS/LiveKit
(those want their own packages so they can be tested and stubbed without a socket).

## `backend/internal/standings/`

**Why it exists.** To keep the "who's 1st" algorithm (`SYSTEM_DESIGN.md §7`) as pure,
dependency-free, testable geometry — one place, per `CLAUDE.md:113`.

**Code goes here when:** it's a mathematical function of coordinates and routes: distance,
projection, cumulative-length precomputation, the windowed/monotonic refinement, off-route
thresholds, position smoothing. If it can be expressed as `func(inputs) outputs` with no clock, no
network, and no lock, it belongs here.

**Code does NOT go here when:** it needs a `Room`, a `Client`, a mutex, or wall-clock time. Note the
current `sort` + `pos` assignment in `room.go:104-111` is a boundary violation in the other
direction — ranking is domain logic that would be better (and testable) here.

## `backend/main.go`

**Why it exists.** The composition root: read env, build the mux, start the server.

**Code goes here when:** it's route registration, process configuration, or top-level middleware
(CORS, recovery, logging, timeouts all belong here).

**Code does NOT go here when:** it's business logic. Handler *bodies* beyond two lines should move
into a package — the current `POST /rides` inline closure is already at the limit, and the
route/voice handlers will be far past it.

## `web/`

**Why it exists.** The v1 client (`SYSTEM_DESIGN.md:26`). PWA-first because riders mount the phone
screen-on, so a wake lock covers the use case and the one thing a browser can't do — background
location — never bites. Bought at the price of foreground-only tracking, in exchange for no
dev-client builds and one shareable URL.

**Code goes here when:** it's browser-specific rendering, interaction, or a browser API binding.

**Code does NOT go here when:** it's authoritative shared state (belongs on the server), it holds a
secret, or it duplicates something the server can compute once for everyone. `CLAUDE.md:113` is
explicit: **standings do not get reimplemented client-side.**

## `web/src/net/`

**Why it exists.** All server communication and identity in one place, so the transport can change
without touching UI.

**Code goes here when:** it's WebSocket lifecycle, REST calls, endpoint configuration, or rider
identity. The Phase-2 `setRoute()` and Phase-3 `voiceToken()` calls go in `api.ts`.

**Code does NOT go here when:** it renders anything, or it's domain state — that's `store/`. `net/`
should push into the store and never own state itself.

## `web/src/store/`

**Why it exists.** The single client-side source of truth (`SETUP_WEB.md:131`). Map and standings
are both pure views of `riders`; neither owns data.

**Code goes here when:** state is read by more than one component or written from outside React (the
WS callbacks). Phase 2's route and Phase 3's voice state belong here.

**Code does NOT go here when:** it's genuinely local (`Lobby`'s `busy`/`joinCode`/`error` are
correctly `useState`), or it's a derived value that could be computed in a selector.

## `web/src/location/`

**Why it exists.** To isolate the two browser APIs that have no native equivalent and that will be
*replaced wholesale* — not ported — in the mobile app. Keeping them behind hooks makes that swap a
one-file change per concern.

**Code goes here when:** it wraps a device-sensor or power-management API: geolocation, wake lock,
and (should it arrive) orientation, motion, or battery status.

**Code does NOT go here when:** it decides *what to do* with a fix. `useGeo` deliberately takes an
`onFix` callback and knows nothing about WebSockets; keep that inversion.

## `web/src/map/`

**Why it exists.** To quarantine MapLibre's imperative, non-React model behind one component — and
to be the **single site of the `lat/lng` → `[lng,lat]` conversion** that `CLAUDE.md:110` names "a
known trap".

**Code goes here when:** it touches the MapLibre instance: sources, layers, markers, camera. The
Phase-2 route line goes here.

**Code does NOT go here when:** it's non-map UI (the standings list is correctly in `Ride.tsx`), or
it's a coordinate conversion for a non-map purpose. **Any `[lng, lat]` literal appearing outside
this directory is a bug.**

## `web/scripts/`

**Why it exists.** Build-time generation so the repo carries zero binary assets — `gen-icons.mjs`
rasterizes the PWA icons from code using only Node built-ins.

**Code goes here when:** it runs at build time via an npm lifecycle hook and produces gitignored
output.

**Code does NOT go here when:** it ships to the browser, or it needs a dependency (these scripts are
deliberately built on `node:` built-ins only).

## `web/public/`

**Why it exists.** Static assets copied verbatim to the site root. Currently holds only
`favicon.svg`; the three PNG icons are generated and gitignored.

**Code goes here when:** it must be fetched by exact URL and not processed by Vite.

**Code does NOT go here when:** it could be imported and fingerprinted by the bundler — put it in
`src/assets/` instead. Never generated output that's already gitignored, and never anything secret
(`public/` is world-readable by definition).

## `mobile/`

**Why it exists.** For exactly one capability: **true background location**
(`SYSTEM_DESIGN.md:26`, `SETUP_WEB.md:174`). Pocketed, screen-off tracking is impossible in a
browser at any price, and no service-worker trick changes that. Everything else in this directory is
a re-implementation of code that already works in `web/`.

**Code goes here when:** it requires a native module (MapLibre RN, LiveKit RN, WebRTC), an OS
permission flow (iOS "Always", Android foreground service), or a background task. Also when it's the
RN equivalent of a working web module — but only during the actual port.

**Code does NOT go here when:** it duplicates protocol truth (share `types.ts`, don't fork it), it
re-implements standings (`CLAUDE.md:113`), or it's an experiment better run in the faster PWA loop.
Adding a **native** dependency here forces a dev-client rebuild (`CLAUDE.md:115`) — treat native
deps as expensive and JS deps as cheap. Per `mobile/AGENTS.md`, check the versioned Expo v56 docs
before writing anything here; the SDK has changed.

## `mobile/src/app/`

**Why it exists.** expo-router file-based routes — file path *is* URL path.

**Code goes here when:** the file is a screen or a layout.

**Code does NOT go here when:** it's a shared component, hook, or service. Everything currently in
this directory is template scaffolding to be deleted.

## Root documentation

| File | Purpose | Changes when |
|---|---|---|
| `SYSTEM_DESIGN.md` | Source of truth for *why*: decisions, trade-offs, alternatives rejected, scaling path | A decision changes. **Not** a place for setup steps or code. |
| `CLAUDE.md` | Enforceable working rules: protocol contract, hard constraints, conventions, Do/Don't | A *rule* changes. Keep it short enough to actually be read. |
| `README.md` | Entry point: what this is, repo layout, quickstart order, phase status | Phase status or layout changes. |
| `SETUP_*.md` | Step-by-step checkpointed setup guides | Setup steps change. These currently embed full source listings, which is why they've drifted (`SETUP_BACKEND.md:308` vs `room.go:58`) — they should trend toward *pointing at* files rather than *copying* them. |
| `ARCHITECTURE_REVIEW.md` | This document: the system *as built*, with debt, risks, and sequencing | A review is re-run. Subordinate to `SYSTEM_DESIGN.md` on intent. |

---

# 10. Recommended Development Order

The governing principle is `CLAUDE.md:53`: **"Prefer completing the current phase over adding
later-phase features."** Phases 0 and 1 are marked ✅ in the README — but three defects mean the
"core pipe" is not actually solid, and every later phase compounds on top of it. So the order below
closes Phase 1 for real before opening Phase 2.

## Stage 0 — Unbreak what claims to work

*Hours, not days. These are prerequisites, not improvements.*

**1. CORS on the backend.**
Add an `Access-Control-Allow-Origin` middleware in `main.go` (with an `OPTIONS` handler for the
preflighted requests Phase 2/3 will need, since those send `Content-Type: application/json`). *Or*
add `server.proxy` in `vite.config.ts` — but the middleware is the right fix, because the mobile app
and any non-same-origin deployment need it too. **Without this, "Start a ride" does not work.**
*First, because every subsequent manual test goes through this button.*

**2. Implement `TODO(rejoin)`** (`room.go:58`).
Under the existing `Lock`: scan `r.rider` for a client with the same `id`, `delete` it,
`close(old.send)`, and carry `lat/lng/speed/lastSeen` across so the dot unfreezes rather than
vanishing. The comment already specifies all three steps.
*Second, because it corrupts standings, React keys, and marker cleanup simultaneously, and every
later feature inherits the corruption.*

**3. Room GC + join-code registry.**
Have `CreateRide` record the code; reject `/ws` for unknown codes; shut down a room's goroutine and
remove it from `h.rooms` when the last rider leaves (watch the race: a rider may join between the
emptiness check and the delete — do it under `h.mu` with a re-check). Fixes the leak and the DoS
surface in one change.
*Third, because it's the same edit surface as #2 and cheapest to do while that code is in hand.*

**4. Fix the mobile config drift.**
`npx expo install expo-location expo-task-manager`; add `scheme`, `version`, `icon`, `splash` to
`app.config.ts`. Five minutes, unblocks all of Phase 4, and prevents discovering it under pressure
later.
*Do it now precisely because it's not urgent yet.*

**5. Basic server observability.**
Log connect/disconnect (with ride, id, name), room create/destroy, and dropped frames.
*Before Phase 2, because you cannot debug standings on a moving bike without it.*

## Stage 1 — Make the foundation testable and shippable

**6. Go tests for `standings`.**
Known-answer haversine cases, projection onto a segment (including the `t` clamp at both ends),
`DistAlongRoute` on a straight line, an L-bend, and — as a documented failing/skipped case — an
out-and-back. This is ~100 lines and is the single highest-value test in the project, because Phase
2's correctness is otherwise unverifiable by eye.
*Before writing the route endpoint, so the endpoint has something to validate against.*

**7. Deploy it: Koyeb + Cloudflare Tunnel, `wss://`, real `CheckOrigin`.**
The plan is already written (`SETUP_BACKEND.md:678`).
*This must come before Phase 2, not after, for a non-obvious reason:* geolocation, wake lock, PWA
install, **and WebRTC all require a secure context**. Until the app is on HTTPS you cannot do a
genuine two-phone road test, which means every feature after this point would be validated only in
two browser tabs on a desk. Do it while the surface area is small.

**8. A real two-phone ride.**
Take the current build outside and ride with it.
*This is a development step, not a QA step.* It will produce a priority list (GPS accuracy in
traffic, wake-lock behaviour on your actual phones, tunnel reconnection, battery over an hour) that
no amount of desk reasoning will. Everything downstream should be prioritized against what this
reveals.

**9. Ride persistence + shareable URL.**
Put the code in the URL (`pushState` or a hash), persist `code`/`name` in sessionStorage, rehydrate
on load.
*Placed here because #8 will make its absence painful:* if the browser reloads mid-ride you're
ejected to the lobby, and sharing a ride currently means reading six characters aloud.

**10. Failure-state UX.**
Surface geolocation-permission denial and wake-lock refusal in the UI.
*Same rationale — these are silent today, and #8 is exactly where silent failures cost you a ride.*

## Stage 2 — Phase 2: Route + standings

**11. `POST /rides/{code}/route`** — ORS cycling proxy, `ORS_API_KEY` from env, decode the geometry
to `[]standings.Pt`, store on the room **under `r.mu.Lock()`**. Return the polyline to the client as
`[lng,lat]` so MapLibre can consume it directly (`SETUP_MOBILE.md:305`). Enforce once-per-ride to
protect the quota.

**12. Precompute cumulative segment lengths** when the route is set, and rework `DistAlongRoute` to
use them. *Do this in the same change as #11, not after.* It removes two of three haversines per
segment, and retrofitting it later means re-validating standings twice.

**13. Move the `distAlong` computation out of `r.mu.RLock()`** — snapshot the positions under the
lock, compute after releasing it. *Also same change, same reason: it's a one-line restructure now
and a subtle regression risk later.*

**14. Web: route line layer + route fetch + a minimal destination picker.** GeoJSON source +
`LineLayer` in `Map.tsx` (the `[lng,lat]` boundary stays there); `setRoute()` in `net/api.ts`; a
long-press or a pasted-coords input to set the destination. Keep the picker deliberately crude —
`SETUP_WEB.md:159` is right that a friend group can paste coordinates at first.

**15. Windowed/monotonic projection + off-route detection.** Add `lastDistAlong` to `Client`,
constrain the segment search to a window around it, and expose the already-computed `bestDist` as an
off-route signal. *After #14, because you need a route rendered on screen to see that the fix is
working.*

**16. Standings hysteresis.** Require a margin (or a sustained lead) before swapping positions, so
GPS jitter doesn't flicker 1st/2nd at 4 Hz. *Last in this stage, because you can't tune the
threshold until you've watched real standings on a real ride.*

## Stage 3 — Phase 3: Voice

**17. `POST /rides/{code}/voice-token`** — LiveKit Go SDK, room name = ride code, identity = rider
id, short TTL, `{token, url}` response.

**18. Web voice + PTT** — `npm install livekit-client`, connect with `audio: false`, mic on press /
off release. Mind the iOS gotcha (`SETUP_WEB.md:170`): audio must be started from a user gesture, so
gate it behind an explicit "Join voice" tap.

**19. Battery measurement with voice on.** GPS + screen + WebRTC together is the real load; measure
before tuning.

*Voice is deliberately after route/standings: it's the only feature fully independent of the
location pipe, so it's the safest thing to defer, and it's the one that most benefits from the
deployment and HTTPS work already being done.*

## Stage 4 — Phase 4: Native app

**20. Port the shared core to `mobile/`** in dependency order: types → store → socket →
config/identity (AsyncStorage) → location → map → standings UI. Resolve the `features/` vs
flat-directory question first (R-Mt4) — recommend copying `web/`'s flat structure, since it's
proven.

**21. Background location** — `TaskManager` + `startLocationUpdatesAsync` + foreground-service
notification. **Solve the hard problem explicitly:** the background task runs in a separate JS
context and cannot reuse the React-owned WebSocket. Decide up front whether the socket moves outside
React or fixes are queued and handed off.

**22. Native voice** — `registerGlobals()`, `AudioSession`, `LiveKitRoom` + PTT.

**23. Battery tuning** — adaptive GPS rate when stationary, map dimming when idle
(`SYSTEM_DESIGN.md:330`).

## Deferred indefinitely (correctly)

Auth, database, Redis, self-hosted tiles/ORS/LiveKit — all documented as the `SYSTEM_DESIGN.md §9`
scaling path and explicitly forbidden in v1 by `CLAUDE.md:127`. Do not pull these forward.

## The two ordering choices worth defending

- **Deployment (#7) before Phase 2, not after.** It's tempting to build features first and deploy once. But HTTPS is a hard prerequisite for geolocation, wake lock, PWA install, *and* WebRTC — so until it's done, every feature is validated in a configuration that doesn't match reality. Deploying while the surface is three endpoints is far cheaper than deploying after Phase 3.
- **Stage 0 before everything.** Items 1–3 are each individually small, and each individually invalidates testing of everything built on top. The CORS bug makes the main entry point unusable; the ghost bug corrupts the exact data structure Phase 2 sorts; the room leak makes long-running behaviour unrepresentative. Closing them first means every later measurement is trustworthy.

---

# 11. Closing Observations

**The design documentation is unusually strong, and that creates a specific hazard.**
`SYSTEM_DESIGN.md` and `CLAUDE.md` describe the intended system with real precision — including
trade-offs, alternatives rejected, and known sharp edges. The code follows them faithfully where it
exists. But the docs describe the *target*, and in three places they describe as done what is in
fact scaffolded: the rejoin policy, the standings, and the mobile app. `README.md:58-60` marks
Phases 0 and 1 ✅, and the most recent commit is titled `fix: ghost users` — yet the ghost fix's
server half is an unimplemented TODO. A reader who trusts the docs will build on a foundation that
isn't there. The good news is that every one of these gaps is *marked in the code* by a `TODO`
written by someone who clearly understood exactly what was left undone.

**The single most valuable next action is Stage 0 #1 (CORS)** — not because it's the deepest
problem, but because it silently breaks the primary entry point while presenting itself as "the
backend isn't running," and it hides behind the fact that the *join* path works. Everything else in
Stage 0 is a known-and-marked TODO; this one is unmarked and actively misleading.
