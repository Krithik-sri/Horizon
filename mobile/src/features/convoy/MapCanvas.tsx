import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Map, type CameraEasing } from '@maplibre/maplibre-react-native';

import { horizon, motion } from '@/design/tokens';
import { nextBearing } from '@/core/bearing';

/**
 * OpenFreeMap's official dark style — keyless, no account, no billing (CLAUDE.md
 * hard constraint #1). Matte dark background, vector source at
 * https://tiles.openfreemap.org/planet (OpenMapTiles schema).
 */
export const DARK_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

const CAMERA_ZOOM = 15;
// Forward-leaning tilt for a heading-up, navigation-unit view — fixed rather than
// speed/zoom-adaptive. ponytail: constant pitch, revisit if riders ask for it to ease
// off at low speed/high zoom the way turn-by-turn apps do.
const CAMERA_PITCH = 45;
// Camera animation must never exceed motion.duration.quick (register.motion.maxAnimationDuration,
// CLAUDE.md's 120ms Motion cap) — fixes arrive ~1Hz, far slower than this, so each
// animation always finishes before the next fix retriggers it.
const CAMERA_DURATION = motion.duration.quick;
// Continuous 1Hz follow, not a one-off jump — "fly"'s arc/zoom-out is for a big context
// change, and any deceleration curve is imperceptible at 120ms anyway, so linear is the
// simplest choice that avoids overshoot.
const CAMERA_EASING: CameraEasing = 'linear';

type MapCanvasProps = {
  ownPosition: [number, number] | null;
  /** Degrees, GPS course-over-ground — null before the first fix. Drives camera bearing. */
  heading: number | null;
  /** m/s — null before the first fix. Gates bearing smoothing (see core/bearing.ts). */
  speed: number | null;
  /**
   * Where to point the camera before the first fix arrives, [lng, lat].
   *
   * Without this the camera gets no centre at all and MapLibre sits at its default —
   * 0,0, in the Atlantic — so a rider who starts a ride before GPS has locked sees a
   * featureless black rectangle with their own committed route somewhere off-screen,
   * and no way to tell a cold GPS from a broken app. The route's own start point is a
   * far better guess than nothing: it is where the rider is about to be. The camera
   * snaps to the real fix the moment one lands.
   */
  fallbackCenter?: [number, number] | null;
  onLongPress?: (coord: [number, number]) => void;
  children?: ReactNode;
};

/**
 * Full-bleed MapLibre canvas. Composes RiderMarkers/RouteLine/etc. as children
 * (MapLibre requires those be descendants of <Map>) rather than owning them.
 *
 * Heading-up navigation camera: bearing follows the rider's smoothed course (see
 * core/bearing.ts — low-passed, gated on a speed floor so a stopped bike doesn't spin
 * the map), with a forward pitch and top padding that pushes the rider's dot below the
 * HUD's Ahead band. Driven declaratively from `ownPosition`/`heading`/`speed`, which
 * come from the same expo-location fix already flowing into the store — this does NOT
 * enable MapLibre's own trackUserLocation, which would open a second GPS subscription
 * (CLAUDE.md: battery, on rides that run for hours).
 */
export default function MapCanvas({
  ownPosition,
  heading,
  speed,
  fallbackCenter,
  onLongPress,
  children,
}: MapCanvasProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // Smoothed bearing lives in a ref (the value fed straight back into the next smoothing
  // step) plus state (what actually re-renders the Camera) — same split as
  // ride/[code].tsx's prevIndexRef, for the same reason: the ref is an internal anchor,
  // not itself a reason to re-render.
  const bearingRef = useRef<number | null>(null);
  const [bearing, setBearing] = useState<number | null>(null);

  useEffect(() => {
    if (heading === null || speed === null) return;
    bearingRef.current = nextBearing(bearingRef.current, heading, speed);
    setBearing(bearingRef.current);
  }, [heading, speed]);

  // Bias the viewport so the road ahead renders below the HUD's Ahead band (top
  // horizon.ahead fraction of the safe area, tokens.ts) instead of hidden under it.
  // MapLibre padding is in points, not percent, so the fraction is converted here.
  const safeAreaHeight = windowHeight - insets.top - insets.bottom;
  const topPadding = insets.top + horizon.ahead * safeAreaHeight;

  return (
    <Map
      style={{ flex: 1 }}
      mapStyle={DARK_STYLE_URL}
      onLongPress={(event: NativeSyntheticEvent<{ lngLat: [number, number] }>) => {
        onLongPress?.(event.nativeEvent.lngLat);
      }}
    >
      <Camera
        center={ownPosition ?? fallbackCenter ?? undefined}
        zoom={CAMERA_ZOOM}
        bearing={bearing ?? undefined}
        pitch={CAMERA_PITCH}
        padding={{ top: topPadding }}
        duration={CAMERA_DURATION}
        easing={CAMERA_EASING}
      />
      {children}
    </Map>
  );
}
