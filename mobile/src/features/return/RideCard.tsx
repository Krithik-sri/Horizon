import { Pressable, Text } from 'react-native';

import { formatDateShort, formatDistanceKm, formatDuration } from '@/core/format';
import type { Ride } from '@/core/rides';
import { color, register, space, type } from '@/design/tokens';

type RideCardProps = {
  ride: Ride;
  onPress: () => void;
};

/**
 * One archive row: date, distance, duration, title if set. Not RideFacts — this is a
 * list-row summary, not the enforcement point ADR-019 §4 names, though it never
 * receives more than the one `ride` prop given here either way.
 */
export default function RideCard({ ride, onPress }: RideCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        minHeight: register.return.touchTarget,
        justifyContent: 'center',
        paddingVertical: space[3],
        borderBottomWidth: 1,
        borderColor: color.surface.hairline,
      }}
    >
      {ride.title && <Text style={[type.reflective.body, { color: color.ink.primary }]}>{ride.title}</Text>}
      <Text
        style={[
          type.departure.label,
          { color: color.ink.secondary, marginTop: ride.title ? space[1] : 0 },
        ]}
      >
        {formatDateShort(ride.startedAt)} · {formatDistanceKm(ride.distanceM)} · {formatDuration(ride.movingS)}
      </Text>
    </Pressable>
  );
}
