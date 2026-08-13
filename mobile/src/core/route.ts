import { api } from './api';
import type { RouteData } from './models';
import type { FetchRouteError, FetchRouteResult, Waypoint } from './route.pure';

// Re-exported so every existing import of '@/core/route' keeps working — see
// route.pure.ts's doc comment for why the network-free half lives there instead.
// routeErrorText and viaLabel (the value exports of that split) have no callers
// left importing them from here — import them straight from './route.pure'.
export type { FetchRouteError, FetchRouteResult, Waypoint };

/**
 * POSTs waypoints to {base}/rides/{code}/route for the caller's immediate feedback.
 *
 * `preview: true` (ADR-013 §1) fetches without storing or broadcasting to the room —
 * the planner screen uses this for every stop/reorder edit. Omitted (the default),
 * this commits: the resulting route is stored and reaches every rider over the
 * WebSocket as a `route` message (route.go's SetRoute fans it out) — that WS message
 * is the source of truth every rider converges on, so this HTTP response should be
 * used for surfacing errors to the caller, not as the value the UI renders a route
 * from. `alternatives: true` only works with exactly two waypoints (ADR-013 §3);
 * `index` selects which returned route to commit and is ignored under `preview`.
 */
export async function fetchRoute(
  code: string,
  waypoints: Waypoint[],
  opts?: { preview?: boolean; alternatives?: boolean; index?: number },
): Promise<FetchRouteResult> {
  let res: Response;
  try {
    res = await api(`/rides/${encodeURIComponent(code)}/route`, {
      method: 'POST',
      body: JSON.stringify({
        waypoints,
        preview: opts?.preview ?? false,
        alternatives: opts?.alternatives ?? false,
        index: opts?.index ?? 0,
      }),
    });
  } catch {
    return { ok: false, error: 'network' };
  }

  if (res.status === 200) {
    const data = (await res.json()) as { routes: RouteData[]; selected: number };
    return { ok: true, routes: data.routes, selected: data.selected };
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
