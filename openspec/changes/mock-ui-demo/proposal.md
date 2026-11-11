# Proposal: Mock UI Demo

## What

A standalone web application that demonstrates all three Horizon registers (Departure, Motion, Return) and the Planner screen with realistic mock data, rendered at mobile phone dimensions (375x812 or similar) in a desktop browser. The demo uses static HTML/CSS/JavaScript with no backend connection, no Supabase authentication, no LiveKit voice, and no real GPS tracking. It is a visual showcase, not a functional prototype.

## Why

Horizon's mobile app is code-complete (Phases 0-4) but has never been run on a real device. Stakeholders need to see what the app can do before committing to device testing, real-world validation, and further development. A web-based mock is the fastest path to a visual demo that can be shown in browsers, recorded for presentations, or embedded in documentation.

The real app requires:
- Supabase project with signing keys
- Android device with dev-client rebuild
- Go backend server running
- LiveKit credentials
- OpenRouteService API key

None of this exists in a demo-ready state. A mock UI bypasses all infrastructure dependencies while preserving the product's visual identity and interaction patterns.

## Scope

### Included
- All four existing screens: Departure, Motion, Planner, Return (list + detail)
- Realistic mock data: rider names, ride codes, waypoints, ETA, speed, distance, route placeholders
- Navigation between screens (clickable buttons, links)
- Dark theme with exact transcribed values from `mobile/src/design/tokens.ts` (the authoritative source per DESIGN.md 7)
- Typography: Inter for operational text (Departure, Motion, Planner), Newsreader serif for reflective text (Return only) -- loaded from Google Fonts (SIL OFL)
- Mobile dimensions: phone frame or viewport-sized container (375x812 or similar)
- Static map placeholder or abstract route visualization (no real tiles)
- Convoy dots visualization on the map (3 mock riders as dots, no panel)
- Multi-stop route preview in Planner with route summary lines
- Ride history list with year dividers and ride detail with RideFacts

### Excluded
- Real location tracking or GPS
- Real WebSocket connections to the Go backend
- Real LiveKit voice/push-to-talk
- Real Supabase authentication or session management
- Real map tiles from OpenFreeMap
- Real route calculations from OpenRouteService
- Real ride data or history
- Backend integration of any kind
- Mobile-native gestures (swipe, pinch) - click/tap only
- Animations beyond basic CSS transitions

## Technical Approach

A single-page web app (vanilla HTML/CSS/JS) that:
- Renders at mobile dimensions in a desktop browser (phone frame or responsive viewport)
- Uses CSS for dark theme, typography, spacing -- all values transcribed from `mobile/src/design/tokens.ts`
- Loads Inter + Newsreader from Google Fonts as web equivalents of the native fonts
- Stores mock data as JavaScript constants
- Uses state-based screen switching (no build step required)
- Requires no backend (can be opened as static files or served locally)
- Lives OUTSIDE `mobile/` so the mobile workspace's Expo constraints don't apply

## Fidelity to the real app

The mock replicates the real screens' structure rather than inventing parallel UI:
- **Horizon Line bands** (Ahead 0-34%, Now 34-58%, Held 58-100%) structure the Motion screen
- **AheadCue card**, **SpeedReadout**, **EndRide stationary gate**, **Push-to-talk hairline** are all present in Motion
- **Year dividers** in Return list, **RideFacts** in Return detail
- **Route summary format** ("32 min . 18 km . via NH 44") and selectable alternatives list in Planner
- Mock-only affordances (on-screen Back links, the always-visible EndRide pill bypassing the 5-second stationary gate) are explicitly marked in the spec as demo simplifications

## Success Criteria

A stakeholder can open the demo in a browser, navigate through all four screens, and understand:
1. What Horizon does (navigation + convoy + ride planning + memories)
2. How the three registers feel different (calm -> invisible -> reflective)
3. What the visual identity is (dark, premium, restrained, amber accents)
4. What the interaction patterns are (start/join flows, route planning, ride history)

The demo should feel like a real product, not a wireframe or prototype.
