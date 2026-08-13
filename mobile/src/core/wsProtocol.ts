/**
 * The pure, timer-free half of wsClient.ts's connection policy: the reconnect backoff
 * schedule and the outbound `loc` throttle. Split out for the same reason reroute.ts
 * is split from useReroute.ts — wsClient.ts needs core/supabase.ts for a live token,
 * which pulls in `react-native` (AppState) and therefore a module graph plain `tsx`
 * cannot transform standalone. Keeping these functions here, with no import of
 * supabase.ts or anything RN, is what lets wsClient.check.ts run the same way
 * reroute.check.ts does. wsClient.ts re-exports everything below, so nothing outside
 * this pair needs to know the split exists.
 */

export const MIN_LOC_INTERVAL_MS = 1000; // throttle outbound `loc` to ~1 Hz
const BASE_BACKOFF_MS = 500;
export const MAX_BACKOFF_MS = 15000; // cap on reconnect delay

/**
 * Deterministic upper bound for the reconnect delay before a given attempt (1-based).
 * Exponential, capped at MAX_BACKOFF_MS. The actual delay used by connect() applies
 * full jitter on top of this (Math.random() * cap) so a batch of clients dropped by
 * the same network hiccup doesn't all reconnect in lockstep. Exported (pure, no
 * randomness) so wsClient.check.ts can assert the schedule without mocking timers.
 */
export function backoffDelayCapMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
}

/**
 * Whether a `loc` send at `now` should go out, given the last send at `lastSentAt`.
 * Exported (pure) for the same reason as backoffDelayCapMs — testable without a timer.
 */
export function shouldSendLoc(lastSentAt: number, now: number): boolean {
  return now - lastSentAt >= MIN_LOC_INTERVAL_MS;
}

/**
 * Whether to spend an HTTP precheck before this attempt (0-based; 0 is the first connect).
 *
 * Only two moments are worth it:
 *   - the first attempt, so a mistyped or expired code fails fast with a real reason
 *     instead of retrying silently behind a spinner;
 *   - once backoff has saturated, meaning we've been failing for a while. If the server
 *     is reachable at that point, the likely cause is a room GC'd after its 5-minute
 *     empty grace — a dead code we should stop retrying rather than drain the battery on.
 *
 * Everything in between is an ordinary network drop, where the room is almost certainly
 * still there and a precheck buys nothing but a spurious 400 in the server log.
 */
export function shouldPrecheck(attempt: number): boolean {
  return attempt === 0 || backoffDelayCapMs(attempt) >= MAX_BACKOFF_MS;
}
