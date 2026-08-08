import { View } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';

import { color, radius } from '@/design/tokens';
import type { LngLat } from '@/core/models';

// Ring diameter — a magic number tokens.ts doesn't cover (no size scale for map
// markers), same treatment as RiderMarkers.tsx's DOT_SIZE. Slightly larger than a
// rider dot (16) so the destination reads as a different kind of thing, not one more
// rider.
const RING_SIZE = 20;
// Stroke width — tokens.ts has no stroke-width scale either, same treatment as
// RouteLine.tsx's line-width.
const RING_BORDER_WIDTH = 2;

type DestinationMarkerProps = {
  polyline: LngLat[];
};

/**
 * Marks the destination as a hollow ring — distinguished from a rider's solid dot by
 * FORM, not by a new color (horizon-design SKILL.md #6: color communicates meaning,
 * never decoration). `color.amber.core` already means "the live thing that matters
 * now" (the rider's own dot in RiderMarkers.tsx); reusing it here would collide with
 * that meaning. `color.ink.tertiary` is ruled out too — it fails the Motion 7:1
 * contrast floor (tokens.ts line 29). So this reuses `ink.primary`, same as another
 * rider's dot, and changes only the shape.
 *
 * The destination is derived from the route polyline's LAST point, never from the
 * long-press coordinate that requested it, for two reasons:
 *   1. The last polyline point is where ORS actually snapped the route to, not the
 *      raw press — the more correct "destination" once a route exists.
 *   2. Every other rider in the convoy only ever receives the WS `route` message; they
 *      never saw the long-press. A locally stored press coordinate would draw the pin
 *      on the presser's phone only, never the rest of the convoy.
 * There is deliberately no destination field in the zustand store — `route` is
 * already the single source of truth (useRide.ts), and this component reads straight
 * off it.
 */
export default function DestinationMarker({ polyline }: DestinationMarkerProps) {
  if (polyline.length === 0) {
    return null;
  }

  const destination = polyline[polyline.length - 1];

  return (
    <Marker id="destination" lngLat={destination}>
      <View
        style={{
          width: RING_SIZE,
          height: RING_SIZE,
          borderRadius: radius.full,
          borderWidth: RING_BORDER_WIDTH,
          borderColor: color.ink.primary,
          backgroundColor: 'transparent',
        }}
      />
    </Marker>
  );
}
