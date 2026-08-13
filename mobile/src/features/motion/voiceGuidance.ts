/**
 * Spoken turn-by-turn guidance (ADR-015), pure logic only — no `expo-speech`
 * import, no store, no React. This is the half of the split that
 * `voiceGuidance.check.ts` imports directly under plain `tsx`, which cannot parse
 * `react-native` (same reason `reroute.ts` is split from `useReroute.ts` — see that
 * pair's doc comments). `useVoiceGuidance.ts` owns the `expo-speech` import and
 * re-exports everything below.
 */
import type { Step } from '@/core/models';

export type CueTier = 'far' | 'near' | 'final';

export const FAR_METERS = 800;
export const NEAR_METERS = 200;
export const FINAL_LEAD_SECONDS = 5;
// > IMMINENT_METERS (30m, routeProgress.ts) by construction — the corner guard,
// ADR-015 §2 mechanism 2. voiceGuidance.check.ts asserts this relationship directly
// against the real IMMINENT_METERS constant so a lowered floor fails loudly.
export const FINAL_MIN_METERS = 60;
export const FINAL_MAX_METERS = 250;

/** clamp(speed * FINAL_LEAD_SECONDS, FINAL_MIN_METERS, FINAL_MAX_METERS) — ADR-015 §3:
 * five seconds of travel is the right unit for "time to act," floored so a crawling
 * rider still gets a cue and capped so a motorway cue doesn't fire a quarter-km early. */
export function finalThresholdMeters(speedMps: number): number {
  return Math.min(FINAL_MAX_METERS, Math.max(FINAL_MIN_METERS, speedMps * FINAL_LEAD_SECONDS));
}

/**
 * Which tier, if any, is due to speak for this fix. Pure: no Speech, no refs, no
 * store — the imminent guard lives HERE rather than at the call site (ADR-015 §2
 * mechanism 1), so a future caller cannot forget it.
 *
 * A tier only fires once the rider was ever beyond its threshold for this step
 * (`entryMeters > threshold`) and has now crossed inside it — that's what stops two
 * close-together maneuvers from producing extra announcements (ADR-015 §3). Checked
 * in final/near/far order: when a fix jumps past more than one threshold at once,
 * the nearest (truest) tier wins, per ADR-015 §3's explicit priority — this is a
 * fixed priority order, not a comparison of the tiers' numeric thresholds (the
 * speed-aware final threshold can itself exceed NEAR_METERS at high speed).
 */
export function dueTier(s: {
  metersToStep: number;
  entryMeters: number; // the max metersToStep seen since this step became current
  speedMps: number;
  imminent: boolean;
  spoken: ReadonlySet<CueTier>;
}): CueTier | null {
  if (s.imminent) return null;

  const thresholds: [CueTier, number][] = [
    ['final', finalThresholdMeters(s.speedMps)],
    ['near', NEAR_METERS],
    ['far', FAR_METERS],
  ];
  for (const [tier, threshold] of thresholds) {
    if (s.spoken.has(tier)) continue;
    if (s.entryMeters > threshold && s.metersToStep <= threshold) return tier;
  }
  return null;
}

/**
 * Reuses `step.instruction` verbatim (ADR-015 §3 — not composed from `type`/`name`;
 * ORS's sentence is already readable, and a second instruction generator would just
 * reinvent it worse). `far`/`near` prefix a distance lead-in; `final` speaks the
 * instruction alone, since it's the one tier that fires close enough to read as "now."
 */
export function phrase(step: Step, tier: CueTier): string {
  if (tier === 'final') return step.instruction;
  const meters = tier === 'far' ? FAR_METERS : NEAR_METERS;
  // Lowercased so the prefix and the instruction read as one sentence ("In 800
  // metres, turn right onto NH 44") rather than two clauses stapled together with a
  // capital mid-sentence — ORS instructions are always sentence-cased on their own.
  const lowered = step.instruction.charAt(0).toLowerCase() + step.instruction.slice(1);
  return `In ${meters} metres, ${lowered}`;
}
