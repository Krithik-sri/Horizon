import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';

import { color } from '@/design/tokens';
import type { LngLat } from '@/core/models';

type RejoinLineProps = {
  polyline: LngLat[];
};

/**
 * The personal detour (ADR-014) — same `GeoJSONSource` + `Layer` shape as
 * RouteLine.tsx, drawn in `amber.core` with a dash pattern instead of a second tone.
 *
 * Dash is texture, not a second hue: `docs/DESIGN.md` §1's one-accent rule ("a
 * second accent hue needs an ADR") and `ADR-012` §3's brightness-not-colour decision
 * for the route line both stay intact — this reuses the single accent rather than
 * introducing one. The dash pattern itself carries a specific meaning worth having:
 * it says "this line is yours alone." No other rider is seeing it (ADR-014 §1) —
 * the convoy's shared route (RouteLine, dimmed via its `dimOnly` prop while this is
 * on screen) is the only line every rider has in common.
 */
export default function RejoinLine({ polyline }: RejoinLineProps) {
  if (polyline.length === 0) {
    return null;
  }

  return (
    <GeoJSONSource
      id="rejoin-line-source"
      data={{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: polyline },
        properties: {},
      }}
    >
      <Layer
        id="rejoin-line"
        type="line"
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{
          'line-color': color.amber.core,
          'line-width': 4,
          'line-dasharray': [2, 2],
        }}
      />
    </GeoJSONSource>
  );
}
