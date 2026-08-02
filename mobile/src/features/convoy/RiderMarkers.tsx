import { View } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';

import { color, radius } from '@/design/tokens';
import { isStale } from '@/state/useRide';
import type { Rider } from '@/core/models';

// Dot diameter — a magic number tokens.ts doesn't cover (no size scale for map markers).
const DOT_SIZE = 16;

type RiderMarkersProps = {
  riders: Rider[];
  ownId: string | null;
  /** This device's own live GPS position, [lng, lat]. See below for why it's separate. */
  ownLngLat: [number, number] | null;
};

/**
 * One Marker per rider. Own dot renders amber (the "live thing that matters now"),
 * other riders render ink.primary — both swap to ink.disabled when stale. No
 * gradient/opacity logic (ADR-009: this is a binary state, never a ranking).
 *
 * Own position is drawn from `ownLngLat` (local GPS) rather than from this device's entry
 * in `riders` (the server echoing that same fix back). Otherwise our own dot would freeze
 * on any network drop, and would never appear at all before the first `state` frame lands.
 * We are also never stale to ourselves — staleness describes not hearing from someone, and
 * we always hear from ourselves.
 */
export default function RiderMarkers({ riders, ownId, ownLngLat }: RiderMarkersProps) {
  return (
    <>
      {riders.map((rider) => {
        if (rider.id === ownId) return null; // drawn below, from local GPS
        const dotColor = isStale(rider) ? color.ink.disabled : color.ink.primary;
        return (
          <Marker key={rider.id} id={rider.id} lngLat={[rider.lng, rider.lat]}>
            <View style={{ width: DOT_SIZE, height: DOT_SIZE, borderRadius: radius.full, backgroundColor: dotColor }} />
          </Marker>
        );
      })}
      {ownLngLat && (
        <Marker id="own" lngLat={ownLngLat}>
          <View
            style={{
              width: DOT_SIZE,
              height: DOT_SIZE,
              borderRadius: radius.full,
              backgroundColor: color.amber.core,
            }}
          />
        </Marker>
      )}
    </>
  );
}
