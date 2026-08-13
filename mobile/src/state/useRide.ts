import { create } from 'zustand';

import { addFix, emptyTrack, type TrackState } from '@/core/rideTrack';
import { clearPendingRide, saveRide, savePendingRide, type Ride } from '@/core/rides';
import { fetchRoute, type FetchRouteError, type Waypoint } from '@/core/route';
import { clearRideCode, saveRideCode, saveRiderName } from '@/core/riderName';
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
  /** A private detour back to the destination. This device only — never broadcast
   * (ADR-014 §1). Non-null means Motion navigates this instead of `route`. */
  rejoin: RouteData | null;
  /** Reroutes spent against the current shared `route`. Reset by every `route` frame. */
  rerouteCount: number;
  /** Date.now() of the last attempt, success or failure. 0 = never. */
  rerouteAt: number;
  status: ConnStatus;
  /** Last setDestination failure, for the UI to surface; cleared on the next attempt. */
  routeError: FetchRouteError | null;

  join: (code: string, name: string) => Promise<void>;
  leave: () => void;
  applyMessage: (msg: ServerMessage) => void;
  /** `index` selects which of a preview's alternatives to commit — unused (defaults
   * to the only route) for the single-destination callers. */
  setDestination: (waypoints: Waypoint[], index?: number) => Promise<void>;
  /** Fetches a personal detour from `from` to the current shared route's destination
   * (ADR-014 §3), via a `preview: true` request — the mechanism that keeps it off the
   * wire entirely (ADR-014 §2). Called by useReroute.ts once its trigger contract
   * passes; not meant to be called with an arbitrary point. */
  requestRejoin: (from: { lat: number; lng: number }) => Promise<void>;
  sendLoc: (fix: LocFix) => void;
  /** Finalises the ride-in-progress accumulator, writes it via rides.ts's saveRide,
   * then leave()s. Returns the new ride's id, or null if there was nothing to save
   * (never joined) or the save failed — the pending-row guard (rides.ts) still has a
   * copy either way, so a failure here isn't data loss, just a delayed save. */
  endRide: () => Promise<string | null>;
};

// The live ws handle is imperative plumbing, not UI state — kept out of the store
// itself so opening/closing a socket doesn't itself trigger a re-render. trackState
// (ADR-018's distance/movingS/track accumulator) lives alongside it for the same
// reason: it changes on every ~1Hz GPS fix, and putting it in the store would mean a
// re-render per fix for state nothing renders directly from — only endRide() and the
// pending-row guard ever read it.
let handle: WsHandle | null = null;
let trackState: TrackState | null = null;
// The in-flight promise of leave()'s persisted-ride-code clear, so join() (which
// always calls leave() first, below) can wait for it before writing the new code.
// leave() can't be made async itself — several callers (index.tsx's flow guards,
// ride/[code].tsx's rejection handler) call it synchronously and never await it — so
// it fires clearRideCode() and stashes the promise here instead. Without this, the
// clear and the following save race on the same AsyncStorage key with no ordering
// guarantee, and a slow clear landing after a fast save silently wipes the code
// join() just persisted (ADR-021 §6; riderName.ts's saveRiderName doc comment
// documents this same trap for the rider name, pre-ADR-016).
let pendingCodeClear: Promise<void> | null = null;

// Builds the ride shape rides.ts saves — shared by the pending-row guard's periodic
// updates (ADR-018 §3) and endRide()'s real save, so "what a ride looks like right
// now, if it ended this instant" is defined in exactly one place. `endedAt` is always
// "now": for the pending guard that's the best available guess if the app never gets
// to call endRide() at all; for the real save the caller calls this right before
// saveRide(), so "now" is accurate there too.
function pendingSnapshot(
  route: RouteData | null,
  riders: Rider[],
  code: string | null,
  ts: TrackState,
): Omit<Ride, 'id'> {
  return {
    startedAt: ts.startedAt,
    endedAt: new Date().toISOString(),
    distanceM: ts.distanceM,
    movingS: ts.movingS,
    maxSpeedMps: ts.maxSpeedMps,
    track: ts.track.length > 0 ? ts.track : null,
    route,
    companions: riders.map((r) => ({ id: r.id, name: r.name })),
    title: null,
    note: null,
    joinCode: code,
  };
}

export const useRide = create<RideState>()((set, get) => ({
  code: null,
  ownId: null,
  ownFix: null,
  riders: [],
  route: null,
  rejoin: null,
  rerouteCount: 0,
  rerouteAt: 0,
  status: 'closed',
  routeError: null,

  async join(code, name) {
    get().leave(); // drop any existing connection first
    // leave() just fired a fire-and-forget clear of the persisted ride code — wait
    // for it before saving the new one below, or it can land after and wipe it
    // (see pendingCodeClear's comment above).
    await pendingCodeClear;

    // Saved so ride/[code].tsx can rejoin on its own — a deep link, Fast Refresh
    // remount, or Android killing the backgrounded app all skip this join() call.
    // The code comes from the route param there; only the name needs remembering.
    await saveRiderName(name);
    // Saved so the background location task can rejoin headlessly, with no route
    // param and no React tree to read it from (ADR-021 §4) — see riderName.ts's
    // saveRideCode doc comment.
    await saveRideCode(code);
    // ownId is no longer set here — there's no client-chosen rider id to set it to
    // (ADR-016 §3). It stays null until the server's `welcome` message confirms the
    // JWT `sub` it derived (ADR-017 §6), same as any other rider's id.
    set({ code, ownId: null, ownFix: null, riders: [], route: null, routeError: null });

    // Starts the ADR-018 distance/movingS/track accumulator, and writes the first
    // pending-row snapshot immediately — before a single GPS fix has arrived — so the
    // guard covers the app dying in the first seconds of a ride, not just later on.
    trackState = emptyTrack(new Date().toISOString());
    await savePendingRide(pendingSnapshot(null, [], code, trackState));

    handle = connect({
      code,
      name,
      onMessage: (msg) => get().applyMessage(msg),
      onStatus: (status) => set({ status }),
    });
  },

  leave() {
    handle?.close();
    handle = null;
    trackState = null;
    // Clears the persisted ride code (ADR-021 §6) so a headless restart days later
    // doesn't rejoin a long-GC'd room and burn battery on `rejected` retries. Caught
    // rather than left to reject unobserved — nothing awaits this promise except an
    // immediately-following join() (via pendingCodeClear above), and most callers of
    // leave() never join() again at all.
    pendingCodeClear = clearRideCode().catch(() => {});
    set({
      code: null,
      ownId: null,
      ownFix: null,
      riders: [],
      route: null,
      rejoin: null,
      rerouteCount: 0,
      rerouteAt: 0,
      status: 'closed',
    });
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
        // A new shared route supersedes any personal detour for free (ADR-014 §1):
        // the rejoin was a detour back toward the *old* route's destination, and the
        // quota it was spending belonged to that route, not this one.
        set({
          route: { polyline: msg.polyline, steps: msg.steps, summary: msg.summary },
          rejoin: null,
          rerouteCount: 0,
          rerouteAt: 0,
        });
        break;
    }
  },

  async setDestination(waypoints, index) {
    const { code } = get();
    if (!code) return;
    const result = await fetchRoute(code, waypoints, { index });
    // Success sets only routeError (to null) here — `route` itself is set from the WS
    // `route` message in applyMessage, which is what every rider converges on.
    set({ routeError: result.ok ? null : result.error });
  },

  async requestRejoin(from) {
    const { code, route } = get();
    if (!code || !route || route.polyline.length === 0) return;

    // route.polyline is [lng, lat] (MapLibre/GeoJSON order); Waypoint is [lat, lng]
    // (CLAUDE.md's known trap) — swap here, the one boundary this function crosses.
    const [destLng, destLat] = route.polyline[route.polyline.length - 1];
    const result = await fetchRoute(
      code,
      [
        [from.lat, from.lng],
        [destLat, destLng],
      ],
      { preview: true }, // the whole mechanism (ADR-014 §2): fetched, returned, never stored or broadcast
    );

    // rerouteCount/rerouteAt advance on EVERY attempt, success or failure — a
    // failing ORS call must not be retryable in a tight loop (ADR-014 §4's cooldown).
    set((state) => ({
      rejoin: result.ok ? result.routes[0] : state.rejoin,
      rerouteCount: state.rerouteCount + 1,
      rerouteAt: Date.now(),
    }));
  },

  sendLoc(fix) {
    // Retained before forwarding, and unconditionally: handle?.sendLoc throttles to ~1 Hz
    // and no-ops entirely while the socket is down, but our own position is still valid
    // and still worth drawing. This is why the speedometer keeps working in a tunnel.
    set({ ownFix: fix });
    handle?.sendLoc(fix);

    if (trackState) {
      const priorPoints = trackState.track.length;
      const ts = fix.ts ?? Math.floor(Date.now() / 1000);
      trackState = addFix(trackState, { lat: fix.lat, lng: fix.lng, speed: fix.speed, ts });
      // Persisted only when addFix actually stored a new track point — i.e. on the
      // same ~50m cadence rideTrack.ts's own decimation uses, not on every ~1Hz fix.
      // That keeps the pending-row guard from re-serializing a multi-thousand-point
      // track array once a second for the length of a ride, while still updating
      // often enough that a crash loses at most ~50m of progress.
      if (trackState.track.length !== priorPoints) {
        const { route, riders, code } = get();
        savePendingRide(pendingSnapshot(route, riders, code, trackState)).catch(() => {});
      }
    }
  },

  async endRide() {
    if (!trackState) return null;
    const { route, riders, code } = get();
    const ride = pendingSnapshot(route, riders, code, trackState);

    // Written to the pending row one last time, with the real endedAt/companions/
    // route, before attempting the Supabase insert — so even a crash mid-request
    // leaves the accurate final snapshot behind for flushPendingRide to promote.
    await savePendingRide(ride);
    const saved = await saveRide(ride);
    if (saved) await clearPendingRide();

    get().leave();
    return saved?.id ?? null;
  },
}));

/** A rider whose last fix is older than 10s (CLAUDE.md protocol) — derived, not
 * stored, so the store never deletes a stale rider from the list. */
export function isStale(rider: Rider): boolean {
  return rider.ageSec > 10;
}
