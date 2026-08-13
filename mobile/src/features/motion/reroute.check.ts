/**
 * Self-check for useReroute.ts's shouldReroute — the ADR-014 §4 trigger contract a
 * bad refactor could silently loosen (a rider parked at a petrol stop spending a
 * request, or a lost rider grinding past the quota). Same style as the sibling
 * *.check.ts files: a plain assert script, no framework, run with:
 *
 *   npx tsx src/features/motion/reroute.check.ts
 */
import {
  MAX_REROUTES_PER_ROUTE,
  REROUTE_COOLDOWN_MS,
  REROUTE_FIXES,
  REROUTE_METERS,
  REROUTE_SPEED_MPS,
  shouldReroute,
} from './reroute';

// Same reasoning as the sibling check files: no @types/node here, so no node:assert.
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// A state where every one of the five conditions is exactly at its passing boundary.
function passingState() {
  return {
    consecutiveOffRoute: REROUTE_FIXES,
    offRouteMeters: REROUTE_METERS,
    speedMps: REROUTE_SPEED_MPS,
    rerouteCount: 0,
    msSinceLastAttempt: REROUTE_COOLDOWN_MS,
  };
}

// --- all five conditions passing (at their boundary values) fires a reroute ---
assert(shouldReroute(passingState()) === true, 'all five conditions at their boundary should pass');

// --- each condition, failing alone, blocks the reroute ---
assert(
  shouldReroute({ ...passingState(), consecutiveOffRoute: REROUTE_FIXES - 1 }) === false,
  'one fix short of the consecutive-fix requirement should block alone',
);
assert(
  shouldReroute({ ...passingState(), offRouteMeters: REROUTE_METERS - 1 }) === false,
  '1m short of the distance threshold should block alone',
);
assert(
  shouldReroute({ ...passingState(), speedMps: REROUTE_SPEED_MPS - 0.1 }) === false,
  'below the speed floor should block alone',
);
assert(
  shouldReroute({ ...passingState(), rerouteCount: MAX_REROUTES_PER_ROUTE }) === false,
  'a rerouteCount already at the cap should block alone',
);
assert(
  shouldReroute({ ...passingState(), msSinceLastAttempt: REROUTE_COOLDOWN_MS - 1 }) === false,
  '1ms short of the cooldown should block alone',
);

// --- boundary values land on the correct side ---
assert(
  shouldReroute({ ...passingState(), consecutiveOffRoute: REROUTE_FIXES }) === true,
  'exactly REROUTE_FIXES consecutive off-route fixes should pass',
);
assert(
  shouldReroute({ ...passingState(), offRouteMeters: REROUTE_METERS }) === true,
  'exactly REROUTE_METERS off the line should pass',
);
assert(
  shouldReroute({ ...passingState(), speedMps: REROUTE_SPEED_MPS }) === true,
  'exactly REROUTE_SPEED_MPS should pass — the floor is inclusive',
);
assert(
  shouldReroute({ ...passingState(), rerouteCount: MAX_REROUTES_PER_ROUTE - 1 }) === true,
  'one under the cap should still pass',
);
assert(
  shouldReroute({ ...passingState(), rerouteCount: MAX_REROUTES_PER_ROUTE }) === false,
  'a rerouteCount exactly at the cap should block — the cap is exclusive',
);
assert(
  shouldReroute({ ...passingState(), msSinceLastAttempt: REROUTE_COOLDOWN_MS }) === true,
  'exactly REROUTE_COOLDOWN_MS since the last attempt should pass — the cooldown is inclusive',
);

console.log('reroute self-check passed');
