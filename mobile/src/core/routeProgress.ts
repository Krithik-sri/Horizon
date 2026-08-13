/**
 * Rider-to-route matching: where along the polyline a fix sits, and which maneuver
 * (if any) is next. Pure — no React, no I/O — so it can be unit-checked directly
 * (routeProgress.check.ts) and called from anywhere a route + a position exist.
 *
 * Coordinate order: `route.polyline` is [lng, lat] (GeoJSON/MapLibre order, CLAUDE.md's
 * known trap); `position` and everything this module computes internally is lat/lng.
 * The only place the two mix is haversineMeters's call sites below — each one is
 * commented at the swap.
 */
import type { RouteData, Step } from './models';

export type Progress = {
  /** Nearest polyline vertex to the rider's last fix. */
  index: number;
  /** Straight-line distance from the fix to that vertex. */
  offRouteMeters: number;
  onRoute: boolean;
  /** The next maneuver ahead of `index`. The depart step (steps[0]) is never
   * returned here — the rider is already doing it by the time this runs. Null
   * once off-route, arrived, or past the last maneuver. */
  step: Step | null;
  /** Distance from the fix to `step`'s waypoint, via the cumulative-distance
   * table — 0 when `step` is null. */
  metersToStep: number;
  /** Close enough to `step` that "now" reads truer than a shrinking number. */
  imminent: boolean;
  arrived: boolean;
  /** Metres from `index` to the final polyline vertex, via the cumulative-distance
   * table (O(1)) — same lookup metersToStep uses, just against the last entry
   * instead of a step's waypoint. Always computed, but only meaningful when
   * `onRoute`: off-route, `index` is a stale/irrelevant snap and this number
   * doesn't describe the rider's actual remaining distance. */
  remainingMeters: number;
  /** Compass bearing (0-360, 0 = north) from the rider's fix to `polyline[index]`.
   * Only means something when the rider is off the line — null when on-route (no
   * "back to the route" direction to give) or when the polyline is empty. Feeds
   * the zero-quota degraded mode ADR-014 §5 describes: once the reroute budget is
   * spent, this plus `offRouteMeters` is the only thing left to show a lost rider,
   * and it costs nothing to compute since `index` is already known. */
  bearingToRoute: number | null;
};

// No stdlib/dependency has this — straight-line great-circle distance between two
// lat/lng points. Moved here from AheadCue.tsx; this is the only copy.
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Great-circle initial bearing from point 1 to point 2, in degrees [0, 360), 0 = north.
// No stdlib/dependency has this either (see haversineMeters above — same reasoning,
// this is the only copy). Lives here rather than bearing.ts: that module smooths a
// *camera* heading over successive fixes, a filtering problem; this is one-shot
// geodesy between two coordinates, the same concern haversineMeters already owns.
export function initialBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Beyond this, GPS jitter stops being the explanation — the rider is genuinely off
// the planned line (missed a turn, is lane-splitting down a service road, whatever)
// and no maneuver should be asserted with confidence. 50m is generous for a
// driving-car profile polyline (ORS has no motorcycle profile — CLAUDE.md) plus
// consumer GPS error under tree cover or between buildings.
export const OFF_ROUTE_METERS = 50;

// Distance under which "now" beats a shrinking number — Motion register rule is one
// word over a countdown a rider can't safely read mid-lean anyway.
export const IMMINENT_METERS = 30;

// Distance to the final polyline vertex under which the ride counts as arrived
// rather than merely close. Tighter than IMMINENT_METERS because arrival is a
// one-time state transition, not a per-maneuver cue.
export const ARRIVE_METERS = 20;

// Vertices scanned ahead of the previous index on every update. ORS driving-car
// polylines are dense (a vertex every few metres through curves), so even at
// motorway speed and ~1Hz GPS one tick of travel is nowhere near this many
// vertices — wide enough to absorb a noisy fix, narrow enough to keep the search
// O(window) instead of O(polyline) every frame (the defect this module replaces).
export const SEARCH_WINDOW_FORWARD = 60;

// Small backward allowance so a fix that lands a vertex or two "behind" the
// previous index (GPS jitter, not the rider reversing) doesn't get misread as a
// teleport and force a full rescan.
export const SEARCH_WINDOW_BACKWARD = 5;

// Single-slot memo: only one route is ever live per ride screen, so there is never
// more than one polyline worth caching at a time. Keyed on array identity — a new
// `route` WS message always constructs a fresh polyline array (see useRide.ts),
// so this invalidates itself correctly without an explicit version/id field.
// ponytail: single-slot cache, not a Map/WeakMap keyed by route — upgrade only if
// this module ever needs to track more than one route at once.
let cumCache: { polyline: RouteData['polyline']; cum: number[] } | null = null;

/**
 * Cumulative distance (metres) from vertex 0 to vertex i, for every i. Computed
 * once per distinct polyline (see cumCache above), not per call — this is what
 * turns "distance to maneuver" from an O(n) per-frame sum into an O(1) lookup:
 * `cum[maneuverIndex] - cum[riderIndex]`.
 */
export function getCumulativeDistances(polyline: RouteData['polyline']): number[] {
  if (cumCache && cumCache.polyline === polyline) return cumCache.cum;
  const cum = new Array<number>(polyline.length).fill(0);
  for (let i = 1; i < polyline.length; i++) {
    const [lng1, lat1] = polyline[i - 1]; // polyline is [lng, lat] — swap at the boundary
    const [lng2, lat2] = polyline[i];
    cum[i] = cum[i - 1] + haversineMeters(lat1, lng1, lat2, lng2);
  }
  cumCache = { polyline, cum };
  return cum;
}

/** Nearest vertex to `position` within polyline[start..end] inclusive. */
function nearestInWindow(
  polyline: RouteData['polyline'],
  position: { lat: number; lng: number },
  start: number,
  end: number,
): { index: number; dist: number } {
  let bestIndex = start;
  let bestDist = Infinity;
  for (let i = start; i <= end; i++) {
    const [lng, lat] = polyline[i]; // polyline is [lng, lat] — swap for haversineMeters
    const d = haversineMeters(position.lat, position.lng, lat, lng);
    // <=, not <: on an exact distance tie (e.g. a road that revisits the same
    // coordinates — an out-and-back's turnaround, a loop closing) prefer the higher
    // index. Scanning start-to-end, this keeps the *last* tied vertex, so a tie never
    // snaps progress back to the earlier, spatially-identical one.
    if (d <= bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  return { index: bestIndex, dist: bestDist };
}

/**
 * Matches a fix to the route and finds the next maneuver.
 *
 * `prevIndex` is the caller's anchor from the previous call (null on the first call
 * for this route) — this is what makes the search monotonic. The search only looks
 * in a bounded window around it, so a spatially-close-but-topologically-earlier
 * vertex (an out-and-back's return leg passing back by the outbound leg, a loop, two
 * parallel carriageways) never snaps the index backwards. Only when nothing in that
 * window is within OFF_ROUTE_METERS does this fall back to a full scan — a genuine
 * reroute, a teleport, or cold start (prevIndex anchored at 0 while the rider is
 * actually far down the route) — and reports off-route honestly rather than pin to a
 * stale index.
 *
 * Snaps to the nearest polyline *vertex*, not the perpendicular projection onto the
 * nearest segment. ponytail: vertex snap, not segment projection — projection would
 * trim the last few metres of error between vertices; add it if "0 m still showing
 * near a turn" resurfaces as a complaint once this ships.
 */
export function computeProgress(
  route: RouteData,
  position: { lat: number; lng: number },
  prevIndex: number | null,
): Progress {
  const { polyline, steps } = route;
  if (polyline.length === 0) {
    return {
      index: 0,
      offRouteMeters: Infinity,
      onRoute: false,
      step: null,
      metersToStep: 0,
      imminent: false,
      arrived: false,
      remainingMeters: 0,
      bearingToRoute: null,
    };
  }

  const anchor = prevIndex ?? 0;
  const windowStart = Math.max(0, anchor - SEARCH_WINDOW_BACKWARD);
  const windowEnd = Math.min(polyline.length - 1, anchor + SEARCH_WINDOW_FORWARD);
  let { index, dist } = nearestInWindow(polyline, position, windowStart, windowEnd);

  if (dist > OFF_ROUTE_METERS) {
    const full = nearestInWindow(polyline, position, 0, polyline.length - 1);
    if (full.dist < dist) {
      index = full.index;
      dist = full.dist;
    }
  }

  const onRoute = dist <= OFF_ROUTE_METERS;
  const cum = getCumulativeDistances(polyline);
  const remainingToEnd = cum[cum.length - 1] - cum[index];
  const arrived = onRoute && remainingToEnd <= ARRIVE_METERS;

  let step: Step | null = null;
  let metersToStep = 0;
  if (onRoute && !arrived && steps) {
    // steps[0] is always ORS's depart maneuver ("Head north on ...") — by the time
    // this runs the rider is already doing it, so the search starts at steps[1].
    for (let i = 1; i < steps.length; i++) {
      const wp = Math.min(steps[i].wayPoints[0], polyline.length - 1);
      if (wp >= index) {
        step = steps[i];
        metersToStep = cum[wp] - cum[index];
        break;
      }
    }
  }

  const imminent = step !== null && metersToStep <= IMMINENT_METERS;

  // Only meaningful once the rider has actually drifted — on-route, there is no
  // "which way back" to report. polyline[index] is [lng, lat] — swap for
  // initialBearing, same as nearestInWindow above.
  const bearingToRoute = onRoute
    ? null
    : initialBearing(position.lat, position.lng, polyline[index][1], polyline[index][0]);

  return {
    index,
    offRouteMeters: dist,
    onRoute,
    step,
    metersToStep,
    imminent,
    arrived,
    remainingMeters: remainingToEnd,
    bearingToRoute,
  };
}
