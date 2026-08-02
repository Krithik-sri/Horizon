import type { ReactNode } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import { Camera, Map } from '@maplibre/maplibre-react-native';

/**
 * OpenFreeMap's official dark style — keyless, no account, no billing (CLAUDE.md
 * hard constraint #1). Matte dark background, vector source at
 * https://tiles.openfreemap.org/planet (OpenMapTiles schema).
 */
const DARK_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

type MapCanvasProps = {
  ownPosition: [number, number] | null;
  onLongPress?: (coord: [number, number]) => void;
  children?: ReactNode;
};

/**
 * Full-bleed MapLibre canvas. Composes RiderMarkers/RouteLine/etc. as children
 * (MapLibre requires those be descendants of <Map>) rather than owning them.
 */
export default function MapCanvas({ ownPosition, onLongPress, children }: MapCanvasProps) {
  return (
    <Map
      style={{ flex: 1 }}
      mapStyle={DARK_STYLE_URL}
      onLongPress={(event: NativeSyntheticEvent<{ lngLat: [number, number] }>) => {
        onLongPress?.(event.nativeEvent.lngLat);
      }}
    >
      <Camera center={ownPosition ?? undefined} zoom={15} />
      {children}
    </Map>
  );
}
