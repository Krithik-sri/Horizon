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
 *   - Deployed:       "https://<app>.koyeb.app" — https here derives wss below.
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
