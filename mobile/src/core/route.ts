import { BASE_URL } from './config';
import type { RouteData } from './models';

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

export type FetchRouteResult = { ok: true; route: RouteData } | { ok: false; error: FetchRouteError };

/**
 * POSTs waypoints to {base}/rides/{code}/route for the caller's immediate feedback.
 *
 * The same route also arrives over the WebSocket as a `route` message to everyone in
 * the room (route.go's SetRoute fans it out) — that WS message is the source of truth
 * every rider converges on. This HTTP response should be used for surfacing errors to
 * the caller, not as the value the UI renders a route from.
 */
export async function fetchRoute(code: string, waypoints: Waypoint[]): Promise<FetchRouteResult> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/rides/${encodeURIComponent(code)}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waypoints }),
    });
  } catch {
    return { ok: false, error: 'network' };
  }

  if (res.status === 200) {
    return { ok: true, route: (await res.json()) as RouteData };
  }

  const byStatus: Record<number, FetchRouteError> = {
    400: 'bad-waypoints',
    404: 'unknown-ride',
    422: 'no-route',
    502: 'upstream-failed',
    503: 'unavailable',
  };
  return { ok: false, error: byStatus[res.status] ?? 'network' };
}
