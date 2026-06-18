# Horizon 🚴

Live group-tracking + voice for bike rides. Everyone sees everyone else on a shared map,
talks over push-to-talk, and gets a race-style "who's 1st" indicator.

- **Platforms:** iOS + Android (React Native / Expo, TypeScript)
- **Voice:** live push-to-talk (LiveKit)
- **Backend:** Go realtime server (WebSockets)
- **Maps:** MapLibre + OpenFreeMap tiles (**no API key, no card**)
- **Directions:** OpenRouteService (free key, no card)

> Full design rationale lives in [`SYSTEM_DESIGN.md`](./SYSTEM_DESIGN.md). Read that first.
> **No credit card is required to build or run this project.**

---

## Repo structure

```
horizon/
├── README.md                # you are here
├── SYSTEM_DESIGN.md         # architecture, tech stack, design choices
├── backend/                 # Go realtime server
│   └── SETUP.md             # ← see SETUP_BACKEND.md, place it here
├── mobile/                  # React Native (Expo) app
│   └── SETUP.md             # ← see SETUP_MOBILE.md, place it here
└── docs/                    # (optional) extra notes, diagrams
```

> The two setup files are provided as `SETUP_BACKEND.md` and `SETUP_MOBILE.md`.
> Drop them into `backend/SETUP.md` and `mobile/SETUP.md` respectively.

---

## Quickstart

Set the repo up in this order. Each step is self-contained.

1. **Backend** — get the Go WebSocket server running locally.
   → follow [`SETUP_BACKEND.md`](./SETUP_BACKEND.md)
2. **Mobile** — create the Expo app and point it at your local server.
   → follow [`SETUP_MOBILE.md`](./SETUP_MOBILE.md)
3. **Accounts you'll need (all free, none need a card):**
   - [LiveKit Cloud](https://cloud.livekit.io) — API key + secret + project URL (free tier)
   - [OpenRouteService](https://openrouteservice.org/dev/#/signup) — free API key for cycling directions
   - Map tiles: **OpenFreeMap** — nothing to sign up for, just a style URL

---

## Build order (don't skip ahead)

| Phase | Goal |
|-------|------|
| 0 | Map shows your own moving dot; server echoes WS messages. |
| 1 | Two phones see each other live. **(the whole product in miniature)** |
| 2 | Route + 1st/2nd/3rd standings. |
| 3 | Push-to-talk voice. |
| 4 | Background location, reconnect, battery. |

---

## Tech at a glance

| Concern | Tool | Package / service |
|---------|------|-------------------|
| App | React Native (Expo) | `expo`, TypeScript |
| Map renderer | MapLibre | `@maplibre/maplibre-react-native` |
| Map tiles | OpenFreeMap | style URL, no key |
| Directions | OpenRouteService | free API key (proxied via backend) |
| Location | Expo | `expo-location` (+ `expo-task-manager` for background) |
| Realtime | Go | `github.com/gorilla/websocket` |
| Realtime client | built-in | global `WebSocket` (no package) |
| Voice | LiveKit | `@livekit/react-native` + LiveKit Cloud |

## License

Private project — add a license before sharing publicly.
