import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { color, type } from '@/design/tokens';
import { startBackgroundLocation, stopBackgroundLocation } from '@/core/backgroundLocation';
import { loadVoiceEnabled } from '@/core/prefs';
import { loadRiderName } from '@/core/riderName';
import type { RouteData } from '@/core/models';
import { routeErrorText } from '@/core/route.pure';
import { computeProgress, type Progress } from '@/core/routeProgress';
import { useRide } from '@/state/useRide';
import AheadCue from '@/features/motion/AheadCue';
import EndRide from '@/features/motion/EndRide';
import HorizonLine from '@/features/motion/HorizonLine';
import PushToTalk from '@/features/motion/PushToTalk';
import SpeedReadout from '@/features/motion/SpeedReadout';
import { useReroute } from '@/features/motion/useReroute';
import { useVoiceGuidance } from '@/features/motion/useVoiceGuidance';
import DestinationMarker from '@/features/convoy/DestinationMarker';
import MapCanvas from '@/features/convoy/MapCanvas';
import RejoinLine from '@/features/convoy/RejoinLine';
import RiderMarkers from '@/features/convoy/RiderMarkers';
import RouteLine from '@/features/convoy/RouteLine';
import { useVoice } from '@/features/convoy/useVoice';

// Stable tag for this screen's keep-awake lock, paired with the manual
// activate/deactivate below (see the effect in RideScreen for why not useKeepAwake).
const KEEP_AWAKE_TAG = 'horizon-ride';

/** "Reconnecting…" / "Connection lost" — ambient, absent entirely when the
 * connection is healthy (rule: stale positions must never be presented as live). */
function ambientStatusText(
  status: ReturnType<typeof useRide.getState>['status'],
  hasFix: boolean,
): string | null {
  if (status === 'reconnecting') return 'Reconnecting…';
  if (status === 'closed' || status === 'rejected') return 'Connection lost';
  // Before the first fix there is no dot, no speed, and no progress along the route —
  // the screen is nearly empty and nothing explains why. Saying so costs one ambient
  // line and is the difference between "my GPS hasn't locked yet" and "this app is
  // broken" (PRODUCT.md's Confidence pillar: don't show what can't be trusted, but do
  // say why it's missing). It clears itself the moment a fix lands.
  if (!hasFix) return 'Waiting for GPS…';
  return null;
}

export default function RideScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();

  // useKeepAwake() throws an unhandled rejection on unmount once the activity is gone
  // (ExpoKeepAwake.deactivate — "the current activity is no longer available"). Both
  // halves are exported by expo-keep-awake; catching each side directly avoids it.
  useEffect(() => {
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, []);

  const riders = useRide((s) => s.riders);
  const ownId = useRide((s) => s.ownId);
  const ownFix = useRide((s) => s.ownFix);
  const route = useRide((s) => s.route);
  const rejoin = useRide((s) => s.rejoin);
  const routeError = useRide((s) => s.routeError);
  const status = useRide((s) => s.status);

  // Loaded once on mount, not watched live — the toggle lives only in Departure
  // (ADR-015 §5), so nothing during a Motion session should ever change it. Default
  // true matches loadVoiceEnabled's own default, so there's no flash-of-off before
  // the AsyncStorage read resolves.
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  useEffect(() => {
    loadVoiceEnabled().then(setVoiceEnabled);
  }, []);

  // The route Motion actually navigates: a personal detour, when one is active, else
  // the convoy's shared route. Everything downstream — progress matching, the
  // maneuver cue, the destination marker — reads this instead of `route` directly,
  // so none of it needs to know a detour is in play (ADR-014 §1). `route` itself
  // stays around unmodified: RouteLine still draws it, dimmed, underneath.
  const activeRoute = rejoin ?? route;

  // Self-connect: a deep link, Fast Refresh remount, or Android killing the
  // backgrounded app can land here without Departure ever having called join() (CLAUDE.md
  // W3). Rejoin from the last saved session rather than sitting on a live-looking map
  // with no connection.
  useEffect(() => {
    if (useRide.getState().code === code) return; // already connected to this ride
    (async () => {
      const name = await loadRiderName();
      if (!name) {
        router.replace('/');
        return;
      }
      useRide.getState().join(code, name);
    })();
  }, [code, router]);

  // A rejected (re)join means the code is gone — rooms are GC'd 5 min after the last
  // rider leaves (CLAUDE.md). Retrying is pointless, so bail to Departure instead of
  // sitting on a dead screen; leave() also clears the saved session so we don't try
  // this same dead code again next launch.
  useEffect(() => {
    if (status !== 'rejected') return;
    useRide.getState().leave();
    router.replace('/');
  }, [status, router]);

  // The one GPS subscription a ride uses, foreground AND background (ADR-021 §1) —
  // this is deliberately NOT paired with a watchPositionAsync effect here too.
  // MapCanvas.tsx's own doc comment already refuses MapLibre's trackUserLocation to
  // avoid a second GPS subscription on a multi-hour ride; running the background task
  // alongside a foreground watcher would reintroduce exactly that, plus two delivery
  // paths racing to write the same ownFix at different cadences.
  useEffect(() => {
    (async () => {
      try {
        // Non-prompting check only — re-prompting mid-ride is exactly the
        // interruption CLAUDE.md forbids.
        const { status: permStatus } = await Location.getForegroundPermissionsAsync();
        if (permStatus !== 'granted') return;
        await startBackgroundLocation();
      } catch {
        // A permissions edge case must never crash the screen.
      }
    })();
    return () => {
      stopBackgroundLocation().catch(() => {});
    };
  }, [code]);

  // Own position, speed and camera all come from the local GPS fix, never from this
  // device's entry in `riders`. That entry is our own fix echoed back by the server, so
  // using it would freeze our own dot and speedometer whenever the network drops — the
  // one rider whose data needs no network at all. See RideState.ownFix.
  const ownLngLat: [number, number] | null = ownFix ? [ownFix.lng, ownFix.lat] : null;

  // The monotonic search in computeProgress needs its previous index as an anchor —
  // kept in a ref (not state) because it's an internal search hint, not something
  // that should itself cause a re-render.
  const prevIndexRef = useRef<number | null>(null);
  // Which route that anchor belongs to. activeRoute can swap identity — a rejoin
  // starting or clearing, or a fresh `route` frame — without ownFix changing at the
  // same instant, so the useMemo's dependency array alone won't always catch it via
  // "did anything change"; this ref lets the memo body detect the swap explicitly
  // and drop the stale anchor rather than searching a window into the wrong polyline.
  const prevActiveRouteRef = useRef<RouteData | null>(null);

  // Recomputed only when the route or the GPS fix actually changes reference — not on
  // every render, which would otherwise mean redoing this at the 4Hz `state`-frame
  // rate on top of the 1Hz GPS rate the fix itself arrives at (CLAUDE.md protocol).
  //
  // Yes, this writes a ref from inside useMemo, which is normally a bug: React may
  // invoke a memo twice (StrictMode) or drop and recompute it. It's safe here because
  // computeProgress converges — re-running it with its own previous output as the
  // anchor searches a window that still contains that index, so a repeat invocation
  // can only match the same vertex or a nearer one further forward, never snap
  // backwards. The alternative (computing in an effect) would leave the maneuver cue
  // one render behind the fix, which for a turn cue is the worse trade.
  const progress: Progress | null = useMemo(() => {
    if (!activeRoute || !ownFix) {
      prevIndexRef.current = null; // no fix/route to anchor from — start fresh once one arrives
      prevActiveRouteRef.current = activeRoute;
      return null;
    }
    if (prevActiveRouteRef.current !== activeRoute) {
      // A different polyline than the anchor was computed against (ADR-014 §1: a
      // rejoin starting/clearing swaps activeRoute's identity) — the old index means
      // nothing here, so start the monotonic search fresh instead of anchoring into
      // an unrelated route.
      prevIndexRef.current = null;
      prevActiveRouteRef.current = activeRoute;
    }
    const next = computeProgress(activeRoute, { lat: ownFix.lat, lng: ownFix.lng }, prevIndexRef.current);
    prevIndexRef.current = next.index;
    return next;
  }, [activeRoute, ownFix]);

  // One Room connection for the whole screen (ADR-020 §3) — PushToTalk and
  // useVoiceGuidance both read off this same call rather than each calling
  // useVoice() themselves, which would open a second Room.
  const voice = useVoice(code);

  useReroute(progress);
  // remoteSpeaking threads ADR-015's open audio-contention item to its answer
  // (ADR-020 §5): a co-rider talking defers a due cue exactly like this hook
  // already defers its own in-flight utterance — see useVoiceGuidance.ts for why
  // that's a skip-and-retry, never a delay.
  useVoiceGuidance(progress, voiceEnabled, voice.remoteSpeaking);

  function handleLongPress(coord: [number, number]) {
    if (!ownFix) return; // no fix yet — rare startup race, silent no-op
    const [destLng, destLat] = coord;
    useRide.getState().setDestination([
      [ownFix.lat, ownFix.lng],
      [destLat, destLng],
    ]);
  }

  // Connection status takes precedence — a dead socket is the more important fact,
  // and it's ambient text either way so only one line ever shows at once.
  const ambientText = ambientStatusText(status, ownFix !== null) ?? routeErrorText(routeError);

  return (
    <View style={{ flex: 1, backgroundColor: color.surface.void }}>
      <MapCanvas
        ownPosition={ownLngLat}
        heading={ownFix ? ownFix.heading : null}
        speed={ownFix ? ownFix.speed : null}
        // The route's own start — already [lng, lat], no swap needed — so a rider whose
        // GPS hasn't locked sees the ride they just planned instead of open ocean.
        fallbackCenter={activeRoute?.polyline[0] ?? null}
        onLongPress={handleLongPress}
      >
        {/* RouteLine always draws the convoy's own `route`, not `activeRoute`: ADR-014
            §6 needs the shared line to stay visible, dimmed, underneath a personal
            detour — "the line you're trying to get back to" — which only holds if
            this never swaps to drawing the detour's own polyline instead. */}
        <RouteLine polyline={route?.polyline ?? []} progress={progress} dimOnly={rejoin !== null} />
        {rejoin && <RejoinLine polyline={rejoin.polyline} />}
        <DestinationMarker polyline={activeRoute?.polyline ?? []} />
        <RiderMarkers riders={riders} ownId={ownId} ownLngLat={ownLngLat} />
      </MapCanvas>
      {/* Mounted before HorizonLine on purpose (see PushToTalk.tsx's doc comment):
          this invisible band sits UNDER EndRide's button, which lives in
          HorizonLine's Held band over the same bottom strip, so EndRide wins the
          touch when it's visible and PushToTalk gets everywhere else. */}
      <PushToTalk voice={voice} />
      <HorizonLine
        register="motion"
        ahead={
          <>
            {ambientText && (
              <Text style={[type.motion.label, { color: color.ink.secondary }]}>{ambientText}</Text>
            )}
            <AheadCue progress={progress} summary={activeRoute?.summary ?? null} />
          </>
        }
        now={<SpeedReadout speedMps={ownFix ? ownFix.speed : null} />}
        // Always passed, never conditionally — EndRide gates its own visibility
        // (speed sustained below threshold) and HorizonLine.tsx only decides whether
        // to allocate the Held band at all, not what's safe to show in it.
        held={<EndRide speed={ownFix ? ownFix.speed : null} />}
      />
    </View>
  );
}
