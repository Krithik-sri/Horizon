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
├── backend/                 # Go realtime server (WS hub + ORS route proxy; voice stubbed 501)
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
3. **Free accounts you'll need** (none require a card):
   - [OpenRouteService](https://openrouteservice.org/dev/#/signup) — free API key for cycling/motorcycle-friendly directions
   - [LiveKit Cloud](https://cloud.livekit.io) — API key + secret + project URL, free tier
   - [Supabase](https://supabase.com) — free tier, for durable state (auth, storage, ride history)
   - Map tiles: **OpenFreeMap** — nothing to sign up for, just a style URL

---

## Build order

| Phase | Goal | Status |
|-------|------|--------|
| 0 | App shell + design tokens; own dot shows on the map. | design tokens done; screens pending |
| 1 | Two phones see each other live. **(the whole product in miniature)** | backend done |
| 2 | Route line + turn cues. | backend done (ORS proxy); app pending |
| 3 | Push-to-talk voice. | backend stubbed (`501`) |
| 4 | Background location, reconnect hardening, battery. | — |
