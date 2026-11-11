// Formatting rules mirror mobile/src/features/motion (ETA, coarse distance) and Return facts.

/** "28 min" or "1 h 05" */
export function fmtEta(seconds: number): string {
  const m = Math.max(0, Math.round(seconds / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')}`;
}

/** Duration for ride facts: "1 h 12" / "48 min" */
export const fmtDuration = fmtEta;

/** Coarse remaining distance: whole km ≥10 km, 0.1 km 1–10 km, nearest 100 m below. */
export function fmtRemaining(m: number): string {
  if (m >= 10000) return `${Math.round(m / 1000)} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.max(0, Math.round(m / 100) * 100)} m`;
}

/** Distance to the next maneuver, as the cue reads it. */
export function fmtManeuver(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  if (m >= 100) return `${Math.round(m / 10) * 10} m`;
  return `${Math.max(0, Math.round(m / 5) * 5)} m`;
}

export function fmtKm(m: number, digits = 1): string {
  return `${(m / 1000).toFixed(digits)} km`;
}

export const kmh = (mps: number) => Math.round(mps * 3.6);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Aug 10" */
export function fmtShortDate(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "August 10, 2026" */
export function fmtLongDate(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function fmtWeekday(ts: number): string {
  return DAYS[new Date(ts).getDay()];
}

/** "6:42 AM" */
export function fmtClock(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  return `${((h + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');
}
