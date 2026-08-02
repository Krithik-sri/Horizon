import { create } from 'zustand';

import { getRiderId } from '@/core/riderId';
import { fetchRoute, type FetchRouteError, type Waypoint } from '@/core/route';
import { connect, type ConnStatus, type LocFix, type WsHandle } from '@/core/wsClient';
import type { Rider, RouteData, ServerMessage } from '@/core/models';

type RideState = {
  code: string | null;
  /** This device's rider id, confirmed by the server's `welcome` message. Use this to
   * pick this device's own dot out of `riders`. */
  ownId: string | null;
  /**
   * This device's own latest GPS fix, straight off expo-location.
   *
   * Own position and speed are read from here, NOT from this device's entry in `riders`.
   * That entry is the server echoing our own fix back a round trip later, so relying on it
   * would freeze this rider's own speedometer and dot the moment the network drops — for
   * the one rider whose data needs no network at all. Local GPS is both the lowest-latency
   * and the most trustworthy source we have for ourselves (PRODUCT.md, Confidence).
   *
   * `riders` remains the source of truth for everyone else.
   */
  ownFix: LocFix | null;
  /** Latest `state` frame. Pre-sorted by id for frame stability only — never re-sort,
   * rank, or derive a position/distance-along-route from this list (ADR-009). */
  riders: Rider[];
  /** Latest `route` frame (WS is the source of truth — see setDestination). */
  route: RouteData | null;
  status: ConnStatus;
  /** Last setDestination failure, for the UI to surface; cleared on the next attempt. */
  routeError: FetchRouteError | null;

  join: (code: string, name: string) => Promise<void>;
  leave: () => void;
  applyMessage: (msg: ServerMessage) => void;
  setDestination: (waypoints: Waypoint[]) => Promise<void>;
  sendLoc: (fix: LocFix) => void;
};

// The live ws handle is imperative plumbing, not UI state — kept out of the store
// itself so opening/closing a socket doesn't itself trigger a re-render.
let handle: WsHandle | null = null;

export const useRide = create<RideState>()((set, get) => ({
  code: null,
  ownId: null,
  ownFix: null,
  riders: [],
  route: null,
  status: 'closed',
  routeError: null,

  async join(code, name) {
    get().leave(); // drop any existing connection first

    const riderId = await getRiderId();
    set({ code, ownId: riderId, ownFix: null, riders: [], route: null, routeError: null });

    handle = connect({
      code,
      name,
      riderId,
      onMessage: (msg) => get().applyMessage(msg),
      onStatus: (status) => set({ status }),
    });
  },

  leave() {
    handle?.close();
    handle = null;
    set({ code: null, ownId: null, ownFix: null, riders: [], route: null, status: 'closed' });
  },

  applyMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        set({ ownId: msg.id });
        break;
      case 'state':
        set({ riders: msg.riders });
        break;
      case 'route':
        set({ route: { polyline: msg.polyline, steps: msg.steps, summary: msg.summary } });
        break;
    }
  },

  async setDestination(waypoints) {
    const { code } = get();
    if (!code) return;
    const result = await fetchRoute(code, waypoints);
    // Success sets only routeError (to null) here — `route` itself is set from the WS
    // `route` message in applyMessage, which is what every rider converges on.
    set({ routeError: result.ok ? null : result.error });
  },

  sendLoc(fix) {
    // Retained before forwarding, and unconditionally: handle?.sendLoc throttles to ~1 Hz
    // and no-ops entirely while the socket is down, but our own position is still valid
    // and still worth drawing. This is why the speedometer keeps working in a tunnel.
    set({ ownFix: fix });
    handle?.sendLoc(fix);
  },
}));

/** A rider whose last fix is older than 10s (CLAUDE.md protocol) — derived, not
 * stored, so the store never deletes a stale rider from the list. */
export function isStale(rider: Rider): boolean {
  return rider.ageSec > 10;
}
