/**
 * Self-check for route.ts's viaLabel — the "via NH 44" label the planner's
 * alternative-route rows depend on. Same style as the sibling *.check.ts files: a
 * plain assert script, no framework, run with:
 *
 *   npx tsx src/core/route.check.ts
 *
 * Imports from ./route.pure, not ./route: route.ts now imports core/api.ts, which
 * imports core/supabase.ts for a live token on every request, which imports
 * `react-native` (AppState) — a module graph plain `tsx` cannot transform standalone.
 * route.pure.ts is the network-free split that keeps this check running the same way
 * it always has; see its doc comment.
 */
import { viaLabel } from './route.pure';
import type { RouteData, Step } from './models';

// Same reasoning as the sibling check files: no @types/node here, so no node:assert.
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message}: got ${actual}, expected ${expected}`);
}

function step(name: string, distance: number): Step {
  return { instruction: '', distance, duration: 0, type: 6, name, wayPoints: [0, 0] };
}
function route(steps: Step[] | null): RouteData {
  return { polyline: [], steps, summary: null };
}

// --- picks the longest-distance named step, not the first or last ---
assertEqual(
  viaLabel(route([step('Side St', 50), step('NH 44', 40000), step('Exit Rd', 100)])),
  'via NH 44',
  'should pick the step with the greatest distance',
);

// --- skips ORS's "-" unnamed-way placeholder, even when it's the longest ---
assertEqual(
  viaLabel(route([step('-', 90000), step('MG Road', 500)])),
  'via MG Road',
  'an unnamed ("-") step must never win, however long it is',
);

// --- no named step at all ---
assertEqual(viaLabel(route([step('-', 1000)])), null, 'every step unnamed should return null, not "via -"');

// --- steps: null (RouteData permits it) ---
assertEqual(viaLabel(route(null)), null, 'no steps at all should return null, not throw');

// --- empty steps array ---
assertEqual(viaLabel(route([])), null, 'an empty steps array should return null');

console.log('route self-check passed');
