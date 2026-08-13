/**
 * Shared distance/duration/date formatters — dedupes what plan/[code].tsx,
 * RideCard.tsx, and RideFacts.tsx each defined for themselves. Pure — no
 * react-native import, no store — so a future *.check.ts could exercise this
 * under plain tsx the same way route.pure.ts / wsProtocol.ts already do.
 *
 * AheadCue.tsx's formatDistance/formatRemaining/formatEta are deliberately NOT
 * here: those carry anti-flicker rounding for Motion's live, ticking-down
 * readout (a plain .toFixed(1) would repaint "42.0 km" every frame), a concern
 * these one-shot, read-once labels don't have.
 */

// The three duplicates disagreed on precision, and the disagreement turned out to be
// meaningful rather than accidental, so it survives as a parameter rather than being
// resolved away:
//   - Whole km for *choosing* between route alternatives — ADR-013's own worked example
//     is "1 h 12 · 58 km · via NH 44", and a tenth of a km is below the resolution any
//     of that decision is made at.
//   - One decimal for a *recorded* ride, where the number is the fact itself and
//     rounding 58.4 to 58 quietly discards something the rider might care about.
export function formatDistanceKm(m: number, decimals: 0 | 1 = 1): string {
  return `${(m / 1000).toFixed(decimals)} km`;
}

export function formatDuration(totalSeconds: number): string {
  const totalMin = Math.round(totalSeconds / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

// Compact — "Aug 10" — for a list row (RideCard).
export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Full — "August 10, 2026" — for a single ride's detail facts (RideFacts).
export function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
