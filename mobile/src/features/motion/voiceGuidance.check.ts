/**
 * Self-check for voiceGuidance.ts — the ADR-015 §2 corner guard and the tier
 * thresholds a bad refactor could loosen (a cue speaking mid-corner, a re-fired
 * tier, the wrong tier winning a tie). Same style as reroute.check.ts: a plain
 * assert script, no framework, run with:
 *
 *   npx tsx src/features/motion/voiceGuidance.check.ts
 */
import { IMMINENT_METERS } from '@/core/routeProgress';

import {
  dueTier,
  FAR_METERS,
  FINAL_MAX_METERS,
  FINAL_MIN_METERS,
  finalThresholdMeters,
  NEAR_METERS,
} from './voiceGuidance';

// Same reasoning as the sibling check files: no @types/node here, so no node:assert.
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// --- finalThresholdMeters: floor, cap, and the linear region between them ---
assert(finalThresholdMeters(0) === FINAL_MIN_METERS, 'stationary should floor at FINAL_MIN_METERS');
assert(finalThresholdMeters(1) === FINAL_MIN_METERS, 'a slow speed (5m of travel) should still floor at FINAL_MIN_METERS');
assert(finalThresholdMeters(100) === FINAL_MAX_METERS, 'a very high speed should cap at FINAL_MAX_METERS');
assert(finalThresholdMeters(20) === 100, '20 m/s * 5s = 100m, mid-range, uncapped and unfloored');

// --- ADR-015 §2 mechanism 2: the corner guard's structural floor ---
// This is the assertion that fails loudly if anyone lowers FINAL_MIN_METERS below
// IMMINENT_METERS — the whole argument in ADR-015 §2 that the final cue is
// structurally finished before the guard region begins depends on this holding.
assert(FINAL_MIN_METERS > IMMINENT_METERS, 'FINAL_MIN_METERS must stay strictly above IMMINENT_METERS');

// --- dueTier: imminent blocks everything, regardless of every other input ---
assert(
  dueTier({ metersToStep: 5, entryMeters: 10000, speedMps: 0, imminent: true, spoken: new Set() }) === null,
  'imminent must block even when every other condition would otherwise fire',
);
assert(
  dueTier({ metersToStep: 0, entryMeters: 10000, speedMps: 40, imminent: true, spoken: new Set() }) === null,
  'imminent must block regardless of speed or distance',
);

// --- the entryMeters gate: a step first seen at 150m never fires far/near ---
assert(
  dueTier({ metersToStep: 150, entryMeters: 150, speedMps: 5, imminent: false, spoken: new Set() }) === null,
  'first sighting at 150m: nothing due yet — 150m is outside the final threshold too',
);
assert(
  dueTier({ metersToStep: 50, entryMeters: 150, speedMps: 5, imminent: false, spoken: new Set() }) === 'final',
  'once inside the final threshold, a step that entered at 150m fires final — never far or near',
);
assert(
  dueTier({ metersToStep: 50, entryMeters: 150, speedMps: 5, imminent: false, spoken: new Set(['final']) }) === null,
  'far and near remain permanently unreachable for a step that entered at 150m, even once final is used up',
);

// --- already-spoken tiers don't re-fire ---
assert(
  dueTier({
    metersToStep: 150,
    entryMeters: 1000,
    speedMps: 0,
    imminent: false,
    spoken: new Set(['far', 'near']),
  }) === null,
  'far and near already spoken, and this fix is not below the (floored) final threshold — nothing due',
);
assert(
  dueTier({
    metersToStep: 50,
    entryMeters: 1000,
    speedMps: 0,
    imminent: false,
    spoken: new Set(['far', 'near', 'final']),
  }) === null,
  'every tier already spoken for this step should never re-fire',
);

// --- nearest-tier-wins when two thresholds are crossed in the same fix ---
// A fix that jumps from 1000m straight to 150m at walking speed (final floors at
// 60m) crosses both NEAR_METERS (200) and FAR_METERS (800) at once; near is nearer.
assert(
  dueTier({ metersToStep: 150, entryMeters: 1000, speedMps: 0, imminent: false, spoken: new Set() }) === 'near',
  'jumping past far and near at once should fire the nearer tier, near',
);
// A fix that jumps from 1000m straight to 30-and-a-bit (just outside imminent)
// crosses far, near, and final at once (final floors at 60m here); final wins.
assert(
  dueTier({ metersToStep: 31, entryMeters: 1000, speedMps: 0, imminent: false, spoken: new Set() }) === 'final',
  'jumping past far, near and final at once should fire the nearest, final',
);
// Sanity: individually, far alone fires when only its threshold has been crossed.
assert(
  dueTier({ metersToStep: FAR_METERS, entryMeters: FAR_METERS + 1, speedMps: 0, imminent: false, spoken: new Set() }) ===
    'far',
  'crossing exactly into FAR_METERS with nothing else due should fire far',
);
assert(
  dueTier({ metersToStep: NEAR_METERS, entryMeters: NEAR_METERS + 1, speedMps: 0, imminent: false, spoken: new Set() }) ===
    'near',
  'crossing exactly into NEAR_METERS with nothing else due should fire near',
);

console.log('voiceGuidance self-check passed');
