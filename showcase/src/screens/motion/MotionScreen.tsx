// Motion — the riding screen. Heading-up map, one ambient Ahead cue, a giant speed readout,
// and a Held band that is mostly a press-and-hold push-to-talk surface. Everything else waits
// for Return. Mirrors mobile/src/app/ride/[code].tsx + features/motion/*.
import { AnimatePresence, motion } from 'framer-motion';
import { Flag, Mic, MicOff, SkipForward, Volume2, WifiOff } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { HoldButton, TurnGlyph, Waveform } from '../../components/fx';
import type { MapLine, MapMarker } from '../../components/MapView';
import { MapView } from '../../components/MapView';
import { Avatar, DotMeter, IconButton, fade, spring } from '../../components/ui';
import { CONVOY, RIDE_CODE, ROUTE_CUM, ROUTE_LINE, ROUTE_STEPS, ROUTE_TOTAL } from '../../mock/data';
import { fmtEta, fmtManeuver, fmtRemaining, kmh } from '../../mock/format';
import { haversine, sliceAlong } from '../../mock/geoutil';
import { derive, STALE_AFTER_S, type Derived, type SimFlags } from '../../mock/sim';
import { useApp } from '../../mock/store';
import type { LngLat, RouteStep } from '../../mock/types';
import './motion.css';

const TIME_SCALES = [1, 6, 20];
const ROUTE_END = ROUTE_LINE[ROUTE_LINE.length - 1];
const CONVOY_BY_NAME = [...CONVOY].sort((a, b) => a.name.localeCompare(b.name));
const RIDER_COLOR: Record<string, string> = Object.fromEntries(CONVOY.map((r) => [r.id, r.color]));

export function MotionScreen() {
  const sim = useApp((s) => s.sim);
  const scenario = useApp((s) => s.scenario);
  const voiceGuidance = useApp((s) => s.voiceGuidance);
  const ptt = useApp((s) => s.ptt);
  const setPtt = useApp((s) => s.setPtt);
  const ending = useApp((s) => s.ending);
  const endRide = useApp((s) => s.endRide);
  const startSim = useApp((s) => s.startSim);
  const activeCode = useApp((s) => s.activeCode);
  const setDestinationFromPress = useApp((s) => s.setDestinationFromPress);

  useEffect(() => {
    startSim();
  }, [startSim]);

  // release push-to-talk if the screen goes away mid-press
  useEffect(() => () => setPtt(false), [setPtt]);

  const flags: SimFlags = useMemo(
    () => ({
      offRoute: scenario.offRoute,
      staleRider: scenario.staleRider,
      forceStop: scenario.forceStop,
      voiceEnabled: voiceGuidance,
      coRiderTalking: scenario.coRiderTalking,
      waitingGps: scenario.waitingGps,
    }),
    [scenario, voiceGuidance],
  );
  const d = derive(sim, flags);

  /* ---------- map ---------- */
  const alongQ = Math.round(sim.along / 5) * 5;
  const ridden = useMemo(() => sliceAlong(ROUTE_LINE, ROUTE_CUM, 0, Math.max(alongQ, 1)), [alongQ]);
  const ahead = useMemo(() => sliceAlong(ROUTE_LINE, ROUTE_CUM, alongQ, ROUTE_TOTAL), [alongQ]);
  const rejoinKey = d.rejoin ? d.rejoin.map((p) => p.join(',')).join(';') : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rejoin = useMemo(() => d.rejoin, [rejoinKey]);

  const lines: MapLine[] = useMemo(() => {
    // arrived: the whole ride stays drawn so the map reads as "you came all this way", not empty
    if (d.arrived) return [{ id: 'route-all', coords: ROUTE_LINE, variant: 'dim' }];
    if (d.offRoute && rejoin) {
      return [
        { id: 'route-all', coords: ROUTE_LINE, variant: 'dim' },
        { id: 'rejoin', coords: rejoin, variant: 'dashed' },
      ];
    }
    return [
      { id: 'ridden', coords: ridden, variant: 'dim' },
      { id: 'ahead', coords: ahead, variant: 'glow' },
    ];
  }, [d.arrived, d.offRoute, rejoin, ridden, ahead]);

  const markers: MapMarker[] = [
    { id: 'dest', lngLat: ROUTE_END, kind: 'dest', color: d.arrived ? 'var(--cyan)' : 'var(--cyan-soft)' },
    ...sim.convoy.map((r) => ({
      id: r.id,
      lngLat: r.pos,
      kind: 'rider' as const,
      color: r.color,
      // a name tag right on top of you is noise — drop it when the rider is beside you or the ride is over
      label: d.arrived || haversine(r.pos, d.selfPos) < 40 ? undefined : r.name,
      stale: r.ageSec > STALE_AFTER_S,
    })),
    // heading-up camera: the cone always points up the screen
    { id: 'self', lngLat: d.selfPos, kind: 'self', color: '#22d3ee', heading: 0 },
  ];

  // self sits low in the frame (below the speed numerals); on arrival pull back to show the ride
  const camera = d.arrived
    ? { center: d.selfPos, zoom: 14.2, pitch: 40, bearing: sim.heading, padding: { top: 260, bottom: 120 }, duration: 1200 }
    : { center: d.selfPos, zoom: 15.6, pitch: 55, bearing: sim.heading, padding: { top: 380 }, duration: 300 };

  /* ---------- long-press ripple ---------- */
  const lastDown = useRef({ x: 0, y: 0 });
  const [ripple, setRipple] = useState<{ id: number; x: number; y: number } | null>(null);
  const onLongPress = useCallback(
    (ll: LngLat) => {
      setRipple({ id: Date.now(), ...lastDown.current });
      void setDestinationFromPress(ll);
    },
    [setDestinationFromPress],
  );
  useEffect(() => {
    if (!ripple) return;
    const t = setTimeout(() => setRipple(null), 900);
    return () => clearTimeout(t);
  }, [ripple]);

  /* ---------- "Now" latch ----------
     At demo time-lapse the 30 m imminent window can pass between two 4 Hz ticks; hold the
     "Now" read for a beat so it is actually seen. At 1x it never outlasts the real window. */
  const [latch, setLatch] = useState<{ i: number; at: number } | null>(null);
  useEffect(() => {
    if (d.imminent) setLatch((l) => (l?.i === d.stepIndex ? l : { i: d.stepIndex, at: Date.now() }));
  }, [d.imminent, d.stepIndex]);
  const nowStep =
    latch && !d.offRoute && !d.arrived && (d.imminent || Date.now() - latch.at < 1400)
      ? { step: ROUTE_STEPS[latch.i], index: latch.i }
      : null;

  /* ---------- status ---------- */
  const status =
    scenario.connection === 'lost'
      ? 'Connection lost'
      : scenario.connection === 'reconnecting'
        ? 'Reconnecting…'
        : scenario.waitingGps
          ? 'Waiting for GPS…'
          : null;

  const progress = Math.min(1, sim.along / ROUTE_TOTAL);
  const staleIds = new Set(sim.convoy.filter((r) => r.ageSec > STALE_AFTER_S).map((r) => r.id));
  const talker = CONVOY[0];

  /* ---------- push-to-talk ---------- */
  // the affordance is spelled out once on entry, then the band goes quiet
  const [showHint, setShowHint] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 5000);
    return () => clearTimeout(t);
  }, []);
  const pttDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setPtt(true);
  };
  const pttUp = () => setPtt(false);

  return (
    <div className={`mo-root ${ptt ? 'mo-ptt-on' : ''} ${d.arrived ? 'mo-arrived' : ''}`}>
      <div
        className="mo-map"
        onPointerDownCapture={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          lastDown.current = { x: e.clientX - r.left, y: e.clientY - r.top };
        }}
      >
        <MapView lines={lines} markers={markers} camera={camera} interactive onLongPress={onLongPress} />
      </div>
      <div className="mo-scrim" aria-hidden />

      <AnimatePresence>
        {ripple && (
          <motion.div
            key={ripple.id}
            className="mo-ripple"
            style={{ left: ripple.x, top: ripple.y }}
            initial={{ scale: 0.2, opacity: 0.9 }}
            animate={{ scale: 2.4, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
      </AnimatePresence>

      {/* ---------- push-to-talk surface: the whole lower band ---------- */}
      {!scenario.voiceUnavailable && (
        <div
          className={`mo-ptt ${ptt ? 'on' : ''}`}
          onPointerDown={pttDown}
          onPointerUp={pttUp}
          onPointerCancel={pttUp}
          onLostPointerCapture={pttUp}
          onContextMenu={(e) => e.preventDefault()}
          role="button"
          aria-label="Hold to talk to convoy"
          aria-pressed={ptt}
        >
          <AnimatePresence>
            {showHint && (
              <motion.div className="mo-ptt-hint t-label" exit={{ opacity: 0 }} transition={fade}>
                Hold anywhere here to talk
              </motion.div>
            )}
          </AnimatePresence>
          <motion.div
            className="mo-mic glass glass-map"
            animate={{ scale: ptt ? 1.12 : 1 }}
            transition={spring.snappy}
            aria-hidden
          >
            <span className="mo-mic-ring" />
            <Mic size={28} strokeWidth={2.2} />
          </motion.div>
        </div>
      )}

      <AnimatePresence>
        {ptt && (
          <motion.div
            className="mo-edge"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
            aria-hidden
          >
            <i className="mo-edge-bloom" />
            <i className="mo-edge-line" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- top row ---------- */}
      <div className="mo-top">
        <div className="mo-code glass glass-map">
          <span className={`mo-code-dot ${scenario.connection !== 'ok' ? 'warn' : ''}`} />
          <span className="t-mono">{activeCode ?? RIDE_CODE}</span>
        </div>
        <DemoControls timeScale={sim.timeScale} />
      </div>

      {/* ---------- AHEAD ---------- */}
      <div className="mo-ahead">
        <AnimatePresence initial={false}>
          {status && (
            <motion.div
              key={status}
              className={`mo-status glass glass-map ${scenario.connection === 'lost' ? 'bad' : ''}`}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={fade}
              layout
            >
              {scenario.connection !== 'ok' ? <WifiOff size={12} /> : <span className="mo-status-dot" />}
              <span>{status}</span>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div layout transition={spring.soft}>
          <AheadCue d={d} nowStep={nowStep} progress={progress} offRouteFor={sim.offRouteFor} />
        </motion.div>
      </div>

      {/* ---------- NOW ---------- */}
      <div className="mo-now" aria-live="off">
        <div className="mo-now-glow" aria-hidden />
        <SpeedReadout value={scenario.waitingGps && sim.speed === 0 ? null : kmh(sim.speed)} />
        <div className="mo-unit t-mono">KM/H</div>
      </div>

      {/* ---------- HELD ---------- */}
      <div className="mo-held">
        <AnimatePresence>
          {voiceGuidance && sim.caption && !ptt && !d.offRoute && !d.arrived && (
            <motion.div
              key={sim.caption.id}
              className="mo-caption glass glass-map"
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6 }}
              transition={fade}
            >
              <span className="mo-caption-ico">
                <Volume2 size={15} />
              </span>
              <Waveform active bars={6} height={16} style={{ width: 26 }} colors={['#22d3ee', '#5b8cff', '#22d3ee']} />
              <span className="mo-caption-text">{sim.caption.text}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {ptt && (
            <motion.div
              className="mo-talk"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={fade}
            >
              <div className="mo-talk-pill glass glass-map">
                <Waveform active bars={26} height={34} colors={['#22d3ee', '#5b8cff', '#8beeff']} style={{ width: 180 }} />
              </div>
              <span className="t-label mo-talk-label">Talking to convoy</span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {scenario.coRiderTalking && !ptt && (
            <motion.div
              className="mo-incoming glass glass-map"
              style={{ ['--rc' as string]: talker.color }}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={fade}
            >
              <span className="mo-incoming-dot" />
              <span className="mo-incoming-name">{talker.name}</span>
              <Waveform active bars={9} height={16} colors={[talker.color, talker.color, talker.color]} style={{ width: 40 }} />
            </motion.div>
          )}
        </AnimatePresence>

        {scenario.voiceUnavailable && (
          <div className="mo-novoice glass glass-map">
            <MicOff size={13} />
            <span>Voice unavailable</span>
          </div>
        )}

        <ConvoyStrip staleIds={staleIds} />

        <AnimatePresence>
          {d.endAvailable && (
            <motion.div
              className="mo-end"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={spring.soft}
            >
              <HoldButton label="Hold to end ride" busyLabel="Ending…" busy={ending} ms={800} size={92} onComplete={() => void endRide()} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ================= Ahead cue ================= */
function AheadCue({
  d,
  nowStep,
  progress,
  offRouteFor,
}: {
  d: Derived;
  nowStep: { step: RouteStep; index: number } | null;
  progress: number;
  offRouteFor: number;
}) {
  let state: 'arrived' | 'off' | 'now' | 'next';
  if (d.arrived) state = 'arrived';
  else if (d.offRoute) state = 'off';
  else if (nowStep) state = 'now';
  else state = 'next';

  const step = nowStep?.step ?? d.step;
  const key = state === 'arrived' || state === 'off' ? state : `step-${nowStep?.index ?? d.stepIndex}`;
  const finding = state === 'off' && !d.rejoin;

  return (
    <div className={`mo-cue glass glass-map holo ${state === 'now' ? 'is-now' : ''} ${state === 'off' ? 'is-off' : ''}`}>
      <div className="mo-cue-dots halftone-accent" aria-hidden />
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={key}
          className="mo-cue-body"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -14 }}
          transition={fade}
        >
          {state === 'off' ? (
            <div className="mo-cue-row">
              <div className="mo-cue-glyph off">
                <motion.div
                  className="mo-needle"
                  animate={{ rotate: -90 + Math.sin(offRouteFor * 1.4) * 6 }}
                  transition={{ duration: 0.3, ease: 'linear' }}
                >
                  <i />
                </motion.div>
              </div>
              <div className="mo-cue-text">
                <div className="mo-cue-off">{d.offRouteText}</div>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={finding ? 'finding' : 'rejoin'}
                    className={`mo-cue-sub ${finding ? 'finding' : 'rejoin'}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={fade}
                  >
                    {finding ? 'Finding a way back…' : 'Rejoin route ahead'}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          ) : state === 'arrived' ? (
            <div className="mo-cue-row">
              <div className="mo-cue-glyph">
                <TurnGlyph type={10} size={52} />
              </div>
              <div className="mo-cue-text">
                <div className="mo-cue-dist grad-text-accent">Arrived</div>
                <div className="mo-cue-street t-mono">{d.step.name && d.step.name !== '-' ? d.step.name : 'Destination'}</div>
              </div>
            </div>
          ) : (
            <>
              <div className="mo-cue-row">
                <div className="mo-cue-glyph">
                  <TurnGlyph type={step.type} size={52} />
                </div>
                <div className="mo-cue-text">
                  <div className="mo-cue-dist grad-text-accent">{state === 'now' ? 'Now' : fmtManeuver(d.distToTurn)}</div>
                  <div className="mo-cue-instr">{step.instruction}</div>
                </div>
              </div>
              {step.name && step.name !== '-' && <div className="mo-cue-street t-mono">{step.name}</div>}
            </>
          )}
        </motion.div>
      </AnimatePresence>
      {state !== 'arrived' && state !== 'off' && (
        <div className="mo-cue-foot">
          <span className="t-mono mo-cue-readout">
            {fmtEta(d.etaS)} · {fmtRemaining(d.remaining)}
          </span>
          <DotMeter value={progress} n={18} />
        </div>
      )}
    </div>
  );
}

/* ================= Speed readout ================= */
/** Shown speed changes only when it moves by >=1 km/h, and at most about once a second, so the
 *  digits roll calmly instead of ticking with every 4 Hz sample. */
function useCalmSpeed(value: number | null): number | null {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    if (value == null || shown == null) {
      if (value !== shown) {
        setShown(value);
        last.current = Date.now();
      }
      return;
    }
    if (Math.abs(value - shown) < 1) return;
    const wait = Math.max(0, 1000 - (Date.now() - last.current));
    const t = setTimeout(() => {
      setShown(value);
      last.current = Date.now();
    }, wait);
    return () => clearTimeout(t);
  }, [value, shown]);
  return shown;
}

const SpeedReadout = memo(function SpeedReadout({ value: raw }: { value: number | null }) {
  const value = useCalmSpeed(raw);
  // Two distinct modes — a number, or the "–" placeholder (waiting for GPS only). They crossfade as
  // whole units so a digit can never share the readout with the dash; digits roll only within
  // number mode.
  return (
    <div className="mo-speed t-hero" aria-label={value == null ? 'Speed unknown' : `${value} kilometres per hour`}>
      {/* glow lives on a static sibling, not as a filter on the rolling digits' ancestor, so it can't break their clip */}
      {value != null && (
        <span className="mo-speed-glow" aria-hidden>
          {value}
        </span>
      )}
      <AnimatePresence mode="wait" initial={false}>
        {value == null ? (
          <motion.span
            key="none"
            className="mo-speed-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            –
          </motion.span>
        ) : (
          <motion.span
            key="num"
            className="mo-speed-num"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <Digits value={value} />
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
});

function Digits({ value }: { value: number }) {
  const chars = String(value).split('');
  return (
    <>
      {chars.map((c, i) => (
        // key by place value (from the right) so a 2→3 digit change doesn't re-roll every column
        <span key={chars.length - i} className="mo-digit">
          <span className="mo-digit-ghost" aria-hidden>
            {c}
          </span>
          <AnimatePresence initial={false}>
            <motion.span
              key={c}
              className="mo-digit-in"
              // transform only — an opacity tween runs on the compositor and can desync from the
              // JS-driven y on a busy frame, flashing a half digit; the clip does the hiding instead
              initial={{ y: '-130%' }}
              animate={{ y: '0%' }}
              exit={{ y: '130%' }}
              transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            >
              {c}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </>
  );
}

/* ================= Convoy strip — ordered by name, never a standing ================= */
function ConvoyStrip({ staleIds }: { staleIds: Set<string> }) {
  return (
    <div className="mo-convoy glass glass-map" aria-label="Convoy">
      {CONVOY_BY_NAME.map((r) => {
        const stale = staleIds.has(r.id);
        return (
          <div key={r.id} className={`mo-rider ${stale ? 'stale' : ''}`} title={stale ? `${r.name} — no recent position` : r.name}>
            <Avatar name={r.name} grad={r.grad} size={28} />
            <span className="mo-rider-dot" style={{ ['--rc' as string]: RIDER_COLOR[r.id] }} />
          </div>
        );
      })}
    </div>
  );
}

/* ================= Demo controls (not part of the real app) ================= */
function DemoControls({ timeScale }: { timeScale: number }) {
  const setTimeScale = useApp((s) => s.setTimeScale);
  const jumpToTurn = useApp((s) => s.jumpToTurn);
  const jumpToArrival = useApp((s) => s.jumpToArrival);
  const next = TIME_SCALES[(TIME_SCALES.indexOf(timeScale) + 1) % TIME_SCALES.length] ?? 1;
  return (
    <div className="mo-demo" title="Demo controls — not in the real app">
      <IconButton
        label={`Demo: time-lapse ${timeScale}× (tap for ${next}×)`}
        size={34}
        className="glass-map mo-demo-btn"
        onClick={() => setTimeScale(next)}
      >
        <span className="mo-demo-scale t-mono">{timeScale}×</span>
      </IconButton>
      <IconButton label="Demo: skip to next turn" size={34} className="glass-map mo-demo-btn" onClick={jumpToTurn}>
        <SkipForward />
      </IconButton>
      <IconButton label="Demo: skip to arrival" size={34} className="glass-map mo-demo-btn" onClick={jumpToArrival}>
        <Flag />
      </IconButton>
    </div>
  );
}
