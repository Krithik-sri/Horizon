/**
 * Horizon backend base URL — the one place this app's Go server address lives.
 *
 * Everything else (the WebSocket URL, every HTTP call in this layer) derives from
 * BASE_URL below rather than storing a second constant, so the two can never drift
 * apart when switching hosts.
 *
 * Dev options — edit BASE_URL (or fill in KOYEB_BASE_URL) to switch:
 *   - Android emulator (default below): the host machine is reachable at 10.0.2.2.
 *   - iOS simulator: "http://localhost:8080" — localhost only works here.
 *   - Physical device (Android or iOS): your computer's LAN IP, e.g.
 *     "http://192.168.1.20:8080" — 10.0.2.2 and localhost both fail on real hardware.
 *   - Deployed backend: a Koyeb URL, "https://<app>.koyeb.app" — https:// here derives
 *     wss:// below automatically.
 */

// No Koyeb deployment exists yet — left blank rather than inventing a hostname
// (CLAUDE.md). Fill this in once the backend has a real Koyeb URL, e.g.
// "https://horizon-xyz.koyeb.app".
const KOYEB_BASE_URL = '';

// Android-first (CLAUDE.md) — 10.0.2.2 is the sensible local default. Swap for a LAN
// IP or localhost per the dev options above when running on a physical device or the
// iOS simulator.
export const BASE_URL = KOYEB_BASE_URL || 'http://10.0.2.2:8080';

/** WebSocket base URL, derived from BASE_URL: http -> ws, https -> wss. */
export const WS_BASE_URL = BASE_URL.replace(/^http/, 'ws');
