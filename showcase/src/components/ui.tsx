// Shared UI primitives for every screen. Screens compose these; they never restyle them inline
// beyond layout (margin, flex, width).
import { AnimatePresence, motion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import './ui.css';

export type Tone = 'violet' | 'cyan' | 'magenta' | 'lime' | 'coral' | 'rose';

/* ---------------- GlassCard ---------------- */
export interface GlassCardProps extends HTMLMotionProps<'div'> {
  tone?: Tone;
  depth?: 'default' | 'deep' | 'strong';
  pad?: number;
  radius?: number;
  dots?: boolean;
}
export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(function GlassCard(
  { tone, depth = 'default', pad = 20, radius, dots, className = '', style, children, ...rest },
  ref,
) {
  return (
    <motion.div
      ref={ref}
      className={`glass ${depth === 'deep' ? 'glass-deep' : depth === 'strong' ? 'glass-strong' : ''} ${
        tone ? `tone-${tone}` : ''
      } ${className}`}
      style={{ padding: pad, borderRadius: radius, ...style }}
      {...rest}
    >
      {dots && <div className="card-dots dots dots-fade" aria-hidden />}
      {children as ReactNode}
    </motion.div>
  );
});

/* ---------------- GlowButton ---------------- */
export interface GlowButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: 'primary' | 'sunset' | 'mint' | 'glass' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  full?: boolean;
  children?: ReactNode;
}
export function GlowButton({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  iconRight,
  full,
  disabled,
  className = '',
  children,
  ...rest
}: GlowButtonProps) {
  const off = disabled || loading;
  return (
    <motion.button
      className={`gbtn gbtn-${variant} gbtn-${size} ${full ? 'gbtn-full' : ''} ${off ? 'is-off' : ''} ${
        loading ? 'is-loading' : ''
      } ${className}`}
      disabled={off}
      whileTap={off ? undefined : { scale: 0.96 }}
      whileHover={off ? undefined : { y: -1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      {...rest}
    >
      <span className="gbtn-sheen" aria-hidden />
      {icon && <span className="gbtn-icon">{icon}</span>}
      {children != null && <span className="gbtn-label">{children}</span>}
      {loading && <Dots />}
      {iconRight && !loading && <span className="gbtn-icon">{iconRight}</span>}
    </motion.button>
  );
}

/* ---------------- IconButton ---------------- */
export function IconButton({
  children,
  label,
  tone,
  size = 40,
  className = '',
  ...rest
}: HTMLMotionProps<'button'> & { label: string; tone?: Tone; size?: number; children: ReactNode }) {
  return (
    <motion.button
      aria-label={label}
      title={label}
      className={`ibtn glass ${tone ? `tone-${tone}` : ''} ${className}`}
      style={{ width: size, height: size }}
      whileTap={{ scale: 0.9 }}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

/* ---------------- Dots (loading) ---------------- */
export function Dots({ color }: { color?: string }) {
  return (
    <span className="ldots" style={color ? ({ '--dc': color } as CSSProperties) : undefined} aria-label="loading">
      <i />
      <i />
      <i />
    </span>
  );
}

/* ---------------- Toggle ---------------- */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`tgl ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <motion.span className="tgl-knob" layout transition={{ type: 'spring', stiffness: 600, damping: 32 }} />
    </button>
  );
}

/* ---------------- Chip ---------------- */
export function Chip({
  tone = 'violet',
  icon,
  children,
  pulse,
  onClick,
  className = '',
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  pulse?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const Comp = onClick ? motion.button : motion.span;
  return (
    <Comp className={`chip chip-${tone} ${className}`} onClick={onClick} whileTap={onClick ? { scale: 0.95 } : undefined}>
      {pulse && <span className="chip-pulse" />}
      {icon}
      <span>{children}</span>
    </Comp>
  );
}

/* ---------------- Avatar ---------------- */
export function Avatar({ name, grad, size = 32, ring }: { name: string; grad?: string; size?: number; ring?: string }) {
  const init = name
    .split(/\s+/)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: grad ?? 'linear-gradient(135deg,#7c5cff,#ff4fd8)',
        boxShadow: ring ? `0 0 0 2px #0a0828, 0 0 0 3.5px ${ring}` : undefined,
      }}
    >
      {init}
    </span>
  );
}

/* ---------------- Sheet (modal bottom sheet inside the phone) ---------------- */
export function Sheet({
  open,
  onClose,
  children,
  tone,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="sheet-root" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="sheet-backdrop" onClick={onClose} />
          <motion.div
            className={`sheet glass glass-deep ${tone ? `tone-${tone}` : ''}`}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            <div className="sheet-handle" />
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------- Label / section header ---------------- */
export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="t-label" style={style}>
      {children}
    </div>
  );
}

/* ---------------- Inline error / note line ---------------- */
export function Note({
  tone = 'rose',
  children,
  action,
}: {
  tone?: Tone;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <motion.div
      className={`note note-${tone}`}
      initial={{ opacity: 0, y: -4, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: -4, height: 0 }}
    >
      <span className="note-dot" />
      <span className="note-text">{children}</span>
      {action && (
        <button className="note-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </motion.div>
  );
}

/* ---------------- Stagger helpers ---------------- */
export const stagger = {
  container: { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } } },
  item: {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
  },
} as const;

/* ---------------- Backdrop (in-phone aurora behind a screen) ---------------- */
export function Backdrop({ palette = 'aurora', dots = true }: { palette?: 'aurora' | 'sunset' | 'mint' | 'dusk'; dots?: boolean }) {
  return (
    <div className={`bd bd-${palette}`} aria-hidden>
      <i className="bd-b1" />
      <i className="bd-b2" />
      <i className="bd-b3" />
      {dots && <div className="bd-dots dots" />}
    </div>
  );
}

/* ---------------- motion tokens ---------------- */
export const spring = {
  snappy: { type: 'spring', stiffness: 520, damping: 32 },
  soft: { type: 'spring', stiffness: 260, damping: 30 },
} as const;
export const fade = { duration: 0.32, ease: [0.16, 1, 0.3, 1] } as const;

/* ---------------- DotRule: a divider of fading dots ---------------- */
export function DotRule({ n = 28, style }: { n?: number; style?: CSSProperties }) {
  return (
    <div className="dotrule" style={style} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ opacity: 1 - i / n }} />
      ))}
    </div>
  );
}

/* ---------------- DotMeter: dot-matrix progress (0..1) ---------------- */
export function DotMeter({ value, n = 20, style }: { value: number; n?: number; style?: CSSProperties }) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * n);
  return (
    <div className="dotmeter" style={style} role="meter" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < lit ? 'on' : ''} />
      ))}
    </div>
  );
}
