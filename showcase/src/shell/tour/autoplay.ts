// "Play the full journey": a scripted, cancellable end-to-end walk through every register.
// It only calls store actions — exactly what a rider's taps would do — and waits on real state.
import { create } from 'zustand';
import { currentRoute, useApp } from '../../mock/store';
import { derive } from '../../mock/sim';
import { jumpTo, simFlags, type Chapter } from './nav';

export interface JourneyStep {
  chapter: Chapter;
  caption: string;
  run: (ctx: Ctx) => Promise<void>;
}

interface Ctx {
  signal: AbortSignal;
  sleep: (ms: number) => Promise<void>;
  until: (pred: () => boolean, timeoutMs: number) => Promise<boolean>;
  type: (text: string, set: (v: string) => void, perCharMs?: number) => Promise<void>;
}

/* ---------- status store the rail renders ---------- */
interface AutoplayState {
  running: boolean;
  index: number;
  caption: string;
  error: string | null;
  play: () => void;
  stop: () => void;
}

class Aborted extends Error {}

let controller: AbortController | null = null;
let savedRideId: string | null = null;

const app = () => useApp.getState();
const screen = () => currentRoute(useApp.getState()).screen;

export const STEPS: JourneyStep[] = [
  {
    chapter: 'boot',
    caption: 'Opening Horizon — signing in anonymously, no account needed',
    run: async ({ sleep }) => {
      app().leaveRide();
      app().resetScenario();
      useApp.setState({ session: 'pending', stack: [{ screen: 'boot' }], direction: 1, ptt: false });
      await app().boot();
      await sleep(700);
      if (screen() === 'boot') useApp.setState({ stack: [{ screen: 'departure' }], direction: 1 });
    },
  },
  {
    chapter: 'departure',
    caption: 'Departure asks one question: am I ready to ride?',
    run: async ({ sleep }) => {
      if (screen() !== 'departure') jumpTo('departure');
      await sleep(2200);
    },
  },
  {
    chapter: 'departure',
    caption: 'The rider sets the name the convoy will see',
    run: async ({ sleep, type }) => {
      await type('Alex', app().setName, 140);
      await sleep(800);
    },
  },
  {
    chapter: 'departure',
    caption: 'Start ride — the server mints a six-letter code for the convoy',
    run: async ({ sleep, until }) => {
      void app().startRide();
      await until(() => app().start.socketOpen || !!app().start.error, 7000);
      await sleep(2200);
    },
  },
  {
    chapter: 'planner',
    caption: 'Planner — searching for a destination',
    run: async ({ sleep, until, type }) => {
      useApp.setState((s) => ({ activeCode: s.activeCode ?? 'H3K7M2' }));
      app().go('planner');
      if (app().originState !== 'ready') void app().locateOrigin();
      await sleep(1400);
      await type('Nandi', app().setQuery, 160);
      void app().runSearch();
      await until(() => app().search.phase !== 'searching' && app().search.phase !== 'idle', 4000);
      await sleep(1300);
    },
  },
  {
    chapter: 'planner',
    caption: 'Adding Nandi Hills as a stop — the route preview draws itself',
    run: async ({ sleep, until }) => {
      const first = app().search.results[0];
      if (first) app().addStop(first);
      await until(() => app().preview === 'ready' || app().preview === 'error', 4000);
      await sleep(1600);
    },
  },
  {
    chapter: 'planner',
    caption: 'Comparing alternatives before committing to one',
    run: async ({ sleep }) => {
      app().selectAlt(1);
      await sleep(1800);
      app().selectAlt(0);
      await sleep(1400);
    },
  },
  {
    chapter: 'planner',
    caption: 'Send to convoy — every rider now shares one route',
    run: async ({ sleep }) => {
      await app().commitRoute();
      await sleep(1500);
      app().back();
      await sleep(1200);
    },
  },
  {
    chapter: 'motion',
    caption: 'Motion — heading-up map, convoy dots, almost nothing else',
    run: async ({ sleep }) => {
      app().go('motion');
      app().startSim();
      await sleep(6000);
    },
  },
  {
    chapter: 'motion',
    caption: 'Time-lapse to the next turn — the cue and spoken guidance arrive',
    run: async ({ sleep }) => {
      app().setTimeScale(20);
      await sleep(1500);
      app().jumpToTurn();
      await sleep(5000);
    },
  },
  {
    chapter: 'motion',
    caption: 'Push-to-talk — holding to speak to the convoy',
    run: async ({ sleep }) => {
      app().setPtt(true);
      await sleep(2500);
      app().setPtt(false);
      await sleep(900);
    },
  },
  {
    chapter: 'motion',
    caption: 'A rider’s signal goes stale — their dot quietly greys out',
    run: async ({ sleep }) => {
      app().setScenario('staleRider', true);
      await sleep(4500);
      app().setScenario('staleRider', false);
      await sleep(800);
    },
  },
  {
    chapter: 'motion',
    caption: 'Arriving — stop the bike and End ride becomes available',
    run: async ({ sleep, until }) => {
      app().jumpToArrival();
      // the sim marks End ride available the moment we arrive — hold just long enough to see the button
      await until(() => derive(app().sim, simFlags(app())).endAvailable, 9000);
      await sleep(1600);
    },
  },
  {
    chapter: 'detail',
    caption: 'End ride — the ride is saved and Return opens on it',
    run: async ({ sleep, until }) => {
      const before = new Set(app().rides.map((r) => r.id));
      await app().endRide();
      await until(() => screen() === 'detail', 3000);
      savedRideId = app().rides.find((r) => !before.has(r.id))?.id ?? null;
      await sleep(2600);
    },
  },
  {
    chapter: 'detail',
    caption: 'Adding a photo from the ride',
    run: async ({ sleep }) => {
      if (savedRideId) await app().addPhoto(savedRideId);
      await sleep(1600);
    },
  },
  {
    chapter: 'detail',
    caption: 'Naming the ride and writing the journal line while it’s still fresh',
    run: async ({ sleep }) => {
      if (savedRideId) {
        app().renameRide(savedRideId, 'Nandi Hills at first light');
        await sleep(900);
        await app().updateNote(
          savedRideId,
          'Left in the dark, chased the fog up the hairpins. Sam waited at every turn. Sunrise from the top was worth every cold minute.',
        );
      }
      await sleep(2400);
    },
  },
  {
    chapter: 'archive',
    caption: 'The archive keeps every ride — one at a time, never ranked',
    run: async ({ sleep }) => {
      // a clean stack, so Back from the archive returns to Departure rather than the detail
      useApp.setState({ stack: [{ screen: 'departure' }, { screen: 'archive' }], direction: 1 });
      await sleep(2500);
    },
  },
];

function makeCtx(signal: AbortSignal): Ctx {
  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Aborted());
      const id = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(id);
        reject(new Aborted());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  const until = async (pred: () => boolean, timeoutMs: number) => {
    const end = performance.now() + timeoutMs;
    while (performance.now() < end) {
      if (pred()) return true;
      await sleep(120);
    }
    return pred();
  };
  const type = async (text: string, set: (v: string) => void, perCharMs = 120) => {
    set('');
    for (let i = 1; i <= text.length; i++) {
      await sleep(perCharMs);
      set(text.slice(0, i));
    }
  };
  return { signal, sleep, until, type };
}

function cleanUp() {
  const s = app();
  s.resetScenario();
  s.setPtt(false);
}

export const useAutoplay = create<AutoplayState>()((set) => ({
  running: false,
  index: -1,
  caption: '',
  error: null,
  play: () => {
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    savedRideId = null;
    set({ running: true, index: 0, caption: STEPS[0].caption, error: null });
    void (async () => {
      const ctx = makeCtx(ctl.signal);
      try {
        for (let i = 0; i < STEPS.length; i++) {
          if (ctl.signal.aborted) throw new Aborted();
          set({ index: i, caption: STEPS[i].caption });
          await STEPS[i].run(ctx);
        }
        if (controller === ctl) set({ running: false, index: STEPS.length, caption: 'Journey complete — from first launch to a saved memory.' });
      } catch (e) {
        if (controller !== ctl) return;
        if (e instanceof Aborted) set({ running: false, index: -1, caption: '' });
        else set({ running: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        if (controller === ctl) {
          controller = null;
          cleanUp();
        }
      }
    })();
  },
  stop: () => {
    controller?.abort();
  },
}));
