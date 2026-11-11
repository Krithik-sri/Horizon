# Capability Spec: Three Registers Demo

## Overview

The mock UI demonstrates all three Horizon registers and the Planner screen. Each screen must feel distinct while sharing a unified dark, premium visual identity. All data is static/mock. All navigation is click/tap only. All values are transcribed from `mobile/src/design/tokens.ts` (the authoritative source per DESIGN.md 7).

---

## Global Requirements

### Mobile Dimensions
- The app renders inside a phone-sized frame (375x812 px or similar) centered in the browser viewport
- On smaller viewports (< 400px wide), it fills the screen without a frame
- The frame has a hairline border (`surface.hairline` #2A2A2E) to suggest a device, but no device chrome (no notch, no buttons)

### Design Tokens (transcribed from tokens.ts)

#### Color
**Surfaces:**
- `surface.void` #000000 -- Motion register background ONLY (true black, OLED pixels off)
- `surface.base` #0A0A0B -- Departure/Return background (matte, not void)
- `surface.raised` #141416 -- Cards, sheets, grouped rows (Planner bottom sheet)
- `surface.overlay` #1C1C1F -- Modals, menus, EndRide pill
- `surface.hairline` #2A2A2E -- Borders and dividers (RideCard borders, Return list)

**Ink:**
- `ink.primary` #F5F4F2 -- Body and headline text (18.1:1 on base)
- `ink.secondary` #A3A29E -- Supporting text, labels (8.4:1 on base)
- `ink.tertiary` #6B6A67 -- Non-essential only (3.8:1 on base). NEVER used in Motion (fails 7:1 floor)
- `ink.disabled` #3F3F42 -- Inactive controls (1.7:1 on base)

**Accent:**
- `amber.core` #E8A33D -- The single accent. Active state, primary actions (9.6:1 on base)
- `amber.dim` #8A6224 -- Amber at rest, track fills, inactive segments
- `amber.wash` rgba(232,163,61,0.10) -- Tinted backgrounds only

**Signal:**
- `signal.good` #6E9E7C -- Ready/healthy ("Location ready." in Departure)
- `signal.critical` #D4544A -- Safety-critical (Planner remove-stop x)

**Banned:** gradients, glows, neon, shadows as decoration, any hue outside the tables above.

#### Typography
**Motion scale (operational only, NEVER serif):**
- `motion.primary` 64/64 Inter 700 tabular-nums -- "the one number that matters" (speed)
- `motion.secondary` 32/36 Inter 600 tabular-nums -- at most one on screen (AheadCue primary)
- `motion.label` 15/20 Inter 500 uppercase +1.2 tracking -- labels, readouts

**Departure scale (operational):**
- `departure.display` 40/44 Inter 600 -- "Horizon" title
- `departure.title` 28/34 Inter 600 -- section titles ("Plan your route")
- `departure.body` 17/24 Inter 400 -- body text, inputs
- `departure.label` 13/18 Inter 500 uppercase +0.78 tracking -- small labels, year dividers

**Reflective scale (serif, Return register ONLY):**
- `reflective.title` 32/40 Newsreader 400 -- "Rides" title, ride detail title
- `reflective.body` 19/30 Newsreader 400 -- journal entries, ride titles in list
- `reflective.caption` 14/20 Inter 400 -- captions and stats stay operational

**Font loading:** Web mock loads Inter + Newsreader from Google Fonts (both SIL OFL) as web equivalents. The serif NEVER appears in Departure, Motion, or Planner.

#### Register Contract Table

| | **Departure** | **Motion** | **Return** |
|---|---|---|---|
| Background | `surface.base` | `surface.void` | `surface.base` |
| Type voice | Operational | Operational | Operational + **Reflective** |
| Largest text | 40 | **64** | 32 |
| Contrast floor | 4.5:1 | **7:1** | 4.5:1 |
| Screen padding | `space.5` (24) | `space.6` (32) | `space.5` (24) |
| Max animation | 220 ms | **120 ms** | 380 ms |
| Touch target | 44 | **56** | 44 |
| Held zone | present | **collapsed** (except EndRide) | primary |

#### Spacing
4pt base scale: `space.1` 4, `space.2` 8, `space.3` 12, `space.4` 16, `space.5` 24, `space.6` 32, `space.7` 48, `space.8` 64, `space.9` 96

#### Radius
- `radius.input` 4 (inputs)
- `radius.card` 10 (cards, AheadCue, SpeedReadout)
- `radius.sheet` 18 (sheets, Planner bottom sheet top corners)
- `radius.full` 9999 (genuinely circular controls ONLY -- no pill-shaped buttons)

#### Horizon Line Zones
- **Ahead** 0 to 0.34 -- what's coming
- **Now** 0.34 to 0.58 (center at 0.46) -- current riding
- **Held** 0.58 to 1.0 -- deferred

---

## Screen 1: Departure

**Register:** Departure (calm, confident)
**Background:** `surface.base` #0A0A0B
**Padding:** 24 (space.5)
**Question answered:** "Am I ready to ride?"

### Layout
- "Horizon" title at top (departure.display 40/44, Inter 600, ink.primary)
- "Location ready." status indicator (departure.body, signal.good #6E9E7C)
- "Your name" label (departure.label, ink.secondary) + text input field (departure.body, ink.primary, border hairline) -- mock value: "Alex"
- "Spoken directions" toggle row (departure.body, ink.primary) -- mock: enabled/on
- Divider / spacing

### Start a Ride section
- "Start a ride" section title (departure.title 28/34, Inter 600, ink.primary)
- Primary button: "Start a ride" (departure.body, amber.core bg, surface.void text, radius.card 10)
- On click: transitions to "confirm" state showing:
  - Large ride code display: "H3K7M2" (departure.display, tabular-nums, letter-spacing 8, ink.primary)
  - "Plan the route" button (amber.core bg, radius.card) -- navigates to Planner
  - "Start Riding" button (amber.core bg, radius.card) -- navigates to Motion

### Join a Ride section
- "Join a ride" section title (departure.title, ink.primary)
- Code input field showing "H3K7M2" (departure.display, tabular-nums, letter-spacing 8, ink.primary)
- "Join" button (amber.core bg, radius.card)
- On click: transitions to connected state showing:
  - Large ride code: "H3K7M2"
  - "Plan the route" button -- navigates to Planner
  - "Join Ride" button -- navigates to Motion

### Past rides link
- "Past rides" text link at bottom (departure.label, ink.secondary)
- Click navigates to Return list

### Mock Data
- Name: "Alex"
- Ride code: "H3K7M2"
- Location status: "Location ready." (signal.good)
- Voice toggle: on

---

## Screen 2: Motion

**Register:** Motion (almost invisible, strictest register)
**Background:** `surface.void` #000000 (true black)
**Padding:** 32 (space.6)
**Touch target:** 56
**Contrast floor:** 7:1 for everything
**Max animation:** 120ms
**Question answered:** "What is essential right now?"

### Layout (Horizon Line structure)

The screen divides into three zones by fraction of safe-area height:

#### Ahead band (0 to 0.34, padded 32)
ONE ambient `AheadCue` card. Exactly one element occupies this band.
- Card: bg `surface.void`, radius.card (10), padding space.4 (16)
- Maneuver glyph: right-turn dart SVG (amber.core #E8A33D, 28px)
- Primary line: "420 m . Turn right onto NH 44" (motion.secondary 32/36 Inter 600 tabular-nums, ink.primary #F5F4F2)
- Street: "NH 44" (motion.label 15/20 Inter 500 uppercase, ink.secondary #A3A29E)
- Readout: "28 min . 14.2 km" (motion.label, ink.secondary)
- All in one card, exactly one element in the band

#### Now band (0.34 to 0.58, center at 0.46, padded 32)
`SpeedReadout` card. The speed is the LARGEST element on screen.
- Card: bg `surface.void`, radius.card (10), padding space.4 (16)
- Speed: "62" (motion.primary 64/64 Inter 700 tabular-nums, ink.primary #F5F4F2)
- Label: "km/h" (motion.label 15/20 Inter 500 uppercase, ink.primary -- renders as "KM/H")
- Now band center sits at 0.46 of safe-area height; the card itself is aligned flex-start (left-aligned) within the band

#### Held band (0.58 to 1.0, padded 32)
Collapsed by default in Motion. `EndRide` is the one exception.
- **Mock simplification:** EndRide pill shown visible (in real app appears only after 5s stationary)
- "Hold to end ride" pill: bg `surface.overlay` #1C1C1F, radius.full (9999, circular), motion.label text (ink.primary #F5F4F2)
- On click: navigates to Return Detail of the just-ended ride (mock simplification of 800ms long-press)

#### Push-to-talk band (invisible, full-width, 0.58 to screen bottom)
- Invisible pressable area
- While talking: 2px amber.core hairline at very bottom edge (mock may show hairline state to demonstrate)
- Nothing else ever renders for voice in Motion

### Map background
- Full-screen dark gray placeholder with subtle SVG route line (amber or white, no POI labels)
- Destination ring at the route's end point (DestinationMarker reuse): 20px hollow ring (r=10), stroke ink.primary, stroke-width 2
- **Rider markers as dots on the map:** 3 dots (Sam ahead, Alex you amber-highlighted, Rio behind)
- NO rider panel, NO list, NO "3 riders" collapsed row
- Map is static (no pan/zoom, mock)

### Mock Data
- Speed: 62 km/h
- Next maneuver: Turn right onto NH 44 in 420 m
- Readout: 28 min . 14.2 km
- Convoy: Sam (ahead), Alex (you, amber), Rio (behind) -- as dots on map
- Ride code: H3K7M2 (not shown on screen, in data only)

### Interaction
- EndRide pill navigates to Return Detail (mock simplification)
- Convoy expand/collapse: NO (riders are dots on map only)
- Map is static (no pan/zoom)
- Push-to-talk hairline: mock may show to demonstrate

---

## Screen 3: Planner

**Register:** Departure (calm, confident -- planner is part of pre-ride)
**Background:** `surface.base` #0A0A0B
**Padding:** 24 (space.5)
**Question answered:** "Is this the route I want?"

### Layout
- Map area (top ~45% of screen): mock route line (SVG, amber), waypoint markers (small circles)
- Map is same style as Motion but static, with visible waypoints

#### Bottom sheet (max 55% height)
- Background: `surface.raised` #141416
- Top corners: radius.sheet (18)
- Padding: space.5 (24)

### Bottom sheet content
- "Plan your route" title (departure.title 28/34 Inter 600, ink.primary)
- Origin line: "Your location" (departure.body 17/24 Inter 400, ink.secondary)
- Stops list: numbered rows
  - "1. MG Road, Bangalore" (departure.body, ink.primary)
  - Each stop has: reorder up arrow (amber.core, disabled at top), reorder down arrow (amber.core, disabled at bottom), remove x (signal.critical #D4544A)
- Destination search input (like real DestinationSearch -- text input field, NOT "Add stop" button)
- Route summary lines (when >1 route exists):
  - Primary (selected): "32 min . 18 km . via NH 44" (departure.body, amber.core #E8A33D)
  - Alt 1: "36 min . 20 km . via ..." (departure.body, ink.primary)
  - Alt 2: "34 min . 17 km . via ..." (departure.body, ink.primary)
  - **No "FASTEST"/"BEST" chips** (no-gamification rule)
- Commit button: "Set destination" (departure.body, amber.core bg, surface.void text, radius.card 10) -- navigates **back to Departure** (mock simplification; real app uses router.back())

### Mock-only affordance
- Back link: "Back" (departure.label, ink.secondary) at top -- mock-only (real app uses system back)

### Mock Data
- Primary route: 32 min . 18 km . via NH 44
- Alt 1: 36 min . 20 km . via ...
- Alt 2: 34 min . 17 km . via ...
- Waypoints: Current location, MG Road Bangalore
- Ride code: H3K7M2

---

## Screen 4a: Return List

**Register:** Return (reflective)
**Background:** `surface.base` #0A0A0B
**Padding:** 24 (space.5)
**Question answered:** "What have I ridden?"

### Layout
- "Rides" title at top (reflective.title 32/40 Newsreader 400, ink.primary)
- Year divider: "2026" (departure.label 13/18 Inter 500 uppercase, ink.tertiary #6B6A67)
- Ride rows (hairline-separated, NOT cards):

### Ride rows (3 mock rides)
Each row:
- borderBottom: 1px surface.hairline #2A2A2E
- paddingVertical: space.3 (12)
- minHeight: register.return.touchTarget (44)
- Title (if set): "Bangalore to Mysore" (reflective.body 19/30 Newsreader 400, ink.primary)
- Caption line: "12 Oct . 142 km . 2h 18m" (departure.label 13/18 Inter 500 uppercase, ink.secondary)
- Click navigates to ride detail

### Mock Data
- Ride 1: 12 Oct 2026, "Bangalore to Mysore", 142 km, 2h 18m
- Ride 2: 05 Oct 2026, "Nandi Hills Loop", 68 km, 1h 42m
- Ride 3: 28 Sep 2026, "City Evening Ride", 24 km, 52m

### Navigation
- Mock-only back link: "Back" (departure.label, ink.secondary) at top -- navigates to Departure (real app uses system back)
- Click any ride row -- navigates to Return Detail

---

## Screen 4b: Return Detail

**Register:** Return (reflective)
**Background:** `surface.base` #0A0A0B
**Padding:** 24 (space.5)
**Question answered:** "What happened on this ride?"

### Layout
- Mock-only back link: "Back" (departure.label, ink.secondary) at top (real app uses system back)
- Route name: "Bangalore to Mysore" (reflective.title 32/40 Newsreader 400, ink.primary)

### RideTrace (static route-line placeholder)
- Fixed-height map card: 220px tall, radius.card (10), overflow hidden
- Amber route line (SVG path, amber.core)
- Hollow ring at the track's end point (DestinationMarker reuse)
- 16px start dot at the beginning (ink.primary, radius.full circle)

### RideFacts list
Each fact: label (departure.label 13/18 Inter 500 uppercase, ink.secondary) + value (reflective.body 19/30 Newsreader 400, ink.primary)
- **Date:** "12 October 2026"
- **Distance:** "142 km"
- **Moving time:** "2h 18m"
- **Elapsed time:** "2h 31m"
- **Average speed:** "62 km/h"
- **Max speed:** "98 km/h"
- **With:** "Sam, Rio"
- **NO "Route" fact** (not knowable from single ride -- no reverse geocode)
- **NO separate "Riders" section** -- "With" covers it

### PhotoStrip section
- "Add a photo" link (departure.body 17/24 Inter 400, amber.core #E8A33D, minHeight 44) -- mock: non-functional
- 3 gray placeholder thumbnails (120x120, radius.card 10, gap space.2 8px, marginTop space.3 12px) in horizontal scroll row

### JournalNote section
- Mock journal entry text (reflective.body 19/30 Newsreader 400, ink.primary):
  > "Left Bangalore around 7am. The highway was quiet - just us and the truckers. The climb past Savandurga was the best part, everything opened up. Stopped at the viewpoint near Mysore for chai. Good ride."
- Generous line-height, readable width

### Delete link
- "Delete this ride" (departure.label 13/18 Inter 500 uppercase, ink.tertiary #6B6A67) at bottom
- Mock: non-functional

### Mock Data
- Title: Bangalore to Mysore
- Date: 12 October 2026
- Distance: 142 km
- Moving time: 2h 18m
- Elapsed time: 2h 31m
- Avg speed: 62 km/h
- Max speed: 98 km/h
- With: Sam, Rio
- Journal: (see above)
- Photos: 3 placeholders

---

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
  |-- [Set destination] --> Departure (mock simplification; real app uses router.back())
  |-- [Back] (mock-only) --> Departure

Motion
  |-- [Hold to end ride] --> Return Detail (mock simplification of 5s stationary gate + 800ms long-press)

Return List
  |-- [Back] (mock-only) --> Departure
  |-- [Ride row] --> Return Detail

Return Detail
  |-- [Back] (mock-only) --> Return List
```

**Mock-only affordances marked:**
- On-screen Back links (real app uses system back)
- Always-visible EndRide pill (real app gates on 5s stationary)
- Planner "Set destination" navigates to Departure (real app uses router.back())

---

## Acceptance Criteria

### AC-1: Mobile Dimensions
- [ ] App renders at 375x812 px (or similar phone size) in a centered frame on desktop
- [ ] On mobile viewports (< 400px wide), app fills screen without frame
- [ ] All content is readable and interactive at these dimensions

### AC-2: Dark Theme
- [ ] Background is deep matte black (#0A0A0B for Departure/Return, #000000 for Motion)
- [ ] All text meets contrast floors: 4.5:1 for Departure/Return, **7:1 for Motion**
- [ ] Amber (#E8A33D) used only for primary actions and active states
- [ ] No vibrant gradients, neon, or cyberpunk effects anywhere
- [ ] ink.tertiary (#6B6A67) NEVER used in Motion (fails 7:1 floor)

### AC-3: Typography
- [ ] Departure, Motion, Planner use Inter (operational voice)
- [ ] Return list and detail use Newsreader serif (reflective voice)
- [ ] Serif NEVER appears in Departure, Motion, or Planner screens
- [ ] Motion uses motion.primary (64px) for speed, motion.secondary (32px) for AheadCue
- [ ] Display sizes are large and generous for key information
- [ ] Letter-spacing and line-height feel premium, not cramped
- [ ] All type values transcribed from tokens.ts

### AC-4: Departure Screen
- [ ] Shows "Horizon" title (departure.display 40px), name input ("Alex"), voice toggle, location status (signal.good)
- [ ] "Start a ride" button shows confirm state with ride code "H3K7M2" (departure.display, tabular-nums)
- [ ] Confirm state has "Plan the route" and "Start Riding" buttons (amber.core, radius.card)
- [ ] "Join" flow shows pre-filled code "H3K7M2" and connected state
- [ ] "Past rides" link (departure.label) navigates to Return list
- [ ] Background: surface.base #0A0A0B, padding 24

### AC-5: Motion Screen
- [ ] Background: surface.void #000000 (true black), padding 32
- [ ] Horizon Line structure: Ahead (0-34%), Now (34-58%), Held (58-100%)
- [ ] Ahead band: ONE AheadCue card with maneuver glyph (amber), primary text (motion.secondary 32px "420 m . Turn right onto NH 44"), street (motion.label "NH 44"), readout (motion.label "28 min . 14.2 km")
- [ ] Now band: SpeedReadout card with speed "62" (motion.primary 64px, tabular-nums, ink.primary), "KM/H" label (motion.label, uppercase)
- [ ] Speed is the LARGEST element on screen (64px)
- [ ] Held band: EndRide pill "Hold to end ride" (surface.overlay bg, radius.full, motion.label) -- mock shows visible (real app gates on 5s stationary)
- [ ] Push-to-talk: invisible bottom band, mock may show 2px amber hairline when talking
- [ ] Convoy: 3 rider dots on map (Sam ahead, Alex you amber, Rio behind) -- NO panel, NO list
- [ ] Destination ring at the route's end point (20px hollow, ink.primary, stroke 2) -- matches the real Motion screen's DestinationMarker
- [ ] EndRide navigates to Return Detail (mock simplification)
- [ ] Touch target: 56 (not 44)
- [ ] All Motion text meets 7:1 contrast floor

### AC-6: Planner Screen
- [ ] Title: "Plan your route" (departure.title 28px)
- [ ] Bottom sheet: max 55% height, surface.raised bg, radius.sheet (18) top corners, padding 24
- [ ] Origin line: "Your location" (departure.body, ink.secondary)
- [ ] Stops: numbered rows "1. MG Road, Bangalore" (departure.body, ink.primary) with reorder arrows (amber, disabled at bounds) and remove x (signal.critical)
- [ ] Destination search input (NOT "Add stop" text button)
- [ ] Route summary format: "32 min . 18 km . via NH 44" (time first, WHOLE km, no decimals)
- [ ] Alternatives: list of selectable text lines (selected = amber.core, others = ink.primary) -- NO "FASTEST"/"BEST" chips
- [ ] Commit button: "Set destination" (amber, radius.card) navigates to Departure (mock simplification)
- [ ] Mock-only back link at top (real app uses system back)

### AC-7: Return List Screen
- [ ] "Rides" title uses serif font (reflective.title 32px Newsreader)
- [ ] Year divider: "2026" (departure.label, ink.tertiary)
- [ ] 3 ride rows (hairline-separated, NOT cards) with title (reflective.body serif) + caption "12 Oct . 142 km . 2h 18m" (departure.label uppercase, ink.secondary)
- [ ] Each row has borderBottom surface.hairline, paddingVertical 12, minHeight 44
- [ ] Clicking a row navigates to Return Detail
- [ ] Mock-only back link at top (real app uses system back)

### AC-8: Return Detail Screen
- [ ] Route name "Bangalore to Mysore" uses serif font (reflective.title 32px Newsreader)
- [ ] RideTrace: 220px-tall map card (radius.card) with amber route line + hollow ring at end + 16px start dot, no distance label
- [ ] RideFacts list (NOT stats grid): Date, Distance, Moving time, Elapsed time, Average speed, Max speed, With
- [ ] Each fact: label (departure.label uppercase, ink.secondary) + value (reflective.body serif, ink.primary)
- [ ] NO "Route" fact (not knowable from single ride)
- [ ] NO separate "Riders" section -- "With" covers it
- [ ] PhotoStrip: "Add a photo" link (departure.body, amber.core, mock non-functional) + 3 gray placeholder thumbnails (120x120, radius.card) in horizontal row, no "Photos" subtitle, no "3 photos" caption
- [ ] JournalNote: note text directly in reflective.body (serif), no "Journal" subtitle
- [ ] "Delete this ride" link (departure.label, ink.tertiary) at bottom -- mock non-functional
- [ ] Mock-only back link at top (real app uses system back)

### AC-9: Navigation
- [ ] All navigation paths in the Navigation Map work correctly
- [ ] Mock-only Back links return to expected previous screen
- [ ] EndRide navigates to Return Detail (not list)
- [ ] Planner "Set destination" navigates to Departure
- [ ] No broken links or dead ends

### AC-10: No Backend Dependencies
- [ ] App works with no network connection
- [ ] No API calls, no WebSocket connections, no authentication
- [ ] All data is static/mock
- [ ] Can be opened as static HTML files or served locally with no backend

### AC-11: Visual Quality
- [ ] Feels like a real product, not a wireframe
- [ ] Spacing is generous and consistent (4pt scale)
- [ ] Touch targets: 44 in Departure/Return, **56 in Motion**
- [ ] No visual clutter or unnecessary decoration
- [ ] Premium, restrained, intentional feel throughout
- [ ] All color/type/spacing values transcribed from tokens.ts (no invented hex values)

### AC-12: Design Token Fidelity
- [ ] Every color value matches tokens.ts exactly (no #0A0A0A, #E8E8E8, #888888, #D4A017)
- [ ] Every type scale matches tokens.ts (64/64, 32/36, 15/20, 40/44, 28/34, 17/24, 13/18, 32/40, 19/30, 14/20)
- [ ] Every spacing value matches tokens.ts (4, 8, 12, 16, 24, 32, 48, 64, 96)
- [ ] Every radius value matches tokens.ts (4, 10, 18, 9999)
- [ ] Register contract table values match tokens.ts (contrast floors, padding, touch targets, animation durations)
