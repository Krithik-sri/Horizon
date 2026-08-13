/**
 * Incremental accumulation of a ride's distance, moving time and track while it's in
 * progress — the pure half of the Return register's data layer (docs/ADR/ADR-018.md).
 * Pure and side-effect free, same split as routeProgress.ts and reroute.ts: the
 * Supabase/AsyncStorage I/O that turns this into a saved `Ride` lives in rides.ts,
 * which imports supabase.ts and therefore `react-native` — a module graph plain `tsx`
 * can't transform (the *.check.ts constraint every other pure core module already
 * follows). useRide.ts folds each GPS fix through addFix and only calls into rides.ts
 * at ride start (the pending-row guard) and ride end (the real save).
 *
 * Coordinate order: `track` is [lng, lat] (GeoJSON/MapLibre order, CLAUDE.md's known
 * trap, matching route.polyline and the rides table's `track` column) — `fix` in
 * addFix is lat/lng, like every other GPS fix in this app. The swap happens once,
 * inside addFix.
 */
import { haversineMeters } from './routeProgress';

export type TrackState = {
  startedAt: string;
  distanceM: number;
  movingS: number;
  maxSpeedMps: number;
  track: [number, number][];
  lastFix: { lat: number; lng: number; ts: number } | null;
};

// One point per ~50m keeps a 300km ride at roughly 6,000 points — "a few hundred KB
// of jsonb", per ADR-018's Negative consequences — instead of the multi-MB row a
// point-per-GPS-fix track would produce over a multi-hour ride at 1Hz.
export const TRACK_POINT_METERS = 50;

// Below this the rider is stopped — a red light, a fuel stop, a photo — not moving.
// GPS-reported speed jitters near zero even when genuinely stationary, so 0 itself
// would be too tight a floor.
export const MOVING_SPEED_MPS = 0.5;

export function emptyTrack(startedAt: string): TrackState {
  return { startedAt, distanceM: 0, movingS: 0, maxSpeedMps: 0, track: [], lastFix: null };
}

/**
 * Folds one GPS fix into the accumulator. Pure — returns a new TrackState, never
 * mutates `s`.
 *
 * Distance accumulates from every fix regardless of speed — a rider pushing the bike
 * a few metres at walking pace has still moved. Moving time only advances when this
 * fix's speed clears MOVING_SPEED_MPS, and it gates the elapsed time since the
 * *previous* fix (the only interval there's actually a duration for — this fix's own
 * dwell time isn't knowable until the next one arrives).
 *
 * `track` gets a new point only once the rider has moved TRACK_POINT_METERS since the
 * last *stored* point, not the last fix — that's the decimation the module comment
 * describes. The very first fix is always stored (there is no "last stored point" to
 * measure against yet), so the track always has a start coordinate even before the
 * rider has covered 50m.
 *
 * `maxSpeedMps` tracks the highest fix.speed seen (ADR-019 §2: max speed is a fact
 * about this ride, ships because it needs no second ride to compute). `expo-location`
 * reports -1 for speed on some Android devices when it can't derive one — that's "no
 * reading", not "moving backwards", so a negative speed is floored to 0 before it can
 * feed either the moving-time gate or the max.
 */
export function addFix(
  s: TrackState,
  fix: { lat: number; lng: number; speed: number; ts: number },
): TrackState {
  const speed = Math.max(0, fix.speed);
  let distanceM = s.distanceM;
  let movingS = s.movingS;
  const maxSpeedMps = Math.max(s.maxSpeedMps, speed);

  if (s.lastFix) {
    distanceM += haversineMeters(s.lastFix.lat, s.lastFix.lng, fix.lat, fix.lng);
    const elapsedS = fix.ts - s.lastFix.ts;
    if (elapsedS > 0 && speed >= MOVING_SPEED_MPS) {
      movingS += elapsedS;
    }
  }

  const lastStored = s.track[s.track.length - 1];
  // track is [lng, lat] (GeoJSON order) — swap from fix's lat/lng here, the one
  // boundary this function crosses. No lastStored (first fix) reads as Infinity, so
  // the first fix always qualifies.
  const distSinceLastStored = lastStored
    ? haversineMeters(lastStored[1], lastStored[0], fix.lat, fix.lng)
    : Infinity;
  const track: [number, number][] =
    distSinceLastStored >= TRACK_POINT_METERS ? [...s.track, [fix.lng, fix.lat]] : s.track;

  return { ...s, distanceM, movingS, maxSpeedMps, track, lastFix: { lat: fix.lat, lng: fix.lng, ts: fix.ts } };
}
