import { BASE_URL } from './config';
import { getAccessToken } from './supabase';

/**
 * The one seam every backend HTTP call goes through.
 *
 * Attaches `Authorization: Bearer <jwt>` here, once — this is the seam that phase was
 * built for, so nobody has to hunt through every call site to add auth. Nobody should
 * add a second raw `fetch(BASE_URL + ...)` — route new backend calls through here.
 * getAccessToken() goes through getSession(), which auto-refreshes an expired token,
 * so a request made right before expiry still carries a live one. If there is no
 * session at all (ensureSession() failed — ADR-016's no-network-on-first-launch case)
 * the header is simply omitted and the server's 401 surfaces normally.
 *
 * Deliberately thin beyond that: passes `init` through untouched (merging in a
 * default Content-Type only when there's a body and the caller didn't set one),
 * and returns the raw Response. It does not throw on non-2xx, parse JSON, or map
 * errors — every caller already has its own status -> error-union mapping
 * (FetchRouteError, SearchError) and this must not interfere with that. A network
 * error still rejects, exactly as a bare `fetch` would, since callers already
 * try/catch around it.
 */
export async function api(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith('/') ? `${BASE_URL}${path}` : `${BASE_URL}/${path}`;

  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = await getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  return fetch(url, { ...init, headers });
}
