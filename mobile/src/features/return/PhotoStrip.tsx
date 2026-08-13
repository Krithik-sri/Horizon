import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';

import { listRidePhotos, signedPhotoUrls, uploadPhoto, type RidePhoto } from '@/core/photos';
import { color, radius, register, space, type } from '@/design/tokens';

type PhotoStripProps = {
  rideId: string;
};

const THUMB_SIZE = 120;

// expo-image-picker's own JPEG re-encode, not a resize — no expo-image-manipulator
// dependency for it (CLAUDE.md: add a dependency on first real need, and a few lines
// here cover it). ADR-018's Consequences names photos, not tracks, as what will
// actually fill the 1 GB Storage free tier, so this isn't optional.
const UPLOAD_QUALITY = 0.5;

/**
 * Horizontal photo row for one ride, via core/photos.ts's listRidePhotos/uploadPhoto —
 * like every other feature component, this one goes through the core layer rather
 * than importing `supabase` directly.
 *
 * ponytail: library picks only, no camera — a rider adding a photo to a *finished*
 * ride is almost always reaching for one they already took while riding, since they
 * weren't looking at this screen mid-ride. Add launchCameraAsync behind a menu if
 * that assumption turns out wrong.
 */
export default function PhotoStrip({ rideId }: PhotoStripProps) {
  const [photos, setPhotos] = useState<RidePhoto[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);

  async function refresh() {
    const rows = await listRidePhotos(rideId);
    setPhotos(rows);
    const signed = await signedPhotoUrls(rows.map((p) => p.path));
    setUrls(signed);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await listRidePhotos(rideId);
      if (cancelled) return;

      setPhotos(rows);
      const signed = await signedPhotoUrls(rows.map((p) => p.path));
      if (!cancelled) setUrls(signed);
    })();
    return () => {
      cancelled = true;
    };
  }, [rideId]);

  async function handleAddPhoto() {
    // Requested here, at the point of use, not on mount — a rider who never taps
    // "Add a photo" is never asked. Denial degrades quietly below: no Alert, no
    // retry loop, the affordance just doesn't do anything.
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: UPLOAD_QUALITY,
    });
    if (result.canceled) return;

    setUploadError(false);
    setUploading(true);
    const uploaded = await uploadPhoto(rideId, result.assets[0].uri);
    setUploading(false);
    if (!uploaded) {
      setUploadError(true);
      return;
    }
    await refresh();
  }

  return (
    <View>
      <Pressable
        onPress={handleAddPhoto}
        disabled={uploading}
        style={{ minHeight: register.return.touchTarget, justifyContent: 'center' }}
      >
        <Text style={[type.departure.body, { color: color.amber.core }]}>
          {uploading ? 'Adding…' : 'Add a photo'}
        </Text>
      </Pressable>

      {uploadError && (
        <Text style={[type.departure.label, { color: color.ink.tertiary }]}>Couldn't add that photo — try again.</Text>
      )}

      {photos && photos.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space[2], marginTop: space[3] }}
        >
          {photos.map(
            (photo) =>
              urls[photo.path] && (
                <Image
                  key={photo.id}
                  source={{ uri: urls[photo.path] }}
                  style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: radius.card }}
                  contentFit="cover"
                />
              ),
          )}
        </ScrollView>
      )}
    </View>
  );
}
