/**
 * The ADR-014 §4 trigger contract, pure. Split out of useReroute.ts rather than
 * inlined there: useReroute.ts's hook needs `useRide` (state/useRide.ts), which
 * pulls in AsyncStorage and therefore `react-native` — a module graph plain `tsx`
 * cannot transform standalone (proven by every other *.check.ts in this repo
 * staying clear of it). Keeping the predicate here, with no import of the hook or
 * the store, is what lets reroute.check.ts run the same way routeProgress.check.ts
 * and bearing.check.ts do. useReroute.ts re-exports everything below, so nothing
 * outside this pair needs to know the split exists.
 */

// ADR-014 §4's trigger contract, transcribed as constants rather than inlined so
// this file and its check script assert the same numbers the ADR's table gives.

// ~5s at the 1Hz GPS rate (CLAUDE.md protocol) — one bad fix under a bridge is not
// a missed turn.
export const REROUTE_FIXES = 5;
// OFF_ROUTE_METERS (routeProgress.ts) already means "don't assert a turn." This
// means "different road" — two thresholds for two different questions.
export const REROUTE_METERS = 120;
// A bike parked 60m off the line at a petrol stop must never spend a request.
export const REROUTE_SPEED_MPS = 2;
// Caps one rider at 1 request/minute, success or failure.
export const REROUTE_COOLDOWN_MS = 60_000;
// Attempts per stored route — a genuinely lost rider cannot grind the quota.
// Reset by every incoming `route` frame (useRide.ts's applyMessage).
export const MAX_REROUTES_PER_ROUTE = 5;

/**
 * All five ADR-014 §4 conditions, required together. Pure — no store, no fetch, no
 * `Date.now()` inside it — so the caller supplies every input and this is trivially
 * unit-checkable (reroute.check.ts) without mocking a clock or a store.
 */
export function shouldReroute(s: {
  consecutiveOffRoute: number;
  offRouteMeters: number;
  speedMps: number;
  rerouteCount: number;
  msSinceLastAttempt: number;
}): boolean {
  return (
    s.consecutiveOffRoute >= REROUTE_FIXES &&
    s.offRouteMeters >= REROUTE_METERS &&
    s.speedMps >= REROUTE_SPEED_MPS &&
    s.rerouteCount < MAX_REROUTES_PER_ROUTE &&
    s.msSinceLastAttempt >= REROUTE_COOLDOWN_MS
  );
}
