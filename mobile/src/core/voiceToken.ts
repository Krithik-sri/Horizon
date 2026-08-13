import { api } from './api';

export type VoiceTokenError =
  | 'unknown-ride' // 404 — the ride code is unknown or expired
  | 'unavailable' // 503 — LiveKit env unset on the backend (ADR-020 §6)
  | 'network'; // fetch threw, or the server returned something unrecognised

export type VoiceTokenResult =
  | { ok: true; url: string; token: string }
  | { ok: false; error: VoiceTokenError };

/**
 * POSTs {base}/rides/{code}/voice-token to mint a LiveKit room token (ADR-020 §4).
 *
 * No request body: unlike route.ts's waypoints, there is nothing here for the caller
 * to supply — identity comes from the Supabase JWT's `sub` claim, which `api()`
 * already attaches as `Authorization: Bearer <jwt>`. A rider id in the body would
 * just be a second, spoofable copy of what the token already proves.
 */
export async function fetchVoiceToken(code: string): Promise<VoiceTokenResult> {
  let res: Response;
  try {
    res = await api(`/rides/${encodeURIComponent(code)}/voice-token`, { method: 'POST' });
  } catch {
    return { ok: false, error: 'network' };
  }

  if (res.status === 200) {
    const data = (await res.json()) as { url: string; token: string };
    return { ok: true, url: data.url, token: data.token };
  }

  const byStatus: Record<number, VoiceTokenError> = {
    404: 'unknown-ride',
    503: 'unavailable',
  };
  return { ok: false, error: byStatus[res.status] ?? 'network' };
}
