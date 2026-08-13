/**
 * Self-check for rideTrack.ts — the accumulator that turns a stream of GPS fixes into
 * the distance/movingS/track a ride record is made of (docs/ADR/ADR-018.md). Same
 * style as the sibling *.check.ts files: a plain assert script, no framework, run
 * with:
 *
 *   npx tsx src/core/rideTrack.check.ts
 */
import { addFix, emptyTrack, MOVING_SPEED_MPS, TRACK_POINT_METERS } from './rideTrack';

// Same reasoning as the sibling check files: no @types/node here, so no node:assert.
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message}: got ${actual}, expected ~${expected} (±${tolerance})`,
  );
}

// One degree of latitude is ~111,320m — same conversion routeProgress.check.ts uses,
// to build fixes at known spacings without hand-computing haversine distances.
const METERS_PER_DEGREE_LAT = 111320;
function metersToLatDelta(m: number): number {
  return m / METERS_PER_DEGREE_LAT;
}

const START = '2026-08-10T09:00:00.000Z';

// --- emptyTrack then one fix is sane ---
{
  const s = addFix(emptyTrack(START), { lat: 0, lng: 0, speed: 10, ts: 1000 });
  assert(s.startedAt === START, 'startedAt should be carried through unchanged');
  assertClose(s.distanceM, 0, 0, 'the first fix has nothing to measure distance from');
  assertClose(s.movingS, 0, 0, 'the first fix has nothing to measure elapsed time from');
  assert(s.track.length === 1, "the first fix should always be stored as the track's start point");
  assert(s.lastFix !== null && s.lastFix.ts === 1000, 'lastFix should be set from the fix just folded in');
  assert(s.maxSpeedMps === 10, `maxSpeedMps should pick up the only fix's speed, got ${s.maxSpeedMps}`);
}

// --- maxSpeedMps tracks the highest fix, not the latest one ---
{
  let s = emptyTrack(START);
  for (const speed of [5, 20, 8, 15]) {
    s = addFix(s, { lat: 0, lng: 0, speed, ts: 0 });
  }
  assert(s.maxSpeedMps === 20, `maxSpeedMps should be the highest fix seen, got ${s.maxSpeedMps}`);
}

// --- maxSpeedMps ignores a -1 "no reading" sentinel ---
{
  let s = emptyTrack(START);
  s = addFix(s, { lat: 0, lng: 0, speed: 12, ts: 0 });
  s = addFix(s, { lat: 0, lng: 0, speed: -1, ts: 1 }); // expo-location's "can't derive a speed" sentinel
  assert(s.maxSpeedMps === 12, `a -1 sentinel fix should not lower maxSpeedMps, got ${s.maxSpeedMps}`);
}

// --- maxSpeedMps stays 0 for an empty track ---
{
  const s = emptyTrack(START);
  assert(s.maxSpeedMps === 0, `an empty track should have maxSpeedMps 0, got ${s.maxSpeedMps}`);
}

// --- distance accumulates across a straight line of fixes ---
{
  const STEP_M = 20;
  let s = emptyTrack(START);
  let ts = 0;
  for (let i = 0; i <= 10; i++) {
    s = addFix(s, { lat: i * metersToLatDelta(STEP_M), lng: 0, speed: 10, ts });
    ts += 1;
  }
  assertClose(s.distanceM, STEP_M * 10, 1, 'ten 20m hops should total ~200m');
}

// --- movingS does not advance while stopped ---
{
  let s = emptyTrack(START);
  s = addFix(s, { lat: 0, lng: 0, speed: 10, ts: 0 });
  for (let ts = 1; ts <= 5; ts++) {
    s = addFix(s, { lat: 0, lng: 0, speed: 0, ts }); // parked, not moving
  }
  assert(s.movingS === 0, `movingS should not advance while stopped, got ${s.movingS}`);

  // and it should resume once speed clears the floor again
  s = addFix(s, { lat: 0, lng: 0, speed: MOVING_SPEED_MPS, ts: 6 });
  assert(s.movingS === 1, `movingS should advance by the 1s gap once moving again, got ${s.movingS}`);
}

// --- decimation: points land roughly every TRACK_POINT_METERS, not one per fix ---
{
  let s = emptyTrack(START);
  let ts = 0;
  const totalM = 500;
  const fixSpacingM = 5; // far denser than TRACK_POINT_METERS, like real 1Hz GPS at speed
  for (let d = 0; d <= totalM; d += fixSpacingM) {
    s = addFix(s, { lat: metersToLatDelta(d), lng: 0, speed: 10, ts: ts++ });
  }
  const expectedPoints = Math.floor(totalM / TRACK_POINT_METERS) + 1; // +1 for the start point
  assert(
    Math.abs(s.track.length - expectedPoints) <= 1,
    `expected ~${expectedPoints} decimated points over ${totalM}m, got ${s.track.length}`,
  );
  assert(
    s.track.length < totalM / fixSpacingM,
    'decimation should store far fewer points than one per fix',
  );
}

// --- a stationary rider adds no points beyond the start ---
{
  let s = emptyTrack(START);
  s = addFix(s, { lat: 10, lng: 20, speed: 0, ts: 0 });
  for (let ts = 1; ts <= 20; ts++) {
    s = addFix(s, { lat: 10, lng: 20, speed: 0, ts });
  }
  assert(
    s.track.length === 1,
    `a rider who never moves should only ever have the start point, got ${s.track.length}`,
  );
}

console.log('rideTrack self-check passed');
