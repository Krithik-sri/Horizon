# Horizon 🏍️

A premium native companion for motorcycle riders. It navigates, keeps a convoy together, and
covers everything else that happens between departure and arrival: it stays quiet while you
ride, shows only what's essential, and gives the rest back to you when you stop. See
[`docs/PRODUCT.md`](./docs/PRODUCT.md) for the full vision.

- **App:** React Native + Expo (dev client), TypeScript — Android first, iOS later (`mobile/`)
- **Voice:** live group push-to-talk (LiveKit)
- **Backend:** Go realtime server (WebSockets) + Supabase for durable state
- **Maps:** MapLibre + OpenFreeMap tiles (**no API key, no card**)
- **Directions:** OpenRouteService (free key, no card)

> Full design rationale lives in [`docs/SYSTEM_DESIGN.md`](./docs/SYSTEM_DESIGN.md). Read that first.
> **No credit card is required to build or run this project.**

---

## The three registers

Every screen belongs to one of three states of mind, not just a page: **Departure** (calm,
confident, ready — "am I ready to ride?"), **Motion** (the app goes almost invisible — only
essential information, all attention on the road), and **Return** (reflective — photos,
journal, stats, everything deferred during the ride becomes available). See
[`docs/PRODUCT.md`](./docs/PRODUCT.md) and [`docs/DESIGN.md`](./docs/DESIGN.md).

---

## Repo structure

```
horizon/
├── README.md                # you are here
├── CLAUDE.md                # working rules for this repo (protocol contract, conventions)
├── docs/                    # every other document lives here
│   ├── PRODUCT.md               # product vision — the source of truth
│   ├── SYSTEM_DESIGN.md         # architecture, tech stack, design choices
│   ├── DESIGN.md                # design system — tokens, type, color, motion
│   ├── SETUP.md                  # Expo app setup
│   ├── SETUP_BACKEND.md         # Go server setup
│   └── ADR/                     # architecture decision records
├── backend/                 # Go realtime server (WS hub, ORS route + geocode proxy, LiveKit tokens, JWT auth)
└── mobile/                  # React Native (Expo) app — Android first, iOS later
```

---

## Documentation map

Each document answers exactly one question. Everything except this file and `CLAUDE.md`
lives in [`docs/`](./docs/) — see [`docs/README.md`](./docs/README.md) for the folder index.

| Question | Document |
|----------|----------|
| What are the hard rules? | [`CLAUDE.md`](./CLAUDE.md) |
| What is Horizon, and why? | [`docs/PRODUCT.md`](./docs/PRODUCT.md) |
| Why is the architecture like this? | [`docs/SYSTEM_DESIGN.md`](./docs/SYSTEM_DESIGN.md) · [`docs/ADR/`](./docs/ADR/) |
| What do things look like — colors, type, motion? | [`docs/DESIGN.md`](./docs/DESIGN.md) |
| How do I set up and run the app? | [`docs/SETUP.md`](./docs/SETUP.md) |
| How do I set up and run the backend? | [`docs/SETUP_BACKEND.md`](./docs/SETUP_BACKEND.md) |

**New contributors start with [`docs/PRODUCT.md`](./docs/PRODUCT.md)** — it outranks every technical doc here.

---

## Quickstart

Set the repo up in this order. Each step is self-contained.

1. **Backend** — get the Go WebSocket server running locally.
   → follow [`docs/SETUP_BACKEND.md`](./docs/SETUP_BACKEND.md)
2. **App** — the Expo dev client, pointed at your local server.
   → follow [`docs/SETUP.md`](./docs/SETUP.md)
3. **Free accounts you'll need right now** (none require a card):
   - [OpenRouteService](https://openrouteservice.org/dev/#/signup) — free API key for directions.
     Uses the `driving-car` profile: ORS has no motorcycle profile, and this is the closest
     approximation.
   - Map tiles: **OpenFreeMap** — nothing to sign up for, just a style URL

   [LiveKit Cloud](https://cloud.livekit.io) and [Supabase](https://supabase.com) are named in the
   stack list above for later — voice is still Phase 3 and auth is deferred, so skip both accounts
   until then.

---

## First ride

Cloned the repo — here's the shortest path from that to three phones on an actual ride. Detail
lives in [`docs/SETUP.md`](./docs/SETUP.md) and [`docs/SETUP_BACKEND.md`](./docs/SETUP_BACKEND.md);
this is the order the pieces go in.

1. **Get an OpenRouteService key.** Free, email signup, no card — routing and place search both run
   through it.
2. **Create a Supabase project.** Free, email signup, no card. Two settings are not optional and
   both are easier to get right now than to diagnose later: use the **legacy HS256 JWT secret**
   rather than the asymmetric signing keys new projects now default to (`docs/ADR/ADR-017.md` §8 —
   with ES256, every token silently fails verification), and **enable anonymous sign-ins** under
   Auth → Sign In / Providers, which are off by default (`docs/ADR/ADR-016.md`). Then apply
   `supabase/migrations/`. Riders never see a sign-up screen; this is invisible to them.
3. **Run the backend and put a tunnel in front of it.** `go run .`, then
   `cloudflared tunnel --url http://localhost:8080` — no ports opened, no platform account, TLS and
   `wss://` for free (`docs/SETUP_BACKEND.md`). Use a **named** tunnel if you want a URL that
   survives a restart; step 5 explains why that matters more than it sounds. The server **will
   refuse to start without `SUPABASE_JWT_SECRET`**, on purpose: an unset auth secret must never
   quietly mean "everything is open" (`docs/ADR/ADR-017.md` §7).
4. **Point the app at it.** Edit `BASE_URL` in [`mobile/src/core/config.ts`](./mobile/src/core/config.ts)
   — your LAN IP for a tabletop test, the tunnel's `https://` URL for a real one. Everything else
   (the WebSocket URL, every HTTP call) derives from it. Set the two `EXPO_PUBLIC_SUPABASE_*` values in
   `mobile/.env` too; the anon key is deliberately public — RLS is the security boundary, not key
   secrecy.
5. **Build once, install per rider.** MapLibre, LiveKit and `expo-speech` all need native code, so
   Expo Go can't run this app — see `docs/SETUP.md`. Do this *after* step 4: `eas build --profile
   preview --platform android` bakes `config.ts`'s URL into the build at bundle time (`preview`, not
   `development` — that profile expects a live Metro server, which nobody has on a road). Changing
   the URL later means every rider needs a new install link.
6. **Ride.** One rider creates a ride and reads the 6-character code aloud; everyone else joins with
   it. Plan a route from Departure, or long-press the map mid-ride — either way it routes the whole
   convoy. Hold the bottom edge of the screen to talk.

LiveKit is optional: without `LIVEKIT_*` set, the voice endpoint answers 503 and the app renders no
push-to-talk control at all rather than a button that does nothing (`docs/ADR/ADR-020.md` §6).

---

## Build order

| Phase | Goal | Status |
|-------|------|--------|
| 0 | App shell + design tokens; own dot shows on the map. | written, never run on a device |
| 1 | Two phones see each other live. **(the whole product in miniature)** | backend verified; app written, never run |
| 2 | Route line + turn cues. | backend verified; app written, never run |
| 3 | Push-to-talk voice. | backend verified; app written, never run |
| 4 | Background location, reconnect hardening, battery. | written, never run on a device |

Beyond the original five phases, also code-complete and equally unproven: the multi-stop ride
planner, alternative routes, ETA, personal off-route rerouting, spoken guidance, Supabase anonymous
auth with JWT verification on every backend route, and the Return register (ride history, journal,
photos). Decisions are recorded in [`docs/ADR/`](./docs/ADR/) 013–021.

**Every row above says "never run on a device."** That is the honest state of this project: a lot of
code that type-checks, passes its self-checks, and has never met a motorcycle. The next task is not
another feature.
