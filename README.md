# Horizon 🚴

Live group-tracking + voice for bike rides. Everyone sees everyone else on a shared map,
talks over push-to-talk, and gets a race-style "who's 1st" indicator.

- **Client (v1):** installable **PWA** — Vite + React + TypeScript (`web/`)
- **Native path (later):** React Native / Expo (`mobile/`) — only needed for true background GPS
- **Voice:** live push-to-talk (LiveKit)
- **Backend:** Go realtime server (WebSockets)
- **Maps:** MapLibre + OpenFreeMap tiles (**no API key, no card**)
- **Directions:** OpenRouteService (free key, no card)

> Full design rationale lives in [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md) — including why the
> v1 client is a PWA, not the native app (§1 "Client decision"). Read that first.
> **No credit card is required to build or run this project.**

---

## Repo structure

```
horizon/
├── README.md                # you are here
├── CLAUDE.md                # working rules for this repo (protocol contract, conventions)
├── SYSTEM_DESIGN.md         # architecture, tech stack, design choices
├── SETUP_BACKEND.md         # Go server setup
├── SETUP_WEB.md             # PWA setup — the v1 client
├── SETUP_MOBILE.md          # Expo app setup — the future native path (Phase 4)
├── backend/                 # Go realtime server (WS hub, standings; route/voice stubbed)
├── web/                     # installable PWA (Vite + React + TS)
└── mobile/                  # React Native (Expo) — default template scaffold for now
```

---

## Quickstart

Set the repo up in this order. Each step is self-contained.

1. **Backend** — get the Go WebSocket server running locally.
   → follow [`SETUP_BACKEND.md`](./SETUP_BACKEND.md)
2. **Web (PWA)** — the v1 client; point it at your local server.
   → follow [`SETUP_WEB.md`](./SETUP_WEB.md)
3. **Accounts you'll need for Phases 2–3 (all free, none need a card):**
   - [OpenRouteService](https://openrouteservice.org/dev/#/signup) — free API key for cycling directions (Phase 2)
   - [LiveKit Cloud](https://cloud.livekit.io) — API key + secret + project URL (Phase 3)
   - Map tiles: **OpenFreeMap** — nothing to sign up for, just a style URL

The Expo app ([`SETUP_MOBILE.md`](./SETUP_MOBILE.md)) is deliberately later — build it when
Phase 4 (background GPS with the screen off) becomes real.

---

## Build order

| Phase | Goal | Status |
|-------|------|--------|
| 0 | Map shows your own moving dot; server echoes WS messages. | ✅ (web) |
| 1 | Two phones see each other live. **(the whole product in miniature)** | ✅ (web) |
| 2 | Route + 1st/2nd/3rd standings. | backend stubbed (`501`) |
| 3 | Push-to-talk voice. | backend stubbed (`501`) |
| 4 | Background location (native app), reconnect hardening, battery. | — |

---

## Tech at a glance

| Concern | v1 (PWA, `web/`) | Native path (`mobile/`, later) |
|---------|------------------|--------------------------------|
| App | Vite + React + TypeScript | React Native (Expo dev client), TypeScript |
| Map renderer | `maplibre-gl` (MapLibre GL JS) | `@maplibre/maplibre-react-native` |
| Map tiles | OpenFreeMap style URL, no key | same |
| Directions | OpenRouteService, proxied via backend | same |
| Location | `navigator.geolocation` + `navigator.wakeLock` | `expo-location` (+ `expo-task-manager`) |
| Realtime client | built-in global `WebSocket` (no package) | same |
| Voice | `livekit-client` + LiveKit Cloud | `@livekit/react-native` + LiveKit Cloud |
| State | zustand | zustand |
| Realtime server | Go + `github.com/gorilla/websocket` | same (client-agnostic) |
