// Departure — "Am I ready to ride?" Calm, confident, one column. The start card is the hero.
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  LocateFixed,
  LocateOff,
  LogOut,
  MapPin,
  Route,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { CodeCells, Waveform } from '../../components/fx';
import { Backdrop, Chip, Dots, GlowButton, Note, Toggle, stagger } from '../../components/ui';
import { CODE_ALPHABET, DESTINATION } from '../../mock/data';
import { useApp } from '../../mock/store';
import { CheckTile, HorizonMark, RouteDots } from './parts';
import './departure.css';

const collapse: Variants = {
  initial: { opacity: 0, height: 0, overflow: 'hidden' },
  animate: {
    opacity: 1,
    height: 'auto',
    transition: { height: { type: 'spring', stiffness: 260, damping: 32 }, opacity: { duration: 0.3, delay: 0.08 } },
    transitionEnd: { overflow: 'visible' },
  },
  exit: {
    opacity: 0,
    height: 0,
    overflow: 'hidden',
    transition: { height: { type: 'spring', stiffness: 320, damping: 36 }, opacity: { duration: 0.18 } },
  },
};

function Collapse({ children }: { children: ReactNode }) {
  return (
    <motion.div variants={collapse} initial="initial" animate="animate" exit="exit">
      {children}
    </motion.div>
  );
}

// Clearance kept below a revealed card so it sits above the shell's home-indicator scrim.
const REVEAL_CLEARANCE = 64;

/** Smoothly scroll `scroller` so `el`'s bottom edge sits above the home indicator. */
function revealBottom(scroller: HTMLElement | null, el: HTMLElement | null) {
  if (!scroller || !el) return;
  const s = scroller.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  const overflow = e.bottom - (s.bottom - REVEAL_CLEARANCE);
  if (overflow > 0) scroller.scrollTo({ top: scroller.scrollTop + overflow, behavior: 'smooth' });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
}

function copyCode(code: string, toast: (t: string, tone?: 'lime') => void) {
  try {
    void navigator.clipboard?.writeText(code).catch(() => undefined);
  } catch {
    /* clipboard unavailable in this context — the toast still confirms intent */
  }
  toast('Code copied', 'lime');
}

export function DepartureScreen() {
  const go = useApp((s) => s.go);
  const toast = useApp((s) => s.toast);
  const session = useApp((s) => s.session);
  const boot = useApp((s) => s.boot);
  const name = useApp((s) => s.name);
  const setName = useApp((s) => s.setName);
  const voice = useApp((s) => s.voiceGuidance);
  const setVoice = useApp((s) => s.setVoiceGuidance);
  const locationDenied = useApp((s) => s.scenario.locationDenied);
  const locationChecking = useApp((s) => s.locationChecking);
  const retryLocation = useApp((s) => s.retryLocation);
  const start = useApp((s) => s.start);
  const startRide = useApp((s) => s.startRide);
  const join = useApp((s) => s.join);
  const setJoinCode = useApp((s) => s.setJoinCode);
  const joinRide = useApp((s) => s.joinRide);
  const activeCode = useApp((s) => s.activeCode);
  const leaveRide = useApp((s) => s.leaveRide);
  const routeSet = useApp((s) => s.routeSet);
  const lastStop = useApp((s) => s.stops[s.stops.length - 1]?.label);

  const nameValid = name.trim().length > 0;
  const sessionOk = session === 'ready';
  const canAct = nameValid && sessionOk;
  const startConfirm = start.phase === 'confirm';
  const joinConnected = join.phase === 'connected';
  const showStart = !joinConnected;
  const showJoin = start.phase === 'idle';
  const joinEnabled = canAct && join.code.length === 6 && join.phase === 'idle';
  const firstName = name.trim().split(/\s+/)[0];
  const destLabel = lastStop ?? DESTINATION.label;
  const rideOpen = startConfirm || joinConnected;

  // When a ride opens, the hero card grows; as its height settles, bring its action
  // buttons into view so "Plan the route / Start riding" are never left below the fold.
  const scrollRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLElement>(null);
  const joinRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!rideOpen) return;
    // The card keeps growing for a while (inner mode="wait" swap, code cells, socket line), so
    // follow its size: re-reveal shortly after each resize settles, for the first ~2.4s.
    const scroller = scrollRef.current;
    const card = startConfirm ? startRef.current : joinRef.current;
    if (!scroller || !card) return;
    let settle = 0;
    const reveal = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(() => revealBottom(scroller, card), 160);
    };
    const ro = new ResizeObserver(reveal);
    ro.observe(card);
    const first = window.setTimeout(reveal, 350);
    const stop = window.setTimeout(() => ro.disconnect(), 2400);
    return () => {
      ro.disconnect();
      [settle, first, stop].forEach((id) => window.clearTimeout(id));
    };
  }, [rideOpen, startConfirm]);

  const summary = (() => {
    if (session === 'pending') return { tone: 'busy', text: 'Signing you in — one moment.' };
    if (session === 'error') return { tone: 'bad', text: 'Not signed in yet, so a ride can’t open.' };
    if (!nameValid) return { tone: 'warn', text: 'Add your name so the convoy knows who you are.' };
    if (rideOpen) return { tone: 'ok', text: 'Your ride is open. Plan the route or roll out.' };
    if (locationDenied) return { tone: 'warn', text: 'Ready — though you won’t show on the map.' };
    return { tone: 'ok', text: 'Ready to ride. Everything checks out.' };
  })();

  const routeChip = routeSet && (
    <motion.div className="dep-route-set" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <Chip tone="cyan" icon={<MapPin />}>
        Route set · {destLabel}
      </Chip>
    </motion.div>
  );

  return (
    <div className="dep">
      <Backdrop palette="mint" />
      <div className="dep-scrim" aria-hidden />

      <motion.div ref={scrollRef} className="dep-scroll scroll" variants={stagger.container} initial="hidden" animate="show">
        {/* header */}
        <motion.header className="dep-head" variants={stagger.item}>
          <div className="dep-brand">
            <HorizonMark />
            <span className="dep-wordmark">Horizon</span>
          </div>
          <h1 className="dep-greeting">
            {greeting()}
            {firstName ? (
              <>
                , <span className="grad-text-accent">{firstName}</span>
              </>
            ) : null}
            .
          </h1>
          <p className={`dep-summary is-${summary.tone}`}>
            <span className="dep-summary-led" />
            {summary.text}
          </p>
        </motion.header>

        {/* readiness */}
        <motion.section className="dep-checks" variants={stagger.item}>
          <CheckTile
            state={session === 'ready' ? 'ok' : session === 'error' ? 'bad' : 'busy'}
            icon={session === 'error' ? <ShieldAlert size={18} /> : <ShieldCheck size={18} />}
            label="Session"
            value={
              session === 'ready' ? 'Signed in' : session === 'error' ? 'Not signed in' : (
                <>
                  Signing in <Dots />
                </>
              )
            }
          />
          <CheckTile
            state={locationChecking ? 'busy' : locationDenied ? 'bad' : 'ok'}
            icon={locationDenied && !locationChecking ? <LocateOff size={18} /> : <LocateFixed size={18} />}
            label="Location"
            value={
              locationChecking ? (
                <>
                  Checking <Dots />
                </>
              ) : locationDenied ? (
                'Off'
              ) : (
                'Location ready'
              )
            }
          />
        </motion.section>

        <motion.div variants={stagger.item} className="dep-notes">
          <AnimatePresence initial={false}>
            {session === 'error' && (
              <Note key="sess" tone="rose" action={{ label: 'Retry', onClick: () => void boot() }}>
                Couldn’t sign you in — check your connection, then retry.
              </Note>
            )}
            {locationDenied && (
              <Note
                key="loc"
                tone="cyan"
                action={locationChecking ? undefined : { label: 'Retry', onClick: () => void retryLocation() }}
              >
                Horizon needs your location to show you on the convoy map. You can still start or join without it.
              </Note>
            )}
          </AnimatePresence>
        </motion.div>

        {/* name */}
        <motion.label className="dep-name" variants={stagger.item}>
          <span className="t-label">Your name</span>
          <span className="dep-name-row">
            <input
              className="field dep-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              autoCapitalize="words"
              autoComplete="nickname"
              maxLength={24}
            />
            <AnimatePresence>
              {nameValid && (
                <motion.span
                  className="dep-name-ok"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                >
                  <Check size={14} strokeWidth={3} />
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          <span className="dep-hint">{nameValid ? 'This is how your convoy sees you.' : 'Needed before you start or join.'}</span>
        </motion.label>

        {/* spoken directions */}
        <motion.section className={`dep-voice glass glass-quiet ${rideOpen ? 'is-compact' : ''}`} variants={stagger.item}>
          <div className="dep-voice-main">
            <div className="dep-voice-text">
              <span className="dep-voice-title">Spoken directions</span>
              {!rideOpen && (
                <span className="dep-voice-sub">The only place this can be changed — never mid-ride.</span>
              )}
            </div>
            {rideOpen && <span className={`dep-voice-state t-label ${voice ? 'on' : ''}`}>{voice ? 'On' : 'Muted'}</span>}
            <Toggle on={voice} onChange={setVoice} label="Spoken directions" />
          </div>
          <AnimatePresence initial={false}>
            {!rideOpen && (
              <Collapse key="wave">
                <div className={`dep-voice-wave ${voice ? 'on' : ''}`}>
                  <Waveform active={voice} bars={34} height={22} colors={['var(--lime)', 'var(--cyan)', 'var(--lime)']} />
                  <span className="t-label">{voice ? 'On' : 'Muted'}</span>
                </div>
              </Collapse>
            )}
          </AnimatePresence>
        </motion.section>

        {/* start a ride (hero) */}
        <motion.div variants={stagger.item}>
          <AnimatePresence initial={false}>
            {showStart && (
              <Collapse key="start">
                <section ref={startRef} className={`dep-card dep-hero glass ${startConfirm ? 'holo' : 'glass-quiet'}`}>
                  <div className="dep-card-dots halftone-accent" aria-hidden />
                  <div className="dep-card-head">
                    <span className="t-label">Start a ride</span>
                    {startConfirm && (
                      <Chip tone="lime" pulse>
                        Live
                      </Chip>
                    )}
                  </div>

                  <AnimatePresence initial={false} mode="wait">
                    {!startConfirm ? (
                      <Collapse key="start-idle">
                        <h2 className="dep-card-title">Lead the convoy</h2>
                        <p className="dep-card-sub">Open a ride and get a six-character code your group joins with.</p>
                        <GlowButton
                          full
                          size="lg"
                          loading={start.phase === 'posting'}
                          disabled={!canAct}
                          onClick={() => void startRide()}
                          iconRight={<ArrowRight size={18} />}
                        >
                          {start.phase === 'posting' ? 'Starting…' : 'Start a ride'}
                        </GlowButton>
                        <AnimatePresence>
                          {start.error && (
                            <Note key="se" tone="rose">
                              {start.error}
                            </Note>
                          )}
                        </AnimatePresence>
                      </Collapse>
                    ) : (
                      <Collapse key="start-confirm">
                        <h2 className="dep-card-title">Your ride is open</h2>
                        <div className="dep-code">
                          <CodeCells value={activeCode ?? ''} readOnly size="lg" />
                        </div>
                        <div className="dep-share">
                          <span className="t-label">Share this code</span>
                          <Chip tone="lime" icon={<Copy />} onClick={() => copyCode(activeCode ?? '', toast)}>
                            Copy
                          </Chip>
                        </div>
                        <SocketLine open={start.socketOpen} />
                        {routeChip}
                        <div className="dep-actions">
                          <GlowButton variant="glass" icon={<Route size={17} />} onClick={() => go('planner')}>
                            Plan the route
                          </GlowButton>
                          <GlowButton
                            disabled={!start.socketOpen}
                            iconRight={<ArrowRight size={17} />}
                            onClick={() => go('motion')}
                          >
                            Start riding
                          </GlowButton>
                        </div>
                        <GlowButton variant="ghost" size="sm" className="dep-leave" icon={<LogOut size={14} />} onClick={leaveRide}>
                          Leave
                        </GlowButton>
                      </Collapse>
                    )}
                  </AnimatePresence>
                </section>
              </Collapse>
            )}
          </AnimatePresence>
        </motion.div>

        {/* join a ride */}
        <motion.div variants={stagger.item}>
          <AnimatePresence initial={false}>
            {showJoin && (
              <Collapse key="join">
                <section ref={joinRef} className={`dep-card glass ${joinConnected ? 'holo dep-hero' : 'glass-quiet'}`}>
                  {joinConnected && <div className="dep-card-dots halftone-accent" aria-hidden />}
                  <div className="dep-card-head">
                    <span className="t-label">Join a ride</span>
                    {joinConnected && (
                      <Chip tone="lime" pulse>
                        Live
                      </Chip>
                    )}
                  </div>
                  <AnimatePresence initial={false} mode="wait">
                    {!joinConnected ? (
                      <Collapse key="join-idle">
                        <p className="dep-card-sub dep-card-sub-tight">Enter the code from whoever is leading.</p>
                        <div className="dep-code">
                          <CodeCells
                            value={join.code}
                            onChange={setJoinCode}
                            alphabet={CODE_ALPHABET}
                            error={!!join.error}
                            onSubmit={() => joinEnabled && void joinRide()}
                          />
                        </div>
                        <div className="dep-try">
                          <span>Try</span>
                          {['H3K7M2', 'NANDI7'].map((c) => (
                            <button key={c} className="dep-try-code" onClick={() => setJoinCode(c)}>
                              {c}
                            </button>
                          ))}
                        </div>
                        <GlowButton
                          full
                          variant={joinEnabled || join.phase === 'connecting' ? 'primary' : 'glass'}
                          loading={join.phase === 'connecting'}
                          disabled={!joinEnabled}
                          onClick={() => void joinRide()}
                        >
                          {join.phase === 'connecting' ? 'Connecting…' : 'Join'}
                        </GlowButton>
                        <AnimatePresence>
                          {join.error && (
                            <Note key="je" tone="rose">
                              {join.error}
                            </Note>
                          )}
                        </AnimatePresence>
                      </Collapse>
                    ) : (
                      <Collapse key="join-connected">
                        <h2 className="dep-card-title">You’re in</h2>
                        <div className="dep-code">
                          <CodeCells value={join.code} readOnly size="lg" />
                        </div>
                        <SocketLine open />
                        {routeChip}
                        <div className="dep-actions">
                          <GlowButton variant="glass" icon={<Route size={17} />} onClick={() => go('planner')}>
                            Plan the route
                          </GlowButton>
                          <GlowButton iconRight={<ArrowRight size={17} />} onClick={() => go('motion')}>
                            Join ride
                          </GlowButton>
                        </div>
                        <GlowButton variant="ghost" size="sm" className="dep-leave" icon={<LogOut size={14} />} onClick={leaveRide}>
                          Leave
                        </GlowButton>
                      </Collapse>
                    )}
                  </AnimatePresence>
                </section>
              </Collapse>
            )}
          </AnimatePresence>
        </motion.div>

        {/* past rides */}
        <motion.button
          className="dep-past glass glass-quiet"
          variants={stagger.item}
          whileTap={{ scale: 0.98 }}
          onClick={() => go('archive')}
        >
          <RouteDots />
          <span className="dep-past-text">
            <span className="dep-past-title">Past rides</span>
            <span className="dep-past-sub">Photos, notes and routes from earlier rides</span>
          </span>
          <ChevronRight size={18} className="dep-past-chev" />
        </motion.button>
      </motion.div>
    </div>
  );
}

function SocketLine({ open }: { open: boolean }) {
  return (
    <div className="dep-socket">
      <AnimatePresence mode="wait" initial={false}>
        {open ? (
          <motion.span
            key="open"
            className="dep-socket-open"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
          >
            <span className="dep-socket-led" />
            Convoy channel open
          </motion.span>
        ) : (
          <motion.span key="opening" className="dep-socket-wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            Opening the ride <Dots />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
