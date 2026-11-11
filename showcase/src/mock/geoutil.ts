import type { LngLat } from './types';

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x =
    Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Move `dist` metres from `p` along `brg` degrees. */
export function offset(p: LngLat, brg: number, dist: number): LngLat {
  const d = dist / R;
  const b = rad(brg);
  const lat1 = rad(p[1]);
  const lng1 = rad(p[0]);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [deg(lng2), deg(lat2)];
}

/** Cumulative distance (m) at each polyline vertex. */
export function cumulative(line: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + haversine(line[i - 1], line[i]));
  return out;
}

export interface AlongResult {
  point: LngLat;
  index: number;
  heading: number;
}

/** Point `along` metres into `line`, with the segment index and heading. */
export function pointAlong(line: LngLat[], cum: number[], along: number): AlongResult {
  const total = cum[cum.length - 1];
  const a = Math.max(0, Math.min(total, along));
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= a) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi] - cum[lo] || 1;
  const t = (a - cum[lo]) / segLen;
  const p0 = line[lo];
  const p1 = line[hi];
  return {
    point: [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t],
    index: lo,
    heading: bearing(p0, p1),
  };
}

/** Sub-line between two along-distances (inclusive), for ridden/ahead splits. */
export function sliceAlong(line: LngLat[], cum: number[], from: number, to: number): LngLat[] {
  const a = pointAlong(line, cum, from);
  const b = pointAlong(line, cum, to);
  const mid = line.slice(a.index + 1, b.index + 1);
  return [a.point, ...mid, b.point];
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compass8(brg: number): string {
  return COMPASS[Math.round(((brg % 360) + 360) % 360 / 45) % 8];
}

export function bounds(points: LngLat[]): [LngLat, LngLat] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}
