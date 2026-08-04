# Backend setup — Go realtime server (WebSocket hub)

> Goal: a single Go binary that holds one WebSocket per rider, groups them into rooms by join
> code, and broadcasts everyone's combined position back to the room ~4×/sec. This is the
> **spine** of Horizon — everything else (route, voice) is a view on this pipe.
>
> **This server owns ephemeral realtime only** — live positions, LiveKit tokens, and the ORS
> route proxy. Durable state (auth, ride history, journal, photos) belongs to Supabase, not this
> server — see `docs/ADR/ADR-008.md` for the split.
>
> **Scope of this guide:** `GET /healthz`, `POST /rides` (reserve a join code), `GET /ws` (the
> location in/out pipe), and `POST /rides/{code}/route` (the ORS proxy — fetches a route and
> broadcasts a `route` message to everyone in the room, `docs/ADR/ADR-011.md`). The voice-token
> endpoint is still a `501 Not Implemented` stub you fill in Phase 3.
>
> No paid accounts, no credit card. The only secrets (LiveKit, ORS) come later and live **only**
> here on the backend, never in the app.

---

## How to use this guide

Run commands from the **repo root** (`C:\Data\Projects\Horizon`) unless a step says otherwise.
Commands are PowerShell (your shell). Each numbered step ends with a ✅ checkpoint — don't move
on until it passes.

**Naming note:** this file is `docs/SETUP_BACKEND.md` (referenced by `CLAUDE.md` and `README.md`).
If you prefer `go-setup.md`, just rename it — nothing depends on the filename.

---

## 0. Go

If Go isn't installed (no account, no card):

```powershell
winget install GoLang.Go
```

Close and reopen PowerShell so `PATH` picks it up, then:

```powershell
go version
```

`backend/go.mod` declares `go 1.26.4`, so that is the floor. (Go 1.22 is the older floor you'll
see referenced elsewhere — it's when `net/http` gained method routing, which this server uses.)

**One optional extra:** `go test -race` needs cgo, which on Windows needs a C compiler Go does not
ship. Without one, `-race` fails with `cgo: C compiler "gcc" not found` while plain `go test`
works fine. This matters because the hub is concurrent code and the race detector is the only
thing that meaningfully checks it:

```powershell
winget install BrechtSanders.WinLibs.POSIX.UCRT
# then, in a fresh shell:
$env:CGO_ENABLED = 1
go test -race ./...
```

✅ **Checkpoint:** `go version` prints `go1.26`+.

---

## 1. The module

Already created — `backend/go.mod` exists. You do not need to `go mod init` anything:

```powershell
Set-Location backend
go mod download
```

> One dependency, deliberately: `github.com/gorilla/websocket`. Everything else is standard
> library ([`ADR-001`](./ADR/ADR-001.md)). The module path is just an import prefix — it doesn't
> need to resolve over the internet.

✅ **Checkpoint:** `backend\go.mod` lists `github.com/gorilla/websocket` under `require`, and
`go build ./...` succeeds.

---

## 2. The connection — `backend/internal/hub/client.go`

One `Client` per WebSocket. The **read pump** parses `loc` messages and stamps the rider's
last-seen with the **server's** receive time (don't trust the phone's clock for staleness). The
**write pump** drains a buffered `send` channel and keeps the socket alive with pings.

The implementation is `backend/internal/hub/client.go` — read it there. What follows is why it
looks the way it does.

The wire shape of what a rider sends, unchanged since Phase 0:

```go
type locMsg struct {
	Type    string  `json:"type"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Heading float64 `json:"heading"`
	Speed   float64 `json:"speed"`
	Ts      int64   `json:"ts"`
}
```

The `writeWait`/`pongWait`/`pingPeriod`/`maxMessageSize` reasoning is covered together with the
`http.Server` timeouts they complement — see *Server timeouts* under §5.

---

## 3. The room — `backend/internal/hub/room.go`

One `Room` per join code. Since `docs/ADR/ADR-010.md`, a `Room` is plain data — no goroutine and
no `register`/`unregister` channels of its own; a single sweep goroutine on the `Hub` (§4) owns
every room's rider set instead. What hasn't changed: state still **broadcasts on a fixed ~4 Hz
tick** rather than on every incoming `loc` (decouples fan-out from ingest —
`docs/SYSTEM_DESIGN.md §8`).

The implementation is `backend/internal/hub/room.go` — read it there, alongside
`backend/internal/hub/hub.go` (§4), which now owns the sweep that calls into it. What follows is
why it looks the way it does.

The wire shape of what the room sends back, unchanged since Phase 0:

```go
type riderState struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Lat    float64 `json:"lat"`
	Lng    float64 `json:"lng"`
	Speed  float64 `json:"speed"`
	AgeSec int     `json:"ageSec"` // seconds since this rider's last fix (server clock)
}

type stateMsg struct {
	Type   string       `json:"type"`
	Ride   string       `json:"ride"`
	Riders []riderState `json:"riders"`
}
```

Building that `riders` slice on every tick makes three deliberate choices:

- A rider with a zero `lastSeen` — hasn't sent a fix yet — is skipped, so nobody's dot is drawn at
  `(0, 0)`.
- The slice is sorted by id before marshaling, purely so the client's list doesn't jitter between
  frames. That is **not** a ranking — Horizon does not rank riders (`docs/ADR/ADR-009.md`,
  "No Gamification" in `docs/PRODUCT.md`).
- Sending to a client's `send` channel is non-blocking: if that client's 16-slot buffer is full,
  this frame is dropped for them rather than stalling the whole room on one slow socket.

---

## 4. The hub — `backend/internal/hub/hub.go`

Owns the room map and upgrades incoming `/ws` requests. Each new client is greeted with a
one-time `welcome` message carrying its id (so it can pick its own dot out of `state`), and
may present a stable `?rider=` id so a reconnect replaces its old connection. A missing
`?ride=` is still **400**; an unminted, expired, or otherwise unknown code is now rejected with
**404 `unknown ride code`** before the upgrade (`docs/ADR/ADR-010.md`).

The implementation is `backend/internal/hub/hub.go` — read it there. What follows is why it looks
the way it does.

`docs/ADR/ADR-010.md` covers the concurrency model in full: one `sync.Mutex` on the `Hub` guards
every room's rider map *and* every client's latest fix — there is exactly one lock in
`internal/hub` now, not one per room plus a second one inside it — and a single sweep goroutine,
started once when the process boots, replaces every per-room goroutine:

```go
const (
	broadcastInterval = 250 * time.Millisecond // ~4 Hz

	// roomGrace is how long an empty room survives before sweep collects it — long
	// enough that a convoy losing signal in a tunnel doesn't lose the room.
	roomGrace = 5 * time.Minute
)
```

On each tick, `sweep` broadcasts to every non-empty room exactly as the old per-room `run` loop
did, then deletes any room that's been empty for `roomGrace` — including a code nobody ever
joined, since a freshly created room is empty from the start.

> Codes and rider ids come from `crypto/rand`, not `math/rand`. `CreateRide` reserves the code by
> creating its (empty) room under the hub lock before returning it, so `POST /rides` is no longer
> decorative — a client can only join a code that was actually minted, and `POST /rides` returns
> **503** on the (statistically tiny) chance the 6-character space is exhausted. A code stops
> working 5 minutes after its room empties — including a code nobody ever joined — because the
> room is garbage-collected and the code goes with it (`docs/ADR/ADR-010.md`). These codes are
> still a bearer token, not an auth boundary: anyone holding one can join.

---

## 5. Wiring it up — `backend/main.go`

Assembles the hub, the middleware chain (below), and the routes into one `http.Server`, and owns
process lifecycle: startup, structured logging, and graceful shutdown on `SIGINT`/`SIGTERM`. The
implementation is `backend/main.go` — read it there. What follows is why it looks the way it does.

### The middleware chain

`srv.Handler` is the wrapped chain, **not** the bare `mux`. `buildHandler` assembles it:

```
Recover → Log → CORS → mux
```

One concern per file, all in `backend/internal/httpx/` (read them — they are short and the
reasoning is in the comments, and this guide deliberately does not copy source that can drift):

| File | What it does |
|---|---|
| `cors.go` | Browser cross-origin policy and `OPTIONS` preflights |
| `logging.go` | One structured line per request |
| `recover.go` | Turns a panic into a 500 instead of a dead process |
| `responsewriter.go` | The shared wrapper the other two need |

Why that order:

- **Recover outermost**, so a panic in *any* other middleware is caught too, not just one in a
  handler. Every ride lives in memory, so a process death ends every ride in progress.
- **Log outside CORS**, so preflights appear in the log. CORS answers those itself and the mux
  never sees them, so logging inside CORS would make a failing preflight invisible — exactly the
  failure you would be trying to diagnose.
- **CORS wrapping the whole mux**, so `/ws` and every route added later inherit the policy.

A per-IP rate limiter, when it lands, goes *inside* CORS so a preflight is never rate-limited.

#### The one that will bite you: `http.Hijacker`

`gorilla/websocket` reaches the raw connection with a **direct** `w.(http.Hijacker)` type
assertion (`server.go:175` in v1.5.3) — not `http.ResponseController`, and not `Unwrap()`.

Request logging needs the status code, which means wrapping `http.ResponseWriter`. A wrapper that
does not itself implement `Hijack()` therefore fails **every** WebSocket upgrade with *"response
does not implement http.Hijacker"* — and it fails silently in the sense that every HTTP-level test
still passes. `responseRecorder` implements `Hijack()` (and `Flush()`); anything you add later
must too, and implementing only `Unwrap()` is not enough.

`backend/main_test.go` guards this with a real WebSocket dial through the real chain. If you touch
`responsewriter.go`, that is the test that tells you whether you broke the app.

### The CORS wrapper

Why it matters: the native Android app sends no `Origin` header at all — CORS is a browser-enforced
mechanism, and neither RN's `WebSocket` nor `fetch` set one — so CORS never gates its requests. The
wrapper exists for browser-based tooling instead, e.g. the Expo web dev server on `:8081`, where a
JSON-bodied request to a different origin would otherwise be silently discarded by the browser.
**CORS is not the auth boundary here** — it only decides which browser pages may read a response,
never who may call the API. That boundary is the Supabase JWT check on the backend
(`docs/ADR/ADR-008.md`).

Three things the wrapper is doing, all of which are easy to get wrong:

- **It wraps the whole mux, once.** A route added later inherits the policy without anyone
  remembering to add it, and responses the mux generates itself (404, 405) still carry the headers
  a browser needs in order to *show* you the failure.
- **It answers `OPTIONS` preflights itself and returns 204.** The mux registers no `OPTIONS`
  pattern, so a preflight that reached it would get a 405 — and a 405 is a failed preflight, which
  would make every JSON-bodied endpoint (the Phase 2 route proxy, the Phase 3 voice token)
  unreachable from a browser.
- **It sets its headers before delegating.** That is what lets a 500 written by the outer recovery
  middleware still carry `Access-Control-Allow-Origin`, so a panic surfaces in the browser as a
  real 500 rather than an opaque CORS error.

A disallowed origin is not rejected server-side on ordinary requests — the request runs and the
response simply carries no `Access-Control-Allow-Origin`, which is precisely how CORS refuses.
Rejecting would stop no attacker (CORS is enforced by the *browser*, on the response) while
breaking every legitimate caller that sends no `Origin` at all: the native client, `curl`, and
platform health checks. Server-side origin enforcement belongs on the WebSocket path, in the
upgrader's `CheckOrigin` — see *What's deliberately deferred* at the end of this guide.

---

## 6. Environment template — `backend/.env.example`

Phase 0 needs none of these, but create the template now so the secret-handling convention is
in place. **Never commit a real `.env`** — only this `.env.example` with blank values.

```
# Port the server listens on (optional; defaults to 8080)
PORT=

# Browser origins allowed to call the HTTP API (CORS), comma separated. Matching is
# exact — no wildcards, and a trailing slash makes an entry that can never match.
# Leave blank in local dev: blank allows every origin and warns at startup. Set it for
# any deployment, e.g. https://horizon.example.com,http://localhost:8081
ALLOWED_ORIGINS=

# Log verbosity: debug | info | warn | error (case-insensitive). Blank means info.
# Logs are JSON on stderr. An unrecognised value is not fatal — the server starts at
# info and logs a warning saying so.
#
# WARNING: debug is the only level at which rider coordinates may be logged. Location is
# the most sensitive data this app handles — never set debug in a deployed build.
LOG_LEVEL=

# LiveKit Cloud (Phase 3 — voice). Server-side only, never in the app.
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_URL=

# OpenRouteService (Phase 2 — driving-car profile; ORS has no motorcycle profile). Server-side only.
ORS_API_KEY=

# Supabase. The Go server verifies tokens Supabase issues — it never mints identity and
# never talks to Postgres (docs/ADR/ADR-008.md). Server-side only, never in the app.
SUPABASE_URL=
SUPABASE_JWT_SECRET=
```

### `.env.example` is documentation, not a loader

Copying this file to `.env` and filling in values is the usual workflow for a project like this
one — and it **does not work here**. Grep `backend/*.go` for `godotenv` or `dotenv` and you'll
find nothing: the server reads real environment variables through `os.Getenv` only (`backend/main.go`)
— no `.env` file is ever opened. That's deliberate, not an oversight: one stdlib call needs no new
dependency, consistent with this repo's stdlib-first rule (`docs/ADR/ADR-001.md`). It does mean a
`.env` sitting next to `server.exe` is completely inert — you'll get `503 route service is not
configured` from `POST /rides/{code}/route`, with nothing pointing you at why.

Set the variable in the shell that runs the server instead:

```powershell
$env:ORS_API_KEY = "your-key-here"
cd backend
go run .
```

That value lives only in **this** PowerShell session — close the window, or open a new one, and
it's gone; you set it again. In a deployment it isn't your problem at all: the platform sets it
(Koyeb's dashboard — see *Deploying* below), which is exactly why a `.env` loader was never added.
Local dev and production end up using the same mechanism, real environment variables, instead of
two different ones.

### `ALLOWED_ORIGINS`

**Purpose.** The allowlist of browser origins permitted to call the HTTP API. It is the only
input to the CORS wrapper from §5 — nothing else configures it. It does **not** yet guard the
WebSocket upgrade; that is a separate, still-open piece of work (see the deferred list below).

**Format.** A comma-separated list of origins. An origin is *scheme + host + port* and nothing
else — no path, and **no trailing slash**.

- Whitespace around entries is trimmed, and empty entries are dropped, so `a, b`, `a,b` and
  `a,,b,` all parse identically.
- **Matching is exact string equality.** Nothing is normalised. `http://localhost:8081/` has a
  trailing slash and can therefore never match; `HTTP://LocalHost:8081` differs in case and will
  not match either. Both are misconfigurations to fix, not things the server repairs for you.
- **No wildcards.** `*.horizon.app` is a literal string that will never match anything.
- **Blank means permissive** — every origin is allowed, and the server logs a warning at startup
  saying so. That is the deliberate zero-config default for local development, because the dev
  page is reachable as `localhost`, as `127.0.0.1` and as a DHCP-assigned LAN address (a phone on
  your wifi), which are three separate origins. **Set it before deploying.**

**Example.**

```
ALLOWED_ORIGINS=http://localhost:8081,https://horizon.app
```

**What you should see at startup.** Set, and the server confirms what it parsed:

```
CORS: 2 allowed origin(s): http://localhost:8081, https://horizon.app
horizon backend listening on :8080
```

Blank, and it warns instead — if you see this line on a deployed box, it is a bug to fix:

```
WARNING: ALLOWED_ORIGINS is not set — every origin is allowed. Set it to a comma-separated list of origins before deploying.
```

**Checking it by hand**, without a browser — an allowed origin gets the header echoed back:

```powershell
curl.exe -i -X POST -H "Origin: http://localhost:8081" http://localhost:8080/rides
# -> 200, Access-Control-Allow-Origin: http://localhost:8081, {"code":"9DK6PY"}
```

A preflight (what the browser sends ahead of any JSON-bodied request) gets a 204 and the policy:

```powershell
curl.exe -i -X OPTIONS -H "Origin: http://localhost:8081" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type" http://localhost:8080/rides
# -> 204, Allow-Methods: GET, POST, OPTIONS · Allow-Headers: Content-Type, Authorization · Max-Age: 600
```

An origin that is *not* on the list gets a normal response with **no** `Access-Control-Allow-Origin`
header — that absence is the refusal, and the browser is what enforces it.

### `LOG_LEVEL`

**Purpose.** Sets the verbosity of the process logger. Everything the server emits is JSON on
**stderr**, one object per line, via `log/slog` from the standard library — no logging dependency.

**Format.** One of `debug`, `info`, `warn`, `error`, case-insensitive. Blank means `info`.

An unrecognised value is **not fatal**: the server starts at `info` and logs a warning naming the
bad value. Refusing to boot over a typo in an observability setting would be a worse failure than
the typo.

**Example.**

```
LOG_LEVEL=debug
```

> ⚠️ **`debug` is the only level at which rider coordinates may be logged.** Location is the most
> sensitive data this app handles. Never set `debug` in a deployed build.

**What you get.** One line per request, from the logging middleware:

```json
{"time":"...","level":"INFO","msg":"http request","method":"POST","path":"/rides","status":200,"duration":312000,"bytes":18,"remote":"127.0.0.1:51292"}
```

Two deliberate omissions in that line:

- **No query string.** `/ws` carries `?name=` and `?rider=` — a rider's display name and their
  identity across reconnects. Only `r.URL.Path` is logged, never `RawQuery` or `RequestURI`, and
  never a request body.
- **No proxy awareness.** `remote` is the address the server sees. Behind the Cloudflare Tunnel
  that becomes the tunnel's address for every request; fixing that needs `X-Forwarded-For`
  handling, which is deliberately deferred — trusting that header without knowing the hop count
  is a spoofing vector.

`GET /healthz` logs at `debug`, not `info`. Uptime monitoring polls it on a schedule forever, and
at `info` it would out-number every line that describes an actual rider.

A WebSocket upgrade is logged as **101**, once, when the upgrade completes — not when the rider
eventually disconnects. `ServeWS` returns as soon as the pumps are running, so `duration` measures
the handshake, not the length of the ride.

### Server timeouts — and the two that are deliberately unset

`main.go` builds an `http.Server` rather than calling `http.ListenAndServe`, which sets no
timeouts at all. Only two of the four fields are set, and **the two left at zero are the decision
worth understanding**:

| Field | Value | Why |
|---|---|---|
| `ReadHeaderTimeout` | **5s** | Slow-loris defence. A client that opens a connection and dribbles headers holds a goroutine until something bounds it. Harmless to WebSockets — their headers arrive in the first packet like any other request's |
| `IdleTimeout` | **120s** | Bounds idle keep-alive connections between requests. Does not apply to a WebSocket: once gorilla hijacks the connection it leaves the server's management entirely |
| `ReadTimeout` | **0 (unset)** | See below |
| `WriteTimeout` | **0 (unset)** | See below |

**Setting `ReadTimeout` or `WriteTimeout` is the most likely way to break this server.** Both are
absolute deadlines armed when the request begins, not idle timeouts. On a WebSocket that lives for
a whole bike ride, either one kills the connection the moment it elapses — presenting as *"riders
vanish after exactly N seconds"*, which is a miserable thing to diagnose from a bicycle.

Both directions are already bounded at the right granularity, per connection, in
`internal/hub/client.go`: a 60s read deadline refreshed by every pong, and a 10s write deadline set
before each individual write. If you are hardening the server, `ReadHeaderTimeout` is the field
that buys protection without touching long-lived connections.

**Graceful shutdown.** `SIGINT`/`SIGTERM` stops the server accepting, drains in-flight requests
within 15s, and exits 0. `ListenAndServe` returns `http.ErrServerClosed` on a clean stop, which is
explicitly *not* treated as a failure — reporting it would make every clean shutdown look like a
crash to whatever supervises the process.

> Note: `srv.Shutdown` does not close hijacked connections, so live WebSockets are **not** sent a
> close frame — they are cut when the process exits. Sending close frames on shutdown would need
> the hub to enumerate and close every live connection itself, which is still unimplemented
> (`docs/ADR/ADR-010.md`). On Windows `SIGTERM` is never really delivered, so only Ctrl+C exercises
> this path locally.

---

## 7. Format, vet, build

```powershell
Set-Location backend
go fmt ./...
go vet ./...
go build -o server.exe .
Set-Location ..
```

✅ **Checkpoint:** `go vet ./...` prints nothing (clean) and `backend\server.exe` is produced.

---

## 8. Run it

```powershell
Set-Location backend
go run .
# -> horizon backend listening on :8080
```

Leave it running. In a **second** PowerShell window:

```powershell
Invoke-RestMethod http://localhost:8080/healthz                 # -> ok
Invoke-RestMethod -Method Post http://localhost:8080/rides      # -> code : ABC123
```

✅ **Checkpoint:** `/healthz` returns `ok` and `POST /rides` returns a JSON object with a 6-char
`code`.

---

## 9. Verify the WebSocket pipe (loc in → state out)

Node 24 ships a global `WebSocket`, so no install needed. Create `backend\wstest.mjs`:

```js
// Phase 0 smoke test: open the WS, send one loc, expect a `welcome` then a `state`
// broadcast echoing our fix. Delete or keep as a smoke test.
const ws = new WebSocket("ws://localhost:8080/ws?ride=TEST01&name=tester");
let gotWelcome = false;
let gotState = false;
ws.onopen = () => {
  console.log("connected");
  ws.send(JSON.stringify({ type: "loc", lat: 12.9716, lng: 77.5946, heading: 45, speed: 6.2, ts: Math.floor(Date.now() / 1000) }));
};
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "welcome") { gotWelcome = true; console.log("welcome id:", msg.id); }
  if (msg.type === "state") { gotState = true; console.log("state:", e.data); }
};
setTimeout(() => {
  console.log(gotWelcome && gotState ? "PASS: welcome + state received" : `FAIL: welcome=${gotWelcome} state=${gotState}`);
  process.exit(gotWelcome && gotState ? 0 : 1);
}, 1500);
```

Run it (server still running in the other window):

```powershell
node backend\wstest.mjs
```

✅ **Checkpoint:** a `welcome id: …` line immediately, then within ~250 ms a line like:
`state: {"type":"state","ride":"TEST01","riders":[{"id":"...","name":"tester","lat":12.9716,"lng":77.5946,"speed":6.2,"ageSec":0}]}`
and finally `PASS: welcome + state received`.

That's the whole spine working: a `loc` went up, the hub stamped and stored it, and the tick
broadcast the combined `state` back — plus the one-time `welcome` that tells a client which
rider it is.

---

## 10. Connecting from the mobile app

The app keeps this address in one place: `BASE_URL` in `mobile/src/core/config.ts`. The WebSocket
URL derives from it (`http` → `ws`, `https` → `wss`), so there is only ever one value to change.

- **Android emulator** — `http://10.0.2.2:8080`. The emulator cannot reach `localhost`; `10.0.2.2`
  is how it addresses the host machine. This is the file's default.
- **Physical device** — your computer's LAN IP, e.g. `http://192.168.1.20:8080`. Both `localhost`
  and `10.0.2.2` fail on real hardware.
- **Deployed** — the Koyeb URL (`https://…`, which derives `wss://`).

`docs/SETUP.md` covers the app side, including the fact that a `preview` build bakes this value in
at bundle time — so set it before building, not after.

---

## Deploying

Two paths, for two different needs. **Koyeb** is the real deployment — it builds
`backend/Dockerfile` from GitHub on every push and gives you a stable `https://` URL, free and
without a card. **Cloudflare Tunnel** is faster to stand up for a one-off: no build, no commit, no
Dockerfile — it just puts TLS in front of the binary you already have running locally.

### Koyeb (primary)

`backend/Dockerfile` and `backend/.dockerignore` exist for exactly this. The Dockerfile is a
multi-stage build: a `golang:1.26-alpine` stage compiles a fully static binary
(`CGO_ENABLED=0 GOOS=linux go build -trimpath ...`), and only that binary is copied into
`gcr.io/distroless/static-debian12:nonroot` — no shell, no package manager, running as uid 65532
instead of root. `.dockerignore` keeps `*_test.go`, `wstest.mjs`, and any stray `.env` out of the
build context.

Create a Koyeb app from the GitHub repo with these settings:

| Setting | Value |
|---|---|
| Source | GitHub repo |
| Builder | Dockerfile |
| Dockerfile path | `backend/Dockerfile` |
| Work directory | `backend` |
| Health check | HTTP, path `/healthz` |
| Env var | `ORS_API_KEY` (mark as **secret**) |
| Env var | `LOG_LEVEL=info` |
| Instance | Free |

A few things worth knowing before you click deploy:

- **Don't set `PORT`.** Koyeb injects its own; `main.go` reads it via `os.Getenv("PORT")` and only
  falls back to `8080` when it's unset. Setting it yourself just risks it disagreeing with what
  Koyeb actually forwards traffic to. `ORS_API_KEY` and `LOG_LEVEL`, by contrast, you do set — as
  real Koyeb environment variables in the dashboard, the same mechanism as the `$env:` line in §6
  above, never a `.env` file baked into the image.
- **`ALLOWED_ORIGINS` can stay unset.** There is no browser client (`docs/ADR/ADR-007.md`), so
  CORS — a browser-enforced mechanism — isn't the security boundary for this server. You'll see
  the "every origin is allowed" warning in the Koyeb logs at startup; that's the expected state
  here, not a problem to chase down.
- **The race detector cannot run in this image.** `-race` needs cgo, and the Dockerfile builds
  with `CGO_ENABLED=0` specifically so the final stage can be `distroless/static`, which has
  nothing for a dynamically-linked binary to link against. Race testing (`go test -race`) happens
  against the module in dev/CI, never against the deployed artifact.
- **Koyeb builds from GitHub, not your working tree.** Commit and push before deploying — an
  uncommitted change or an unpushed branch simply isn't there when the build runs.

### Cloudflare Tunnel (quick, no build step)

For a tabletop test — everyone in the same room, backend on your laptop, nothing pushed to
GitHub — put Cloudflare Tunnel in front of the binary you already have running:

1. Run `go run .` (or build a Linux binary for a spare machine:
   `GOOS=linux GOARCH=amd64 go build -o server .`).
2. `cloudflared tunnel --url http://localhost:8080` for TLS/`wss://` with no open inbound ports.
   Two flavours:
   - **Quick tunnel** — zero signup, no card, but the `*.trycloudflare.com` URL is random and
     changes on every restart. Fine for a friend group that re-shares a link.
   - **Named tunnel** — stable hostname, but needs a domain you own added to Cloudflare (domains
     cost ~$10/yr — the one place "no card" bends if you want a fixed URL).
3. Point the app at the tunnel's `https://` URL (`wss://` follows automatically —
   `mobile/src/core/config.ts`). `ALLOWED_ORIGINS` can stay unset here too, for the same reason as
   Koyeb above — set it only if you're also fronting some browser-based tooling through the same
   tunnel (see §5, *The CORS wrapper*).

### Security reality check

Either path above puts an **unauthenticated WebSocket server on the public internet**. Be honest
with yourself about what that means before you send the URL to anyone:

- **`/ws` has no auth.** Supabase JWT verification is designed (`docs/ADR/ADR-008.md`) but not
  implemented — anyone who reaches the URL with a valid ride code can join.
- **`upgrader.CheckOrigin` returns `true` for every request** (`backend/internal/hub/hub.go`) —
  nothing checks where a WebSocket upgrade came from.
- **There is no rate limiting**, and no cap on the number of rooms or connections.

The only real gate is the join code itself: 6 characters from a 32-character alphabet — about 1.07
billion possibilities — and a room is garbage-collected 5 minutes after it empties, including a
code nobody ever joined. That's a reasonable barrier for a handful of friends on a URL nobody else
has, and it is not an auth boundary for anything more exposed than that.

---

## Done when…

- **Phase 0:** `go run .` serves `/healthz`, `POST /rides` mints a code, and a `loc` sent to
  `/ws` comes back inside a `state` broadcast (step 9). Then the mobile app's own dot, fed
  through this server, proves the toolchain end to end (`docs/SYSTEM_DESIGN.md §11`).

### What's deliberately deferred
- **`POST /rides/{code}/route`** — ORS driving-car proxy + storing the polyline on the room (Phase 2).
- **`POST /rides/{code}/voice-token`** — LiveKit JWT minting (Phase 3).
- **`wss://` in production** — the dev server still speaks plaintext `ws://`; switching to TLS is
  a deployment step (see *Deploying*, above), not something `docs/ADR/ADR-010.md` touches.
- **Supabase JWT verification middleware** — the Go server verifies (never mints) Supabase-issued
  JWTs before trusting a caller's identity; not yet implemented (`docs/ADR/ADR-008.md`).
- **Redacting `Authorization` in the logging middleware** — once JWTs flow through `/ws`, the
  logging middleware (`internal/httpx/logging.go`) must not let a bearer token reach the log
  stream unredacted (`docs/ADR/ADR-008.md`).
- **WebSocket origin enforcement** — `upgrader.CheckOrigin` still returns `true` for every
  request. The CORS wrapper in §5 covers the *HTTP* API only; CORS does not apply to a WebSocket
  handshake, so `ALLOWED_ORIGINS` currently has no effect on `/ws`. Wiring the same allowlist into
  `CheckOrigin` is its own task, and it must land before the server is publicly reachable.
- **Panic recovery for the hub's goroutines** — `Recover` covers the HTTP handler chain only. The
  sweep goroutine, `readPump`, and `writePump` run outside it, and an unrecovered panic in *any*
  goroutine still terminates the process (`docs/ADR/ADR-010.md`).
- **Hub-level shutdown** — see the graceful-shutdown note under §5 on close frames.
- **Hub lifecycle logging** — connect, disconnect, room create/destroy, dropped frame, malformed
  message and unknown ride code are not logged yet. The request log covers the HTTP edge; nothing
  inside `internal/hub` emits anything.
