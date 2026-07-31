# Design — the Horizon design language

Concrete values. [`PRODUCT.md`](./PRODUCT.md) says *why*; this file says *what*, in numbers you can
transcribe without inventing anything.

**This document is the spec. `mobile/src/design/tokens.ts` will be the implementation, and once it
exists it becomes authoritative** — this file then documents intent and rationale, not truth. The
rules for applying all of it live in the `horizon-design` skill.

> Nothing here is built yet. `mobile/src/` is empty; `tokens.ts` is task #1 of the design work.

---

## 1. Color

Dark-first and matte. Two rules govern everything below:

1. **Color communicates meaning, never decoration.** If a color is there because it looks nice,
   delete it.
2. **There is one accent.** Amber. A second accent hue needs an ADR.

### Surfaces

| Token | Hex | Use |
|---|---|---|
| `surface.void` | `#000000` | **Motion register background only.** True black: OLED pixels are off, which buys battery on a long ride and maximum contrast in sunlight. |
| `surface.base` | `#0A0A0B` | Default app background (Departure, Return). Lifted off pure black so the app reads matte, not void. |
| `surface.raised` | `#141416` | Cards, sheets, grouped rows. |
| `surface.overlay` | `#1C1C1F` | Modals, menus, anything above a sheet. |
| `surface.hairline` | `#2A2A2E` | Borders and dividers. Never a full-strength line — separation comes from spacing first. |

### Ink

Warm off-white, not clinical `#FFFFFF` — the warmth is what keeps it matte.

| Token | Hex | Contrast on `base` | Use |
|---|---|---|---|
| `ink.primary` | `#F5F4F2` | 18.1:1 | Body and headline text. |
| `ink.secondary` | `#A3A29E` | 8.4:1 | Supporting text, labels. |
| `ink.tertiary` | `#6B6A67` | 3.8:1 | **Non-essential only.** Never used in Motion. |
| `ink.disabled` | `#3F3F42` | 1.7:1 | Inactive controls. Never carries information. |

### Accent

| Token | Hex | Use |
|---|---|---|
| `amber.core` | `#E8A33D` | The single accent. Active state, the live value, the thing that matters now. 9.6:1 on `base`. |
| `amber.dim` | `#8A6224` | Amber at rest — track fills, inactive segments of an active control. |
| `amber.wash` | `rgba(232,163,61,0.10)` | Tinted backgrounds. The only acceptable "fill" use of the accent. |

### Signal — safety semantics only

Never decorative, never a status badge, never a count.

| Token | Hex | Meaning |
|---|---|---|
| `signal.caution` | `#E8A33D` | Attention. Deliberately the same value as `amber.core` — caution and "the live thing" are the same idea. |
| `signal.critical` | `#D4544A` | Safety-critical. Muted, not fire-engine — panic is not the feeling. The **only** token permitted to interrupt. |
| `signal.good` | `#6E9E7C` | Ready / healthy. Used almost exclusively in Departure ("Am I ready to ride?"). |

**Banned:** gradients, glows, neon, shadows used as decoration, any hue outside the tables above.
Elevation is expressed by the surface ramp, not by shadow.

### Contrast floors

- Departure / Return: **4.5:1** for body text, 3:1 for large text.
- **Motion: 7:1 for everything.** Sunlight, vibration, a glance measured in fractions of a second.
  `ink.tertiary` fails this, which is why it is banned in Motion — the palette enforces the rule.

---

## 2. Typography

Two voices. The separation is the point.

| Voice | Family | Fallback | Used for |
|---|---|---|---|
| **Operational** | **Inter** | system sans | All riding information. Cool, precise, objective. |
| **Reflective** | **Newsreader** | Source Serif 4, system serif | Journal, archive, stories, memories. **Return register only.** |

Both are SIL Open Font License — free, no account, consistent with the no-card constraint.

**All numerals in riding data use tabular figures** (`fontVariant: ['tabular-nums']`). A speed
readout whose digits shift width as it changes is exactly the flicker the Presence pillar forbids.

### Scale

Motion is the largest register, not the smallest. The rider is furthest from the screen and has
the least time.

**Motion** — operational only:

| Token | Size / Line | Weight | Notes |
|---|---|---|---|
| `motion.primary` | 64 / 64 | 700 | The one number that matters. Tabular. |
| `motion.secondary` | 32 / 36 | 600 | At most one of these on screen. Tabular. |
| `motion.label` | 15 / 20 | 500 | Uppercase, `+0.08em` tracking. |

**Departure** — operational:

| Token | Size / Line | Weight |
|---|---|---|
| `departure.display` | 40 / 44 | 600 |
| `departure.title` | 28 / 34 | 600 |
| `departure.body` | 17 / 24 | 400 |
| `departure.label` | 13 / 18 | 500, `+0.06em`, uppercase |

**Return** — the only register where the serif appears:

| Token | Size / Line | Weight | Family |
|---|---|---|---|
| `reflective.title` | 32 / 40 | 400 | Newsreader |
| `reflective.body` | 19 / 30 | 400 | Newsreader — generous leading, this is for reading |
| `reflective.caption` | 14 / 20 | 400 | Inter — captions and stats stay operational |

**The serif has no Motion size.** That is not an oversight and not a convention to be remembered —
the `motion` scale contains no serif entry, so the ban is enforced by the token structure itself.

---

## 3. Spacing

4pt base. Use the generous end; whitespace is the premium material.

| Token | px | Typical use |
|---|---|---|
| `space.1` | 4 | Hairline gaps, icon-to-label |
| `space.2` | 8 | Within a control |
| `space.3` | 12 | Related items |
| `space.4` | 16 | Between rows |
| `space.5` | 24 | **Default screen padding** |
| `space.6` | 32 | **Motion screen padding**, section separation |
| `space.7` | 48 | Between unrelated groups |
| `space.8` | 64 | Register-level breathing room |
| `space.9` | 96 | Isolation — one element, alone, on purpose |

**Radius:** `4` (inputs) · `10` (cards) · `18` (sheets) · `full` (only for genuinely circular
controls). No pill-shaped buttons — they read as a trend, and Horizon is meant to be timeless.

**Touch targets: 44×44 minimum, 56×56 in Motion.** A gloved hand on a vibrating bike is the design
case, not a thumb on a sofa.

---

## 4. Animation

Motion explains. It never entertains.

| Token | ms | Use |
|---|---|---|
| `duration.quick` | 120 | State feedback — press, toggle, value change. **The cap for anything in Motion.** |
| `duration.base` | 220 | Most transitions. |
| `duration.considered` | 380 | Register changes only. The one place a transition is allowed to be felt. |

| Token | Curve | Use |
|---|---|---|
| `easing.enter` | `cubic-bezier(0.2, 0, 0, 1)` | Things arriving — decelerate into place |
| `easing.exit` | `cubic-bezier(0.4, 0, 1, 1)` | Things leaving |
| `easing.standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | Movement within the screen |

**No overshoot, no bounce, ever.** If `withSpring` is used, it must be critically damped
(`damping ≥ 20`, no visible oscillation) — otherwise use `withTiming`. A bouncing element is an
element asking for attention it has not earned.

**Nothing in the rider's field of view animates for longer than 120 ms.** Respect the corner.

---

## 5. The Horizon Line

A compositional principle, not a drawn line. Every layout divides into three zones by fraction of
safe-area height:

| Zone | Fraction | Holds |
|---|---|---|
| **Ahead** | `0 → 0.34` | What is coming. Next turn, upcoming hazard, distance remaining. |
| **Now** | `0.34 → 0.58` | Current riding. **In Motion this is the only zone that carries information.** |
| **Held** | `0.58 → 1.0` | Deferred. Messages, photos, insights — present but not asking. |

The *Now* band's center sits at `0.46` — deliberately above true center, where a rider's gaze
naturally rests when the phone is bar-mounted and they are looking up the road.

Per register:

- **Departure** — all three zones active. *Ahead* is the route, *Now* is readiness, *Held* is
  everything that can wait.
- **Motion** — *Ahead* is minimal (a single upcoming cue), *Now* carries the essential readout,
  *Held* is **collapsed entirely.** Deferred content does not exist on screen while riding.
- **Return** — the line softens. *Held* becomes the primary zone; this is when everything that
  waited arrives.

---

## 6. Register summary

The one table to check a screen against.

| | **Departure** | **Motion** | **Return** |
|---|---|---|---|
| Background | `surface.base` | `surface.void` | `surface.base` |
| Type voice | Operational | Operational | Operational + **Reflective** |
| Largest text | 40 | **64** | 32 |
| Contrast floor | 4.5:1 | **7:1** | 4.5:1 |
| Screen padding | `space.5` (24) | `space.6` (32) | `space.5` (24) |
| Max animation | 220 ms | **120 ms** | 380 ms |
| Touch target | 44 | **56** | 44 |
| Elements on screen | as needed | **as few as possible** | as many as earned |
| *Held* zone | present | **collapsed** | primary |
| Interruptions | permitted | **safety only** | permitted |

---

## 7. Building the design system with Claude Design

The workflow, in order. **`tokens.ts` is authoritative and the design system is generated from
it** — that ordering is what stops the design and the app from drifting apart. Hand-authored
preview HTML always diverges from the app within a month.

### Step 1 — `mobile/src/design/tokens.ts`

Transcribe §§1–6 above into plain exported objects: `color`, `type`, `space`, `radius`, `motion`,
`horizon`, `register`. No logic, no theme provider, no abstraction — a theming layer can be added
the day a second theme exists. There is only dark.

### Step 2 — `design/build.ts`

~60 lines. Imports `tokens.ts`, emits static HTML preview cards into `design/out/`. Run it with
`npx tsx design/build.ts`.

Every emitted file **must start with** a card marker as its first line:

```html
<!-- @dsCard group="Color" -->
```

That first-line comment is what Claude Design indexes to build its card grid — without it the file
uploads but never appears as a card. Groups to emit: `Color`, `Type`, `Spacing`, `Motion`,
`Horizon Line`, `Motion HUD`.

### Step 3 — push to claude.ai/design

Try `/design-sync` first — it drives this flow if your install has it. Otherwise Claude drives the
`DesignSync` tool directly:

| Call | What happens |
|---|---|
| `list_projects` | Read-only. May prompt once to add design-system scope to your claude.ai login. **If the session has no claude.ai login, run `/design-login` first.** |
| `create_project` | **Permission prompt.** Name it `Horizon`. Must be created as a design-system project — that type is immutable, so an ordinary project can never be converted into one later. |
| `finalize_plan` | **Permission prompt.** Locks the exact write paths and the source directory (`design/out`). You see the real path list independently of anything Claude says about it. |
| `write_files` | Uploads by `localPath` — file contents never pass through the model's context. |

### Step 4 — iterate

Change `tokens.ts` → re-run the build → re-push. Never edit the generated HTML directly; it is
output, and the next build overwrites it.

**Scope for the first pass: Foundations + Motion only.** Motion is the strictest register — a
design that survives 80 km/h glanceability will survive Departure and Return, and the reverse is
not true. Departure and Return components wait until Motion is settled.
