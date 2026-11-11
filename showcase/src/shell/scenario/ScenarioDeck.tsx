// Right rail: force any state the real app can be in, drive the ride simulator, reset the demo.
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, Flag, RotateCcw, SkipForward } from 'lucide-react';
import { useMemo } from 'react';
import { Toggle } from '../../components/ui';
import { JOINABLE_CODES, ME, SEED_RIDES } from '../../mock/data';
import { fmtEta, fmtManeuver, kmh } from '../../mock/format';
import { derive } from '../../mock/sim';
import { currentRoute, useApp, type Scenario } from '../../mock/store';
import { useAutoplay } from '../tour/autoplay';
import { chapterOf, jumpTo, simFlags, type Chapter } from '../tour/nav';
import './scenario.css';

type BoolKey = { [K in keyof Scenario]: Scenario[K] extends boolean ? K : never }[keyof Scenario];

interface Item {
  key: BoolKey;
  label: string;
  hint: string;
  go: Chapter;
  /** extra kick after navigating, so the flag is visible straight away */
  after?: () => void;
}

const GROUPS: { title: string; items: (Item | 'connection')[] }[] = [
  {
    title: 'Session & device',
    items: [
      { key: 'sessionError', label: 'Sign-in fails', hint: 'Boot shows a calm retry', go: 'boot' },
      { key: 'locationDenied', label: 'Location denied', hint: 'Departure readiness check', go: 'departure' },
      { key: 'serverTimeout', label: 'Ride server unreachable', hint: 'Start ride or join with a code', go: 'departure' },
    ],
  },
  {
    title: 'Planning',
    items: [
      { key: 'searchError', label: 'Search unavailable', hint: 'Planner place search', go: 'planner' },
      { key: 'routeUnavailable', label: 'Route unavailable', hint: 'Planner preview & send to convoy', go: 'planner' },
      {
        key: 'originUnavailable',
        label: 'No GPS fix in planner',
        hint: 'Planner origin row',
        go: 'planner',
        after: () => void useApp.getState().locateOrigin(),
      },
    ],
  },
  {
    title: 'Riding',
    items: [
      { key: 'offRoute', label: 'Off route + reroute', hint: 'Motion: detour line, then rejoin', go: 'motion' },
      'connection',
      { key: 'waitingGps', label: 'Waiting for GPS', hint: 'Motion before the first fix', go: 'motion' },
      { key: 'staleRider', label: 'Rider signal stale', hint: 'A convoy dot greys out', go: 'motion' },
      { key: 'coRiderTalking', label: 'Co-rider talking', hint: 'Motion voice indicator', go: 'motion' },
      { key: 'voiceUnavailable', label: 'Voice unavailable', hint: 'Push-to-talk disabled', go: 'motion' },
      { key: 'forceStop', label: 'Stop the bike', hint: 'Motion offers End ride', go: 'motion' },
    ],
  },
  {
    title: 'Return',
    items: [
      { key: 'saveFailure', label: 'Ride save fails', hint: 'End ride keeps it on the phone', go: 'motion' },
      { key: 'emptyHistory', label: 'Empty history', hint: 'Archive first-ride state', go: 'archive' },
    ],
  },
];

const CONNECTION: { v: Scenario['connection']; label: string }[] = [
  { v: 'ok', label: 'OK' },
  { v: 'reconnecting', label: 'Reconnecting' },
  { v: 'lost', label: 'Lost' },
];

const SCALES = [1, 6, 20];

function stopAutoplay() {
  if (useAutoplay.getState().running) useAutoplay.getState().stop();
}

function GoLink({ to, here, after }: { to: Chapter; here: boolean; after?: () => void }) {
  if (here) return <span className="sc-here">here</span>;
  return (
    <button
      className="sc-go"
      onClick={() => {
        stopAutoplay();
        jumpTo(to);
        after?.();
      }}
    >
      Go <ArrowUpRight size={11} />
    </button>
  );
}

function Seg<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="sc-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button key={String(o.v)} role="radio" aria-checked={on} className={`sc-seg-btn ${on ? 'on' : ''}`} onClick={() => onChange(o.v)}>
            {on && <motion.span layoutId={`sc-seg-${label}`} className="sc-seg-pill" transition={{ type: 'spring', stiffness: 520, damping: 34 }} />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SimPanel() {
  const sim = useApp((s) => s.sim);
  const scenario = useApp((s) => s.scenario);
  const voice = useApp((s) => s.voiceGuidance);
  const setTimeScale = useApp((s) => s.setTimeScale);
  const jumpToTurn = useApp((s) => s.jumpToTurn);
  const jumpToArrival = useApp((s) => s.jumpToArrival);
  const d = useMemo(() => derive(sim, simFlags({ ...useApp.getState(), scenario, voiceGuidance: voice })), [sim, scenario, voice]);

  return (
    <motion.section
      className="sc-sim"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="sc-sim-head">
        <span className="sc-group-title">Ride sim</span>
        <span className={`sc-sim-state ${sim.running ? 'on' : ''}`}>{sim.running ? 'live' : 'idle'}</span>
      </div>
      <div className="sc-readout">
        <div>
          <span className="sc-num">{kmh(sim.speed)}</span>
          <span className="sc-unit">km/h</span>
        </div>
        <div>
          <span className="sc-num">{d.arrived ? '—' : fmtManeuver(d.distToTurn)}</span>
          <span className="sc-unit">to turn</span>
        </div>
        <div>
          <span className="sc-num">{fmtEta(d.etaS)}</span>
          <span className="sc-unit">eta</span>
        </div>
      </div>
      <div className="sc-sim-row">
        <span className="sc-mini-label">Time-lapse</span>
        <Seg label="timelapse" value={sim.timeScale} options={SCALES.map((v) => ({ v, label: `${v}×` }))} onChange={setTimeScale} />
      </div>
      <div className="sc-sim-actions">
        <button className="sc-btn" onClick={jumpToTurn} disabled={d.arrived}>
          <SkipForward size={14} /> Next turn
        </button>
        <button className="sc-btn" onClick={jumpToArrival} disabled={d.arrived}>
          <Flag size={14} /> Arrive
        </button>
      </div>
    </motion.section>
  );
}

export function ScenarioDeck() {
  const scenario = useApp((s) => s.scenario);
  const setScenario = useApp((s) => s.setScenario);
  const here = useApp((s) => chapterOf(currentRoute(s).screen));

  const resetAll = () => {
    stopAutoplay();
    const s = useApp.getState();
    s.resetScenario();
    s.leaveRide();
    useApp.setState({
      rides: SEED_RIDES,
      name: ME.name,
      ptt: false,
      search: { query: '', phase: 'idle', results: [] },
      session: 'pending',
      stack: [{ screen: 'boot' }],
      direction: -1,
    });
  };

  return (
    <div className="sc glass">
      <header className="sc-head">
        <h2 className="sc-title">Scenarios</h2>
        <p className="sc-sub">Force any state the real app can be in.</p>
      </header>

      <div className="sc-body scroll">
        <AnimatePresence initial={false}>{here === 'motion' && <SimPanel key="sim" />}</AnimatePresence>

        {GROUPS.map((g) => (
          <section key={g.title} className="sc-group">
            <div className="sc-group-title">{g.title}</div>
            {g.items.map((it) => {
              if (it === 'connection') {
                const on = scenario.connection !== 'ok';
                return (
                  <div key="connection" className={`sc-row sc-row-stack ${on ? 'is-on' : ''}`}>
                    <div className="sc-row-top">
                      <div className="sc-row-text">
                        <span className="sc-row-label">Convoy connection</span>
                        <span className="sc-row-hint">Motion connection line</span>
                      </div>
                      <GoLink to="motion" here={here === 'motion'} />
                    </div>
                    <Seg label="connection" value={scenario.connection} options={CONNECTION.map((c) => ({ v: c.v, label: c.label }))} onChange={(v) => setScenario('connection', v)} />
                  </div>
                );
              }
              const on = scenario[it.key];
              return (
                <div key={it.key} className={`sc-row ${on ? 'is-on' : ''}`}>
                  <div className="sc-row-text">
                    <span className="sc-row-label">{it.label}</span>
                    <span className="sc-row-hint">{it.hint}</span>
                  </div>
                  <GoLink to={it.go} here={here === it.go} after={it.after} />
                  <Toggle on={on} label={it.label} onChange={(v) => setScenario(it.key, v)} />
                </div>
              );
            })}
          </section>
        ))}

        <section className="sc-group">
          <div className="sc-group-title">Quick actions</div>
          <button className="sc-btn sc-btn-wide" onClick={resetAll}>
            <RotateCcw size={14} /> Reset everything
          </button>
          <div className="sc-codes">
            <span className="sc-mini-label">Join codes that work</span>
            <div className="sc-code-list">
              {JOINABLE_CODES.slice(0, 2).map((c) => (
                <span key={c} className="sc-code">
                  {c}
                </span>
              ))}
            </div>
            <span className="sc-row-hint">Type one into “Join with code” on Departure. Anything else isn’t found.</span>
          </div>
        </section>
      </div>
    </div>
  );
}
