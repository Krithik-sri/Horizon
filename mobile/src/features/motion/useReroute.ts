/**
 * Off-route personal rerouting (ADR-014). Watches `Progress` for a genuine miss —
 * not a bridge-shadow GPS blip — and fires a personal detour request through
 * `useRide.requestRejoin`, which is the only thing that ever touches the network
 * here; everything else is counting.
 *
 * The trigger contract itself (constants + `shouldReroute`) lives in ./reroute —
 * see that file's doc comment for why it isn't inlined here.
 */
import { useEffect, useRef } from 'react';

import type { Progress } from '@/core/routeProgress';
import { useRide } from '@/state/useRide';

import { shouldReroute } from './reroute';

/** Counts consecutive off-route fixes and requests a personal detour when the full
 *  trigger contract passes. No-op while progress is null, on-route, or arrived. */
export function useReroute(progress: Progress | null): void {
  // An internal search hint, not UI state — same treatment ride/[code].tsx gives
  // prevIndexRef, and for the same reason: it must not itself cause a re-render.
  const consecutiveRef = useRef(0);

  useEffect(() => {
    // arrived implies onRoute (routeProgress.ts), so this is really one condition —
    // named twice anyway because "arrived" reads as a distinct reason to stop counting.
    if (!progress || progress.onRoute || progress.arrived) {
      consecutiveRef.current = 0;
      return;
    }
    consecutiveRef.current += 1;

    const { ownFix, rerouteCount, rerouteAt } = useRide.getState();
    if (!ownFix) return; // no fix to reroute from — progress requires one, but guard anyway

    const pass = shouldReroute({
      consecutiveOffRoute: consecutiveRef.current,
      offRouteMeters: progress.offRouteMeters,
      speedMps: ownFix.speed,
      rerouteCount,
      // rerouteAt: 0 means "never attempted" — Date.now() - 0 is a huge number, so
      // this clears the cooldown gate on its own with no explicit case for it.
      msSinceLastAttempt: Date.now() - rerouteAt,
    });

    if (pass) {
      useRide.getState().requestRejoin({ lat: ownFix.lat, lng: ownFix.lng });
    }
  }, [progress]);
}
