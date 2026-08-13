import { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { listRides, type Ride } from '@/core/rides';
import { color, register, space, type } from '@/design/tokens';
import RideCard from '@/features/return/RideCard';

type Row = { kind: 'year'; year: number } | { kind: 'ride'; ride: Ride };

/**
 * Groups listRides()'s already reverse-chronological rows under a year divider —
 * navigation only, per ADR-019 §2's one permitted aggregate: "a neutral year divider
 * in the archive list, which exists for navigation — finding a ride — not as a
 * figure to admire." No count and no total is ever attached to it here.
 */
function toRows(rides: Ride[]): Row[] {
  const rows: Row[] = [];
  let lastYear: number | null = null;
  for (const ride of rides) {
    const year = new Date(ride.startedAt).getFullYear();
    if (year !== lastYear) {
      rows.push({ kind: 'year', year });
      lastYear = year;
    }
    rows.push({ kind: 'ride', ride });
  }
  return rows;
}

function rowKey(row: Row): string {
  return row.kind === 'year' ? `year-${row.year}` : row.ride.id;
}

/**
 * The Return archive: every finished ride, newest first. Reached from a quiet text
 * link on Departure (app/index.tsx) or by ending a ride (EndRide.tsx's
 * router.replace) — never announced, per Deferred Delivery (docs/PRODUCT.md) and
 * ADR-019 §3's "no notification when a summary is ready."
 */
export default function ReturnArchiveScreen() {
  const router = useRouter();
  const [rides, setRides] = useState<Ride[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listRides().then((r) => {
      if (!cancelled) setRides(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: register.return.background }}>
      <View style={{ flex: 1, padding: register.return.padding }}>
        <Text style={[type.reflective.title, { color: color.ink.primary }]}>Rides</Text>

        {rides?.length === 0 && (
          <Text style={[type.reflective.body, { color: color.ink.secondary, marginTop: space[6] }]}>
            Your first finished ride will show up here.
          </Text>
        )}

        <FlatList
          data={rides ? toRows(rides) : []}
          keyExtractor={rowKey}
          contentContainerStyle={{ paddingTop: space[5], paddingBottom: space[8] }}
          renderItem={({ item }) =>
            item.kind === 'year' ? (
              <Text style={[type.departure.label, { color: color.ink.tertiary, marginTop: space[5] }]}>
                {item.year}
              </Text>
            ) : (
              <RideCard ride={item.ride} onPress={() => router.push(`/return/${item.ride.id}`)} />
            )
          }
        />
      </View>
    </SafeAreaView>
  );
}
