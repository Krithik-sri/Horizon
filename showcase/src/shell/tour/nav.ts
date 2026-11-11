// Jump the phone to any chapter with a believable state behind it. Shared by the Tour rail,
// the auto-play script and the Scenario deck's "Go" links.
import { RIDE_CODE } from '../../mock/data';
import { currentRoute, useApp } from '../../mock/store';
import type { Screen } from '../../mock/types';

export type Chapter = 'boot' | 'departure' | 'planner' | 'motion' | 'archive' | 'detail';

/** The chapter a screen belongs to (1:1 today, but keeps the rail decoupled from routing). */
export const chapterOf = (screen: Screen): Chapter => screen as Chapter;

export const currentScreen = (): Screen => currentRoute(useApp.getState()).screen;

const confirmedStart = { phase: 'confirm' as const, error: null, socketOpen: true };

export function jumpTo(chapter: Chapter) {
  const st = useApp.getState();
  switch (chapter) {
    case 'boot':
      if (currentScreen() === 'boot') {
        void st.boot();
        return;
      }
      useApp.setState({ session: 'pending', stack: [{ screen: 'boot' }], direction: -1 });
      return;
    case 'departure':
      useApp.setState({ session: 'ready', stack: [{ screen: 'departure' }], direction: -1 });
      return;
    case 'planner':
      useApp.setState({
        session: 'ready',
        activeCode: st.activeCode ?? RIDE_CODE,
        start: st.activeCode ? st.start : confirmedStart,
        stack: [{ screen: 'departure' }, { screen: 'planner' }],
        direction: 1,
      });
      return;
    case 'motion':
      // fresh ride every time: leaveRide resets the simulator, then rejoin the seeded room
      st.leaveRide();
      useApp.setState({
        session: 'ready',
        activeCode: RIDE_CODE,
        start: confirmedStart,
        routeSet: true,
        ptt: false,
        stack: [{ screen: 'departure' }, { screen: 'motion' }],
        direction: 1,
      });
      useApp.getState().startSim();
      return;
    case 'archive':
      useApp.setState({ session: 'ready', stack: [{ screen: 'departure' }, { screen: 'archive' }], direction: 1 });
      return;
    case 'detail': {
      const rides = useApp.getState().rides;
      const rideId = rides.find((r) => r.id === 'ride-1')?.id ?? rides[0]?.id ?? 'ride-1';
      useApp.setState({
        session: 'ready',
        stack: [{ screen: 'departure' }, { screen: 'archive' }, { screen: 'detail', params: { rideId } }],
        direction: 1,
      });
      return;
    }
  }
}

/** The simulator flags derived from store state (mirrors the store's tickSim). */
export function simFlags(s: ReturnType<typeof useApp.getState>) {
  return {
    offRoute: s.scenario.offRoute,
    staleRider: s.scenario.staleRider,
    forceStop: s.scenario.forceStop,
    voiceEnabled: s.voiceGuidance,
    coRiderTalking: s.scenario.coRiderTalking,
    waitingGps: s.scenario.waitingGps,
  };
}
