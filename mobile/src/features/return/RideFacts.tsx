import { Text, View } from 'react-native';

import { formatDateLong, formatDistanceKm, formatDuration } from '@/core/format';
import type { Ride } from '@/core/rides';
import { color, space, type } from '@/design/tokens';

type RideFactsProps = {
  ride: Ride;
};

function elapsedSeconds(ride: Ride): number {
  return Math.max(0, (new Date(ride.endedAt).getTime() - new Date(ride.startedAt).getTime()) / 1000);
}

function avgSpeedKmh(ride: Ride): number | null {
  return ride.movingS > 0 ? (ride.distanceM / ride.movingS) * 3.6 : null;
}

// m/s -> km/h, same conversion and rounding treatment as avgSpeedKmh's caller below.
function maxSpeedKmh(ride: Ride): number {
  return ride.maxSpeedMps * 3.6;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginTop: space[3] }}>
      <Text style={[type.departure.label, { color: color.ink.secondary }]}>{label}</Text>
      <Text style={[type.reflective.body, { color: color.ink.primary }]}>{value}</Text>
    </View>
  );
}

/**
 * ADR-019 §4: the enforcement mechanism, not just a description of it. This
 * component's signature takes exactly one `Ride` and nothing else — no second Ride,
 * no store, no aggregate query can reach in here, so a statistic that needs a second
 * ride to compute (a personal best, "longest," a lifetime total — ADR-019 §1's test)
 * has no prop through which to read one. Same trick tokens.ts uses to ban serif in
 * Motion by giving the `motion` scale no serif entry at all. If a change to this
 * component's props would let it see more than one ride, read ADR-019 first.
 *
 * Renders only what ADR-019 §2 actually allows, and only what the Ride record this
 * app persists actually has: date, distance, moving time, elapsed time, average and
 * max speed for this ride, and named companions. Start/end place names are allowed by
 * the ADR too but aren't shown — this Ride has no reverse-geocoded place name
 * (core/geocode.ts's /geocode is forward-only), so it isn't knowable from a single
 * Ride at all, not merely withheld. Max speed is a number, not a superlative: it's
 * labelled "Max speed", never "your fastest" or any other framing that implies a
 * comparison to another ride (ADR-019 §1's test — it doesn't need a second ride to
 * compute, so it ships).
 */
export default function RideFacts({ ride }: RideFactsProps) {
  const avgSpeed = avgSpeedKmh(ride);

  return (
    <View>
      <Fact label="Date" value={formatDateLong(ride.startedAt)} />
      <Fact label="Distance" value={formatDistanceKm(ride.distanceM)} />
      <Fact label="Moving time" value={formatDuration(ride.movingS)} />
      <Fact label="Elapsed time" value={formatDuration(elapsedSeconds(ride))} />
      {avgSpeed !== null && <Fact label="Average speed" value={`${Math.round(avgSpeed)} km/h`} />}
      <Fact label="Max speed" value={`${Math.round(maxSpeedKmh(ride))} km/h`} />
      {ride.companions.length > 0 && (
        <Fact label="With" value={ride.companions.map((c) => c.name).join(', ')} />
      )}
    </View>
  );
}
