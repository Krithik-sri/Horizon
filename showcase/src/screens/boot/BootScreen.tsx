import { AnimatePresence, motion } from 'framer-motion';
import { CloudOff, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Backdrop, Dots, GlowButton, fade } from '../../components/ui';
import { useApp } from '../../mock/store';
import { DotWordmark } from './DotWordmark';
import './boot.css';

// The dot word assembles over ~1.1s and the horizon line + flare land by ~1.9s. Hold the boot
// moment at least this long so a fast sign-in never cuts the animation short.
const MIN_BOOT_MS = 1900;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function BootScreen() {
  const session = useApp((s) => s.session);
  const boot = useApp((s) => s.boot);
  const replace = useApp((s) => s.replace);
  const sessionError = useApp((s) => s.scenario.sessionError);
  const setScenario = useApp((s) => s.setScenario);
  // Bumped on every retry so the dot word re-assembles — the retry reads as a fresh attempt.
  const [attempt, setAttempt] = useState(0);
  // True once this attempt's minimum hold has elapsed — an error card waits for the word too.
  const [held, setHeld] = useState(false);

  // Navigate only on the outcome of *this* screen's sign-in attempt. Reading `session` from render
  // would see a stale 'ready' left over from an earlier visit and skip the boot moment entirely.
  // Each attempt gets a ticket; only the latest live one may navigate (StrictMode double-mounts too).
  const ticket = useRef(0);
  const attemptBoot = useCallback(async () => {
    const mine = ++ticket.current;
    setHeld(false);
    await Promise.all([boot(), wait(MIN_BOOT_MS)]);
    if (mine !== ticket.current) return;
    setHeld(true);
    if (useApp.getState().session === 'ready') replace('departure');
  }, [boot, replace]);

  useEffect(() => {
    void attemptBoot();
    return () => {
      ticket.current++;
    };
  }, [attemptBoot]);

  const retry = () => {
    setAttempt((a) => a + 1);
    void attemptBoot();
  };

  const failed = held && session === 'error';

  return (
    <div className="boot">
      <Backdrop palette="mint" />
      <div className="boot-vignette" aria-hidden />

      <div className="boot-stage">
        <motion.div
          className="boot-mark"
          animate={{ y: failed ? -40 : 0, opacity: failed ? 0.45 : 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 28 }}
        >
          <DotWordmark key={attempt} />
          <div className="boot-horizon" aria-hidden>
            <motion.i
              key={`line-${attempt}`}
              className="boot-line"
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ delay: 0.75, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            />
            <motion.i
              key={`flare-${attempt}`}
              className="boot-flare"
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: [0, 1, 0.75], scale: [0.4, 1.15, 1] }}
              transition={{ delay: 1.1, duration: 0.8, ease: 'easeOut' }}
            />
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {!failed ? (
            <motion.div
              key="pending"
              className="boot-caption t-label"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ ...fade, delay: 0.5 }}
            >
              <span>Signing in</span>
              <Dots />
            </motion.div>
          ) : (
            <motion.div
              key="error"
              className="boot-error glass glass-deep holo"
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            >
              <div className="boot-error-dots halftone" aria-hidden />
              <div className="boot-error-icon">
                <CloudOff size={20} strokeWidth={2} />
              </div>
              <div className="t-label boot-error-label">Not signed in</div>
              <h2 className="boot-error-title">Couldn’t sign you in</h2>
              <p className="boot-error-body">
                Check your connection, then retry. Horizon signs you in anonymously — no account, no
                password — it just needs a moment online to do it.
              </p>
              <GlowButton full size="lg" icon={<RotateCw size={18} />} onClick={retry}>
                Retry
              </GlowButton>
              {sessionError && (
                <button className="boot-error-hint" onClick={() => setScenario('sessionError', false)}>
                  Demo: the session-error scenario is on — tap to restore the connection
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <motion.div
        className="boot-foot t-label"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.6 }}
      >
        The co-rider you barely notice
      </motion.div>
    </div>
  );
}
