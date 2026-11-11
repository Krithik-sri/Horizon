# Horizon — Showcase prototype

A mock-only, clickable, end-to-end prototype of Horizon with a new visual direction called
**Aurora Glass**: a near-neutral night base, colourful accents for each register, glass panels, a
halftone dot motif and smooth motion. Everything runs in the browser inside a phone frame. There is
no backend. Every state is mocked, and the only network traffic is the free OpenFreeMap map tiles,
which need no key.

> This is a design showcase, not the product. The real app is `mobile/` (React Native, Android
> first). Nothing here is wired to Supabase, LiveKit, ORS or the Go server.

## Run

```bash
cd showcase
npm install
npm run dev        # http://localhost:5180
npm run build      # typecheck + production build into dist/
```

## What to look at

- **Tour rail (left).** Jump straight to any chapter of the ride, or press **Play the full
  journey** for a scripted run through every flow: boot, departure, planning, riding and return.
- **Phone (centre).** Fully clickable. Type a name, start a ride, plan a route, ride it, end it,
  then journal it.
- **Scenario deck (right).** Force any state the real app can be in:
  - sign-in failure, location denied, ride server unreachable
  - search or route unavailable
  - off-route with a personal reroute, reconnecting or lost connection, waiting for GPS
  - stale convoy rider, co-rider talking, voice unavailable
  - save failure, empty history

  It also has the ride-sim controls: time-lapse, skip to the next turn, skip to arrival.

On narrow screens the rails turn into **Tour** and **Scenarios** pills that open as drawers. Below
600px the phone fills the screen.

## Features covered (mirrors `mobile/src`)

| Screen | Shows |
|---|---|
| Boot | Anonymous sign-in, sign-in failure with retry |
| Departure | Readiness (location, session), rider name, spoken-directions toggle, start a ride → share code → plan or start, join with a 6-character code (restricted alphabet, not-found and timeout states), past rides |
| Planner | Real map, origin states, submit-only place search, multi-stop with reorder and remove (up to 9), tap-to-drop stop, route alternatives, debounced preview, send the route to the convoy |
| Motion | Heading-up pitched map on real road geometry, ridden and ahead route, turn cue with imminent / arrived / off-route states, ETA and remaining distance, giant speed readout, convoy dots that grey out when stale, spoken-guidance captions, push-to-talk, dashed personal reroute, long-press to set destination, hold to end ride |
| Return | Ride archive with year dividers and route thumbnails, ride detail with an animated trace, facts, generated ride photos, journal editing, rename, delete with confirmation |

Still true to the product: **no gamification.** There are no badges, streaks, totals, rankings or
leaderboards. Convoy riders are always ordered by name, never by position.

## Structure

```
src/
  design/      tokens.css (colours, type, register accents), glass.css (glass, holo, halftone), global.css
  components/  ui.tsx (GlassCard, GlowButton, Toggle, Chip, Sheet, DotMeter…), fx.tsx (TurnGlyph,
               Waveform, HoldButton, CodeCells, PhotoArt, Toasts), MapView.tsx (maplibre wrapper)
  mock/        data.ts, geo.ts (real road geometry, frozen), sim.ts (4 Hz ride simulator), store.ts (zustand)
  shell/       phone frame, aurora background, screen host + transitions, tour/, scenario/
  screens/     boot, departure, planner, motion, archive, detail
```

`src/mock/geo.ts` was generated once from the public OSRM demo router, so the routes follow real
roads (Bengaluru → Nandi Hills, plus six past rides). It is now static data.
