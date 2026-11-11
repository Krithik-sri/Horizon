# Mock UI Demo — Tasks

Ordered implementation tasks. Each task has a concrete deliverable and satisfies specific acceptance criteria (ACs). Each is independently verifiable.

## Task 1: Scaffold the Demo + Phone Frame + CSS Tokens

**Deliverable:**
- `demo/` directory created at repo root
- `demo/index.html` with basic HTML shell: viewport meta, Google Fonts link, phone frame container, screen containers (all hidden)
- `demo/styles.css` with:
  - All CSS custom properties transcribed from `tokens.ts` (colors, spacing, radius, font stacks)
  - Phone frame styles (375×812px, hairline border, centered)
  - Responsive breakpoint (< 400px: frame disappears, app fills screen)
  - `.screen` class (display: none) and `.active` class (display: block)
- `demo/README.md` with "Open index.html in a browser" instructions

**Verification:**
- Open `demo/index.html` in a browser
- See a 375×812px phone frame centered on a dark background
- Resize browser to < 400px wide → frame disappears, content fills screen
- Inspect CSS variables in dev tools → all match `tokens.ts` exactly

**ACs satisfied:**
- AC-1: Mobile Dimensions (phone frame, responsive breakpoint)
- AC-12: Design Token Fidelity (CSS custom properties transcribed)
- AC-11: Visual Quality (partial — frame and tokens established)

---

## Task 2: Typography System + Font Loading

**Deliverable:**
- Google Fonts link in `index.html` loads Inter (400, 500, 600, 700) + Newsreader (400)
- Typography utility classes in `styles.css`:
  - `.type-motion-primary` (64/64, 700, tabular-nums)
  - `.type-motion-secondary` (32/36, 600, tabular-nums)
  - `.type-motion-label` (15/20, 500, uppercase, letter-spacing 1.2px)
  - `.type-departure-display` (40/44, 600)
  - `.type-departure-title` (28/34, 600)
  - `.type-departure-body` (17/24, 400)
  - `.type-departure-label` (13/18, 500, uppercase, letter-spacing 0.78px)
  - `.type-reflective-title` (32/40, 400, Newsreader)
  - `.type-reflective-body` (19/30, 400, Newsreader)
  - `.type-reflective-caption` (14/20, 400, Inter)
- `.tabular-nums` utility class
- Font stacks with system fallbacks

**Verification:**
- Open browser, inspect any text → correct font family, size, weight, line-height
- Check letter-spacing on `.type-departure-label` → 0.78px
- Check tabular-nums on a numeric element → digits don't shift width
- Disconnect network, reload → fonts fall back to system sans/serif

**ACs satisfied:**
- AC-3: Typography (font loading, type scales, tabular-nums, letter-spacing)
- AC-12: Design Token Fidelity (all type values match tokens.ts)

---

## Task 3: Mock Data Module

**Deliverable:**
- `demo/data.js` with all mock data constants:
  - `RIDE_CODE = "H3K7M2"`
  - `RIDER_NAME = "Alex"`
  - `LOCATION_STATUS = "Location ready."`
  - `VOICE_ENABLED = true`
  - `CONVOY_RIDERS = [{ name: "Sam", position: "ahead", color: "var(--ink-primary)" }, { name: "Alex", position: "you", color: "var(--amber-core)" }, { name: "Rio", position: "behind", color: "var(--ink-primary)" }]` — binary state (own dot amber, others ink.primary), never a ranking (ADR-009)
  - `RIDES = [...]` (3 rides with title, date, distance, duration, avg/max speed, companions, journal text)
  - `ROUTE_WAYPOINTS = [...]` (origin + MG Road Bangalore)
  - `ROUTE_SUMMARIES = [...]` (primary: "32 min · 18 km · via NH 44", alt 1: "36 min · 20 km · via ...", alt 2: "34 min · 17 km · via ...")
  - `MOTION_DATA = { speed: 62, maneuver: "420 m · Turn right onto NH 44", street: "NH 44", readout: "28 min · 14.2 km" }`
- `demo/app.js` init routine that reads `window.DATA` and populates DOM content for all screens (ride code, name, convoy, rides list, motion readout, etc.) — `data.js` is the single source of truth; HTML templates use `data-bind` attributes or named containers, not hardcoded values

**Verification:**
- Open browser console, inspect `window.DATA` → all mock values present
- Verify DOM content (ride codes, rider names, ride list, motion readout) matches `window.DATA` values
- Edit a value in `data.js`, reload → DOM reflects the change (proves wiring is live)
- No network requests in dev tools → data is static

**ACs satisfied:**
- Supports all screen tasks (AC-4 through AC-8) by providing mock content
- AC-10: No Backend Dependencies (all data is static)

---

## Task 4: Navigation State Machine

**Deliverable:**
- `demo/app.js` with:
  - `showScreen(id)` function: removes `.active` from all screens, adds to target
  - `setStartState(state)` function: toggles `data-start-state` attribute on Departure screen
  - `setJoinState(state)` function: toggles `data-join-state` attribute on Departure screen
  - `initFromData()` function: reads `window.DATA` and populates all screen content (ride codes, rider names, convoy, rides list, motion readout, etc.)
  - Event listeners for all navigation elements (`data-navigate` attributes)
  - Initial state: Departure screen active, `data-start-state="idle"`, `data-join-state="idle"`
- Screen containers in `index.html`:
  - `<div id="screen-departure" class="screen active" data-start-state="idle" data-join-state="idle" style="overflow-y: auto">...</div>`
  - `<div id="screen-motion" class="screen">...</div>`
  - `<div id="screen-planner" class="screen">...</div>`
  - `<div id="screen-return-list" class="screen">...</div>`
  - `<div id="screen-return-detail" class="screen">...</div>`

**Verification:**
- Open browser, see Departure screen
- Click a navigation element (once added in later tasks) → screen changes
- Verify `initFromData()` populated content from `window.DATA`
- No broken links or dead ends

**ACs satisfied:**
- AC-9: Navigation (screen switching, state transitions)
- AC-10: No Backend Dependencies (all navigation is client-side)

---

## Task 5: Departure Screen

**Deliverable:**
- HTML for Departure screen in `index.html` with **persistent layout** (mirrors real `app/index.tsx`):
  - **Always visible** (persistent chrome):
    - "Horizon" title (`.type-departure-display`, `--ink-primary`)
    - "Location ready." status (`.type-departure-body`, `--signal-good`)
    - "Your name" label + input (populated from `window.DATA.RIDER_NAME`)
    - "Spoken directions" toggle row (mock: enabled)
    - "Start a ride" section title (`.type-departure-title`)
    - "Join a ride" section title (`.type-departure-title`)
    - "Past rides" link at bottom (`.type-departure-label`, `--ink-secondary`) → navigates to Return List
  - **Start flow region** (toggles via `data-start-state="idle|confirm"`):
    - `idle`: amber "Start a ride" button (`.btn-primary`)
    - `confirm`: ride code display (populated from `window.DATA.RIDE_CODE`, `.type-departure-display`, tabular-nums, letter-spacing 8px) + "Plan the route" button (→ Planner) + "Start Riding" button (→ Motion)
  - **Join flow region** (toggles via `data-join-state="idle|connected"`):
    - `idle`: code input (pre-filled from `window.DATA.RIDE_CODE`) + "Join" button
    - `connected`: ride code display + "Plan the route" button (→ Planner) + "Join Ride" button (→ Motion)
  - Screen container has `overflow-y: auto` (content can exceed 812px)
- CSS for Departure states:
  - `[data-start-state="idle"] .start-idle { display: block }`
  - `[data-start-state="idle"] .start-confirm { display: none }`
  - `[data-start-state="confirm"] .start-confirm { display: block }`
  - `[data-start-state="confirm"] .start-idle { display: none }`
  - `[data-join-state="idle"] .join-idle { display: block }`
  - `[data-join-state="idle"] .join-connected { display: none }`
  - `[data-join-state="connected"] .join-connected { display: block }`
  - `[data-join-state="connected"] .join-idle { display: none }`
- JavaScript in `app.js`:
  - "Start a ride" button → `setStartState("confirm")`
  - "Join" button → `setJoinState("connected")`
  - Both regions are independent — entering confirm doesn't touch the join region

**Verification:**
- Open browser, see Departure screen with all persistent chrome visible
- Click "Start a ride" → Start flow region shows code + Plan/Start Riding buttons; Join flow region unchanged
- Click "Plan the route" → Planner screen (once built)
- Click "Start Riding" → Motion screen (once built)
- Click "Past rides" → Return List (once built)
- Scroll content → screen scrolls smoothly (overflow-y: auto)

**ACs satisfied:**
- AC-4: Departure Screen (all checklist items)

---

## Task 6: Motion Screen Structure + Map + Convoy

**Deliverable:**
- HTML for Motion screen in `index.html`:
  - Map placeholder (SVG, 100% width/height of screen):
    - Background: `--surface-raised` (#141416)
    - Route line: SVG `<path>`, stroke `--amber-core`, stroke-width 4 (matches `RouteLine.tsx`'s line-width)
    - Destination ring at the route's end point: 20px hollow circle, `--ink-primary`, stroke-width 2 (`DestinationMarker` reuse)
    - 3 rider dots: Sam (`--ink-primary`), Alex (`--amber-core`), Rio (`--ink-primary`) — binary state per ADR-009, never a ranking
    - Dot size: 16px circles (r=8, matches `RiderMarkers.tsx` DOT_SIZE = 16)
  - Horizon Line bands:
    - `.horizon-ahead` (height: 34%, padding: `--space-6`)
    - `.horizon-now` (height: 24%, padding: `--space-6`, flex center)
    - `.horizon-held` (height: 42%, padding: `--space-6`, flex end)
  - Push-to-talk band (invisible, full-width, 0.58 to bottom):
    - `<div class="ptt-band" style="pointer-events: none">` — must not intercept EndRide clicks
    - Optional 2px amber hairline at bottom when talking
- CSS for Motion:
  - `#screen-motion { background: var(--surface-void); display: flex; flex-direction: column; }`
  - Map SVG positioned absolutely, z-index 0
  - Horizon bands positioned relatively, z-index 1
  - PTT band z-index 2 but `pointer-events: none` so EndRide wins the touch (mirrors real app's mount order)
  - Rider dots positioned along route line (mock coordinates)

**Verification:**
- Navigate to Motion screen
- See dark void background, map placeholder with amber route line, 3 rider dots (Sam/Rio ink.primary, Alex amber.core)
- Destination ring visible at the route's end point (hollow, ink.primary)
- Verify dot size is 16px (not 12px)
- Horizon Line bands visible (empty for now)
- PTT band exists but doesn't intercept clicks on the Held band area
- Resize to mobile → fills screen

**ACs satisfied:**
- AC-5: Motion Screen (partial — structure, map, convoy dots)
- AC-2: Dark Theme (partial — Motion background `--surface-void`)

---

## Task 7: Motion Screen Content (AheadCue, SpeedReadout, EndRide)

**Deliverable:**
- HTML for Motion content:
  - Ahead band:
    - AheadCue card (bg `--surface-void`, radius `--radius-card`, padding `--space-4`, `width: fit-content`):
      - Maneuver glyph: right-turn dart SVG (28px, `--amber-core`)
      - Primary line: "420 m · Turn right onto NH 44" (`.type-motion-secondary`, `--ink-primary`)
      - Street: "NH 44" (`.type-motion-label`, `--ink-secondary`)
      - Readout: "28 min · 14.2 km" (`.type-motion-label`, `--ink-secondary`)
  - Now band:
    - SpeedReadout card (bg `--surface-void`, radius `--radius-card`, padding `--space-4`):
      - Speed: "62" (`.type-motion-primary`, `--ink-primary`, tabular-nums)
      - Label: "km/h" (`.type-motion-label`, `--ink-primary`, uppercase → "KM/H")
      - Card does NOT set `align-self: flex-start` — the band's default `justify-content: flex-start` left-aligns it, `align-items: center` vertically centers it
  - Held band:
    - EndRide pill (bg `--surface-overlay`, radius `--radius-full`, padding `--space-4`):
      - Text: "Hold to end ride" (`.type-motion-label`, `--ink-primary`)
      - `data-navigate="screen-return-detail"` (mock simplification of 5s stationary gate + 800ms long-press)
- CSS for Motion content:
  - AheadCue card: `width: fit-content` (the band is NOT a flex container, so `align-self: flex-start` would be a no-op)
  - SpeedReadout card: no `align-self` — vertically centered by the band's `align-items: center`
  - EndRide pill at bottom of Held band
- All Motion text uses `--ink-primary` or `--ink-secondary` (never `--ink-tertiary`)

**Verification:**
- Navigate to Motion screen
- Ahead band: ONE AheadCue card (shrink-to-fit, not full-width) with maneuver glyph, primary text, street, readout
- Now band: SpeedReadout card with "62" (largest element on screen, 64px), "KM/H" label, vertically centered (not pinned to top)
- Held band: EndRide pill visible (mock simplification)
- Click EndRide pill → navigates to Return Detail (PTT band's `pointer-events: none` allows the click to reach the pill)
- All text meets 7:1 contrast floor (inspect colors)
- Touch target: 56px (inspect EndRide pill height)

**ACs satisfied:**
- AC-5: Motion Screen (all checklist items)
- AC-2: Dark Theme (Motion contrast floor 7:1, no `--ink-tertiary`)

---

## Task 8: Planner Screen

**Deliverable:**
- HTML for Planner screen in `index.html`:
  - Mock-only Back link at top: "Back" (`.type-departure-label`, `--ink-secondary`) → Departure
  - Map area (top ~45%):
    - SVG with route line (amber), waypoint markers (ink-primary)
  - Bottom sheet (max 55% height):
    - Background: `--surface-raised`, top corners `--radius-sheet` (18), padding `--space-5` (24)
    - "Plan your route" title (`.type-departure-title`, `--ink-primary`)
    - Origin line: "Your location" (`.type-departure-body`, `--ink-secondary`)
    - Stops list:
      - "1. MG Road, Bangalore" (`.type-departure-body`, `--ink-primary`)
      - Reorder up arrow (`--amber-core`, disabled at top → `--ink-disabled`)
      - Reorder down arrow (`--amber-core`, disabled at bottom → `--ink-disabled`)
      - Remove x (`--signal-critical`)
    - Destination search input (text input, NOT "Add stop" button)
    - Route summary lines:
      - Primary (selected): "32 min · 18 km · via NH 44" (`.type-departure-body`, `--amber-core`)
      - Alt 1: "36 min · 20 km · via ..." (`.type-departure-body`, `--ink-primary`)
      - Alt 2: "34 min · 17 km · via ..." (`.type-departure-body`, `--ink-primary`)
    - "Set destination" button (amber bg, `--radius-card`, `--surface-void` text) → Departure
- CSS for Planner:
  - Bottom sheet `max-height: 55%`, `border-top-left-radius: var(--radius-sheet)`, `border-top-right-radius: var(--radius-sheet)`
  - Route summary lines selectable (click to change selected)
- JavaScript:
  - Route summary lines: click to toggle selected state
  - "Set destination" button → `showScreen("screen-departure")` (mock simplification)

**Verification:**
- Navigate to Planner screen
- See Back link, map with route + waypoints, bottom sheet with title, origin, stops, input, alternatives, commit button
- Click Back → Departure
- Click a route alternative → selected line changes to amber
- Click "Set destination" → Departure
- No "FASTEST" / "BEST" chips

**ACs satisfied:**
- AC-6: Planner Screen (all checklist items)

---

## Task 9: Return List Screen

**Deliverable:**
- HTML for Return List screen in `index.html`:
  - Mock-only Back link at top: "Back" (`.type-departure-label`, `--ink-secondary`) → Departure
  - "Rides" title (`.type-reflective-title`, `--ink-primary`, Newsreader serif)
  - Year divider: "2026" (`.type-departure-label`, `--ink-tertiary`)
  - 3 ride rows (hairline-separated, NOT cards):
    - Row 1: "Bangalore to Mysore" (`.type-reflective-body`, `--ink-primary`) + "12 Oct · 142 km · 2h 18m" (`.type-departure-label`, `--ink-secondary`)
    - Row 2: "Nandi Hills Loop" + "05 Oct · 68 km · 1h 42m"
    - Row 3: "City Evening Ride" + "28 Sep · 24 km · 52m"
    - Each row: `border-bottom: 1px var(--surface-hairline)`, `padding-vertical: var(--space-3)`, `min-height: 44px`
    - Each row `data-navigate="screen-return-detail"` + `data-ride-id="..."`
- CSS for Return List:
  - Rows separated by hairline, not cards
  - Serif font for ride titles, sans for captions
- JavaScript:
  - Click ride row → `showScreen("screen-return-detail")` + set active ride

**Verification:**
- Navigate to Return List screen
- See "Rides" title in serif, year divider, 3 ride rows with hairline separators
- Click a ride row → Return Detail screen (once built)
- Click Back → Departure

**ACs satisfied:**
- AC-7: Return List Screen (all checklist items)

---

## Task 10: Return Detail Screen

**Deliverable:**
- HTML for Return Detail screen in `index.html`:
  - Mock-only Back link at top: "Back" (`.type-departure-label`, `--ink-secondary`) → Return List
  - Route name: "Bangalore to Mysore" (`.type-reflective-title`, `--ink-primary`, serif)
  - RideTrace (220px-tall map card):
    - Background: `--surface-raised`, radius `--radius-card`, overflow hidden
    - Amber route line (SVG), hollow ring at end (stroke-only, `--ink-primary`, r=10 / 20px diameter, matches `DestinationMarker.tsx` RING_SIZE = 20), 16px start dot (`--ink-primary` filled, r=8 / 16px diameter, matches `RideTrace.tsx` START_DOT_SIZE = 16)
  - RideFacts list (stacked label-over-value pairs, NOT label-left/value-right rows — matches `RideFacts.tsx`):
    - Date: "12 October 2026"
    - Distance: "142 km"
    - Moving time: "2h 18m"
    - Elapsed time: "2h 31m"
    - Average speed: "62 km/h"
    - Max speed: "98 km/h"
    - With: "Sam, Rio"
    - Each fact: label (`.type-departure-label`, `--ink-secondary`, uppercase) on its own line, then value (`.type-reflective-body`, `--ink-primary`, serif) on the next line; facts separated by `margin-top: var(--space-3)` (12px)
  - PhotoStrip section:
    - "Add a photo" link (`.type-departure-body`, `--amber-core`, min-height 44px) — mock non-functional
    - 3 gray placeholder thumbnails (120×120, `--radius-card`, gap `--space-2`, margin-top `--space-3`) in horizontal scroll row
  - JournalNote section:
    - Journal text (`.type-reflective-body`, `--ink-primary`, serif, line-height from token ≈ 30px) — do NOT apply inline `line-height` override
  - "Delete this ride" link (`.type-departure-label`, `--ink-tertiary`) — mock non-functional
- CSS for Return Detail:
  - RideTrace map card 220px tall, amber line + hollow ring (r=10) + start dot (r=8)
  - RideFacts stacked layout (label over value, space.3 between facts)
  - PhotoStrip horizontal scroll row
  - JournalNote line-height comes from `.type-reflective-body` (19/30)

**Verification:**
- Navigate to Return Detail screen
- See Back link, route name in serif, RideTrace map card with amber line + hollow ring (20px diameter) + start dot (16px diameter)
- RideFacts: 7 facts in stacked layout (label above value, NOT side-by-side), each pair separated by 12px
- NO "Route" fact, NO separate "Riders" section
- PhotoStrip: "Add a photo" link + 3 gray thumbnails
- JournalNote: journal text in serif with token line-height (no inline override)
- "Delete this ride" link at bottom
- Click Back → Return List

**ACs satisfied:**
- AC-8: Return Detail Screen (all checklist items)

---

## Task 11: Final Validation + Polish + README

**Deliverable:**
- Complete AC checklist verification (all 12 ACs)
- Polish pass:
  - Consistent spacing (4pt scale)
  - Touch targets: 44px in Departure/Return, 56px in Motion
  - No visual clutter or unnecessary decoration
  - Premium, restrained, intentional feel
- README update:
  - "Open index.html in a browser"
  - "No build step, no dependencies"
  - "All values transcribed from mobile/src/design/tokens.ts"
  - "Mock-only: no backend, no network at runtime (except Google Fonts, graceful fallback)"

**Verification:**
- Open `demo/index.html` in a browser
- Walk through all screens via navigation map
- Verify each AC in the spec (12 ACs, all checklist items)
- Check contrast ratios (4.5:1 Departure/Return, 7:1 Motion)
- Check touch targets (44px Departure/Return, 56px Motion)
- Check typography (Inter + Newsreader, tabular-nums, letter-spacing)
- Check colors (all from tokens.ts, no invented hex)
- Check spacing (4pt scale)
- Check radius (4, 10, 18, 9999)
- Check register contract table values

**ACs satisfied:**
- AC-1 through AC-12 (full pass)
- AC-11: Visual Quality (final polish)
- AC-12: Design Token Fidelity (final verification)

---

## AC-to-Task Traceability

| AC | Tasks |
|---|---|
| AC-1: Mobile Dimensions | 1, 11 |
| AC-2: Dark Theme | 1, 2, 7, 11 |
| AC-3: Typography | 2, 11 |
| AC-4: Departure Screen | 5 |
| AC-5: Motion Screen | 6, 7 |
| AC-6: Planner Screen | 8 |
| AC-7: Return List Screen | 9 |
| AC-8: Return Detail Screen | 10 |
| AC-9: Navigation | 4 |
| AC-10: No Backend Dependencies | 3, 4 (and all tasks) |
| AC-11: Visual Quality | 1, 2, 11 |
| AC-12: Design Token Fidelity | 1, 2, 11 |

All 12 ACs are covered. Each task is independently verifiable against specific ACs.
