/**
 * Horizon design tokens.
 *
 * Source: docs/DESIGN.md §§1-6. Transcribed values only — nothing here is invented or rounded.
 *
 * Per DESIGN.md §7, this file is authoritative the moment it exists: DESIGN.md documents intent
 * and rationale from here on, this file is truth. If the two ever disagree, update DESIGN.md to
 * match a deliberate change here, don't silently drift.
 *
 * There is only dark — no theme provider, no light mode, no logic. Plain data only.
 */

import type { TextStyle } from 'react-native'

export const color = {
  surface: {
    void: '#000000', // Motion register background ONLY. True black: OLED pixels off (battery on a
    // long ride) + maximum contrast in sunlight. Never used as a Departure/Return background.
    base: '#0A0A0B', // Default app background (Departure, Return). Lifted off pure black so the
    // app reads matte, not void.
    raised: '#141416', // Cards, sheets, grouped rows.
    overlay: '#1C1C1F', // Modals, menus, anything above a sheet.
    hairline: '#2A2A2E', // Borders and dividers. Never a full-strength line — separation comes
    // from spacing first.
  },
  ink: {
    primary: '#F5F4F2', // 18.1:1 on base. Body and headline text.
    secondary: '#A3A29E', // 8.4:1 on base. Supporting text, labels.
    tertiary: '#6B6A67', // 3.8:1 on base. Non-essential only — NEVER used in Motion (fails the
    // 7:1 Motion contrast floor; the palette enforces the rule).
    disabled: '#3F3F42', // 1.7:1 on base. Inactive controls. Never carries information.
  },
  amber: {
    core: '#E8A33D', // The single accent. Active state, the live value, the thing that matters
    // now. 9.6:1 on base.
    dim: '#8A6224', // Amber at rest — track fills, inactive segments of an active control.
    wash: 'rgba(232,163,61,0.10)', // Tinted backgrounds. The only acceptable "fill" use of the
    // accent.
  },
  signal: {
    caution: '#E8A33D', // Attention. Deliberately the same value as amber.core — caution and "the
    // live thing" are the same idea.
    critical: '#D4544A', // Safety-critical. Muted, not fire-engine — panic is not the feeling.
    // The ONLY token permitted to interrupt.
    good: '#6E9E7C', // Ready / healthy. Used almost exclusively in Departure ("Am I ready to ride?").
  },
} as const

// Two voices: Operational (Inter, system-sans fallback) carries all riding information across
// the `motion` and `departure` scales below; Reflective (Newsreader, Source Serif 4 / system-serif
// fallback) is journal/archive/story text and appears ONLY in the `reflective` scale — Return
// register only. The `motion` scale below intentionally has no serif entry: the ban on serif in
// Motion is enforced by the token structure itself, not by convention.
// Keys are React Native TextStyle property names, not abstract ones, so a token drops straight
// into `style={type.motion.primary}` with no mapping layer. `satisfies` is what makes that safe:
// it validates every entry against TextStyle (a typo'd or non-RN key is a compile error here
// rather than a silently-ignored style at runtime) while still giving each entry its literal type.
// Deliberately NOT `as const` — that would make the fontVariant arrays readonly, which RN's
// mutable FontVariant[] rejects.
//
// Each entry names a WEIGHT-SPECIFIC font family (`Inter_600SemiBold`), not a family plus a
// `fontWeight`. That is not a style preference — it is how custom fonts work on Android. Each
// face registers under its own family name (see the useFonts call in src/app/_layout.tsx), and
// `fontWeight` does not select between them; a token carrying only `fontWeight: '700'` silently
// renders in the system font (Roboto) at whatever weight it can manage. Setting both risks
// faux-bolding an already-bold face, so weight lives in the family name and nowhere else.
export const type = {
  motion: {
    // Motion is the largest register, not the smallest — the rider is furthest from the screen
    // and has the least time. All riding numerals use tabular figures so digits don't shift
    // width as the value changes (that shift is exactly the flicker the Presence pillar forbids).
    primary: { fontSize: 64, lineHeight: 64, fontFamily: 'Inter_700Bold', fontVariant: ['tabular-nums'] }, // the one number that matters
    secondary: { fontSize: 32, lineHeight: 36, fontFamily: 'Inter_600SemiBold', fontVariant: ['tabular-nums'] }, // at most one of these on screen
    label: { fontSize: 15, lineHeight: 20, fontFamily: 'Inter_500Medium', letterSpacing: 1.2, textTransform: 'uppercase' }, // +0.08em @ 15 = 1.2
  },
  departure: {
    display: { fontSize: 40, lineHeight: 44, fontFamily: 'Inter_600SemiBold' },
    title: { fontSize: 28, lineHeight: 34, fontFamily: 'Inter_600SemiBold' },
    body: { fontSize: 17, lineHeight: 24, fontFamily: 'Inter_400Regular' },
    label: { fontSize: 13, lineHeight: 18, fontFamily: 'Inter_500Medium', letterSpacing: 0.78, textTransform: 'uppercase' }, // +0.06em @ 13 = 0.78
  },
  reflective: {
    // The only register where the serif appears — Return only, which this MVP does not build.
    // Newsreader is therefore NOT loaded by _layout.tsx yet: these three will fall back to the
    // system font until it is. Load it alongside Inter when Return gets built.
    title: { fontSize: 32, lineHeight: 40, fontFamily: 'Newsreader_400Regular' },
    body: { fontSize: 19, lineHeight: 30, fontFamily: 'Newsreader_400Regular' }, // generous leading, this is for reading
    caption: { fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular' }, // captions and stats stay operational
  },
} satisfies Record<string, Record<string, TextStyle>>

// 4pt base. Use the generous end — whitespace is the premium material.
export const space = {
  1: 4, // hairline gaps, icon-to-label
  2: 8, // within a control
  3: 12, // related items
  4: 16, // between rows
  5: 24, // default screen padding
  6: 32, // Motion screen padding, section separation
  7: 48, // between unrelated groups
  8: 64, // register-level breathing room
  9: 96, // isolation — one element, alone, on purpose
} as const

// `full` is for genuinely circular controls ONLY — no pill-shaped buttons, they read as a trend
// and Horizon is meant to be timeless. 9999 is the standard RN "always a circle" hack: it exceeds
// half the size of anything it's applied to, so borderRadius: radius.full is a true circle
// regardless of the element's dimensions.
export const radius = {
  input: 4,
  card: 10,
  sheet: 18,
  full: 9999,
} as const

// Motion explains, it never entertains. Durations in ms; easings as Reanimated-ready bezier
// control points (React Native has no CSS cubic-bezier() string) — the original CSS value is
// commented alongside each so it stays traceable to DESIGN.md.
export const motion = {
  duration: {
    quick: 120, // state feedback — press, toggle, value change. The cap for anything in Motion.
    base: 220, // most transitions.
    considered: 380, // register changes only. The one place a transition is allowed to be felt.
  },
  easing: {
    enter: [0.2, 0, 0, 1], // cubic-bezier(0.2, 0, 0, 1) — things arriving, decelerate into place
    exit: [0.4, 0, 1, 1], // cubic-bezier(0.4, 0, 1, 1) — things leaving
    standard: [0.4, 0, 0.2, 1], // cubic-bezier(0.4, 0, 0.2, 1) — movement within the screen
  },
} as const

// The Horizon Line: a compositional principle, not a drawn line. Every layout divides into three
// zones by fraction of safe-area height. Each value below is the fraction where that zone ENDS
// (and the next begins) — Ahead: 0 → 0.34, Now: 0.34 → 0.58, Held: 0.58 → 1.0. `nowCenter` is
// where the Now band's center sits: deliberately above true center, where a rider's gaze
// naturally rests when the phone is bar-mounted and they're looking up the road.
export const horizon = {
  ahead: 0.34, // 0 → 0.34: what's coming
  now: 0.58, // 0.34 → 0.58: current riding — in Motion, the ONLY zone that carries information
  held: 1.0, // 0.58 → 1.0: deferred — present but not asking
  nowCenter: 0.46,
} as const

// The per-register contract table — the one table to check a screen against.
export const register = {
  departure: {
    background: color.surface.base,
    contrastFloor: 4.5,
    padding: space[5],
    maxAnimationDuration: motion.duration.base,
    touchTarget: 44,
  },
  motion: {
    background: color.surface.void,
    contrastFloor: 7,
    padding: space[6],
    maxAnimationDuration: motion.duration.quick,
    touchTarget: 56,
  },
  return: {
    background: color.surface.base,
    contrastFloor: 4.5,
    padding: space[5],
    maxAnimationDuration: motion.duration.considered,
    touchTarget: 44,
  },
} as const
