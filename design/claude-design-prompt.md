You are designing **Horizon** — a premium native companion app for motorcycle riders. Android
first, iOS later. React Native. There is no web client.

Design the complete app, end to end, using the fixed foundations below. **Do not invent or adjust
any token value.** Colors, type sizes, spacing, radii, and durations are already decided and live
in code; your job is composition — screens, states, hierarchy, and layout — not a new palette.

---

## 1. What Horizon is

Horizon is **not** a navigation app, a social network, a fitness tracker, or a dashboard. It does
not compete with Google Maps.

Horizon exists for everything that happens **between departure and arrival**. Navigation apps
optimize destinations; Horizon optimizes the riding experience. It is an invisible co-rider.

Every design decision answers one question: *"Does this help someone enjoy, understand, or safely
experience the ride?"* If not, it does not belong.

The measure of success is a rider finishing a ride and saying: **"I barely noticed Horizon was
there."**

Horizon is not futuristic. It is timeless — it should still feel elegant in ten years. Avoid
trends. Avoid visual noise. Avoid decoration.

### Pillars

- **Respect** — the rider's attention is sacred. Nothing competes with the road. No engagement
  tricks.
- **Presence** — technology should disappear. The rider experiences the road, not the interface.
- **Confidence** — every piece of information must increase confidence. **If information cannot be
  trusted, it must not be shown.**
- **Exploration** — encourage curiosity, never through gamification.

---

## 2. Hard bans — a design violating any of these is rejected

1. **No gamification.** No badges, streaks, XP, levels, achievements, trophies, or **leaderboards**.
   No notification counts. No ranking of riders anywhere, ever.
2. **No interruption that is not safety-critical.** See the Attention Ladder (§4).
3. **No gradients, no glows, no neon, no decorative shadows.** Elevation is expressed by the
   surface ramp only.
4. **No hue outside the palette in §5.** One accent: amber.
5. **The serif never appears in the Motion register.**
6. **No pill-shaped buttons.** They read as a trend; Horizon is timeless.
7. **No UI-library look.** Every component is custom. Nothing should look like Material or iOS
   default chrome.
8. **The motorcycle is an emotional anchor, not decoration.** The interface must never become a
   motorcycle showroom — no hero bike renders, no chrome, no engine imagery.

---

## 3. The three registers

Every screen belongs to exactly one register. These are **states of mind, not routes.** Typography,
density, animation, and interaction all change between them.

| Register | The rider is | The app is | Answers |
|---|---|---|---|
| **Departure** | preparing | calm, confident | "Am I ready to ride?" |
| **Motion** | moving | almost invisible | only what is essential right now |
| **Return** | finished | reflective | photos, journal, stats, stories |

**Motion is the strictest register. Design it first; the other two relax outward from it.** A
component that is correct in Return can be wrong — even unsafe — in Motion.

The register contract, which every screen must satisfy:

| | **Departure** | **Motion** | **Return** |
|---|---|---|---|
| Background | `surface.base` | `surface.void` | `surface.base` |
| Type voice | Operational | Operational | Operational + **Reflective** |
| Largest text | 40 | **64** | 32 |
| Contrast floor | 4.5:1 | **7:1** | 4.5:1 |
| Screen padding | 24 | **32** | 24 |
| Max animation | 220 ms | **120 ms** | 380 ms |
| Touch target | 44 | **56** | 44 |
| Elements on screen | as needed | **as few as possible** | as many as earned |
| *Held* zone | present | **collapsed** | primary |
| Interruptions | permitted | **safety only** | permitted |

---

## 4. Attention rules

**The Attention Ladder** — escalate gradually, never jump to a loud channel:

```
Ambient → Peripheral → Haptic → Audio → Visual → Interrupt
```

Visual is **not** the default. Reach for it only after ambient, peripheral, haptic, and audio have
been ruled insufficient. **Interrupt is reserved for safety-critical situations only** — never for
a message, a summary, or anything that can wait.

**Silence Budget** — attention is finite. Any new element that wants to interrupt the rider must
*replace* an existing interruption; it does not get to add to the total. Safety events are exempt.

**Never Interrupt a Corner** — no non-safety information reaches the rider while they are turning,
leaning, braking, or mid-maneuver. **This overrides every other rule in this document.**

**Deferred Delivery** — messages, summaries, insights, photos, and analytics wait until the ride
ends or the rider stops. They surface naturally in Return. If content is not urgent and not safety-
related, the default is to hold it — not to find a quieter way to show it now.

**Motion explains, never entertains** — every animation must answer "what does this help the rider
understand?" If the answer is "it looks impressive," remove it.

---

## 5. Foundations — fixed, transcribe exactly

Dark-first and matte. Color communicates meaning, never decoration.

### Surfaces

| Token | Hex | Use |
|---|---|---|
| `surface.void` | `#000000` | **Motion background only.** True black — OLED pixels off, saving battery and giving maximum sunlight contrast. |
| `surface.base` | `#0A0A0B` | Default background (Departure, Return). Lifted off pure black so the app reads matte, not void. |
| `surface.raised` | `#141416` | Cards, sheets, grouped rows. |
| `surface.overlay` | `#1C1C1F` | Modals, menus, anything above a sheet. |
| `surface.hairline` | `#2A2A2E` | Borders and dividers. Never full-strength — separation comes from spacing first. |

### Ink — warm off-white, never clinical `#FFFFFF`

| Token | Hex | Contrast on base | Use |
|---|---|---|---|
| `ink.primary` | `#F5F4F2` | 18.1:1 | Body and headline text. |
| `ink.secondary` | `#A3A29E` | 8.4:1 | Supporting text, labels. |
| `ink.tertiary` | `#6B6A67` | 3.8:1 | Non-essential only. **Never in Motion.** |
| `ink.disabled` | `#3F3F42` | 1.7:1 | Inactive controls. Never carries information. |

### Accent — there is exactly one

| Token | Hex | Use |
|---|---|---|
| `amber.core` | `#E8A33D` | The single accent. Active state, the live value, the thing that matters now. |
| `amber.dim` | `#8A6224` | Amber at rest — track fills, inactive segments of an active control. |
| `amber.wash` | `rgba(232,163,61,0.10)` | Tinted backgrounds. The only acceptable fill use of the accent. |

### Signal — safety semantics only, never a badge or a count

| Token | Hex | Meaning |
|---|---|---|
| `signal.caution` | `#E8A33D` | Attention. Deliberately identical to `amber.core` — caution and "the live thing" are the same idea. |
| `signal.critical` | `#D4544A` | Safety-critical. Muted, not fire-engine — panic is not the feeling. **The only token permitted to interrupt.** |
| `signal.good` | `#6E9E7C` | Ready / healthy. Almost exclusively Departure ("Am I ready to ride?"). |

### Typography — two voices, and the separation is the point

| Voice | Family | Used for |
|---|---|---|
| **Operational** | **Inter** | All riding information. Cool, precise, objective. Departure + Motion. |
| **Reflective** | **Newsreader** (serif) | Journal, archive, stories, memories. **Return only.** |

**All numerals in riding data use tabular figures.** A speed readout whose digits shift width as it
changes is exactly the flicker Presence forbids.

Motion is the *largest* register, not the smallest — the rider is furthest from the screen with the
least time to look.

**Motion** (operational only): `motion.primary` 64/64 w700 tabular · `motion.secondary` 32/36 w600
tabular (at most one on screen) · `motion.label` 15/20 w500 uppercase +0.08em.

**Departure**: `display` 40/44 w600 · `title` 28/34 w600 · `body` 17/24 w400 · `label` 13/18 w500
uppercase +0.06em.

**Return**: `reflective.title` 32/40 w400 Newsreader · `reflective.body` 19/30 w400 Newsreader
(generous leading — this is for reading) · `reflective.caption` 14/20 w400 Inter (captions and
stats stay operational).

**There is no serif size in the Motion scale.** That is not an oversight — the ban is structural.

### Spacing — 4pt base; use the generous end, whitespace is the premium material

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96`

24 is default screen padding; 32 is Motion screen padding; 96 means one element, alone, on purpose.

**Radius:** 4 (inputs) · 10 (cards) · 18 (sheets) · full (only genuinely circular controls).

**Touch targets: 44×44 minimum, 56×56 in Motion.** The design case is a gloved hand on a vibrating
motorcycle — not a thumb on a sofa.

### Animation

`quick` 120 ms (state feedback; **the cap for anything in Motion**) · `base` 220 ms (most
transitions) · `considered` 380 ms (register changes only — the one place a transition may be
felt).

Easing: enter `cubic-bezier(0.2, 0, 0, 1)` · exit `cubic-bezier(0.4, 0, 1, 1)` · standard
`cubic-bezier(0.4, 0, 0.2, 1)`.

**No overshoot, no bounce, ever.** A bouncing element is an element asking for attention it has not
earned. Nothing in the rider's field of view animates for longer than 120 ms.

---

## 6. The Horizon Line — the layout system

Every layout has a visual horizon. This is a compositional principle, not a drawn line. Each screen
divides into three zones by fraction of safe-area height:

| Zone | Fraction | Holds |
|---|---|---|
| **Ahead** | 0 → 0.34 | What is coming. Next turn, upcoming hazard, distance remaining. |
| **Now** | 0.34 → 0.58 | Current riding. **In Motion this is the only zone carrying information.** |
| **Held** | 0.58 → 1.0 | Deferred. Messages, photos, insights — present but not asking. |

The *Now* band's center sits at **0.46** — deliberately above true center, where a rider's gaze
rests when the phone is bar-mounted and they are looking up the road.

- **Departure** — all three zones active. *Ahead* is the route, *Now* is readiness, *Held* is
  everything that can wait.
- **Motion** — *Ahead* is a single upcoming cue at most, *Now* carries the essential readout,
  *Held* is **collapsed entirely.** Deferred content does not exist on screen while riding.
- **Return** — the line softens. *Held* becomes the primary zone; this is when everything that
  waited finally arrives.

Show the Horizon Line zones explicitly as an annotated layout template, then show every screen
composed against it.

---

## 7. What to design — in this order

Deliver each phase completely before moving on. **Phase A and B are the priority**: a design that
survives 80 km/h glanceability will survive Departure and Return; the reverse is not true.

### Phase A — Foundations

Swatch, scale, spacing, radius, and motion cards for everything in §5, plus the annotated Horizon
Line template from §6. One card per group: Color, Type, Spacing, Motion, Horizon Line.

### Phase B — Motion register (strictest — design this properly or nothing else matters)

The screen is a full-bleed dark map (MapLibre, dark matte style) with the HUD composed over it.

1. **Motion HUD, riding alone** — own position on the map; one primary readout (speed) in *Now*;
   *Held* collapsed. Prove 7:1 contrast and one-glance legibility.
2. **Motion HUD, riding in a convoy** — other riders as dots on the map with a minimal peripheral
   presence for who is out there. **Critical: riders are listed in a stable arbitrary order so the
   list does not jitter between frames. That order is NOT a ranking and must never read as one.**
   No positions, no distances-ahead, no ordering by progress, no "1st/2nd/3rd", no standings.
3. **A stale rider** — when a rider's last GPS fix is older than ~10 seconds, they grey out. Design
   that degradation so it reads as "unknown," never as alarm.
4. **Ahead cue** — a single upcoming turn or hazard in the *Ahead* zone. Show the empty (no cue)
   state too; empty is the normal state.
5. **Voice is live** — the convoy voice channel is active. This must be ambient or peripheral on
   the ladder, never visual chrome demanding attention. Show the muted state as well.
6. **The safety interrupt** — the single permitted interruption, using `signal.critical`. This is
   the loudest thing in the entire app; design it so it is unmistakable yet does not induce panic,
   and can be dismissed or auto-dismissed without a deliberate interaction.
7. **Connection lost / reconnecting** — the convoy link drops (mobile networks do). The rider must
   understand what is trustworthy and what is not, without being alarmed. Confidence pillar: stale
   data must never masquerade as live.
8. **Rider has stopped** — motion ends without the ride ending. This is the moment deferred content
   is allowed to become quietly available. Show the transition into that state.

### Phase C — Departure register

9. **Readiness** — the one screen answering "Am I ready to ride?" Use `signal.good`. Decide what
   genuinely belongs here and cut everything else.
10. **Plan a ride** — set a destination and get a route line. One route fetch per ride, not per
    rider.
11. **Start or join a convoy** — a ride produces a short join code; another rider enters it.
    Design both directions, including the code-entry input.
12. **First run** — permissions, especially location. Explain honestly, ask once, no dark patterns.
13. **Sign in** — email-based. Minimal, calm, forgettable in the right way.

### Phase D — Return register — the only place the serif appears

14. **Ride summary** — what the ride *was*. Statistics without ranking, comparison, or scoring.
15. **Journal entry** — reflective serif, generous leading, built for writing and reading.
16. **Photos and archive** — everything withheld during Motion arrives here.
17. **Ride history** — past rides as memories, not as a log or a feed.

### Phase E — Components

Buttons and controls (both target sizes), sheets, list rows, the code-entry input, empty states,
map markers (own rider vs. other riders vs. stale), the route line treatment, and the pattern for
content that has been deferred and is now available.

---

## 8. How to present the work

- Dark backgrounds, mobile portrait frames, realistic content — real speeds, real place names, real
  journal prose. Never lorem ipsum, never placeholder greys.
- Label every screen with its register and mark the three Horizon Line zones.
- For each screen, state in one line **what was deliberately left out and why.** Restraint is the
  deliverable; a screen with nothing removed has not been designed.
- Show empty, degraded, and error states — for a riding app those are not edge cases, they are
  Tuesday.
- Design for one-handed, gloved, sunlit, vibrating use. If it needs a second look, it has failed.

## 9. Acceptance checklist — run against every screen before delivering it

- [ ] Which register is this, and does it obey that register's row in the §3 table exactly?
- [ ] If it can appear in Motion: essential information only, 7:1 contrast, no serif, 56px targets,
      nothing animating past 120 ms?
- [ ] Does it interrupt? If so, is it safety-critical — and what existing interruption does it
      replace?
- [ ] Could it fire while the rider is turning, leaning, or braking? Then it must not.
- [ ] Is every color communicating meaning rather than decorating?
- [ ] Does every animation explain something, rather than perform?
- [ ] Any badge, streak, count, ranking, or ordering that could be read as standings? Remove it.
- [ ] Is non-urgent content deferred to Return instead of surfaced live?
- [ ] Does every pixel earn its place?
