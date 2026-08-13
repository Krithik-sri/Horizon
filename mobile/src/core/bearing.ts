/**
 * Heading-up camera bearing smoothing: turns a raw GPS course-over-ground reading
 * (~1 Hz, noisy, meaningless at a standstill) into a stable camera bearing. Pure —
 * no React — so it's unit-checked directly (bearing.check.ts) and callable from
 * MapCanvas on every fix.
 */

// Below this speed, GPS course-over-ground is dominated by noise, not real heading —
// a stationary or idling bike would make the map spin, which is both nauseating and a
// "nothing animates >120ms" violation (CLAUDE.md, register.motion.maxAnimationDuration).
// Hold the last good bearing instead of following it. 2.5 m/s (~9 km/h) sits comfortably
// above GPS jitter at a standstill and below "actually underway."
export const BEARING_HOLD_SPEED_MPS = 2.5;

// Low-pass factor applied per fix once above the speed floor. Fixes arrive ~1 Hz
// (CLAUDE.md WS protocol); 0.3 settles a genuine turn within a couple of fixes without
// visibly overshooting, while still damping single-fix GPS noise.
export const BEARING_SMOOTHING_ALPHA = 0.3;

/** Normalizes any angle (including negative or >360) to [0, 360). */
function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Steps `prevBearing` toward `heading` by `alpha`, taking the shortest way around the
 * 359°→0° wraparound rather than the raw numeric difference — a naive
 * `prev + alpha * (heading - prev)` swings the long way round whenever the two straddle
 * north (e.g. prev=350, heading=10 is a 20° right turn, not a 340° left loop).
 */
export function smoothBearingStep(prevBearing: number, heading: number, alpha: number): number {
  const rawDelta = normalizeDegrees(heading - prevBearing); // in [0, 360)
  // Fold anything past 180 back to the equivalent negative (shorter) turn.
  const shortestDelta = rawDelta > 180 ? rawDelta - 360 : rawDelta;
  return normalizeDegrees(prevBearing + alpha * shortestDelta);
}

/**
 * Computes the next camera bearing from a new GPS fix.
 *
 * `prevBearing` is the last bearing shown to the rider (null before any fix has
 * arrived). Below BEARING_HOLD_SPEED_MPS the fix's heading is noise, so the previous
 * bearing carries forward unchanged — except on a cold start with nothing yet to hold,
 * where the raw heading is used once so the camera isn't left bearing-less.
 */
export function nextBearing(prevBearing: number | null, heading: number, speed: number): number {
  if (speed < BEARING_HOLD_SPEED_MPS) {
    return prevBearing ?? normalizeDegrees(heading);
  }
  if (prevBearing === null) return normalizeDegrees(heading); // nothing to smooth from yet
  return smoothBearingStep(prevBearing, heading, BEARING_SMOOTHING_ALPHA);
}
