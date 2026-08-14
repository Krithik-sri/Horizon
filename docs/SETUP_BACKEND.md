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
> endpoint (`POST /rides/{code}/voice-token`) is implemented too — it mints a LiveKit join token
> (`docs/ADR/ADR-020.md`, `docs/ADR/ADR-022.md`), not a stub.
>
> No paid accounts, no credit card. The secrets (LiveKit, ORS, and the Supabase JWT secret this
> server now refuses to boot without — `docs/ADR/ADR-017.md`) live **only** here on the backend,
> never in the app.

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

> Two direct dependencies, deliberately, and zero indirect: `github.com/gorilla/websocket` and
> `github.com/golang-jwt/jwt/v5` — the second one added by [`ADR-017`](./ADR/ADR-017.md) to verify
> Supabase JWTs, and per [`ADR-022`](./ADR/ADR-022.md) also what signs LiveKit voice tokens, so no
> third dependency was needed for that. Everything else is standard library
> ([`ADR-001`](./ADR/ADR-001.md)). The module path is just an import prefix — it doesn't need to
> resolve over the internet.

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
one-time `welcome` message carrying its id (so it can pick its own dot out of `state`). That id
is the `sub` claim of the client's verified Supabase JWT, so a reconnect replaces its old
connection and the id cannot be spoofed — the client no longer sends one
(`docs/ADR/ADR-017.md`). A missing `?ride=` is still **400**; an unminted, expired, or otherwise
unknown code is rejected with **404 `unknown ride code`** before the upgrade
(`docs/ADR/ADR-010.md`); a missing or invalid token is **401**, before that.

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
Recover → Log → CORS → Auth → mux
```

One concern per file, all in `backend/internal/httpx/` (read them — they are short and the
reasoning is in the comments, and this guide deliberately does not copy source that can drift):

| File | What it does |
|---|---|
| `cors.go` | Browser cross-origin policy and `OPTIONS` preflights |
| `logging.go` | One structured line per request |
| `recover.go` | Turns a panic into a 500 instead of a dead process |
| `responsewriter.go` | The shared wrapper the other two need |

Auth (`internal/auth.Verifier.Require`) isn't in `httpx` — verifying a Supabase JWT is a different
concern from cross-origin policy or an access log line, so it lives in its own leaf package
([`ADR-017`](./ADR/ADR-017.md)).

Why that order:

- **Recover outermost**, so a panic in *any* other middleware is caught too, not just one in a
  handler. Every ride lives in memory, so a process death ends every ride in progress.
- **Log outside CORS**, so preflights appear in the log. CORS answers those itself and the mux
  never sees them, so logging inside CORS would make a failing preflight invisible — exactly the
  failure you would be trying to diagnose.
- **CORS wrapping the whole mux**, so `/ws` and every route added later inherit the policy.
- **Auth inside CORS, wrapping the mux.** A browser preflight (`OPTIONS` carrying
  `Access-Control-Request-Method`) carries no `Authorization` header — the browser strips it — so
  Auth outside CORS would 401 every preflight; CORS answers those itself before Auth ever sees them
  ([`ADR-017`](./ADR/ADR-017.md) Decision §2). Auth wraps the whole mux for the same "route added
  later" reason CORS does.

A per-IP rate limiter, when it lands, goes *inside* CORS (alongside Auth) so a preflight is never
rate-limited.

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
```

### Copy it to `.env` — that works

```powershell
Copy-Item .env.example .env
# fill in the values, then:
go run .
```

`backend/env.go` reads `.env` from the working directory at startup, before anything calls
`os.Getenv`. You'll see it confirmed in the first log line:

```json
{"level":"INFO","msg":"loaded .env","vars":["SUPABASE_URL","ORS_API_KEY"]}
```

**Variable names only, never values** — these are secrets, and the log is the one place they must
not appear. If a variable you expected is missing from that list, it's missing from the file (or the
line is malformed and was skipped).

Three things worth knowing:

- **A real environment variable always wins.** `.env` never overwrites something already set in the
  environment, so it's a local-development convenience that cannot shadow what a deployment
  configured. Setting a value in the shell still works and still takes precedence:
  ```powershell
  $env:ORS_API_KEY = "your-key-here"   # beats whatever .env says
  ```
- **A missing `.env` is not an error.** The deployed case has no file at all — the server reads the
  environment and logs nothing about it.
- **A malformed line is skipped, not fatal.** A typo on line three costs you line three; the
  variables around it still load.

`backend/.gitignore` already excludes `.env` and everything matching `.env.*`, with `!.env.example`
negated back in — so the file you just created is not committable by accident.

**Why this exists at all**, since the format is trivial and this repo is dependency-averse: it used
to be that no `.env` was ever read, on the reasoning that `os.Getenv` needs no dependency. The
reasoning was fine; the failure mode was not. A filled-in `.env` sitting inert produced a `503 route
service is not configured` from an endpoint, with nothing connecting that symptom to the file — and
copying `.env.example` to `.env` is the first thing anyone tries. `env.go` is about thirty lines of
`strings.Cut` and adds no dependency (`go.mod` is still two direct, zero indirect), so
`docs/ADR/ADR-001.md`'s stdlib-first rule is satisfied by writing the parser rather than by refusing
the feature.

### `ALLOWED_ORIGINS`

**Purpose.** The allowlist of browser origins permitted to call the HTTP API. It is the input to
the CORS wrapper from §5, and `internal/hub.Hub.checkOrigin` reads the same parsed list to gate the
`/ws` upgrade (an empty list means allow-all there too, matching CORS's own dev default) — one
`ALLOWED_ORIGINS` value now governs both.

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

- **No query string.** `/ws` carries `?name=` — a rider's display name. Only `r.URL.Path` is
  logged, never `RawQuery` or `RequestURI`, and never a request body. Headers are not logged
  either, which is what keeps the `Authorization` bearer token out of the log
  (`docs/ADR/ADR-017.md`). Identity used to ride in `?rider=`; it is now the JWT's `sub`.
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
- **Deployed** — the Cloudflare Tunnel URL (`https://…`, which derives `wss://`).

`docs/SETUP.md` covers the app side, including the fact that a `preview` build bakes this value in
at bundle time — so set it before building, not after.

---

## Deploying

**Cloudflare Tunnel, in front of the binary you run yourself.** No build step, no commit, no
container registry, no platform account — `cloudflared` puts TLS and a public hostname in front of
`http://localhost:8080` with no inbound ports open.

1. Run `go run .` (or build a Linux binary for a spare machine that isn't your laptop:
   `GOOS=linux GOARCH=amd64 go build -o server .`).
2. `cloudflared tunnel --url http://localhost:8080`.
3. Point `mobile/src/core/config.ts` at the tunnel's `https://` URL — `wss://` derives from it.

### Pick the tunnel flavour before you build the app, not after

This is the decision that actually bites, because `eas build --profile preview` **bakes `BASE_URL`
into the bundle**. The URL is not configurable after the fact; changing it means every rider
reinstalls.

| | URL | Cost | Good for |
|---|---|---|---|
| **Quick tunnel** | random `*.trycloudflare.com`, new on every restart | free, no signup | a tabletop test where everyone reinstalls anyway |
| **Named tunnel** | stable hostname you choose | a domain you own, ~$10/yr | an actual ride |

A quick tunnel and a `preview` build are close to incompatible for real use: restart the tunnel and
every installed APK is pointing at a dead hostname. For a road test you want the named tunnel.

That domain cost is the one place `docs/ADR/ADR-006.md`'s "no card" rule genuinely bends, and it is
worth naming rather than hiding: everything else in this stack is free with an email, and this is
not. The alternative is accepting that the URL changes and rebuilding before each ride.

### Notes that apply either way

- **`ALLOWED_ORIGINS` can stay unset.** There is no browser client (`docs/ADR/ADR-007.md`), so
  CORS — a browser-enforced mechanism — isn't the security boundary here. The "every origin is
  allowed" warning at startup is the expected state, not a problem to chase.
- **`SUPABASE_URL` must be set or the process exits** (`docs/ADR/ADR-017.md` §7). Set it the
  same way as `ORS_API_KEY` — a real environment variable, never a `.env` baked into an image.
- **`PORT` defaults to 8080** and `main.go` reads `os.Getenv("PORT")` if a host injects one. Running
  it yourself, leave it alone.
- **The race detector can't run against a `distroless/static` image.** `-race` needs cgo, and
  `backend/Dockerfile` builds with `CGO_ENABLED=0` so the final stage can be static. `go test -race`
  runs against the module in dev, never the deployed artifact.

### If you later want a always-on host instead

`backend/Dockerfile` and `backend/.dockerignore` are still here and still correct — a multi-stage
build compiling a static binary into `gcr.io/distroless/static-debian12:nonroot` (no shell, no
package manager, uid 65532). Any container host that reads a Dockerfile will take it; the app is a
single stateless binary with in-memory rooms (`docs/ADR/ADR-010.md`), so nothing about it needs a
specific provider. Set `ORS_API_KEY`, `SUPABASE_URL` and the `LIVEKIT_*` vars
as environment variables there, and let the host inject `PORT`.

### Security reality check

Every route this server answers — including the `/ws` upgrade — now requires a verified Supabase
JWT (`docs/ADR/ADR-017.md`), so "unauthenticated WebSocket server on the public internet" is no
longer an honest description. Be just as honest about what auth does **not** buy you, though,
before you send the URL to anyone:

- **Anyone with a Supabase account and a valid 6-character ride code can join that room.** Auth
  proves *who* is asking, not that they were invited to *this* ride — the join code is still the
  only membership check, and Supabase's anonymous sign-in (`docs/ADR/ADR-016.md`) means "an
  account" costs a rider nothing to get. What auth actually rules out is anonymous traffic and
  rider-id spoofing, not a stranger who's been handed the code.
- **The ORS quota is still shared and still burnable.** `POST /rides/{code}/route` and
  `POST /geocode` both require a token now, but nothing throttles how many requests one valid
  account can send — auth adds identity to the quota's consumers, it doesn't ration it.
- **There is no rate limiting**, and no cap on the number of rooms or connections.
- **`upgrader.CheckOrigin`** (`backend/internal/hub/hub.go`) checks the same `ALLOWED_ORIGINS`
  allowlist CORS uses — but that allowlist is empty (allow-all) by default, which is the
  deliberate zero-config posture the `ALLOWED_ORIGINS` section above describes; set it for any
  deployment that should reject unlisted origins.

The join code itself — 6 characters from a 32-character alphabet, about 1.07 billion
possibilities, garbage-collected 5 minutes after the room empties — remains the actual membership
boundary. Auth sits on top of it; it does not replace it.

---

## Done when…

- **Phase 0:** `go run .` serves `/healthz`, `POST /rides` mints a code, and a `loc` sent to
  `/ws` comes back inside a `state` broadcast (step 9). Then the mobile app's own dot, fed
  through this server, proves the toolchain end to end (`docs/SYSTEM_DESIGN.md §11`).

### What's deliberately deferred
- **`wss://` in production** — the dev server still speaks plaintext `ws://`; switching to TLS is
  a deployment step (see *Deploying*, above), not something `docs/ADR/ADR-010.md` touches.
- **Panic recovery for the hub's goroutines** — `Recover` covers the HTTP handler chain only. The
  sweep goroutine, `readPump`, and `writePump` run outside it, and an unrecovered panic in *any*
  goroutine still terminates the process (`docs/ADR/ADR-010.md`).
- **Hub-level shutdown** — see the graceful-shutdown note under §5 on close frames.
- **Hub lifecycle logging** — connect, disconnect, room create/destroy, dropped frame, malformed
  message and unknown ride code are not logged yet. The request log covers the HTTP edge; nothing
  inside `internal/hub` emits anything.

**No longer deferred, since this section was last true:** `POST /rides/{code}/route` (ORS proxy,
Phase 2), `POST /rides/{code}/voice-token` (LiveKit JWT minting, `docs/ADR/ADR-020.md`/
`docs/ADR/ADR-022.md`), Supabase JWT verification on every route (`docs/ADR/ADR-017.md`), and
`CheckOrigin` honoring `ALLOWED_ORIGINS` are all implemented — see the *Security reality check*
above for what auth still doesn't cover. Redacting `Authorization` from the access log turned out
to need no work: `internal/httpx/logging.go` only ever logged `r.URL.Path`, never headers.
