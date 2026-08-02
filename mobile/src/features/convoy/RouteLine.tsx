import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';

import { color } from '@/design/tokens';
import type { LngLat } from '@/core/models';

type RouteLineProps = {
  polyline: LngLat[];
};

/**
 * Renders the route as a single amber line — amber because the route is "the live
 * thing that matters now." Line width 4 is a magic number tokens.ts doesn't cover
 * (no stroke-width scale).
 */
export default function RouteLine({ polyline }: RouteLineProps) {
  if (polyline.length === 0) {
    return null;
  }

  return (
    <GeoJSONSource
      id="route-line-source"
      data={{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: polyline },
        properties: {},
      }}
    >
      <Layer
        id="route-line"
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{
          'line-color': color.amber.core,
          'line-width': 4,
        }}
      />
    </GeoJSONSource>
  );
}
