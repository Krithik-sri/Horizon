import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';

import { color } from '@/design/tokens';
import type { LngLat } from '@/core/models';
import type { Progress } from '@/core/routeProgress';

type RouteLineProps = {
  polyline: LngLat[];
  progress: Progress | null;
  /** ADR-014 §6: while a personal detour (RejoinLine) is active, the convoy's own
   * route draws entirely in `amber.dim`, with no bright remainder — so it stays
   * visible underneath the detour as "the line you're trying to get back to"
   * without competing with `amber.core`'s now-single owner, the detour itself. */
  dimOnly?: boolean;
};

/**
 * Renders the route two-tone: the whole route dim, the portion still ahead of the
 * rider bright on top. docs/DESIGN.md: "Color communicates meaning, never decoration"
 * and there is one accent, amber — a second accent hue needs an ADR (a blue
 * Google-Maps-style line was rejected on that basis). Brightness now encodes "still
 * ahead of you" — meaning, not decoration — and it relieves amber.core from also
 * having to mean route + rider marker + active state + signal.caution all at once.
 * amber.dim is a track colour sitting behind the live one, not text on a background,
 * so it isn't held to the 7:1 Motion contrast floor; tokens.ts has no published ratio
 * for it, but at #8A6224 it reads as a dark amber-brown clearly above the near-black
 * map style — legible as "the route" without competing with amber.core for attention.
 *
 * Line width 4 is a magic number tokens.ts doesn't cover (no stroke-width scale).
 */
export default function RouteLine({ polyline, progress, dimOnly }: RouteLineProps) {
  if (polyline.length === 0) {
    return null;
  }

  if (dimOnly) {
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
            'line-color': color.amber.dim,
            'line-width': 4,
          }}
        />
      </GeoJSONSource>
    );
  }

  // No fix yet, off-route (progress null), or already at/past the last vertex — in
  // every case fall back to one full-route line in amber.core, the pre-two-tone
  // behaviour. Never leave the rider with no route drawn at all. The last-vertex
  // case also guards the degenerate LineString: slicing at the final index would
  // leave a single point, and a LineString needs at least two.
  const remaining =
    progress !== null && progress.index < polyline.length - 1
      ? polyline.slice(progress.index)
      : null;

  if (remaining === null) {
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

  return (
    <>
      {/* Dim full route first, bright remainder second — MapLibre draws layers in
       * the order they're added, so this keeps the remainder on top. */}
      <GeoJSONSource
        id="route-line-full-source"
        data={{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: polyline },
          properties: {},
        }}
      >
        <Layer
          id="route-line-full"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': color.amber.dim,
            'line-width': 4,
          }}
        />
      </GeoJSONSource>
      <GeoJSONSource
        id="route-line-remaining-source"
        data={{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: remaining },
          properties: {},
        }}
      >
        <Layer
          id="route-line-remaining"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': color.amber.core,
            'line-width': 4,
          }}
        />
      </GeoJSONSource>
    </>
  );
}
