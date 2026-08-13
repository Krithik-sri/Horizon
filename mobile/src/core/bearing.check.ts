/**
 * Self-check for bearing.ts — the camera-heading maths that would drift silently if a
 * refactor broke it (the map spinning at a stoplight, a turn animating the long way
 * round). Same style as wsClient.check.ts/routeProgress.check.ts: a plain assert
 * script, no framework, run with:
 *
 *   npx tsx src/core/bearing.check.ts
 */
import { BEARING_HOLD_SPEED_MPS, nextBearing, smoothBearingStep } from './bearing';

// Same reasoning as the sibling check files: no @types/node here, so no node:assert.
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message}: got ${actual}, expected ${expected}`);
}
function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message}: got ${actual}, expected ~${expected} (±${tolerance})`,
  );
}

// --- smoothBearingStep takes the shortest way round the 359°→0° wraparound ---
{
  // 350° -> 10° is a 20° turn right (clockwise), not a 340° turn left the long way.
  assertEqual(smoothBearingStep(350, 10, 1), 10, 'full step across the wrap should land exactly on the target');
  // Halfway there should be +10° from 350, i.e. 0 — not somewhere near 180.
  assertEqual(smoothBearingStep(350, 10, 0.5), 0, 'half step across the wrap should go the short way (+10), not the long way');
}
{
  // The reverse: 10° -> 350° is a 20° turn left, not a 340° turn right.
  assertEqual(smoothBearingStep(10, 350, 1), 350, 'full step the other way across the wrap should also take the short path');
}

// --- smoothBearingStep with no wraparound involved is a plain lerp ---
assertEqual(smoothBearingStep(0, 90, 0.5), 45, 'a quarter-turn step at alpha 0.5 should land halfway');

// --- smoothBearingStep normalizes out-of-range inputs (e.g. a raw heading of -10) ---
assertEqual(smoothBearingStep(0, -10, 1), 350, 'a negative heading should normalize into [0, 360) and take the short way');

// --- repeated smoothing converges on the target without overshoot ---
{
  let bearing = 0;
  const target = 170;
  let prevDelta = Math.abs(target - bearing);
  for (let i = 0; i < 20; i++) {
    bearing = smoothBearingStep(bearing, target, 0.3);
    const delta = Math.abs(target - bearing);
    assert(delta <= prevDelta, `smoothing moved away from the target at iteration ${i}: ${delta} > ${prevDelta}`);
    prevDelta = delta;
  }
  assertClose(bearing, target, 0.5, 'smoothing should converge on the target after enough iterations');
}

// --- nextBearing holds the last bearing below the speed floor, rather than following noise ---
assertEqual(
  nextBearing(100, 250, BEARING_HOLD_SPEED_MPS - 0.1),
  100,
  'below the speed floor, a wildly different heading must not move the bearing',
);
// --- the speed floor is inclusive of "moving": exactly at it, the fix is trusted ---
assert(
  nextBearing(0, 90, BEARING_HOLD_SPEED_MPS) !== 0,
  'at exactly the speed floor, the bearing should already be following the fix',
);

// --- cold start (no previous bearing) ---
assertEqual(
  nextBearing(null, 250, BEARING_HOLD_SPEED_MPS - 0.1),
  250,
  'cold start below the speed floor has nothing to hold, so it should show the raw heading once',
);
assertEqual(
  nextBearing(null, 45, 10),
  45,
  'cold start above the speed floor should snap straight to the heading, not lag from an assumed 0',
);

console.log('bearing self-check passed');
