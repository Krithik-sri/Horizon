# Capability: demo-showcase

## Purpose

Enables a stakeholder, collaborator, or rider to observe the full Horizon product story — from pre-ride preparation through active navigation to post-ride reflection — in a single, self-contained, zero-setup demonstration artifact. The demo showcases the three registers (Departure, Motion, Return) and the multi-stop Planner with design fidelity, using only hardcoded data and no real functionality.

---

## ADDED requirements

### Requirement: Mobile-Dimension Presentation

The demo renders inside a phone-sized viewport so it looks and feels like the native app. An observer viewing the demo sees a mobile interface, not a desktop web page.

#### Scenario: Phone frame rendering

- [ ] The demo displays a centered viewport with dimensions 390×844 pixels (or the nearest available size that preserves mobile aspect ratio on smaller screens).
- [ ] The viewport is visually framed as a phone: rounded corners, status bar area at top, home indicator at bottom.
- [ ] The rest of the browser window outside the phone frame is neutral (dark grey or black) and does not distract from the demo.
- [ ] On screens smaller than 390×844, the viewport scales down proportionally while preserving aspect ratio (no horizontal scroll, no content cutoff).

#### Scenario: Viewport isolation

- [ ] All demo content is contained within the phone frame. No content spills outside the frame.
- [ ] The demo does not use browser scrollbars, browser navigation, or browser UI elements as part of the experience.
- [ ] The demo is self-contained: no external links, no "open in new tab" prompts, no browser chrome interactions required.

---

### Requirement: Departure Register Demonstration

The demo showcases the Departure register as the "Am I ready to ride?" home screen. It demonstrates ride creation, ride joining via join code, and the convoy roster.

#### Scenario: Home screen loads with readiness framing

- [ ] The Departure screen loads as the initial screen when the demo opens.
- [ ] The screen displays a clear readiness prompt or framing (e.g., "Ready to ride?" or equivalent).
- [ ] The screen uses the Departure register design: `surface.base` background (`#0A0A0B`), Inter (operational voice) typography, 44px minimum touch targets, `space.5` (24px) screen padding.
- [ ] The screen displays the Horizon brand or title in a calm, confident manner (not loud, not gamified).

#### Scenario: Create ride action

- [ ] The Departure screen includes a visible "Create ride" or equivalent action.
- [ ] Activating the action transitions to the Planner screen (or a pre-Planner state) with a sample route pre-populated.
- [ ] The transition uses a 220ms or shorter animation (per `duration.base`).

#### Scenario: Join ride with code

- [ ] The Departure screen includes a visible "Join ride" or equivalent action.
- [ ] Activating the action displays a join code input or a pre-filled sample join code (e.g., "ABC123").
- [ ] Entering or accepting the code transitions to the Motion screen with a sample convoy pre-populated.
- [ ] The join code is displayed in tabular-nums or monospace for clarity.

#### Scenario: Convoy roster displayed

- [ ] The Departure screen displays a convoy roster section showing 3–4 sample riders by name.
- [ ] Each rider entry shows a name and a readiness indicator (e.g., "Ready" in `signal.good` green, or "Not ready" in `ink.secondary`).
- [ ] The roster is visually grouped and uses `surface.raised` (`#141416`) for card backgrounds if cards are used.
- [ ] No rider is displayed with a badge, count, streak, XP, level, or ranking.

---

### Requirement: Planner Demonstration

The demo showcases the Planner as a multi-stop route planning screen. It demonstrates a route preview line, multiple stops, and alternative route options.

#### Scenario: Multi-stop route display

- [ ] The Planner screen displays a route with at least 3 stops (origin, one intermediate, destination).
- [ ] Each stop is labeled with a name (e.g., "Home", "Coffee stop", "Overlook").
- [ ] The stops are displayed in order (origin → intermediate → destination) with clear visual hierarchy.
- [ ] The total route distance and estimated duration are displayed (e.g., "182 km · 2h 40m").

#### Scenario: Route preview line visible

- [ ] The Planner screen displays a route preview line (polyline) on a map-like surface.
- [ ] The map surface is a static SVG or image (not MapLibre, not a real map tile service).
- [ ] The route line is rendered in a visible color (e.g., amber `#E8A33D` or white) against a dark background.
- [ ] The route line connects the stops visually.

#### Scenario: Alternative routes shown

- [ ] The Planner screen displays at least one alternative route option (e.g., "Route A" and "Route B").
- [ ] Each alternative shows a distance and duration comparison (e.g., "Route A: 182 km · 2h 40m", "Route B: 195 km · 2h 55m").
- [ ] The selected route is visually distinguished (e.g., solid line, amber accent) from the alternative (e.g., dashed line, `ink.tertiary`).
- [ ] The alternative is labeled as "pre-commit preview" or equivalent to indicate it is not yet committed to the convoy.
- [ ] Activating a "Select" or equivalent action on an alternative updates the selected route visually.

---

### Requirement: Motion Register Demonstration

The demo showcases the Motion register as the strictest register: almost invisible, only essential information, operational voice only. It demonstrates route line, own position, convoy dots (including a stale rider), ambient maneuver cue, ETA, and voice affordance.

#### Scenario: Route line rendered on map

- [ ] The Motion screen displays a route line (polyline) on a map-like surface.
- [ ] The map surface is a static SVG or image (not MapLibre, not a real map tile service).
- [ ] The route line is rendered in a visible color (e.g., amber `#E8A33D` or white) against a dark background (`surface.void` `#000000`).
- [ ] The route line occupies the upper portion of the screen (the "Ahead" zone, 0–34% of safe-area height).

#### Scenario: Own position displayed

- [ ] The Motion screen displays a marker or indicator for the rider's own position on the route line.
- [ ] The position indicator is visually distinct (e.g., larger dot, amber accent, or pulsing ring).
- [ ] The position indicator moves along the route line during scripted playback (if playback mode is active).

#### Scenario: Convoy dots visible

- [ ] The Motion screen displays 3–4 convoy rider dots on or near the route line.
- [ ] Each dot is labeled with the rider's name (or initials if space is constrained).
- [ ] The dots are ordered along the route (not ranked, just positioned).
- [ ] At least one rider is displayed as "stale" (greyed out) to demonstrate the `ageSec` greying behavior (rider's last fix > 10 seconds ago).
- [ ] The stale rider's dot uses `ink.tertiary` (`#6B6A67`) or a desaturated color to indicate staleness.
- [ ] No rider dot is displayed with a badge, count, streak, XP, level, or ranking.

#### Scenario: Maneuver cue ambient

- [ ] The Motion screen displays an upcoming maneuver cue (e.g., "Turn right onto NH 44 in 420 m").
- [ ] The cue is displayed in the "Ahead" zone (upper portion of screen).
- [ ] The cue uses Inter (operational voice) typography, uppercase labels, tabular-nums for distance.
- [ ] The cue is ambient: it does not interrupt, does not flash, does not demand attention.
- [ ] The cue updates during scripted playback (if playback mode is active) to show the next maneuver.

#### Scenario: ETA displayed

- [ ] The Motion screen displays an ETA (e.g., "ETA 14:32" or "28 min remaining").
- [ ] The ETA is displayed in the "Now" zone (middle portion of screen, 34–58% of safe-area height).
- [ ] The ETA uses Inter (operational voice) typography, tabular-nums for time.
- [ ] The ETA updates during scripted playback (if playback mode is active).

#### Scenario: Voice affordance present

- [ ] The Motion screen displays a push-to-talk voice affordance (e.g., a microphone icon or "Hold to talk" button).
- [ ] The affordance is visually present but not active (no audio is played, no LiveKit connection is made).
- [ ] The affordance is positioned in the "Now" or "Held" zone (middle or lower portion of screen).
- [ ] The affordance uses 56×56px minimum touch target (Motion register requirement).

#### Scenario: Operational voice only (no serif)

- [ ] The Motion screen uses Inter (operational voice) for **all** text: labels, values, cues, ETA, rider names.
- [ ] No serif font (Newsreader or any other serif) appears anywhere on the Motion screen.
- [ ] No reflective voice typography is present in Motion.

#### Scenario: Held zone collapsed

- [ ] The Motion screen does not display a "Held" zone (the lower portion of the screen, 58–100% of safe-area height, is empty or contains only the voice affordance).
- [ ] No photos, no journal entries, no stats, no messages, no deferred content appears on the Motion screen.
- [ ] The Motion screen contains only essential information: route, position, convoy, cue, ETA, voice affordance.

#### Scenario: Motion register design tokens

- [ ] The Motion screen uses `surface.void` (`#000000`) background.
- [ ] The Motion screen uses 7:1 minimum contrast for all text (no `ink.tertiary` in Motion).
- [ ] The Motion screen uses `space.6` (32px) screen padding.
- [ ] The Motion screen uses 56×56px minimum touch targets.
- [ ] All animations on the Motion screen are 120ms or shorter (`duration.quick`).

---

### Requirement: Return Register Demonstration

The demo showcases the Return register as the reflective archive: ride history, photos, journal (in serif voice), stats, and map replay. It demonstrates the emotional transition from Motion's minimalism to Return's reflection.

#### Scenario: Ride history list

- [ ] The Return screen displays a list of past rides (at least 2–3 sample rides).
- [ ] Each ride entry shows a date, route name or summary, distance, and duration (e.g., "Oct 12 · Coastal ride · 182 km · 2h 40m").
- [ ] The ride list uses Inter (operational voice) for stats and captions.
- [ ] Activating a ride entry transitions to a ride detail view.

#### Scenario: Photos displayed

- [ ] The ride detail view displays 2–3 sample photos from the ride.
- [ ] Photos are displayed in a grid or carousel layout.
- [ ] Photos are static images (not fetched from a server; embedded as base64 or SVG placeholders).
- [ ] Photos are displayed with generous spacing (`space.4` or `space.5` between items).

#### Scenario: Journal in serif voice

- [ ] The ride detail view displays a journal entry or narrative summary.
- [ ] The journal text uses Newsreader (reflective voice, serif) typography.
- [ ] The journal text uses `reflective.body` size (19px / 30px line-height) or equivalent.
- [ ] The journal text is written in a reflective, narrative tone (not operational, not gamified).
- [ ] The journal section is visually separated from stats and photos (e.g., by `space.7` or `space.8` spacing).

#### Scenario: Stats displayed

- [ ] The ride detail view displays ride stats: distance, duration, average speed, elevation gain (or equivalent).
- [ ] Stats use Inter (operational voice) typography with tabular-nums.
- [ ] Stats are displayed in a grid or list layout with clear labels and values.
- [ ] Stats do not include badges, streaks, XP, levels, or rankings.

#### Scenario: Map replay

- [ ] The ride detail view displays a map replay of the ride route.
- [ ] The map is a static SVG or image (not MapLibre, not a real map tile service).
- [ ] The route line is rendered on the map (same style as Planner/Motion).
- [ ] Optionally, a "Replay" button or animation shows the rider's position moving along the route (if implemented, animation is 380ms or shorter per `duration.considered`).

#### Scenario: Return register design tokens

- [ ] The Return screen uses `surface.base` (`#0A0A0B`) background.
- [ ] The Return screen uses 4.5:1 minimum contrast for body text.
- [ ] The Return screen uses `space.5` (24px) screen padding.
- [ ] The Return screen uses 44×44px minimum touch targets.
- [ ] The Return screen allows up to 380ms animations (`duration.considered`) for transitions.

---

### Requirement: Register Fidelity

The demo maintains strict fidelity to Horizon's three registers. Each register behaves according to its design rules. No gamification appears anywhere. Serif is absent in Motion.

#### Scenario: No gamification anywhere

- [ ] No screen displays badges, streaks, XP, levels, achievements, leaderboards, rankings, or notification counts.
- [ ] No screen uses gamified language (e.g., "You earned a badge!", "Level up!", "Streak: 5 days").
- [ ] No screen displays artificial rewards or progress bars for non-essential activities.
- [ ] The demo feels calm, confident, and premium — not exciting, not competitive, not addictive.

#### Scenario: Serif absent in Motion

- [ ] The Motion screen contains zero instances of serif typography (Newsreader or any other serif font).
- [ ] All text on the Motion screen uses Inter (operational voice).
- [ ] The absence of serif in Motion is not a convention to be remembered — it is enforced by the fact that the Motion screen simply does not load or use the serif font.

#### Scenario: Three registers have distinct behavior

- [ ] Departure feels calm, confident, ready (not minimal like Motion, not reflective like Return).
- [ ] Motion feels almost invisible, minimal, essential (not busy like Departure, not reflective like Return).
- [ ] Return feels reflective, narrative, archive-like (not minimal like Motion, not preparatory like Departure).
- [ ] Each register uses its designated typography voice, spacing, contrast, and animation rules.
- [ ] Transitions between registers use `duration.considered` (380ms) or shorter.

---

### Requirement: Fully Static Operation

The demo operates fully statically. No network calls, no backend, no API keys, no billing. It works offline.

#### Scenario: No network calls

- [ ] The demo makes zero HTTP requests, zero WebSocket connections, zero API calls.
- [ ] The demo does not attempt to load external resources (no CDN links, no external fonts, no external images).
- [ ] All resources (HTML, CSS, JS, images, fonts) are embedded or local to the `demo/` directory.

#### Scenario: Works offline

- [ ] The demo functions identically whether the device is online or offline.
- [ ] Opening `demo/index.html` in a browser with no internet connection produces the same result as opening it with an internet connection.
- [ ] The demo does not display "offline" warnings, "no connection" messages, or retry prompts.

#### Scenario: No API keys required

- [ ] The demo does not require any API keys, secrets, or credentials to function.
- [ ] The demo does not prompt the user to enter an API key, sign in, or configure a service.
- [ ] The demo does not reference Mapbox, Google Maps, Supabase, LiveKit, ORS, or any other paid service.

---

### Requirement: Demo Ergonomics

The demo is easy to use, easy to reset, and easy to walk through. An observer can step through the full ride story or watch a scripted playback.

#### Scenario: Single entry point

- [ ] The demo has a single entry point: `demo/index.html`.
- [ ] Opening `demo/index.html` in any modern browser (Chrome, Firefox, Safari, Edge) launches the demo.
- [ ] No build step, no installation, no configuration is required.

#### Scenario: Zero setup

- [ ] The demo does not require the user to install dependencies, run a server, or configure environment variables.
- [ ] The demo does not require the user to create an account, sign in, or accept terms.
- [ ] The demo works immediately upon opening.

#### Scenario: Scriptable walkthrough

- [ ] The demo includes a "Play" or "Auto-play" button that drives the demo through the full ride story (Departure → Planner → Motion → Return) automatically.
- [ ] During auto-play, the demo transitions between screens with appropriate timing (e.g., 3–5 seconds per screen, or longer for Motion to show movement).
- [ ] During auto-play, the Motion screen shows the rider's position moving along the route, the maneuver cue updating, and the ETA counting down.
- [ ] Auto-play can be paused or stopped at any time.

#### Scenario: Reset and replay

- [ ] The demo includes a "Reset" or "Restart" button that returns the demo to the initial state (Departure screen, beginning of route).
- [ ] Resetting does not require a page reload. The reset is instantaneous or uses a 220ms transition.
- [ ] The demo can be replayed multiple times without degradation or state accumulation.

#### Scenario: Manual navigation

- [ ] The demo allows manual navigation between screens (e.g., tab bar, back buttons, or swipe gestures).
- [ ] Manual navigation does not interfere with auto-play (if auto-play is active, manual navigation pauses it).
- [ ] The demo provides clear visual affordances for navigation (e.g., tab bar icons, back arrows, or swipe indicators).

---

## Edge Cases

- **Browser zoom.** The demo does not break or become unusable if the user zooms the browser in or out. The phone frame scales proportionally.
- **Window resize.** If the browser window is resized to be smaller than the phone frame, the frame scales down proportionally (no horizontal scroll, no content cutoff).
- **Slow devices.** The demo functions on low-end devices (e.g., a 5-year-old laptop) without significant lag or jank. Animations are 380ms or shorter.
- **Touch devices.** The demo functions on touch devices (tablets, touchscreen laptops) with appropriate touch targets (44×44px minimum, 56×56px in Motion).
- **Keyboard navigation.** The demo does not require keyboard navigation, but does not break if the user tabs through elements.

---

## Error Conditions

- **Font loading failure.** If Inter or Newsreader fails to load (e.g., local font files are missing), the demo falls back to system sans-serif (Inter) and system serif (Newsreader) without breaking layout or design.
- **SVG rendering failure.** If the static map SVG fails to render (e.g., malformed SVG), the demo displays a fallback placeholder (e.g., a dark rectangle with "Map" text) without breaking layout.
- **JavaScript disabled.** If the user disables JavaScript, the demo displays a message: "This demo requires JavaScript. Please enable JavaScript in your browser settings."
