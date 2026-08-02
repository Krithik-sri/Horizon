import { Text, View } from 'react-native';

import { color, radius, space, type } from '@/design/tokens';
import type { RouteData } from '@/core/models';

type AheadCueProps = {
  route: RouteData | null;
  position: { lat: number; lng: number } | null;
};

// No stdlib/dependency has this — straight-line-per-segment sum, an approximation
// of ORS's true segment distance, acceptable for MVP scaffolding.
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/**
 * A single sentence combining distance-to-turn + instruction — type.motion.secondary
 * is documented "at most one of these on screen," and this is that one use.
 */
export default function AheadCue({ route, position }: AheadCueProps) {
  if (!route || !route.steps || route.steps.length === 0 || !position) {
    return null;
  }

  const { polyline, steps } = route;
  if (polyline.length === 0) {
    return null;
  }

  let nearestIdx = 0;
  let nearestDist = Infinity;
  polyline.forEach(([lng, lat], idx) => {
    const d = haversineMeters(position.lat, position.lng, lat, lng);
    if (d < nearestDist) {
      nearestDist = d;
      nearestIdx = idx;
    }
  });

  const step = steps.find((s) => s.wayPoints[0] >= nearestIdx);
  if (!step) {
    return null;
  }

  let distanceMeters = 0;
  for (let i = nearestIdx; i < step.wayPoints[0] && i + 1 < polyline.length; i++) {
    const [lng1, lat1] = polyline[i];
    const [lng2, lat2] = polyline[i + 1];
    distanceMeters += haversineMeters(lat1, lng1, lat2, lng2);
  }

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: color.surface.void,
        borderRadius: radius.card,
        // Snug card padding — the screen-edge padding (space[6]) is applied once,
        // at the HorizonLine band level, so this doesn't double it.
        padding: space[4],
      }}
    >
      <Text style={[type.motion.secondary, { color: color.ink.primary }]}>
        {formatDistance(distanceMeters)} · {step.instruction}
      </Text>
    </View>
  );
}
