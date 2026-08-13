import { View } from 'react-native';
import { Camera, Map, Marker, type LngLatBounds } from '@maplibre/maplibre-react-native';

import type { LngLat } from '@/core/models';
import { color, radius } from '@/design/tokens';
import DestinationMarker from '@/features/convoy/DestinationMarker';
import { DARK_STYLE_URL } from '@/features/convoy/MapCanvas';
import RouteLine from '@/features/convoy/RouteLine';

type RideTraceProps = {
  /** ride.track — [lng, lat], GeoJSON order, same as route.polyline
   * (core/rideTrack.ts's own comment: the lat/lng -> lng/lat swap happens once, at
   * the boundary that wrote this array; nothing downstream should ever treat it as
   * lat-first). */
  track: LngLat[] | null;
};

const MAP_HEIGHT = 220; // no size token for a fixed-height map card — PlannerMap.tsx has the same gap
const START_DOT_SIZE = 16; // matches RiderMarkers.tsx's DOT_SIZE — reads as "a rider's dot," historical rather than live
const CAMERA_PADDING = 32;

function boundsFor(track: LngLat[]): LngLatBounds {
  const lngs = track.map(([lng]) => lng);
  const lats = track.map(([, lat]) => lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/**
 * A static recap of the track actually ridden — ride.track, the GPS trace
 * core/rideTrack.ts recorded while riding, not the planned route. Flat and north-up,
 * camera fit once to the track's own bounds and never re-driven off a live position:
 * Return has no "own dot" to follow. Same reasoning as why PlannerMap.tsx isn't
 * MapCanvas (ADR-013 §4) applied to a finished ride instead of a planner — MapCanvas's
 * camera IS the Motion register, and this screen isn't Motion. touchRotate/touchPitch
 * are switched off so the only gestures left are MapLibre's default pan and zoom;
 * nothing here adds a live layer, a follow behaviour, or a long-press handler.
 */
export default function RideTrace({ track }: RideTraceProps) {
  if (!track || track.length === 0) {
    return null;
  }

  const start = track[0];

  return (
    <View style={{ height: MAP_HEIGHT, borderRadius: radius.card, overflow: 'hidden' }}>
      <Map style={{ flex: 1 }} mapStyle={DARK_STYLE_URL} touchRotate={false} touchPitch={false}>
        {track.length >= 2 ? (
          <Camera
            bounds={boundsFor(track)}
            padding={{ top: CAMERA_PADDING, right: CAMERA_PADDING, bottom: CAMERA_PADDING, left: CAMERA_PADDING }}
          />
        ) : (
          <Camera center={start} zoom={14} />
        )}
        {/* Reuses RouteLine's GeoJSONSource/Layer pattern directly rather than
            re-deriving it — progress={null} is exactly its "nothing to draw two-tone
            against" branch, which renders one full line in amber.core. */}
        <RouteLine polyline={track} progress={null} />
        {/* DestinationMarker draws a hollow ring at a polyline's LAST point — reused
            as-is for the ride's end point. */}
        <DestinationMarker polyline={track} />
        <Marker id="ride-trace-start" lngLat={start}>
          <View
            style={{
              width: START_DOT_SIZE,
              height: START_DOT_SIZE,
              borderRadius: radius.full,
              backgroundColor: color.ink.primary,
            }}
          />
        </Marker>
      </Map>
    </View>
  );
}
