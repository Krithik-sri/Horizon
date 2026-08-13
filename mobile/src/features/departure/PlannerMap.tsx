import { Text, View, type NativeSyntheticEvent } from 'react-native';
import { Camera, Map, Marker, type LngLatBounds } from '@maplibre/maplibre-react-native';

import { color, motion, radius } from '@/design/tokens';
import { DARK_STYLE_URL } from '@/features/convoy/MapCanvas';
import RouteLine from '@/features/convoy/RouteLine';
import DestinationMarker from '@/features/convoy/DestinationMarker';
import type { LngLat } from '@/core/models';

export type PlannerMapProps = {
  /** [lng, lat] markers in order; index 0 is the origin. */
  stops: LngLat[];
  /** Preview line; [] when none. */
  polyline: LngLat[];
  /** MapLibre gives [lng, lat]. */
  onPress: (coord: LngLat) => void;
};

const STOP_SIZE = 22;
const CAMERA_PADDING = 64;

/** Box around every stop, MapLibre's [west, south, east, north] order — undefined
 * below two points, where a box is degenerate and `center` is used instead. */
function boundsFor(stops: LngLat[]): LngLatBounds | undefined {
  if (stops.length < 2) return undefined;
  const lngs = stops.map(([lng]) => lng);
  const lats = stops.map(([, lat]) => lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/**
 * The Departure-register planner map: flat and north-up (no bearing/pitch props at
 * all — MapLibre's own default), fitted to whatever stops exist so far, at
 * Departure's motion.duration.base (220ms), not Motion's 120ms cap.
 *
 * Deliberately its own component rather than MapCanvas with a register prop
 * (ADR-013 §4): MapCanvas's camera IS the Motion register — bearing smoothing,
 * fixed pitch, the 120ms animation cap — and a planner wants none of that. What's
 * actually shared is the tile style, which is why that's the only import from
 * MapCanvas.
 */
export default function PlannerMap({ stops, polyline, onPress }: PlannerMapProps) {
  const bounds = boundsFor(stops);

  return (
    <Map
      style={{ flex: 1 }}
      mapStyle={DARK_STYLE_URL}
      onPress={(event: NativeSyntheticEvent<{ lngLat: LngLat }>) => onPress(event.nativeEvent.lngLat)}
    >
      {bounds ? (
        <Camera
          bounds={bounds}
          padding={{ top: CAMERA_PADDING, right: CAMERA_PADDING, bottom: CAMERA_PADDING, left: CAMERA_PADDING }}
          duration={motion.duration.base}
        />
      ) : stops.length === 1 ? (
        <Camera center={stops[0]} zoom={14} duration={motion.duration.base} />
      ) : (
        <Camera duration={motion.duration.base} />
      )}
      <RouteLine polyline={polyline} progress={null} />
      <DestinationMarker polyline={polyline} />
      {stops.map((stop, i) => (
        <Marker key={i} id={`stop-${i}`} lngLat={stop}>
          <View
            style={{
              width: STOP_SIZE,
              height: STOP_SIZE,
              borderRadius: radius.full,
              backgroundColor: color.surface.overlay,
              borderWidth: 2,
              borderColor: color.ink.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Numbering the rider's own stops is ordering, not a ranking (CLAUDE.md,
                ADR-009) — it's what makes the reorder controls in the planner panel
                legible. Origin gets a dot instead of "0": it wasn't typed in as a stop. */}
            <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: color.ink.primary }}>
              {i === 0 ? '•' : i}
            </Text>
          </View>
        </Marker>
      ))}
    </Map>
  );
}
