import type { RouteData, Step } from './models';

/**
 * The pure half of route.ts: types and label-formatting with no network dependency.
 * Split out for the same reason wsProtocol.ts is split from wsClient.ts — route.ts
 * now imports core/api.ts, which imports core/supabase.ts for a live token on every
 * request, which imports `react-native` (AppState). That's a module graph plain `tsx`
 * cannot transform standalone, and route.check.ts (which only exercises viaLabel)
 * needs to run without it. route.ts re-exports everything below, so nothing outside
 * this pair needs to know the split exists.
 */

/**
 * [lat, lng] — the one request body in this protocol that's lat-first, matching
 * loc/state's named lat/lng field convention rather than route.polyline's [lng, lat]
 * order. Deliberately not `LngLat` (models.ts) — never mix the two up.
 */
export type Waypoint = [number, number];

export type FetchRouteError =
  | 'unknown-ride' // 404 — the ride code is unknown or expired
  | 'bad-waypoints' // 400 — malformed body or waypoints out of range/count
  | 'no-route' // 422 — ORS found no route between the given points
  | 'unavailable' // 503 — route service unconfigured or over its quota
  | 'upstream-failed' // 502 — ORS itself failed
  | 'network'; // fetch threw, or the server returned something unrecognised

/** `routes` is always an array (ADR-013 §1) — length 1 whenever `alternatives`
 * wasn't requested or ORS didn't return extras, so callers never branch on shape. */
export type FetchRouteResult =
  | { ok: true; routes: RouteData[]; selected: number }
  | { ok: false; error: FetchRouteError };

// ORS returns "-" for a way with no name (an unclassified track, a service road)
// rather than omitting the field — same guard as AheadCue.tsx's streetName, kept as
// a separate copy rather than a shared export: that one reads a *current* step off
// live progress, this one picks the single most representative step out of a whole
// route, different enough questions that sharing one function would just add an
// indirection neither call site needs.
function namedStep(step: Step): string | null {
  return step.name && step.name !== '-' ? step.name : null;
}

/**
 * "via NH 44" — the name of the route's longest-`distance` step, skipping unnamed
 * ("-") steps entirely so a short unnamed slip road never wins over the highway that
 * makes up most of the trip. Null when no step is named.
 */
export function viaLabel(route: RouteData): string | null {
  if (!route.steps) return null;
  let longest: Step | null = null;
  for (const step of route.steps) {
    if (namedStep(step) && (!longest || step.distance > longest.distance)) {
      longest = step;
    }
  }
  return longest ? `via ${longest.name}` : null;
}

/** A failed setDestination is otherwise invisible — the map just doesn't change.
 * Ambient text only, the lowest rung of the attention ladder (horizon-design SKILL.md).
 * Shared by ride/[code].tsx (long-press) and index.tsx (Departure search) — both
 * surface this through their own inline-error UI, not through this function. */
export function routeErrorText(error: FetchRouteError | null): string | null {
  switch (error) {
    case 'no-route':
      return 'No route found.';
    case 'unavailable':
    case 'upstream-failed':
      return 'Route unavailable.';
    case 'network':
      return "Couldn't reach the route service.";
    default:
      return null; // unknown-ride / bad-waypoints: not reachable from a long-press in practice
  }
}
