# Proposal: mock-demo-ui

## What

A web-based, fully-scripted, mobile-framed demonstration artifact that showcases Horizon's three registers (Departure, Motion, Return) and the multi-stop Planner without any real functionality. It renders inside a phone-sized viewport (390×844) so it looks and feels like the native app. All data — route, convoy riders, ride history, photos, journal entries, stats — is hardcoded. Zero network calls, zero backend, zero setup: open a single HTML file and it works offline.

## Why

Phases 0–4 of Horizon are code-complete but have **never been run on a real device**. The product story — the three registers, the convoy experience, the reflective Return — cannot be shown to anyone until it runs end-to-end, which requires two phones, a road, and a Supabase project with signing keys configured.

The product needs a way to demonstrate the vision **now**, before any of it has been tested in the field. A scripted mock that walks through the full ride story — from "Am I ready to ride?" through Motion's strict minimalism to Return's reflective archive — lets stakeholders, riders, and collaborators see what Horizon is and why it matters without waiting for real-device validation.

## Current State

- `mobile/` contains four Expo Router screens: Departure (`index.tsx`), Motion (`ride/[code].tsx`), Planner (`plan/[code].tsx`), Return (`return/index.tsx`, `return/[id].tsx`). All are type-checked but untested.
- The Go backend in `backend/` runs the WebSocket hub, LiveKit token minting, ORS proxy, and Supabase JWT verification. It requires `SUPABASE_URL` and JWKS keys to boot.
- No real device has run any of it. The next work is "two phones and a road" — but that requires configuration, credentials, and physical presence that cannot be shared remotely.
- There is no way to show the product to someone who is not in the room with two phones.

## Desired State

- A `demo/` directory at the repo root contains a single-page web application (HTML + CSS + minimal JS, no build step, no framework).
- Opening `demo/index.html` in any browser renders a phone-framed viewport (390×844) that looks like the native app.
- An observer can navigate through all four screens (Departure → Planner → Motion → Return) using simple controls (tab bar, back buttons, or a scripted "play" mode that drives Motion along a route).
- All data is hardcoded: a sample route (polyline as SVG), a sample convoy (3–4 riders, one greyed out as stale), a sample ride history with photos and journal entries.
- The demo follows Horizon's design language exactly: dark-first matte palette, two typography voices (Inter for operational, Newsreader serif for reflective), three registers with distinct behavior, no gamification, no gradients/glows/neon.
- Motion is the strictest: operational voice only, no serif, 7:1 contrast, 120ms max animation, 56px touch targets, Held zone collapsed.
- The demo works offline. No network calls, no API keys, no billing.

## ADR-007 Justification

ADR-007 cancelled the web client and deleted `web/`. It states: **"The only client is the React Native / Expo app in `mobile/`. Android ships first, iOS later. `web/` is deleted — there is no browser client, in v1 or afterward."**

This demo does **not** reintroduce the cancelled web client. It does none of the things a real client must do:

- No background GPS. The demo has no location tracking.
- No durable history. All data is hardcoded in-memory; nothing persists.
- No realtime. No WebSocket, no convoy state, no live positions.
- No auth. No Supabase JWT, no user identity.
- No voice media. No LiveKit, no push-to-talk.
- No routing. No ORS calls, no route computation.
- No map renderer. The "map" is a static SVG or image, not MapLibre.

The demo is a **throwaway artifact** — a visual and interactive mock that exists only to demonstrate the product vision. It lives in `demo/`, not `web/` (which was deleted) and not `mobile/` (which is the real app). It is not a client. It is a presentation.

ADR-007's future revision clause states: "Revisit only if the product walks back toward a lightweight, install-free client — which would itself contradict `../PRODUCT.md`'s 'premium native companion' identity." This demo does not walk back toward a client. It is a static mock, not an install-free client. It cannot be used to ride. It cannot be installed. It cannot replace the native app. It is a demonstration of what the native app will feel like, rendered in a phone frame for observers who are not in the room with two phones.

## Scope

### In Scope

- A single-page web application in `demo/` that renders a phone-framed viewport (390×844).
- Four screens: Departure, Planner, Motion, Return.
- Navigation between screens (tab bar, back buttons, or scripted playback).
- Hardcoded sample data: route polyline (SVG), convoy riders (3–4, one stale), ride history, photos, journal entries, stats.
- Design fidelity: Horizon's design language (dark-first matte palette, two typography voices, three registers with distinct behavior, no gamification).
- Motion register strictness: operational voice only, no serif, 7:1 contrast, 120ms max animation, 56px touch targets, Held zone collapsed.
- Zero network calls. No backend, no API keys, no billing. Works offline.
- Zero setup. Open `demo/index.html` and it works.
- Demo ergonomics: ability to reset/replay the walkthrough, ability to step through screens manually or watch a scripted playback.

### Out of Scope

- Real location tracking. No GPS, no background location, no geolocation API.
- Real backend. No WebSocket, no Go server, no Supabase, no LiveKit, no ORS.
- Real auth. No Supabase JWT, no user identity, no session.
- Real voice media. No LiveKit, no push-to-talk audio.
- Real routing. No ORS calls, no route computation. The route is a static polyline.
- Real map renderer. No MapLibre. The "map" is a static SVG or image.
- Real persistence. No database, no local storage. All data is in-memory and resets on reload.
- Real notification system. No badges, no counts, no alerts.
- Real gamification. No badges, no streaks, no XP, no levels, no leaderboards, no rankings.
- A product client. This is not a client. It cannot be used to ride. It is a demonstration artifact.
- Modification of any existing docs, ADRs, or code in `mobile/` or `backend/`. This proposal touches no existing files.

## Risks and Unknowns

- **Design drift.** The demo may not perfectly match the native app's visual fidelity because it is a static mock, not a live render of the real design tokens. Mitigation: the demo uses the exact color hex values, typography families, spacing tokens, and animation durations from `docs/DESIGN.md`. It is a transcription, not an interpretation.
- **Scope creep.** Observers may request that the demo "just add" real functionality (e.g., "can it track my location?" or "can it connect to the backend?"). Mitigation: the proposal explicitly scopes out all real functionality. If a real demo is needed, the answer is "two phones and a road," not "add GPS to the mock."
- **ADR-007 misinterpretation.** Observers may assume the demo reintroduces the web client. Mitigation: this proposal explicitly justifies the demo against ADR-007 and states that it does none of the things a real client must do. The demo lives in `demo/`, not `web/`, to make the separation visible.

## Open Questions

- None. All decisions are encoded in the proposal: web-based demo, mobile dimensions, fully mocked, `demo/` directory, zero real functionality, design fidelity, zero setup.
