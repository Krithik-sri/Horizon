import { api } from './api';

/** One geocoding hit. Plain data, not a wire type shared with models.ts — this is a
 * search result, never sent or received anywhere else in the protocol. */
export type Place = { label: string; lat: number; lng: number };

export type SearchError =
  | 'bad-query' // 400 — empty/invalid search text
  | 'unavailable' // 503 — geocoding service unconfigured or over its quota
  | 'upstream-failed' // 502 — the upstream geocoder itself failed
  | 'network'; // fetch threw, or the server returned something unrecognised

export type SearchResult = { ok: true; places: Place[] } | { ok: false; error: SearchError };

/**
 * POSTs a free-text query to {base}/geocode.
 *
 * `near`, when given, is [lat, lng] — matching route.ts's `Waypoint` convention
 * (named lat/lng order, for a request body), NOT MapLibre's [lng, lat] used by
 * route.polyline. Coordinate order is a known trap in this repo; this stays
 * consistent with the other lat-first request body rather than the positional one.
 *
 * An empty `results` array is a SUCCESS with zero places, not an error — a query
 * that simply doesn't match anywhere is not the same as a broken search.
 */
export async function searchPlaces(text: string, near?: { lat: number; lng: number }): Promise<SearchResult> {
  let res: Response;
  try {
    res = await api('/geocode', {
      method: 'POST',
      body: JSON.stringify({ text, near: near ? [near.lat, near.lng] : undefined }),
    });
  } catch {
    return { ok: false, error: 'network' };
  }

  if (res.status === 200) {
    const data = (await res.json()) as { results: Place[] };
    return { ok: true, places: data.results };
  }

  const byStatus: Record<number, SearchError> = {
    400: 'bad-query',
    502: 'upstream-failed',
    503: 'unavailable',
  };
  return { ok: false, error: byStatus[res.status] ?? 'network' };
}
