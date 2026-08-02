/**
 * Self-check for the two bits of wsClient.ts that would break silently if a refactor
 * changed their behaviour: the reconnect backoff schedule and the outbound `loc`
 * throttle. No test framework is installed for this project and none is added here —
 * this is a plain assert script, run with:
 *
 *   npx tsx src/core/wsClient.check.ts
 *
 * Everything else in wsClient.ts (the actual socket lifecycle, the 404 precheck) needs
 * a live server or a mocked fetch/WebSocket to exercise meaningfully — not worth a
 * framework for this project, so it's exercised by hand against the real backend
 * instead.
 */
import {
  backoffDelayCapMs,
  MAX_BACKOFF_MS,
  MIN_LOC_INTERVAL_MS,
  shouldPrecheck,
  shouldSendLoc,
} from './wsClient';

// No `node:assert` here — this project has no @types/node installed, and pulling it
// in just for this one self-check isn't worth it (`npx tsc --noEmit` must stay clean
// with no new devDependencies). A two-line assert covers everything this needs.
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message}: got ${actual}, expected ${expected}`);
}

// --- backoff schedule: non-decreasing, and capped by MAX_BACKOFF_MS ---
let prevCap = 0;
for (let attempt = 1; attempt <= 12; attempt++) {
  const cap = backoffDelayCapMs(attempt);
  assert(cap >= prevCap, `backoff cap shrank at attempt ${attempt}: ${cap} < ${prevCap}`);
  assert(cap <= MAX_BACKOFF_MS, `backoff cap exceeded the ceiling at attempt ${attempt}: ${cap}`);
  prevCap = cap;
}
assertEqual(backoffDelayCapMs(1), 1000, 'first retry should back off starting at 2x the base delay');
assertEqual(backoffDelayCapMs(12), MAX_BACKOFF_MS, 'backoff should have hit the ceiling well before attempt 12');

// --- loc throttle: ~1 Hz ---
assertEqual(shouldSendLoc(0, MIN_LOC_INTERVAL_MS - 1), false, 'a send inside the 1s window should be throttled');
assertEqual(shouldSendLoc(0, MIN_LOC_INTERVAL_MS), true, 'a send exactly at the 1s boundary should go out');
assertEqual(shouldSendLoc(0, MIN_LOC_INTERVAL_MS + 500), true, 'a send after the window should go out');

// --- precheck gating: first attempt and saturated backoff only ---
// A precheck against a *valid* code costs a logged 400 on the server, so running one on
// every ordinary drop would fill the access log with 400s that mean nothing is wrong.
assertEqual(shouldPrecheck(0), true, 'the first connect should precheck, so a bad code fails fast');
assert(
  [1, 2, 3, 4].every((a) => !shouldPrecheck(a)),
  'ordinary mid-backoff reconnects should not precheck',
);
assert(shouldPrecheck(20), 'once backoff has saturated, precheck again to catch a GC\'d room');

console.log('wsClient self-check passed');
