/**
 * Horizon backend base URL — the one place this app's Go server address lives.
 *
 * Everything else (the WebSocket URL, every HTTP call in this layer) derives from
 * BASE_URL below rather than storing a second constant, so the two can never drift
 * apart when switching hosts.
 *
 * Set EXPO_PUBLIC_HORIZON_API_URL to point at a real backend. Expo inlines any
 * EXPO_PUBLIC_* variable at build time (no expo-constants, no config plugin, no
 * runtime lookup), which is why this stays a plain module constant.
 *   - Local dev:      leave it unset — the Android-emulator default below applies.
 *   - Physical phone: it MUST be set. 10.0.2.2 and localhost both fail on real
 *                     hardware; a LAN IP only works on wifi, so a ride on mobile
 *                     data needs a public URL.
 *   - Deployed:       the Cloudflare Tunnel URL — https here derives wss below.
 *                     Prefer a *named* tunnel: a quick tunnel's *.trycloudflare.com
 *                     hostname changes on every restart, and a `preview` build bakes
 *                     this value in, so a new hostname means every rider reinstalls.
 *
 * Where to set it:
 *   - `mobile/.env` for local runs (gitignored — see .env.example).
 *   - `eas.json` under the build profile's `env` for EAS builds. EAS does not
 *     upload .env, so a build with nothing set silently gets the emulator default.
 *
 * `||` not `??`: an env var declared-but-empty (an unfilled slot in eas.json) is
 * an empty string, not undefined, and must still fall back to the default.
 */
export const BASE_URL = process.env.EXPO_PUBLIC_HORIZON_API_URL || 'http://10.0.2.2:8080';

/** WebSocket base URL, derived from BASE_URL: http -> ws, https -> wss. */
export const WS_BASE_URL = BASE_URL.replace(/^http/, 'ws');

/**
 * Supabase project URL and anon (publishable) key — see mobile/.env.example for why
 * the anon key is deliberately not a secret (ADR-016 §5). Both must be set for
 * ensureSession()/getAccessToken() (core/supabase.ts) to do anything; there is no
 * dev-default the way BASE_URL has one, because there is no way to run a local
 * Supabase project the app can silently fall back to.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Fail with an error that names the problem, rather than letting supabase-js do it.
 *
 * createClient('', '') throws `supabaseUrl is required` from inside node_modules at
 * import time — and because core/supabase.ts is pulled in transitively by core/api.ts,
 * that lands as a red screen before any UI renders, naming a library the reader hasn't
 * heard of and never mentioning the file that's actually missing. This is the same trap
 * an inert backend `.env` used to be: the failure is real but points nowhere useful.
 *
 * Thrown at module scope on purpose. These are build-time values baked in by Expo, so
 * if they're missing they are missing for the whole session — deferring the error to
 * first use would only move the confusion later.
 */
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  const missing = [
    !SUPABASE_URL && 'EXPO_PUBLIC_SUPABASE_URL',
    !SUPABASE_ANON_KEY && 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  ].filter(Boolean);
  throw new Error(
    `Horizon config: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set.\n` +
      `Create mobile/.env (copy mobile/.env.example) and fill in your Supabase project URL ` +
      `and anon key, then restart the bundler with: npx expo start --clear\n` +
      `Expo only reads .env at bundler start, so editing it while Metro is running has no effect.`,
  );
}
