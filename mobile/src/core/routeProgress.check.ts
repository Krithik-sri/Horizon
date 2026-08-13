/**
 * Self-check for routeProgress.ts — the rider-to-route matching that a bad refactor
 * could break silently (an off-route rider getting a confident turn cue, the index
 * jumping backwards on a loop, the depart step reappearing as a maneuver). Same style
 * as wsClient.check.ts: a plain assert script, no framework, run with:
 *
 *   npx tsx src/core/routeProgress.check.ts
 */
import type { RouteData, Step } from './models';
import {
  ARRIVE_METERS,
  computeProgress,
  getCumulativeDistances,
  IMMINENT_METERS,
  initialBearing,
  OFF_ROUTE_METERS,
} from './routeProgress';

// Same reasoning as wsClient.check.ts: no @types/node here, so no node:assert.
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message}: got ${actual}, expected ${expected}`);
}
// haversineMeters over a hand-picked lat/lng delta isn't bit-exact with a flat
// meters-per-degree conversion (Earth is a sphere, not a plane) — a tolerance instead
// of assertEqual for anything derived from METERS_PER_DEGREE_LAT below.
function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message}: got ${actual}, expected ~${expected} (±${tolerance})`,
  );
}

// One degree of latitude is ~111,320m — used below to build test polylines at known
// spacings without hand-computing haversine distances.
const METERS_PER_DEGREE_LAT = 111320;
function metersToLatDelta(m: number): number {
  return m / METERS_PER_DEGREE_LAT;
}

function step(instruction: string, wayPointIndex: number): Step {
  return { instruction, distance: 0, duration: 0, type: 0, name: '', wayPoints: [wayPointIndex] };
}

// --- a straight route, 21 vertices ~20m apart running due north from (0,0) ---
const STRAIGHT_STEP_M = 20;
const straightPolyline: RouteData['polyline'] = Array.from({ length: 21 }, (_, i) => [
  0,
  i * metersToLatDelta(STRAIGHT_STEP_M),
]);
// The turn is at vertex 15, not the last vertex (20) — kept short of the route end so
// the "metersToStep hits 0" check below exercises reaching the maneuver itself, not
// the separate arrival state (which starts once fewer than ARRIVE_METERS remain).
const TURN_WAYPOINT = 15;
const straightRoute: RouteData = {
  polyline: straightPolyline,
  steps: [step('Head north on Test Rd', 0), step('Turn right onto NH 44', TURN_WAYPOINT)],
  summary: null,
};

// --- a rider far from the route reports onRoute === false ---
{
  const farAway = { lat: 10, lng: 10 }; // nowhere near (0,0)..(0, ~0.0037)
  const p = computeProgress(straightRoute, farAway, null);
  assertEqual(p.onRoute, false, 'a rider 1000+ km from the route should read off-route');
  assertEqual(p.step, null, 'an off-route rider should not get an asserted turn');
}

// --- the depart step is never returned as `step` ---
{
  const atStart = { lat: 0, lng: 0 };
  const p = computeProgress(straightRoute, atStart, null);
  assert(p.step !== null, 'the only other step on this route should still be findable');
  assert(
    p.step?.instruction !== 'Head north on Test Rd',
    'the depart step (steps[0]) must never be surfaced as the next maneuver',
  );
}

// --- metersToStep decreases monotonically as the rider advances along a straight route ---
{
  let prevIndex: number | null = null;
  let prevMeters = Infinity;
  for (let i = 0; i <= TURN_WAYPOINT; i++) {
    const pos = { lat: straightPolyline[i][1], lng: straightPolyline[i][0] };
    const p = computeProgress(straightRoute, pos, prevIndex);
    assert(
      p.metersToStep <= prevMeters,
      `metersToStep rose while advancing: vertex ${i} gave ${p.metersToStep}, previous was ${prevMeters}`,
    );
    prevMeters = p.metersToStep;
    prevIndex = p.index;
  }
  assertEqual(prevMeters, 0, 'metersToStep should reach 0 once the rider is at the maneuver vertex');
}

// --- arrival is reached at the end of the polyline ---
{
  const last = straightPolyline[straightPolyline.length - 1];
  const atEnd = { lat: last[1], lng: last[0] };
  const p = computeProgress(straightRoute, atEnd, 19);
  assertEqual(p.arrived, true, 'a rider at the final vertex should read arrived');
  assertEqual(p.step, null, 'no maneuver should be asserted once arrived');
}
{
  const p = computeProgress(straightRoute, { lat: 0, lng: 0 }, null);
  assertEqual(p.arrived, false, 'a rider at the start of the route should not read arrived');
}

// --- an out-and-back polyline does not jump the index backwards ---
{
  // Vertices 0..10 head north from (0,0); 11..20 retrace south back toward (0,0) a few
  // metres to the side (a second carriageway, not the exact same lng) — close enough
  // that the old whole-polyline-scan bug would snap back to the outbound leg, but not
  // an exact coordinate match, which would make "nearest" ambiguous by construction
  // rather than testing the windowing.
  const RETURN_LEG_OFFSET_DEG = 0.00003; // ~3m of lng at the equator
  const outAndBack: RouteData['polyline'] = [
    ...Array.from({ length: 11 }, (_, i): [number, number] => [0, i * metersToLatDelta(STRAIGHT_STEP_M)]),
    ...Array.from({ length: 10 }, (_, i): [number, number] => [
      RETURN_LEG_OFFSET_DEG,
      (9 - i) * metersToLatDelta(STRAIGHT_STEP_M),
    ]),
  ];
  const route: RouteData = { polyline: outAndBack, steps: null, summary: null };

  let prevIndex: number | null = null;
  const indices: number[] = [];
  const remaining: number[] = [];
  for (let i = 0; i < outAndBack.length; i++) {
    const pos = { lat: outAndBack[i][1], lng: outAndBack[i][0] };
    const p = computeProgress(route, pos, prevIndex);
    indices.push(p.index);
    remaining.push(p.remainingMeters);
    prevIndex = p.index;
  }
  for (let i = 1; i < indices.length; i++) {
    assert(
      indices[i] >= indices[i - 1],
      `index went backwards on the out-and-back at step ${i}: ${indices[i]} < ${indices[i - 1]} (${JSON.stringify(indices)})`,
    );
  }
  // And it should actually have covered the whole polyline, not gotten stuck at the turnaround.
  assertEqual(indices[indices.length - 1], outAndBack.length - 1, 'the walk should reach the last vertex');

  // remainingMeters is cum[last] - cum[index] — as index climbs monotonically (just
  // asserted above), this must fall monotonically too, and hit the arrival threshold
  // once the rider reaches the final vertex.
  for (let i = 1; i < remaining.length; i++) {
    assert(
      remaining[i] <= remaining[i - 1],
      `remainingMeters rose on the out-and-back at step ${i}: ${remaining[i]} > ${remaining[i - 1]} (${JSON.stringify(remaining)})`,
    );
  }
  assert(
    remaining[remaining.length - 1] <= ARRIVE_METERS,
    `remainingMeters at the final vertex should be within ARRIVE_METERS: got ${remaining[remaining.length - 1]}`,
  );
}

// --- the cumulative-distance array is computed once per polyline, not once per call ---
{
  const a = getCumulativeDistances(straightPolyline);
  const b = getCumulativeDistances(straightPolyline);
  assert(a === b, 'getCumulativeDistances should return the same cached array for the same polyline reference, not recompute it');
  assertClose(a[a.length - 1], STRAIGHT_STEP_M * 20, 1, 'cumulative distance over 20 equal 20m hops should total ~400m');

  // A genuinely different polyline (new array, as every WS `route` message produces)
  // must invalidate the cache rather than return the stale one.
  const other: RouteData['polyline'] = [[0, 0], [0, metersToLatDelta(100)]];
  const c = getCumulativeDistances(other);
  assert(c !== a, 'a different polyline reference must not reuse the previous cache entry');
}

// --- initialBearing: the four cardinal directions land on their compass values ---
{
  assertClose(initialBearing(0, 0, 1, 0), 0, 0.01, 'due north should read as bearing 0');
  assertClose(initialBearing(0, 0, 0, 1), 90, 0.01, 'due east should read as bearing 90');
  assertClose(initialBearing(0, 0, -1, 0), 180, 0.01, 'due south should read as bearing 180');
  assertClose(initialBearing(0, 0, 0, -1), 270, 0.01, 'due west should read as bearing 270');
}

// --- bearingToRoute is null on-route — it only means something once the rider has drifted ---
{
  const p = computeProgress(straightRoute, { lat: 0, lng: 0 }, null);
  assert(p.onRoute, 'sanity: this fix should read on-route for the check below to mean anything');
  assertEqual(p.bearingToRoute, null, 'an on-route rider has no "back to the route" bearing to report');
}

// --- thresholds sanity: constants stay in a sane relative order ---
assert(IMMINENT_METERS < OFF_ROUTE_METERS, 'imminent threshold should be tighter than the off-route threshold');
assert(ARRIVE_METERS <= IMMINENT_METERS, 'arrival should require getting at least as close as "imminent"');

console.log('routeProgress self-check passed');
