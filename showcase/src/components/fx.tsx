// Specialised components: turn glyphs, waveform, hold-to-confirm, code cells, photo art, toasts.
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useApp } from '../mock/store';
import './fx.css';

/* ---------------- TurnGlyph ----------------
   ORS step types: 0 L, 1 R, 2 sharp L, 3 sharp R, 4 slight L, 5 slight R, 6 straight,
   7 enter roundabout, 8 exit roundabout, 9 U-turn, 10 goal, 11 depart, 12 keep L, 13 keep R */
const ROT: Record<number, number> = { 0: -90, 1: 90, 2: -135, 3: 135, 4: -45, 5: 45, 6: 0, 11: 0, 12: -30, 13: 30, 8: 0 };

export function TurnGlyph({ type, size = 56 }: { type: number; size?: number }) {
  const gid = useId().replace(/:/g, '');
  const stroke = `url(#tg-${gid})`;
  const defs = (
    <defs>
      <linearGradient id={`tg-${gid}`} x1="0" y1="1" x2="1" y2="0">
        <stop offset="0%" stopColor="#22d3ee" />
        <stop offset="55%" stopColor="#7c5cff" />
        <stop offset="100%" stopColor="#ff4fd8" />
      </linearGradient>
      <filter id={`tgf-${gid}`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2.4" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
  const common = {
    fill: 'none',
    stroke,
    strokeWidth: 5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    filter: `url(#tgf-${gid})`,
  };
  let body;
  if (type === 10) {
    body = (
      <g filter={`url(#tgf-${gid})`}>
        <circle cx="32" cy="32" r="17" fill="none" stroke={stroke} strokeWidth="5" />
        <circle cx="32" cy="32" r="6" fill={stroke} />
      </g>
    );
  } else if (type === 7) {
    body = (
      <g {...common}>
        <circle cx="32" cy="36" r="11" />
        <path d="M32 25 V10 M25 16 L32 9 L39 16" />
        <path d="M32 47 V56" />
      </g>
    );
  } else if (type === 9) {
    body = (
      <g {...common}>
        <path d="M24 54 V28 a10 10 0 0 1 20 0 V40" />
        <path d="M37 33 L44 41 L51 33" />
      </g>
    );
  } else {
    const r = ROT[type] ?? 0;
    body = (
      <g {...common} transform={`rotate(${r} 32 36)`}>
        <path d="M32 56 V18" />
        <path d="M20 29 L32 16 L44 29" />
      </g>
    );
  }
  return (
    <motion.svg
      key={type}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      initial={{ opacity: 0, scale: 0.7, rotate: -8 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
    >
      {defs}
      {body}
    </motion.svg>
  );
}

/* ---------------- Waveform ---------------- */
export function Waveform({
  active,
  bars = 24,
  height = 36,
  colors = ['#22d3ee', '#7c5cff', '#ff4fd8'],
  style,
}: {
  active: boolean;
  bars?: number;
  height?: number;
  colors?: string[];
  style?: CSSProperties;
}) {
  return (
    <div
      className={`wave ${active ? 'on' : ''}`}
      style={{ height, '--wc1': colors[0], '--wc2': colors[1], '--wc3': colors[2], ...style } as CSSProperties}
    >
      {Array.from({ length: bars }, (_, i) => (
        <i key={i} style={{ animationDelay: `${(i * 97) % 700}ms`, animationDuration: `${620 + ((i * 53) % 380)}ms` }} />
      ))}
    </div>
  );
}

/* ---------------- HoldButton ----------------
   Press and hold `ms` to confirm. A gradient ring fills while held; releasing early resets. */
export function HoldButton({
  label,
  busyLabel,
  busy,
  ms = 800,
  onComplete,
  size = 92,
}: {
  label: string;
  busyLabel?: string;
  busy?: boolean;
  ms?: number;
  onComplete: () => void;
  size?: number;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const gid = useId().replace(/:/g, '');
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const down = () => {
    if (busy) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      setHolding(false);
      if (!busyRef.current) onComplete();
    }, ms);
  };
  const up = () => {
    clearTimeout(timer.current);
    setHolding(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  return (
    <motion.button
      className={`hold ${holding ? 'holding' : ''} ${busy ? 'busy' : ''}`}
      style={{ width: size, height: size }}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      onPointerCancel={up}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && down()}
      onKeyUp={up}
      animate={{ scale: holding ? 0.94 : 1 }}
      aria-label={label}
    >
      <svg width={size} height={size} className="hold-ring">
        <defs>
          <linearGradient id={`hg-${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffd166" />
            <stop offset="50%" stopColor="#ff7a59" />
            <stop offset="100%" stopColor="#ff4fd8" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} className="hold-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="hold-fill"
          stroke={`url(#hg-${gid})`}
          strokeDasharray={c}
          strokeDashoffset={holding || busy ? 0 : c}
          style={{ transition: holding ? `stroke-dashoffset ${ms}ms linear` : 'stroke-dashoffset 300ms ease-out' }}
        />
      </svg>
      <span className="hold-label">{busy ? (busyLabel ?? label) : label}</span>
    </motion.button>
  );
}

/* ---------------- CodeCells ----------------
   Six glass cells over a hidden input. Filters to `alphabet`, uppercases. readOnly shows a code. */
export function CodeCells({
  value,
  onChange,
  alphabet,
  length = 6,
  readOnly,
  size = 'md',
  autoFocus,
  error,
  onSubmit,
}: {
  value: string;
  onChange?: (v: string) => void;
  alphabet?: string;
  length?: number;
  readOnly?: boolean;
  size?: 'md' | 'lg';
  autoFocus?: boolean;
  error?: boolean;
  onSubmit?: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const chars = value.split('');
  return (
    <motion.div
      className={`cells cells-${size} ${readOnly ? 'ro' : ''} ${error ? 'err' : ''}`}
      onClick={() => ref.current?.focus()}
      animate={error ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
      transition={{ duration: 0.4 }}
    >
      {!readOnly && (
        <input
          ref={ref}
          className="cells-input"
          value={value}
          autoFocus={autoFocus}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={length}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit?.()}
          onChange={(e) => {
            const up = e.target.value.toUpperCase();
            const clean = alphabet ? up.split('').filter((ch) => alphabet.includes(ch)).join('') : up;
            onChange?.(clean.slice(0, length));
          }}
          aria-label="Ride code"
        />
      )}
      {Array.from({ length }, (_, i) => {
        const ch = chars[i];
        const isCursor = !readOnly && focused && i === Math.min(chars.length, length - 1);
        return (
          <div key={i} className={`cell ${ch ? 'filled' : ''} ${isCursor ? 'cursor' : ''}`}>
            <AnimatePresence mode="popLayout">
              {ch && (
                <motion.span
                  key={ch + i}
                  initial={{ y: 12, opacity: 0, scale: 0.6 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  exit={{ y: -10, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 26, delay: readOnly ? i * 0.07 : 0 }}
                >
                  {ch}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </motion.div>
  );
}

/* ---------------- PhotoArt ----------------
   Deterministic generated "ride photo": duotone sky, sun, layered hills, a road. No assets. */
const PALETTES = [
  ['#ff7a59', '#ff4fd8', '#2a1660', '#120a3a', '#ffd166'],
  ['#22d3ee', '#7c5cff', '#1b1a5c', '#0b0b33', '#b8ff5c'],
  ['#ffd166', '#ff7a59', '#4a1a5a', '#1d0b33', '#fff1c1'],
  ['#b8ff5c', '#22d3ee', '#0f3a4a', '#08202a', '#eaffd0'],
  ['#ff9cea', '#7c5cff', '#2c1a70', '#140c40', '#ffffff'],
  ['#ff5c8a', '#ffd166', '#5a1a3a', '#220a20', '#ffe6a8'],
];
function rand(seed: number) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
export function PhotoArt({ seed, width = 120, height = 120, radius = 16 }: { seed: number; width?: number; height?: number; radius?: number }) {
  const r = rand(seed);
  const p = PALETTES[seed % PALETTES.length];
  const gid = `pa${seed}`;
  const hills = [0, 1, 2].map((k) => {
    const base = 62 + k * 12;
    const pts = Array.from({ length: 6 }, (_, i) => `${i * 24},${base - r() * (22 - k * 5)}`).join(' L');
    return `M0,100 L${pts} L120,${base - r() * 10} L120,100 Z`;
  });
  const sunX = 25 + r() * 70;
  const sunY = 28 + r() * 18;
  const road = r() > 0.35;
  return (
    <svg width={width} height={height} viewBox="0 0 120 100" preserveAspectRatio="xMidYMid slice" style={{ borderRadius: radius, display: 'block' }}>
      <defs>
        <linearGradient id={`${gid}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p[1]} />
          <stop offset="70%" stopColor={p[0]} />
        </linearGradient>
        <radialGradient id={`${gid}g`}>
          <stop offset="0%" stopColor={p[4]} stopOpacity="0.9" />
          <stop offset="100%" stopColor={p[4]} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="120" height="100" fill={`url(#${gid}s)`} />
      <circle cx={sunX} cy={sunY} r="26" fill={`url(#${gid}g)`} />
      <circle cx={sunX} cy={sunY} r="8" fill={p[4]} />
      {hills.map((d, k) => (
        <path key={k} d={d} fill={k === 2 ? p[3] : p[2]} opacity={0.55 + k * 0.22} />
      ))}
      {road && <path d="M52,100 C58,86 62,80 64,72 L66,72 C66,80 70,88 80,100 Z" fill={p[4]} opacity="0.35" />}
    </svg>
  );
}

/* ---------------- Toasts (rendered inside the phone) ---------------- */
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="toasts">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            className={`toast glass glass-deep tone-${t.tone}`}
            initial={{ opacity: 0, y: -24, scale: 0.9, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -16, scale: 0.95, filter: 'blur(6px)' }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={() => dismiss(t.id)}
          >
            <span className={`toast-dot tone-dot-${t.tone}`} />
            {t.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
