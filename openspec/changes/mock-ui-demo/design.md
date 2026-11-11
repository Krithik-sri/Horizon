# Mock UI Demo — Design

## Overview

A standalone web demo that showcases all three Horizon registers (Departure, Motion, Return) and the Planner screen. Vanilla HTML/CSS/JS, no build step, opens as static files. Lives at `demo/` in the repo root, outside `mobile/` so Expo constraints don't apply.

## Location and File Layout

```
demo/
├── index.html          # Single HTML shell: phone frame, all screen containers (hidden/shown)
├── styles.css          # All styles, organized: tokens → base → frame → screens
├── data.js             # Mock data constants (riders, rides, waypoints, routes)
├── app.js              # Screen switching logic, state, navigation
└── README.md           # "Open index.html" instructions
```

### Rationale

**Single `index.html` with all screens** (not separate HTML files per screen):
- Matches the proposal's "state-based screen switching" explicitly
- Simplest "open as file" experience — no XHR, no build, no routing complexity
- Stakeholders can record a linear demo flow without URL changes
- All screens share the same phone frame, tokens, and navigation shell

**Separate `styles.css`** (not per-screen CSS):
- Token transcription lives at the top, referenced by all screens
- Screen-specific styles are organized by section comments
- One file = one source of truth for the design system's web transcription

**Separate `data.js` and `app.js`**:
- `data.js` is pure data (mock riders, rides, waypoints, routes) — no logic
- `app.js` is pure behavior (screen switching, state transitions) — no markup
- Separation makes it obvious what's mock content vs. what's demo wiring

**Location `demo/` at repo root** (not `design/demo/` or `mock/`):
- `design/` already exists for the design-system build pipeline (DESIGN.md §7)
- `demo/` is short, clear, and what stakeholders will search for
- Outside `mobile/` satisfies the hard constraint

## Screen Switching

State-based show/hide via CSS classes and a simple `showScreen(id)` function in `app.js`.

### Mechanism

- Every screen container has `class="screen"` and `id="screen-{name}"`
- Default: `display: none` (via `.screen` in styles.css)
- Active screen: `class="screen active"` → `display: block`
- `showScreen(id)` removes `.active` from all screens, adds it to the target

### Screen IDs

- `screen-departure` — Departure screen (idle state by default)
- `screen-motion` — Motion screen
- `screen-planner` — Planner screen
- `screen-return-list` — Return List screen
- `screen-return-detail` — Return Detail screen (defaults to "Bangalore to Mysore" ride)

### Departure States

The Departure screen has a **persistent layout** with two independent state regions that swap content in place — mirroring the real `app/index.tsx`, where the Horizon title, location status, name input, voice toggle, both flow sections, and the Past rides link all remain on screen; only the Start flow's button and the Join flow's input+button are replaced by their post-action content.

- **Persistent chrome** (always visible): "Horizon" title, "Location ready." status, "Your name" input, "Spoken directions" toggle, "Start a ride" section title, "Join a ride" section title, "Past rides" link.
- **Start flow region** — toggles between two renderings via `data-start-state="idle|confirm"` on `#screen-departure`:
  - `idle`: amber "Start a ride" button.
  - `confirm`: ride code display "H3K7M2" (tabular-nums, letter-spacing 8) + "Plan the route" button (→ Planner) + "Start Riding" button (→ Motion).
- **Join flow region** — toggles between two renderings via `data-join-state="idle|connected"` on `#screen-departure`:
  - `idle`: code input pre-filled "H3K7M2" + "Join" button.
  - `connected`: ride code display "H3K7M2" + "Plan the route" button (→ Planner) + "Join Ride" button (→ Motion).
- The two regions are independent — entering confirm doesn't touch the join region, and vice versa.
- `setStartState(state)` and `setJoinState(state)` functions in `app.js` toggle the respective attributes.
- The Departure screen container has `overflow-y: auto` (mirrors the real screen's `ScrollView`; the content stack can exceed 812px on smaller frames).

**State transitions:**
- Idle → Confirm: click "Start a ride" button.
- Idle → Connected: click "Join" (with code input pre-filled).
- Confirm / Connected → Idle: not provided (demo simplification; the real app has no "back" from confirm either).

**Why state-based, not hash routing:**
- Proposal says "state-based screen switching" explicitly
- Hash routing adds URL complexity stakeholders don't need
- Opening `file:///...` URLs with hashes works, but state-based is simpler for the demo's narrative flow
- No deep-linking requirement — this is a linear showcase

## Phone Frame

Outer `.phone-frame` wrapper, 375×812px, hairline border `--surface-hairline` (#2A2A2E), centered with `margin: auto` in the page.

### Page Background

`--surface-base` (#0A0A0B) — same as the app's Departure/Return background.

**Rationale:** The hairline border is the only thing separating the phone from the page. The Motion screen's `--surface-void` (#000000) then reads as "pixels off" against the frame, which is exactly the matte-vs-void distinction the design language makes. Using a different page background would either:
- Compete with the app's surfaces (if using an invented color)
- Make the Motion screen's true black look like a hole (if using a lighter neutral)
- Add a color not in tokens.ts (violating the "zero invented hex" constraint)

### Responsive Behavior

```css
@media (max-width: 400px) {
  .phone-frame {
    width: 100%;
    height: 100vh;
    border: none;
  }
}
```

On mobile viewports (< 400px wide), the frame disappears and the app fills the screen — matching AC-1.

### No Device Chrome

No notch, no buttons, no status bar. The hairline border "suggests a device" (spec) but doesn't replicate one.

## Map Placeholders

Inline SVG for both Motion and Planner maps. No real tiles, no pan/zoom.

### Motion Map

- Background: `--surface-raised` (#141416) — slightly lifted off the void
- Route line: SVG `<path>`, stroke `--amber-core` (#E8A33D), stroke-width 4 (matches `RouteLine.tsx`'s line-width)
- Destination ring at the route's end point (matches the real Motion screen's `DestinationMarker`): hollow circle, 20px diameter (r=10), stroke `--ink-primary`, stroke-width 2
- Rider dots (3) — binary state, never a ranking (matches `RiderMarkers.tsx` per ADR-009):
  - **Sam** (ahead): `--ink-primary` (#F5F4F2)
  - **Alex** (you): `--amber-core` (#E8A33D) — the live thing
  - **Rio** (behind): `--ink-primary` (#F5F4F2) — same as any other rider
- Dots are 16px circles (r=8, matches `RiderMarkers.tsx` DOT_SIZE = 16), positioned along the route line (mock coordinates)
- NO rider panel, NO list, NO "3 riders" collapsed row (spec)

### Planner Map

- Same treatment as Motion, but occupies top ~45% of screen
- Waypoint markers: small circles (8px) along the route line, `--ink-primary`
- Route line: same amber stroke, stroke-width 4
- NO distance labels on the map (spec)

### RideTrace (Return Detail)

- 220px-tall map card, `--radius-card` (10), overflow hidden
- Background: `--surface-raised` (#141416)
- Route line: SVG `<path>`, stroke `--amber-core`, stroke-width 4
- Hollow ring at end: SVG `<circle>`, stroke `--ink-primary`, stroke-width 2, fill none, radius 10 (20px diameter, matches `DestinationMarker.tsx` RING_SIZE = 20)
- Start dot: 16px circle, `--ink-primary` filled, `--radius-full`
- NO distance label (spec)

## Horizon Line in CSS

The Motion screen divides into three zones by fraction of safe-area height (375×812 = 812px safe height, no status bar in mock).

### Percentages

- **Ahead**: 0 to 0.34 → `height: 34%`
- **Now**: 0.34 to 0.58 → `height: 24%`
- **Held**: 0.58 to 1.0 → `height: 42%`

### Layout

```css
#screen-motion {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.horizon-ahead {
  height: 34%;
  padding: var(--space-6); /* 32px */
}

.horizon-now {
  height: 24%;
  padding: var(--space-6);
  display: flex;
  align-items: center; /* SpeedReadout card vertically centered */
}

.horizon-held {
  height: 42%;
  padding: var(--space-6);
  display: flex;
  align-items: flex-start; /* EndRide pill at the TOP of the band, right-aligned — matches the real app (EndRide.tsx's wrapper alignItems flex-end is horizontal-only; the band View has no vertical justification) */
  justify-content: flex-end;
}
```

### Now Band Center at 0.46

The Now band's center sits at 0.46 of the total height. With the band spanning 0.34 to 0.58, the center is at (0.34 + 0.58) / 2 = 0.46. The SpeedReadout card is vertically centered within the band via the band's `align-items: center`, and left-aligned by the band's default `justify-content: flex-start` (the card itself does NOT set `align-self` — that would override the vertical centering and pin it to the top).

### Ahead Band Card Layout

The AheadCue card in the Ahead band uses `width: fit-content` (not `align-self: flex-start`, because the band is NOT a flex container — it's a block with padding). `width: fit-content` is the CSS shrink-to-fit equivalent of the real app's `alignSelf: 'flex-start'`, preventing the card from stretching to full band width.

### Push-to-Talk Band Stacking

The PTT band is `position: absolute` with a higher z-index than the Horizon bands, but it MUST have `pointer-events: none` so it doesn't intercept clicks on the EndRide pill (which sits inside the `.horizon-held` band at a lower z-index). This mirrors the real app's mount order: `PushToTalk` is rendered BEFORE `<HorizonLine>` so EndRide wins the touch on Android; on the web, `pointer-events: none` is the equivalent.

## Typography in CSS

### Tabular Numerals

```css
.tabular-nums {
  font-variant-numeric: tabular-nums;
}
```

Applied to all riding numerals (speed, distances, times).

### Letter Spacing

- Ride code display: `letter-spacing: 8px` (matches RN `letterSpacing: 8`)
- Motion label: `letter-spacing: 1.2px` (+0.08em @ 15px)
- Departure label: `letter-spacing: 0.78px` (+0.06em @ 13px)

### Uppercase Tracked Labels

```css
.type-motion-label,
.type-departure-label {
  text-transform: uppercase;
}

.type-motion-label {
  letter-spacing: 1.2px;
}

.type-departure-label {
  letter-spacing: 0.78px;
}
```

### Font Stacks

```css
:root {
  --font-operational: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-reflective: 'Newsreader', 'Source Serif 4', Georgia, serif;
}
```

## Mock-Only Affordances Marked

All mock simplifications are marked in code comments:

```html
<!-- mock-only: Back link (real app uses system back) -->
<a href="#" class="back-link" data-navigate="screen-departure">Back</a>

<!-- mock-only: EndRide pill shown visible (real app gates on 5s stationary) -->
<button class="end-ride-pill">Hold to end ride</button>

<!-- mock-only: click instead of 800ms long-press -->
<button data-navigate="screen-return-detail">Hold to end ride</button>

<!-- mock-only: "Set destination" navigates to Departure (real app uses router.back()) -->
<button data-navigate="screen-departure">Set destination</button>
```

## Key Technical Decisions

### No Framework

Vanilla HTML/CSS/JS. No React, no build step, no bundler, no npm install.

**Rationale:** The demo is a visual showcase, not a functional prototype. A framework adds complexity (build pipeline, dev server) for no benefit. Static files are the fastest path to "open in browser and show a stakeholder."

### No Backend

All data is static. No API calls, no WebSocket, no authentication.

**Rationale:** The real app requires Supabase, Go backend, LiveKit, ORS API key — none of which exist in a demo-ready state. The mock bypasses all infrastructure dependencies.

### Google Fonts

Inter + Newsreader loaded from Google Fonts (both SIL OFL).

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:wght@400&display=swap" rel="stylesheet">
```

**Graceful degradation:** If offline, the font stacks fall back to system fonts (sans-serif for Inter, serif for Newsreader). The design still works; the typography just isn't pixel-identical to the real app.

### No Gamification

No "FASTEST" / "BEST" chips in Planner alternatives. No ranking, no superlative labels.

**Rationale:** CLAUDE.md's no-gamification rule applies to routes as well as riders. The alternatives list is just selectable text lines, with the selected one in `--amber-core` and others in `--ink-primary`.

### No Serif Outside Return

Newsreader appears ONLY in Return screens (list + detail). Departure, Motion, and Planner use Inter exclusively.

**Rationale:** The serif is the reflective voice, used for journal/archive/story text. It has no Motion size because Motion is operational only — the ban is enforced by the token structure itself (tokens.ts has no serif entry in the `motion` scale).

### No Gradients / Neon / Glow / Decorative Shadows

Elevation is expressed by the surface ramp (`void` → `base` → `raised` → `overlay`), not by shadow.

**Rationale:** DESIGN.md §1 bans gradients, glows, neon, shadows used as decoration. The mock follows the same rule.

### Data-Driven Rendering

All mock data lives in `data.js` as `window.DATA` constants, and `app.js` populates the DOM from those constants at init time. Screens do NOT hardcode values in HTML — they read from `window.DATA` and inject content. This keeps `data.js` as the single source of truth for mock content, and makes it trivial to swap in different demo scenarios (different rider names, different rides, different routes) by editing only `data.js`.

**Rationale:** Hardcoding values in HTML while maintaining a parallel `data.js` creates two sources of truth that drift. Wiring the data through JS ensures consistency and makes the demo easier to customize for different stakeholder presentations.

## CSS Custom Properties Structure

Mirror `tokens.ts` exactly:

```css
:root {
  /* Colors - surfaces */
  --surface-void: #000000;
  --surface-base: #0A0A0B;
  --surface-raised: #141416;
  --surface-overlay: #1C1C1F;
  --surface-hairline: #2A2A2E;

  /* Colors - ink */
  --ink-primary: #F5F4F2;
  --ink-secondary: #A3A29E;
  --ink-tertiary: #6B6A67;
  --ink-disabled: #3F3F42;

  /* Colors - amber */
  --amber-core: #E8A33D;
  --amber-dim: #8A6224;
  --amber-wash: rgba(232, 163, 61, 0.10);

  /* Colors - signal */
  --signal-caution: #E8A33D; /* same as amber.core */
  --signal-critical: #D4544A;
  --signal-good: #6E9E7C;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --space-9: 96px;

  /* Radius */
  --radius-input: 4px;
  --radius-card: 10px;
  --radius-sheet: 18px;
  --radius-full: 9999px;

  /* Typography - font stacks */
  --font-operational: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-reflective: 'Newsreader', 'Source Serif 4', Georgia, serif;
}
```

### Typography Utility Classes

```css
.type-motion-primary {
  font-family: var(--font-operational);
  font-size: 64px;
  line-height: 64px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.type-motion-secondary {
  font-family: var(--font-operational);
  font-size: 32px;
  line-height: 36px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.type-motion-label {
  font-family: var(--font-operational);
  font-size: 15px;
  line-height: 20px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 1.2px;
}

.type-departure-display {
  font-family: var(--font-operational);
  font-size: 40px;
  line-height: 44px;
  font-weight: 600;
}

.type-departure-title {
  font-family: var(--font-operational);
  font-size: 28px;
  line-height: 34px;
  font-weight: 600;
}

.type-departure-body {
  font-family: var(--font-operational);
  font-size: 17px;
  line-height: 24px;
  font-weight: 400;
}

.type-departure-label {
  font-family: var(--font-operational);
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.78px;
}

.type-reflective-title {
  font-family: var(--font-reflective);
  font-size: 32px;
  line-height: 40px;
  font-weight: 400;
}

.type-reflective-body {
  font-family: var(--font-reflective);
  font-size: 19px;
  line-height: 30px;
  font-weight: 400;
}

.type-reflective-caption {
  font-family: var(--font-operational);
  font-size: 14px;
  line-height: 20px;
  font-weight: 400;
}
```

## Register Contract

The per-register contract table (from `tokens.ts`) is enforced via screen-specific CSS:

| | **Departure** | **Motion** | **Return** |
|---|---|---|---|
| Background | `--surface-base` | `--surface-void` | `--surface-base` |
| Type voice | Operational | Operational | Operational + **Reflective** |
| Largest text | 40 | **64** | 32 |
| Contrast floor | 4.5:1 | **7:1** | 4.5:1 |
| Screen padding | `--space-5` (24) | `--space-6` (32) | `--space-5` (24) |
| Max animation | 220 ms | **120 ms** | 380 ms |
| Touch target | 44 | **56** | 44 |
| Held zone | present | **collapsed** (except EndRide) | primary |

### Motion Contrast Floor

`--ink-tertiary` (#6B6A67) NEVER used in Motion — it fails the 7:1 floor. Only `--ink-primary` (#F5F4F2, 18.1:1) and `--ink-secondary` (#A3A29E, 8.4:1) appear in Motion.

### Touch Targets

- Departure/Return: 44px minimum height for interactive elements
- Motion: 56px minimum height (gloved hand on a vibrating bike)

## Navigation Map

```
Departure
  |-- [Start a ride] --> Departure (confirm state)
  |      |-- [Plan the route] --> Planner
  |      |-- [Start Riding] --> Motion
  |-- [Join] --> Departure (connected state)
  |      |-- [Plan the route] --> Planner
  |      |-- [Join Ride] --> Motion
  |-- [Past rides] --> Return List

Planner
  |-- [Set destination] --> Departure (mock simplification)
  |-- [Back] (mock-only) --> Departure

Motion
  |-- [Hold to end ride] --> Return Detail (mock simplification)

Return List
  |-- [Back] (mock-only) --> Departure
  |-- [Ride row] --> Return Detail

Return Detail
  |-- [Back] (mock-only) --> Return List
```

## Out of Scope

- Real location tracking or GPS
- Real WebSocket connections to the Go backend
- Real LiveKit voice/push-to-talk
- Real Supabase authentication or session management
- Real map tiles from OpenFreeMap
- Real route calculations from OpenRouteService
- Real ride data or history
- Backend integration of any kind
- Mobile-native gestures (swipe, pinch) — click/tap only
- Animations beyond basic CSS transitions (e.g., no Reanimated-style spring physics)
