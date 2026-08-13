// Must be the literal first line, before any other import. Hermes (React Native's JS
// engine) has no URL.hostname, and supabase-js throws on import without this polyfill
// in place first — do not let this get "tidied" below the imports it protects.
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // There is no browser URL to parse a session out of on a native client.
    detectSessionInUrl: false,
  },
});

// supabase-js's auto-refresh timer only ticks while something calls startAutoRefresh —
// it does not know when the app is backgrounded. Without wiring AppState, the refresh
// timer keeps running while backgrounded (per the SDK docs, this is actually the
// opposite failure: it wastes battery/network refreshing a session nobody is using),
// but the more important half is stopAutoRefresh on background / startAutoRefresh on
// foreground so a long background stretch — where a phone spends most of a ride —
// doesn't leave a stale timer racing the OS suspending the JS runtime. Either way, get
// this wrong and the failure does NOT show up now: it shows up on the *next reconnect*,
// looking exactly like a networking bug (ADR-016 §4).
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});

/**
 * Ensures a session exists, signing in anonymously if there isn't one cached.
 * Returns true once a session is available, false if sign-in failed (e.g. no
 * network on first-ever launch — ADR-016 §"Negative"). Safe to call more than
 * once; getSession() reads the cached session with no network call.
 */
/**
 * Why this carries a reason instead of returning a bare boolean: the two ways sign-in
 * fails need completely different actions from whoever is reading the screen, and
 * telling them the wrong one costs real time. "Couldn't reach Supabase" says check the
 * network; `anonymous_provider_disabled` says flip a switch in a dashboard, and no
 * amount of network debugging will ever fix it. A single "check your connection"
 * message sends every reader down the wrong path for the failure they are far more
 * likely to hit on a fresh project — anonymous sign-ins ship OFF by default
 * (ADR-016 §4).
 */
export type SessionResult = { ok: true } | { ok: false; reason: string };

export async function ensureSession(): Promise<SessionResult> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return { ok: true };

  const { error } = await supabase.auth.signInAnonymously();
  if (!error) return { ok: true };

  // Supabase's own code for "this project has anonymous sign-ins turned off" — the
  // single most likely failure on a project that has never signed anyone in, and the
  // one a connection check cannot diagnose.
  if (error.code === 'anonymous_provider_disabled') {
    return {
      ok: false,
      reason:
        'Anonymous sign-ins are disabled for this Supabase project. Enable them under ' +
        'Authentication → Sign In / Providers, then retry.',
    };
  }

  // supabase-js reports a transport failure with no status at all; anything with a
  // status came back from the server and its message is more specific than a guess.
  if (error.status === undefined) {
    return { ok: false, reason: "Couldn't reach Supabase — check your connection, then retry." };
  }
  return { ok: false, reason: `Couldn't sign in: ${error.message}` };
}

/**
 * The current access token, or null if there is no session. Goes through
 * getSession() rather than reading a cached field directly so an expired token is
 * auto-refreshed first — every backend call (core/api.ts, wsClient.ts) depends on
 * that happening here rather than at each call site.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
