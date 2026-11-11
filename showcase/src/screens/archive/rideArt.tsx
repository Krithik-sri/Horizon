// Return-register art shared by the archive and the ride detail: the route thumbnail drawn
// straight from ride.track, and the avatar gradient for a named companion.
import { motion } from 'framer-motion';
import { useId, useMemo } from 'react';
import { CONVOY } from '../../mock/data';
import type { LngLat } from '../../mock/types';

const FALLBACK_GRAD = 'linear-gradient(135deg, #ffd166, #ff7a59)';

/** Same gradient the companion wears in the convoy, so a face reads the same across registers. */
export function companionGrad(name: string): string {
  return CONVOY.find((c) => c.name === name)?.grad ?? FALLBACK_GRAD;
}

interface Projected {
  d: string;
  start: [number, number];
  end: [number, number];
}

type XY = [number, number];

/** Ramer–Douglas–Peucker in pixel space: drops GPS jitter, keeps the shape's real bends. */
function simplify(pts: XY[], tol: number): XY[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const dist = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (dist > worst) {
        worst = dist;
        at = i;
      }
    }
    if (at > 0 && worst > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Centripetal-ish Catmull-Rom through every point, emitted as cubic Béziers — sparse tracks still read as roads. */
function smoothPath(xy: XY[]): string {
  const f = (n: number) => n.toFixed(1);
  if (xy.length === 2) return `M${f(xy[0][0])} ${f(xy[0][1])} L${f(xy[1][0])} ${f(xy[1][1])}`;
  let d = `M${f(xy[0][0])} ${f(xy[0][1])}`;
  const t = 0.5; // tension: 0.5 keeps curves gentle without overshooting short legs
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[Math.max(0, i - 1)];
    const p1 = xy[i];
    const p2 = xy[i + 1];
    const p3 = xy[Math.min(xy.length - 1, i + 2)];
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * t * 2;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * t * 2;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * t * 2;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * t * 2;
    d += ` C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/**
 * Equirectangular projection (cos-lat corrected, so a route keeps its true aspect) of a
 * [lng, lat] track into a w×h box, simplified in pixel space and smoothed — works the same
 * for a 3-point track and a 3000-point one.
 */
function project(track: LngLat[], w: number, h: number, pad: number): Projected | null {
  if (track.length < 2) return null;
  const lat0 = (track.reduce((a, p) => a + p[1], 0) / track.length) * (Math.PI / 180);
  const k = Math.cos(lat0);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of track) {
    const x = p[0] * k;
    const y = -p[1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const s = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const ox = (w - spanX * s) / 2;
  const oy = (h - spanY * s) / 2;
  const raw: XY[] = track.map((p) => [ox + (p[0] * k - minX) * s, oy + (-p[1] - minY) * s]);
  // Simplify relative to the drawing size: ~0.6px on a big hero, a touch coarser on a small thumb.
  const tol = Math.max(0.5, Math.min(w, h) / 160);
  let xy = simplify(raw, tol);
  // Collapse duplicate points (a parked rider) so the spline never gets a zero-length leg.
  xy = xy.filter((q, i) => i === 0 || i === xy.length - 1 || Math.hypot(q[0] - xy[i - 1][0], q[1] - xy[i - 1][1]) > 0.8);
  if (xy.length < 2) xy = [raw[0], raw[raw.length - 1]];
  return { d: smoothPath(xy), start: xy[0], end: xy[xy.length - 1] };
}

/**
 * The ride's own line, sunset gradient running start → end, over a dotted (halftone) echo.
 * `draw` animates the core stroke on once (pathLength) — used by the archive hero only.
 */
export function RideThumb({
  track,
  width,
  height,
  pad = 12,
  draw = false,
  weight = 1,
}: {
  track: LngLat[];
  width: number;
  height: number;
  pad?: number;
  draw?: boolean;
  weight?: number;
}) {
  const uid = useId().replace(/:/g, '');
  const p = useMemo(() => project(track, width, height, pad), [track, width, height, pad]);
  if (!p) return <svg width={width} height={height} aria-hidden />;
  const gid = `rt-g-${uid}`;
  const fid = `rt-f-${uid}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="rt-svg">
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={p.start[0]} y1={p.start[1]} x2={p.end[0]} y2={p.end[1]}>
          <stop offset="0%" stopColor="#ffd166" />
          <stop offset="50%" stopColor="#ff7a59" />
          <stop offset="100%" stopColor="#ff4fd8" />
        </linearGradient>
        <filter id={fid} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={3 * weight} />
        </filter>
      </defs>
      {/* glow */}
      <path d={p.d} fill="none" stroke={`url(#${gid})`} strokeWidth={6 * weight} strokeLinecap="round" strokeLinejoin="round" opacity={0.35} filter={`url(#${fid})`} />
      {/* halftone echo: round-capped zero-length dashes read as dots */}
      <path
        d={p.d}
        fill="none"
        stroke={`url(#${gid})`}
        strokeWidth={3.4 * weight}
        strokeLinecap="round"
        strokeDasharray={`0 ${6.5 * weight}`}
        opacity={0.55}
        transform={`translate(${2.5 * weight} ${3 * weight})`}
      />
      {/* core */}
      <motion.path
        d={p.d}
        fill="none"
        stroke={`url(#${gid})`}
        strokeWidth={2 * weight}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={draw ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.4, ease: [0.65, 0, 0.35, 1], delay: 0.25 }}
      />
      <circle cx={p.start[0]} cy={p.start[1]} r={3.2 * weight} fill="#ffd166" stroke="#fff" strokeWidth={1.2 * weight} />
      <circle cx={p.end[0]} cy={p.end[1]} r={4 * weight} fill="rgba(10,8,30,0.7)" stroke="#ff4fd8" strokeWidth={1.8 * weight} />
    </svg>
  );
}
