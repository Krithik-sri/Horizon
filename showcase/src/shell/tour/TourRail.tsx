// Left rail: what Horizon is, the journey as a timeline of chapters, and a scripted auto-play.
import { AnimatePresence, motion } from 'framer-motion';
import { Play, Square } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { DotMeter, GlowButton } from '../../components/ui';
import { currentRoute, useApp } from '../../mock/store';
import { STEPS, useAutoplay } from './autoplay';
import { chapterOf, jumpTo, type Chapter } from './nav';
import './tour.css';

interface ChapterInfo {
  id: Chapter;
  title: string;
  register: 'departure' | 'motion' | 'return';
  desc: string;
  tags: string[];
}

const CHAPTERS: ChapterInfo[] = [
  {
    id: 'boot',
    title: 'Boot',
    register: 'departure',
    desc: 'First launch signs the rider in silently — no account, no form.',
    tags: ['anonymous sign-in', 'retry on failure'],
  },
  {
    id: 'departure',
    title: 'Departure',
    register: 'departure',
    desc: 'One calm screen that answers “am I ready to ride?”',
    tags: ['readiness', 'name', 'spoken directions', 'start ride', 'ride code', 'join with code'],
  },
  {
    id: 'planner',
    title: 'Planner',
    register: 'departure',
    desc: 'Pick where the convoy is going, then share one route with everyone.',
    tags: ['search', 'multi-stop', 'alternatives', 'send to convoy'],
  },
  {
    id: 'motion',
    title: 'Motion',
    register: 'motion',
    desc: 'Almost invisible while riding — only what matters right now.',
    tags: ['heading-up map', 'turn cues', 'speed', 'convoy dots', 'spoken guidance', 'push-to-talk', 'rerouting', 'end ride'],
  },
  {
    id: 'archive',
    title: 'Return archive',
    register: 'return',
    desc: 'Every ride you’ve finished, newest first. Never ranked.',
    tags: ['ride history'],
  },
  {
    id: 'detail',
    title: 'Ride detail',
    register: 'return',
    desc: 'One ride, remembered: the line you drew, a few facts, photos and words.',
    tags: ['trace', 'facts', 'photos', 'journal'],
  },
];

function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg className="tour-logo" width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <linearGradient id="tour-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--cyan)" />
          <stop offset="0.5" stopColor="var(--violet)" />
          <stop offset="1" stopColor="var(--magenta)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="12" fill="rgba(255,255,255,0.05)" stroke="url(#tour-logo-g)" strokeOpacity="0.55" />
      <circle cx="20" cy="22" r="7" fill="url(#tour-logo-g)" />
      <rect x="6" y="22" width="28" height="12" fill="var(--night-1)" opacity="0.92" />
      <path d="M7 22.5h26" stroke="url(#tour-logo-g)" strokeWidth="2" strokeLinecap="round" />
      {[0, 1, 2, 3, 4].map((i) => (
        <circle key={i} cx={10 + i * 5} cy={28} r={1.1} fill="var(--ink-3)" opacity={1 - i * 0.16} />
      ))}
    </svg>
  );
}

export function TourRail({ onNavigate }: { onNavigate?: () => void }) {
  const screen = useApp((s) => currentRoute(s).screen);
  const current = chapterOf(screen);
  const running = useAutoplay((s) => s.running);
  const index = useAutoplay((s) => s.index);
  const caption = useAutoplay((s) => s.caption);
  const error = useAutoplay((s) => s.error);
  const play = useAutoplay((s) => s.play);
  const stop = useAutoplay((s) => s.stop);

  const listRef = useRef<HTMLOListElement>(null);

  // keep the glowing chapter in view as the phone moves through the journey
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('.tour-ch.is-active');
    if (!list || !el) return;
    const top = el.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const bottom = top + el.offsetHeight;
    const viewTop = list.scrollTop + 24; // clear of the top fade
    const viewBottom = list.scrollTop + list.clientHeight - 16;
    if (top >= viewTop && bottom <= viewBottom) return; // already fully visible
    if (top < viewTop) list.scrollTo({ top: Math.max(0, top - 24), behavior: 'smooth' });
    else list.scrollTo({ top: Math.min(top - 24, bottom - list.clientHeight + 16), behavior: 'smooth' });
  }, [current]);

  const done = !running && index >= STEPS.length;
  const showStatus = running || done || !!error;

  const go = (c: Chapter) => {
    if (useAutoplay.getState().running) stop();
    jumpTo(c);
    onNavigate?.();
  };

  // 1–6 jump to a chapter, P plays / stops the journey (desktop rail only)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= CHAPTERS.length) {
        go(CHAPTERS[n - 1].id);
      } else if (e.key === 'p' || e.key === 'P') {
        const ap = useAutoplay.getState();
        if (ap.running) ap.stop();
        else ap.play();
      } else if (e.key === 'Escape' && useAutoplay.getState().running) {
        stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="tour glass">
      <div className="tour-halftone halftone-accent" aria-hidden />

      <header className="tour-head">
        <div className="tour-brand">
          <LogoMark />
          <h1 className="tour-title">Horizon</h1>
          <span className="tour-chip">Mock prototype</span>
        </div>
        <p className="tour-pitch">The invisible co-rider — navigation, convoy and memories for motorcyclists.</p>
      </header>

      <section className={`tour-play ${running ? 'is-running' : ''}`}>
        {!running ? (
          <GlowButton
            full
            size="md"
            icon={<Play size={16} fill="currentColor" />}
            onClick={() => {
              play();
              onNavigate?.();
            }}
          >
            {done ? 'Play it again' : 'Play the full journey'}
          </GlowButton>
        ) : (
          <GlowButton full size="md" variant="glass" icon={<Square size={14} fill="currentColor" />} onClick={stop}>
            Stop
          </GlowButton>
        )}
        <AnimatePresence initial={false}>
          {showStatus && (
            <motion.div
              className="tour-status"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="tour-status-row">
                <span className="tour-mono">
                  {error ? 'Stopped' : done ? 'Complete' : `Step ${index + 1} / ${STEPS.length}`}
                </span>
                {running && <span className="tour-live" aria-hidden />}
              </div>
              <DotMeter value={done ? 1 : (index + (running ? 0.5 : 0)) / STEPS.length} n={STEPS.length} style={{ gap: 4 }} />
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={error ?? caption}
                  className="tour-caption"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25 }}
                >
                  {error ?? caption}
                </motion.p>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <div className="tour-label">The journey</div>

      <ol ref={listRef} className="tour-timeline scroll">
        {CHAPTERS.map((c, i) => {
          const active = c.id === current;
          return (
            <li key={c.id} className={`tour-ch reg-${c.register} ${active ? 'is-active' : ''}`}>
              <button className="tour-ch-btn" onClick={() => go(c.id)} aria-current={active ? 'step' : undefined}>
                <span className="tour-node" aria-hidden>
                  {active && <motion.span layoutId="tour-node-glow" className="tour-node-glow" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                  <span className="tour-node-num">{i + 1}</span>
                </span>
                <span className="tour-ch-body">
                  <span className="tour-ch-top">
                    <span className="tour-ch-title">{c.title}</span>
                    <span className="tour-ch-reg">{c.register}</span>
                  </span>
                  <span className="tour-ch-desc">{c.desc}</span>
                  <span className="tour-tags">
                    {c.tags.map((t) => (
                      <span key={t} className="tour-tag">
                        {t}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <footer className="tour-foot">
        <div className="tour-keys">
          <kbd>1</kbd>–<kbd>6</kbd> jump · <kbd>P</kbd> play / stop
        </div>
        <div className="tour-note">No real backend — every state is mocked.</div>
      </footer>
    </div>
  );
}
