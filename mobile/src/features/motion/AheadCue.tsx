import { Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { color, radius, space, type } from '@/design/tokens';
import type { RouteSummary, Step } from '@/core/models';
import type { Progress } from '@/core/routeProgress';

type AheadCueProps = {
  progress: Progress | null;
  summary: RouteSummary | null;
};

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

// 8-point compass — a 16-point reading (NNE vs NE) is not something a rider glancing
// at an ambient cue can act on (ADR-014 §5's "bearing and distance to the nearest
// point on the route" only needs to be actionable, not precise). Index 0 is centered
// on north (bearings within ±22.5° of 0 all read "N"), same modular-rounding trick
// as any 8-point compass rose.
const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function compassPoint(bearingDeg: number): string {
  return COMPASS_POINTS[Math.round(bearingDeg / 45) % 8];
}

// The remaining distance scaled onto the *whole route's* duration, not live speed —
// live speed reads 0 at a traffic light, which would show an infinite ETA for a
// rider who is clearly still arriving on time. ponytail: this assumes the remaining
// km will average the same pace as the whole route did, so a rider deep into a
// motorway stretch with a slow city finish (or vice versa) sees the ETA drift as
// they go. Upgrade path if that drift becomes a real complaint: a per-step
// cumulative duration table (steps already carry `duration`) instead of one
// whole-route ratio. `summary.distance <= 0` (a degenerate route) reads as 0
// progress rather than dividing by zero.
function etaSeconds(remainingMeters: number, summary: RouteSummary): number {
  const ratio = summary.distance > 0 ? clamp01(remainingMeters / summary.distance) : 0;
  return summary.duration * ratio;
}

// Minutes below an hour, "H h MM" past it — never digits enough to reflow the card
// as they tick down mid-ride.
function formatEta(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

// Deliberately not formatDistance above — its .toFixed(1) always shows one decimal,
// which on a steadily-ticking-down remaining distance repaints "42.0 km" every
// frame. Coarser rounding here is the point: it exists to hold the string still,
// not to be precise (tabular-figures' whole reason to exist per tokens.ts).
function formatRemaining(m: number): string {
  if (m >= 10000) return `${Math.round(m / 1000)} km`;
  if (m >= 1000) return `${(Math.round(m / 100) / 10).toFixed(1)} km`;
  return `${Math.round(m / 100) * 100} m`;
}

// Time first, per the brief's "38 min · 42 km" — the number a rider glances for is
// how long, not how far. No summary (RouteData permits `summary: null`) still has a
// true distance to show, since that comes from the cum table alone.
function formatReadout(remainingMeters: number, summary: RouteSummary | null): string {
  const distancePart = formatRemaining(remainingMeters);
  return summary ? `${formatEta(etaSeconds(remainingMeters, summary))} · ${distancePart}` : distancePart;
}

// ORS returns "-" for a way with no name (an unclassified track, a service road)
// rather than omitting the field — printing that literally would read as a typo,
// not as "this road has no name."
function streetName(step: Step): string | null {
  return step.name && step.name !== '-' ? step.name : null;
}

// step.type is ORS's own instruction-type enum, documented at
// github.com/GIScience/openrouteservice-docs ("Instruction Types") and mirrored at
// giscience.github.io/openrouteservice/api-reference/endpoints/directions/instruction-types
// — checked against both rather than guessed, since a wrong arrow here is the
// failure mode the brief that produced this file explicitly called out as worse
// than none:
//   0 Left · 1 Right · 2 Sharp left · 3 Sharp right · 4 Slight left · 5 Slight right
//   6 Straight · 7 Enter roundabout · 8 Exit roundabout · 9 U-turn · 10 Goal
//   11 Depart · 12 Keep left · 13 Keep right
//
// Nine of those fourteen are "point the same dart a different amount" (left/right/
// sharp/slight/straight/keep); roundabout, u-turn and goal are different enough
// manoeuvres that reusing a rotated dart for them would assert something false, so
// they get their own minimal shapes instead. Type 11 (Depart) has no entry: it is
// real in ORS's enum but structurally cannot reach this component — routeProgress.ts
// always starts its step search at steps[1], because steps[0] is the depart
// manoeuvre the rider is already doing by the time a Progress exists. A case for a
// value that can never arrive would be dead code, not defensiveness. Any other miss
// (11, or a value ORS adds in a future API version) falls through the `??` below to
// no glyph — the safe default — rather than a fabricated arrow.
type Glyph =
  | { shape: 'arrow'; rotation: number }
  | { shape: 'roundabout' }
  | { shape: 'uturn' }
  | { shape: 'goal' };

const GLYPH_BY_TYPE: Partial<Record<number, Glyph>> = {
  0: { shape: 'arrow', rotation: -90 }, // Left
  1: { shape: 'arrow', rotation: 90 }, // Right
  2: { shape: 'arrow', rotation: -135 }, // Sharp left
  3: { shape: 'arrow', rotation: 135 }, // Sharp right
  4: { shape: 'arrow', rotation: -45 }, // Slight left
  5: { shape: 'arrow', rotation: 45 }, // Slight right
  6: { shape: 'arrow', rotation: 0 }, // Straight
  7: { shape: 'roundabout' }, // Enter roundabout
  8: { shape: 'roundabout' }, // Exit roundabout — same glyph as enter: the shape
  // means "roundabout," the distinction lives in the instruction text already.
  9: { shape: 'uturn' }, // U-turn
  10: { shape: 'goal' }, // Goal — ORS's own "arrive at your destination" step
  12: { shape: 'arrow', rotation: -30 }, // Keep left
  13: { shape: 'arrow', rotation: 30 }, // Keep right
};

/**
 * One glyph, amber.core throughout. That is not decoration — amber.core's own
 * documented meaning (DESIGN.md §1: "the live value, the thing that matters now")
 * is exactly what a current-manoeuvre icon is, so reusing it here says something
 * specific rather than just looking nice.
 *
 * The nine turn-shaped types share one dart rotated by degree (straight = 0,
 * keep = 30, slight = 45, right = 90, sharp = 135, mirrored negative for left) —
 * one path instead of nine, and the ordering is monotonic in how sharp the turn
 * reads. Roundabout/u-turn/goal are shaped differently on purpose: they are not
 * "a turn by some amount," and a rotated dart standing in for them would be exactly
 * the wrong-arrow failure mode this component exists to avoid.
 */
function ManeuverGlyph({ glyph, size }: { glyph: Glyph; size: number }) {
  const stroke = color.amber.core;
  switch (glyph.shape) {
    case 'arrow':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 4 L20 20 L12 15.5 L4 20 Z" fill={stroke} transform={`rotate(${glyph.rotation} 12 12)`} />
        </Svg>
      );
    case 'roundabout':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={7} stroke={stroke} strokeWidth={2.5} fill="none" />
          <Path d="M12 3 L15.5 7.5 L9.5 7.5 Z" fill={stroke} />
        </Svg>
      );
    case 'uturn':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M8 17 V10 A4 4 0 0 1 16 10 V15" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" fill="none" />
          <Path
            d="M13 12 L16 15.5 L19 12"
            stroke={stroke}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      );
    case 'goal':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={7} stroke={stroke} strokeWidth={2.5} fill="none" />
          <Circle cx={12} cy={12} r={2.5} fill={stroke} />
        </Svg>
      );
  }
}

/**
 * The Ahead band's one persistent, ambient line. "Persistent" is load-bearing, not
 * a style note: the plan's answer to ADR-011's open question ("how does a manoeuvre
 * cue survive the never-interrupt-a-corner rule?") is that this cue never has a
 * delivery *event* for a corner to land on — it already occupies the Ahead band
 * before any given corner exists, so a new instruction is a content swap on an
 * element already on screen, not something arriving. Every branch below exists to
 * preserve that: the four states below map to states already flagged on `Progress`
 * (arrived, off-route, imminent, normal) and every one of them renders *something*
 * in the same card rather than mounting/unmounting it, so nothing here ever
 * appears, slides, flashes, or pulses into the rider's field of view mid-ride.
 *
 * The one exception is deliberate: no `progress` at all (no route yet, or no fix
 * yet to place the rider on one) renders nothing, same as before this component
 * grew states. That's a precondition, not a mid-ride transition — it's over before
 * riding starts, never toggled by anything the rider does while moving.
 */
export default function AheadCue({ progress, summary }: AheadCueProps) {
  if (!progress) {
    return null;
  }

  let primaryText: string;
  let primaryColor: string = color.ink.primary;
  let glyph: Glyph | null = null;
  let street: string | null = null;
  // Third line, set only where an ETA/distance is actually true: not arrived (moot —
  // you're there), not off-route (remainingMeters is stale once `index` no longer
  // tracks the rider — see Progress's own doc comment on the field).
  let readout: string | null = null;

  if (progress.arrived) {
    // A real, named state — not the cue quietly going blank as the last
    // manoeuvre's distance counted down to nothing.
    primaryText = 'Arrived';
    glyph = { shape: 'goal' };
  } else if (!progress.onRoute) {
    // Off-route must not assert a turn that may no longer be true — no glyph, no
    // street, just the honest observation, now with a bearing and distance back to
    // the line (ADR-014 §5's zero-quota degraded mode: computed entirely from
    // Progress, no network, the floor this feature never drops below). Shown
    // whenever off-route, reroute attempts or no — it costs nothing to compute and
    // needs no data this component doesn't already have. Dimmed to ink.secondary
    // (8.4:1, still clears Motion's 7:1 floor) because this is a status, not a
    // directive — the one place in this component where color says "less certain"
    // rather than "the live thing."
    primaryText =
      progress.bearingToRoute !== null
        ? `Off route · ${formatDistance(progress.offRouteMeters)} ${compassPoint(progress.bearingToRoute)}`
        : 'Off route';
    primaryColor = color.ink.secondary;
  } else if (progress.step) {
    const { step } = progress;
    // Imminent replaces the counting-down distance with "Now" rather than
    // dropping the distance slot entirely — same "word · instruction" template
    // either way, so nothing about the layout reflows, and "Now" reads as the
    // immediate command the brief asked for without needing to graft the word
    // onto server-supplied instruction text.
    primaryText = `${progress.imminent ? 'Now' : formatDistance(progress.metersToStep)} · ${step.instruction}`;
    glyph = GLYPH_BY_TYPE[step.type] ?? null;
    street = streetName(step);
    readout = formatReadout(progress.remainingMeters, summary);
  } else {
    // On route, not arrived, nothing upcoming — reachable only when this route's
    // `steps` is null (RouteData allows it; ADR-011 §"steps and summary may be
    // null"), since routeProgress.ts otherwise keeps resolving the final Goal step
    // right up until `arrived` flips. Nothing true to say, so nothing renders —
    // the same allowance the off-route case has explicitly. This is constant for
    // a steps-less route, never a mid-ride flicker, so it doesn't reopen the
    // appear/disappear problem the rest of this component exists to close.
    // ponytail: no neutral "on route" filler line for this gap — add one if a
    // real ORS response with steps: null ships and an empty Ahead band turns out
    // to matter in practice.
    return null;
  }

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: color.surface.void,
        borderRadius: radius.card,
        // Snug card padding — the screen-edge padding (space[6]) is applied once,
        // at the HorizonLine band level, so this doesn't double it.
        padding: space[4],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        {glyph && <ManeuverGlyph glyph={glyph} size={28} />}
        <View style={{ flex: 1 }}>
          <Text style={[type.motion.secondary, { color: primaryColor }]}>{primaryText}</Text>
          {street && <Text style={[type.motion.label, { color: color.ink.secondary }]}>{street}</Text>}
          {/* ADR-012 §2: exactly one element occupies the Ahead band; only its content
              changes. This line is content inside that one card, same as `street`
              above it — it must never become a sibling element in the Ahead band
              itself, which would reopen the mid-ride-appearance problem §2 closes. */}
          {readout && <Text style={[type.motion.label, { color: color.ink.secondary }]}>{readout}</Text>}
        </View>
      </View>
    </View>
  );
}
