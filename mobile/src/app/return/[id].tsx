import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { deleteRide, getRide, type Ride } from '@/core/rides';
import { color, register, space, type } from '@/design/tokens';
import JournalNote from '@/features/return/JournalNote';
import PhotoStrip from '@/features/return/PhotoStrip';
import RideFacts from '@/features/return/RideFacts';
import RideTrace from '@/features/return/RideTrace';

export default function RideDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // undefined = still loading, null = not found (or another rider's/deleted row —
  // getRide's RLS-scoped select can't tell the difference, and a rider doesn't need
  // it to: both read as "this ride isn't here").
  const [ride, setRide] = useState<Ride | null | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRide(id).then((r) => {
      if (!cancelled) setRide(r);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function handleDelete() {
    Alert.alert('Delete this ride?', 'This removes the ride and its photos. This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          const ok = await deleteRide(id);
          if (ok) {
            // replace, not back — forces the archive to remount and re-run its own
            // listRides(), which is the only refresh mechanism app/return/index.tsx
            // has (no focus-based refetch elsewhere in this app either).
            router.replace('/return');
          } else {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  if (ride === undefined) {
    return <SafeAreaView style={{ flex: 1, backgroundColor: register.return.background }} />;
  }

  if (ride === null) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: register.return.background }}>
        <View style={{ padding: register.return.padding }}>
          <Text style={[type.reflective.body, { color: color.ink.secondary }]}>This ride isn't here anymore.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: register.return.background }}>
      <ScrollView contentContainerStyle={{ padding: register.return.padding, paddingBottom: space[8] }}>
        <Text style={[type.reflective.title, { color: color.ink.primary }]}>{ride.title ?? 'Ride'}</Text>

        <View style={{ marginTop: space[5] }}>
          <RideTrace track={ride.track} />
        </View>

        <View style={{ marginTop: space[5] }}>
          <RideFacts ride={ride} />
        </View>

        <View style={{ marginTop: space[6] }}>
          <PhotoStrip rideId={ride.id} />
        </View>

        <View style={{ marginTop: space[6] }}>
          <JournalNote rideId={ride.id} note={ride.note} />
        </View>

        <Pressable
          onPress={handleDelete}
          disabled={deleting}
          style={{ marginTop: space[7], minHeight: register.return.touchTarget, justifyContent: 'center' }}
        >
          <Text style={[type.departure.label, { color: color.ink.tertiary }]}>
            {deleting ? 'Deleting…' : 'Delete this ride'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
