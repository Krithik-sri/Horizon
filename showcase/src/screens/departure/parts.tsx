// Small local pieces for the Departure screen.
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

/** Tiny logo: a dot-matrix sun half-risen over a horizon line. */
export function HorizonMark({ size = 22 }: { size?: number }) {
  const dots: { x: number; y: number; r: number }[] = [];
  const cx = 12;
  const cy = 14;
  for (let ring = 1; ring <= 3; ring++) {
    const n = ring * 4 + 1;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (Math.PI * i) / (n - 1);
      dots.push({ x: cx + Math.cos(a) * ring * 3.2, y: cy + Math.sin(a) * ring * 3.2, r: 1.25 - ring * 0.2 });
    }
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="dep-mark">
      <defs>
        <linearGradient id="depMarkG" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" style={{ stopColor: "var(--lime)" }} />
          <stop offset="1" style={{ stopColor: "var(--cyan)" }} />
        </linearGradient>
      </defs>
      <circle cx={cx} cy={cy} r={1.6} fill="url(#depMarkG)" />
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="url(#depMarkG)" />
      ))}
      <rect x="1" y="15.6" width="22" height="1.4" rx="0.7" fill="url(#depMarkG)" />
    </svg>
  );
}

/** A readiness tile: icon, mono label, state line. */
export function CheckTile({
  state,
  icon,
  label,
  value,
}: {
  state: 'ok' | 'bad' | 'busy';
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <motion.div className={`dep-check glass glass-quiet is-${state}`} layout transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
      <span className="dep-check-icon">{icon}</span>
      <span className="dep-check-text">
        <span className="t-label">{label}</span>
        <span className="dep-check-value">{value}</span>
      </span>
      <span className="dep-check-led" />
    </motion.div>
  );
}

/** A tiny dotted route squiggle for the Past rides row. */
export function RouteDots() {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    pts.push([4 + t * 52, 20 - Math.sin(t * Math.PI * 1.6) * 9 - t * 4]);
  }
  return (
    <svg width="60" height="32" viewBox="0 0 60 32" aria-hidden className="dep-routedots">
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 0 || i === pts.length - 1 ? 2.4 : 1.2} opacity={0.35 + (i / pts.length) * 0.65} />
      ))}
    </svg>
  );
}
