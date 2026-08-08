import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { color, type } from '@/design/tokens';
import { loadRiderName } from '@/core/riderId';
import type { FetchRouteError } from '@/core/route';
import { useRide } from '@/state/useRide';
import AheadCue from '@/features/motion/AheadCue';
import HorizonLine from '@/features/motion/HorizonLine';
import SpeedReadout from '@/features/motion/SpeedReadout';
import MapCanvas from '@/features/convoy/MapCanvas';
import RiderMarkers from '@/features/convoy/RiderMarkers';
import RouteLine from '@/features/convoy/RouteLine';

// Stable tag for this screen's keep-awake lock, paired with the manual
// activate/deactivate below (see the effect in RideScreen for why not useKeepAwake).
const KEEP_AWAKE_TAG = 'horizon-ride';

/** "Reconnecting…" / "Connection lost" — ambient, absent entirely when the
 * connection is healthy (rule: stale positions must never be presented as live). */
function ambientStatusText(status: ReturnType<typeof useRide.getState>['status']): string | null {
  if (status === 'reconnecting') return 'Reconnecting…';
  if (status === 'closed' || status === 'rejected') return 'Connection lost';
  return null;
}

/** A failed setDestination is otherwise invisible — the map just doesn't change.
 * Ambient text only, the lowest rung of the attention ladder (horizon-design SKILL.md). */
function routeErrorText(error: FetchRouteError | null): string | null {
  switch (error) {
    case 'no-route':
      return 'No route found.';
    case 'unavailable':
    case 'upstream-failed':
      return 'Route unavailable.';
    case 'network':
      return "Couldn't reach the route service.";
    default:
      return null; // unknown-ride / bad-waypoints: not reachable from a long-press in practice
  }
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
  const routeError = useRide((s) => s.routeError);
  const status = useRide((s) => s.status);

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

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    (async () => {
      try {
        // Non-prompting check only — re-prompting mid-ride is exactly the
        // interruption CLAUDE.md forbids.
        const { status: permStatus } = await Location.getForegroundPermissionsAsync();
        if (permStatus !== 'granted') return;
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 5 },
          (fix) => {
            useRide.getState().sendLoc({
              lat: fix.coords.latitude,
              lng: fix.coords.longitude,
              heading: fix.coords.heading ?? 0,
              speed: fix.coords.speed ?? 0,
            });
          },
        );
      } catch {
        // A permissions edge case must never crash the screen.
      }
    })();
    return () => subscription?.remove();
  }, []);

  // Own position, speed and camera all come from the local GPS fix, never from this
  // device's entry in `riders`. That entry is our own fix echoed back by the server, so
  // using it would freeze our own dot and speedometer whenever the network drops — the
  // one rider whose data needs no network at all. See RideState.ownFix.
  const ownLngLat: [number, number] | null = ownFix ? [ownFix.lng, ownFix.lat] : null;
  const ownPosition = ownFix ? { lat: ownFix.lat, lng: ownFix.lng } : null;

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
  const ambientText = ambientStatusText(status) ?? routeErrorText(routeError);

  return (
    <View style={{ flex: 1, backgroundColor: color.surface.void }}>
      <MapCanvas ownPosition={ownLngLat} onLongPress={handleLongPress}>
        <RouteLine polyline={route?.polyline ?? []} />
        <RiderMarkers riders={riders} ownId={ownId} ownLngLat={ownLngLat} />
      </MapCanvas>
      <HorizonLine
        register="motion"
        ahead={
          <>
            {ambientText && (
              <Text style={[type.motion.label, { color: color.ink.secondary }]}>{ambientText}</Text>
            )}
            <AheadCue route={route} position={ownPosition} />
          </>
        }
        now={<SpeedReadout speedMps={ownFix ? ownFix.speed : null} />}
      />
    </View>
  );
}
