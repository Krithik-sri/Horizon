import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';

import { color, type } from '@/design/tokens';
import { useRide } from '@/state/useRide';
import AheadCue from '@/features/motion/AheadCue';
import HorizonLine from '@/features/motion/HorizonLine';
import SpeedReadout from '@/features/motion/SpeedReadout';
import MapCanvas from '@/features/convoy/MapCanvas';
import RiderMarkers from '@/features/convoy/RiderMarkers';
import RouteLine from '@/features/convoy/RouteLine';

/** "Reconnecting…" / "Connection lost" — ambient, absent entirely when the
 * connection is healthy (rule: stale positions must never be presented as live). */
function ambientStatusText(status: ReturnType<typeof useRide.getState>['status']): string | null {
  if (status === 'reconnecting') return 'Reconnecting…';
  if (status === 'closed' || status === 'rejected') return 'Connection lost';
  return null;
}

export default function RideScreen() {
  // Code is display/use only — the store is already connected from Departure's join().
  useLocalSearchParams<{ code: string }>();
  useKeepAwake();

  const riders = useRide((s) => s.riders);
  const ownId = useRide((s) => s.ownId);
  const ownFix = useRide((s) => s.ownFix);
  const route = useRide((s) => s.route);
  const status = useRide((s) => s.status);

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

  const ambientText = ambientStatusText(status);

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
