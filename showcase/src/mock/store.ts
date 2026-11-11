// One zustand store for the whole showcase: navigation, scenario flags, every mock flow.
// Screens read state and call actions; nothing here touches the network.
import { create } from 'zustand';
import {
  CONVOY,
  DESTINATION,
  JOINABLE_CODES,
  ME,
  ORIGIN,
  PLACES,
  RIDE_CODE,
  ROUTE_CUM,
  ROUTE_LINE,
  SEED_RIDES,
} from './data';
import { sliceAlong } from './geoutil';
import { initialSim, jumpBeforeNextTurn, jumpToArrival, stepSim, type SimState } from './sim';
import type { LngLat, Place, Ride, Screen, Stop } from './types';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ---------- scenario flags (the Scenario deck toggles these) ---------- */
export interface Scenario {
  sessionError: boolean;
  locationDenied: boolean;
  serverTimeout: boolean;
  searchError: boolean;
  routeUnavailable: boolean;
  originUnavailable: boolean;
  offRoute: boolean;
  connection: 'ok' | 'reconnecting' | 'lost';
  waitingGps: boolean;
  staleRider: boolean;
  voiceUnavailable: boolean;
  coRiderTalking: boolean;
  forceStop: boolean;
  saveFailure: boolean;
  emptyHistory: boolean;
}

const DEFAULT_SCENARIO: Scenario = {
  sessionError: false,
  locationDenied: false,
  serverTimeout: false,
  searchError: false,
  routeUnavailable: false,
  originUnavailable: false,
  offRoute: false,
  connection: 'ok',
  waitingGps: false,
  staleRider: false,
  voiceUnavailable: false,
  coRiderTalking: false,
  forceStop: false,
  saveFailure: false,
  emptyHistory: false,
};

export interface Toast {
  id: number;
  text: string;
  tone: 'violet' | 'cyan' | 'magenta' | 'lime' | 'coral' | 'rose';
}

interface Route {
  screen: Screen;
  params?: { rideId?: string };
}

type StartPhase = 'idle' | 'posting' | 'confirm';
type JoinPhase = 'idle' | 'connecting' | 'connected';
type SearchPhase = 'idle' | 'searching' | 'results' | 'empty' | 'error';
type PreviewPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface AppState {
  /* navigation */
  stack: Route[];
  direction: 1 | -1;
  go: (screen: Screen, params?: Route['params']) => void;
  replace: (screen: Screen, params?: Route['params']) => void;
  back: () => void;
  reset: (screen?: Screen) => void;

  /* scenario */
  scenario: Scenario;
  setScenario: <K extends keyof Scenario>(key: K, value: Scenario[K]) => void;
  resetScenario: () => void;

  /* toasts */
  toasts: Toast[];
  toast: (text: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;

  /* boot / session */
  session: 'pending' | 'ready' | 'error';
  boot: () => Promise<void>;

  /* departure */
  name: string;
  setName: (v: string) => void;
  voiceGuidance: boolean;
  setVoiceGuidance: (v: boolean) => void;
  locationChecking: boolean;
  retryLocation: () => Promise<void>;
  start: { phase: StartPhase; error: string | null; socketOpen: boolean };
  join: { phase: JoinPhase; code: string; error: string | null };
  activeCode: string | null;
  setJoinCode: (v: string) => void;
  startRide: () => Promise<void>;
  joinRide: () => Promise<void>;
  leaveRide: () => void;

  /* planner */
  originState: 'finding' | 'ready' | 'unavailable';
  locateOrigin: () => Promise<void>;
  stops: Stop[];
  search: { query: string; phase: SearchPhase; results: Place[] };
  setQuery: (q: string) => void;
  runSearch: () => Promise<void>;
  addStop: (p: Place) => void;
  addMapPoint: (lngLat: LngLat) => void;
  moveStop: (index: number, dir: -1 | 1) => void;
  removeStop: (index: number) => void;
  selectedAlt: number;
  selectAlt: (i: number) => void;
  preview: PreviewPhase;
  refreshPreview: () => void;
  committing: boolean;
  routeSet: boolean;
  commitRoute: () => Promise<boolean>;

  /* motion */
  sim: SimState;
  ptt: boolean;
  setPtt: (v: boolean) => void;
  startSim: () => void;
  tickSim: (dt: number) => void;
  setTimeScale: (v: number) => void;
  jumpToTurn: () => void;
  jumpToArrival: () => void;
  setDestinationFromPress: (lngLat: LngLat) => Promise<void>;
  ending: boolean;
  endRide: () => Promise<void>;

  /* return */
  rides: Ride[];
  updateNote: (id: string, note: string) => Promise<void>;
  addPhoto: (id: string) => Promise<void>;
  deleteRide: (id: string) => Promise<void>;
  renameRide: (id: string, title: string) => void;
}

let toastId = 0;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let photoSeed = 100;
let stopSeq = 0;

export const useApp = create<AppState>()((set, get) => ({
  /* ---------- navigation ---------- */
  stack: [{ screen: 'boot' }],
  direction: 1,
  go: (screen, params) => set((s) => ({ stack: [...s.stack, { screen, params }], direction: 1 })),
  replace: (screen, params) => set((s) => ({ stack: [...s.stack.slice(0, -1), { screen, params }], direction: 1 })),
  back: () => set((s) => (s.stack.length > 1 ? { stack: s.stack.slice(0, -1), direction: -1 } : s)),
  reset: (screen = 'departure') => set({ stack: [{ screen }], direction: -1 }),

  /* ---------- scenario ---------- */
  scenario: DEFAULT_SCENARIO,
  setScenario: (key, value) => set((s) => ({ scenario: { ...s.scenario, [key]: value } })),
  resetScenario: () => set({ scenario: DEFAULT_SCENARIO }),

  /* ---------- toasts ---------- */
  toasts: [],
  toast: (text, tone = 'violet') => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => get().dismissToast(id), 3200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  /* ---------- boot ---------- */
  session: 'pending',
  boot: async () => {
    set({ session: 'pending' });
    await wait(1700);
    if (get().scenario.sessionError) {
      set({ session: 'error' });
      return;
    }
    set({ session: 'ready' });
  },

  /* ---------- departure ---------- */
  name: ME.name,
  setName: (v) => set({ name: v }),
  voiceGuidance: true,
  setVoiceGuidance: (v) => set({ voiceGuidance: v }),
  locationChecking: false,
  retryLocation: async () => {
    set({ locationChecking: true });
    await wait(900);
    set((s) => ({ locationChecking: false, scenario: { ...s.scenario, locationDenied: false } }));
  },
  start: { phase: 'idle', error: null, socketOpen: false },
  join: { phase: 'idle', code: '', error: null },
  activeCode: null,
  setJoinCode: (v) => set((s) => ({ join: { ...s.join, code: v, error: null } })),
  startRide: async () => {
    set({ start: { phase: 'posting', error: null, socketOpen: false } });
    await wait(1100);
    if (get().scenario.serverTimeout) {
      await wait(1400);
      set({ start: { phase: 'idle', error: 'Couldn’t reach the ride server.', socketOpen: false } });
      return;
    }
    set({ start: { phase: 'confirm', error: null, socketOpen: false }, activeCode: RIDE_CODE });
    await wait(900);
    set((s) => ({ start: { ...s.start, socketOpen: true } }));
  },
  joinRide: async () => {
    const code = get().join.code;
    set((s) => ({ join: { ...s.join, phase: 'connecting', error: null } }));
    await wait(1200);
    if (get().scenario.serverTimeout) {
      await wait(1200);
      set((s) => ({ join: { ...s.join, phase: 'idle', error: 'Couldn’t reach the ride server.' } }));
      return;
    }
    if (!JOINABLE_CODES.includes(code)) {
      set((s) => ({ join: { ...s.join, phase: 'idle', error: 'That code wasn’t found — check it and try again.' } }));
      return;
    }
    set((s) => ({ join: { ...s.join, phase: 'connected' }, activeCode: code }));
  },
  leaveRide: () =>
    set({
      start: { phase: 'idle', error: null, socketOpen: false },
      join: { phase: 'idle', code: '', error: null },
      activeCode: null,
      routeSet: false,
      stops: [],
      selectedAlt: 0,
      preview: 'idle',
      sim: initialSim(),
    }),

  /* ---------- planner ---------- */
  originState: 'finding',
  locateOrigin: async () => {
    set({ originState: 'finding' });
    await wait(1000);
    set({ originState: get().scenario.originUnavailable ? 'unavailable' : 'ready' });
  },
  stops: [],
  search: { query: '', phase: 'idle', results: [] },
  setQuery: (q) => set((s) => ({ search: { ...s.search, query: q, phase: q ? s.search.phase : 'idle' } })),
  runSearch: async () => {
    const q = get().search.query.trim().toLowerCase();
    if (!q) return;
    set((s) => ({ search: { ...s.search, phase: 'searching', results: [] } }));
    await wait(750);
    if (get().scenario.searchError) {
      set((s) => ({ search: { ...s.search, phase: 'error' } }));
      return;
    }
    const results = PLACES.filter((p) => `${p.label} ${p.sub}`.toLowerCase().includes(q)).slice(0, 5);
    set((s) => ({ search: { ...s.search, phase: results.length ? 'results' : 'empty', results } }));
  },
  addStop: (p) => {
    if (get().stops.length >= 9) return;
    set((s) => ({
      stops: [...s.stops, { id: `s${++stopSeq}`, label: p.label, lat: p.lat, lng: p.lng }],
      search: { query: '', phase: 'idle', results: [] },
      selectedAlt: 0,
    }));
    get().refreshPreview();
  },
  addMapPoint: ([lng, lat]) => {
    if (get().stops.length >= 9) return;
    set((s) => ({ stops: [...s.stops, { id: `s${++stopSeq}`, label: 'Point on map', lat, lng }], selectedAlt: 0 }));
    get().refreshPreview();
  },
  moveStop: (i, dir) => {
    const stops = [...get().stops];
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    [stops[i], stops[j]] = [stops[j], stops[i]];
    set({ stops });
    get().refreshPreview();
  },
  removeStop: (i) => {
    set((s) => ({ stops: s.stops.filter((_, k) => k !== i), selectedAlt: 0 }));
    get().refreshPreview();
  },
  selectedAlt: 0,
  selectAlt: (i) => set({ selectedAlt: i }),
  preview: 'idle',
  refreshPreview: () => {
    clearTimeout(previewTimer);
    if (!get().stops.length) {
      set({ preview: 'idle' });
      return;
    }
    set({ preview: 'loading' });
    // the real planner debounces 600 ms after any edit, then asks the route service
    previewTimer = setTimeout(() => {
      set({ preview: get().scenario.routeUnavailable ? 'error' : 'ready' });
    }, 600 + 450);
  },
  committing: false,
  routeSet: false,
  commitRoute: async () => {
    set({ committing: true });
    await wait(1000);
    if (get().scenario.routeUnavailable) {
      set({ committing: false, preview: 'error' });
      return false;
    }
    set({ committing: false, routeSet: true });
    get().toast('Route sent to the convoy', 'cyan');
    return true;
  },

  /* ---------- motion ---------- */
  sim: initialSim(),
  ptt: false,
  setPtt: (v) => set({ ptt: v }),
  startSim: () => set((s) => ({ sim: { ...s.sim, running: true } })),
  tickSim: (dt) => {
    const s = get();
    const sim = stepSim(s.sim, dt, {
      offRoute: s.scenario.offRoute,
      staleRider: s.scenario.staleRider,
      forceStop: s.scenario.forceStop,
      voiceEnabled: s.voiceGuidance,
      coRiderTalking: s.scenario.coRiderTalking,
      waitingGps: s.scenario.waitingGps,
    });
    if (sim !== s.sim) set({ sim });
  },
  setTimeScale: (v) => set((s) => ({ sim: { ...s.sim, timeScale: v } })),
  jumpToTurn: () => set((s) => ({ sim: jumpBeforeNextTurn(s.sim) })),
  jumpToArrival: () => set((s) => ({ sim: jumpToArrival(s.sim) })),
  setDestinationFromPress: async () => {
    await wait(500);
    set({ routeSet: true });
    get().toast('New destination sent to the convoy', 'magenta');
  },
  ending: false,
  endRide: async () => {
    set({ ending: true });
    await wait(900);
    if (get().scenario.saveFailure) {
      set({ ending: false });
      get().toast('Couldn’t save yet — still on this phone.', 'rose');
      return;
    }
    const { sim, rides, activeCode } = get();
    const now = Date.now();
    // jumps and time-lapse skip distance without adding moving time; keep the facts plausible (~50 km/h average)
    const movingS = Math.max(sim.movingS, Math.max(sim.along, 1200) / 13.8, 300);
    const elapsed = movingS * 1.14;
    const track = sim.ridden.length > 2 ? sim.ridden : sliceAlong(ROUTE_LINE, ROUTE_CUM, 0, Math.max(sim.along, 4000));
    const ride: Ride = {
      id: `ride-${now}`,
      title: null,
      startedAt: now - elapsed * 1000,
      endedAt: now,
      distanceM: Math.max(sim.along, 1200),
      movingS,
      maxSpeedMps: Math.max(sim.maxSpeed, 14),
      track,
      companions: CONVOY.map((c) => ({ id: c.id, name: c.name })),
      note: null,
      photos: [],
      joinCode: activeCode ?? RIDE_CODE,
    };
    set({
      rides: [ride, ...rides],
      ending: false,
      sim: initialSim(),
      ptt: false,
      start: { phase: 'idle', error: null, socketOpen: false },
      join: { phase: 'idle', code: '', error: null },
      activeCode: null,
      stack: [{ screen: 'departure' }, { screen: 'detail', params: { rideId: ride.id } }],
      direction: 1,
    });
  },

  /* ---------- return ---------- */
  rides: SEED_RIDES,
  updateNote: async (id, note) => {
    await wait(700);
    set((s) => ({ rides: s.rides.map((r) => (r.id === id ? { ...r, note: note.trim() || null } : r)) }));
  },
  addPhoto: async (id) => {
    await wait(1200);
    const seed = ++photoSeed;
    set((s) => ({ rides: s.rides.map((r) => (r.id === id ? { ...r, photos: [...r.photos, seed] } : r)) }));
  },
  deleteRide: async (id) => {
    await wait(800);
    set((s) => ({ rides: s.rides.filter((r) => r.id !== id) }));
  },
  renameRide: (id, title) =>
    set((s) => ({ rides: s.rides.map((r) => (r.id === id ? { ...r, title: title.trim() || null } : r)) })),
}));

export const currentRoute = (s: AppState) => s.stack[s.stack.length - 1];
export { DESTINATION, ORIGIN };

// exposed so the tour script and screenshot tooling can drive the prototype
declare global {
  interface Window {
    __app: typeof useApp;
  }
}
window.__app = useApp;
