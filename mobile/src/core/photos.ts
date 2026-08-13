/**
 * Ride photos: upload to the private `ride-photos` Storage bucket, record metadata in
 * public.ride_photos, read back via short-lived signed URLs — a private bucket has no
 * public URL to hand out (0001_return.sql's RLS comment). Same rider-writes-their-own-
 * row model as rides.ts (docs/ADR/ADR-018.md §1).
 */
import { File } from 'expo-file-system';

import { supabase } from './supabase';

export type RidePhoto = {
  id: string;
  path: string;
  caption: string | null;
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
};

const BUCKET = 'ride-photos';

// 10 minutes: long enough to load a screenful of thumbnails, short enough that a
// leaked URL (a screenshot, a shared link) doesn't stay live.
const SIGNED_URL_TTL_S = 10 * 60;

// Same pattern as rides.ts's currentUserId — see that file's comment for why
// getSession() over getUser().
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

// No uuid package installed, and this isn't worth adding one for (CLAUDE.md: no new
// dependencies without a real need) — Date.now() plus a random suffix is unique
// enough for one device uploading one photo at a time, which is all a storage path
// ever needs here.
function uniqueId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Uploads a photo for a finished ride. Path is `<uid>/<rideId>/<uuid>.jpg` — the
 * first segment is what the Storage RLS policy checks ownership against, so this
 * format is load-bearing, not cosmetic. Reads bytes via SDK 56's `File` class
 * (`expo-file-system`), which returns a Uint8Array `.upload()` accepts directly — no
 * base64 round trip, no `base64-arraybuffer` dependency.
 */
export async function uploadPhoto(rideId: string, uri: string, caption?: string): Promise<RidePhoto | null> {
  const userId = await currentUserId();
  if (!userId) return null;

  const path = `${userId}/${rideId}/${uniqueId()}.jpg`;
  const bytes = await new File(uri).bytes();

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: 'image/jpeg',
  });
  if (uploadError) return null;

  const { data, error } = await supabase
    .from('ride_photos')
    .insert({ ride_id: rideId, user_id: userId, path, caption: caption ?? null })
    .select()
    .single();
  if (error || !data) {
    // Don't leave an orphaned object behind if the metadata row failed to insert —
    // the inverse of deleteRide's ordering in rides.ts, for the same reason: keep
    // Storage and the table from disagreeing about what exists.
    await supabase.storage.from(BUCKET).remove([path]);
    return null;
  }

  return {
    id: data.id,
    path: data.path,
    caption: data.caption,
    takenAt: data.taken_at,
    lat: data.lat,
    lng: data.lng,
  };
}

// The row shape public.ride_photos actually stores (0001_return.sql) — snake_case,
// mirrors rides.ts's own RideRow/rowToRide split for the same reason.
type PhotoRow = {
  id: string;
  path: string;
  caption: string | null;
  taken_at: string | null;
  lat: number | null;
  lng: number | null;
};

function rowToPhoto(row: PhotoRow): RidePhoto {
  return { id: row.id, path: row.path, caption: row.caption, takenAt: row.taken_at, lat: row.lat, lng: row.lng };
}

/** A ride's photos, oldest first (the order they were taken during the ride). Empty
 * array on any failure (RLS rejection, network) — same "caller doesn't need its own
 * error union" reasoning as saveRide in rides.ts. */
export async function listRidePhotos(rideId: string): Promise<RidePhoto[]> {
  const { data, error } = await supabase
    .from('ride_photos')
    .select('id, path, caption, taken_at, lat, lng')
    .eq('ride_id', rideId)
    .order('taken_at', { ascending: true });
  if (error || !data) return [];
  return (data as PhotoRow[]).map(rowToPhoto);
}

/** Signed URLs for a private bucket's objects, keyed by path. A path with no entry
 * in the result means it couldn't be signed (deleted object, expired session, etc.)
 * — callers should treat a missing key as "don't render this photo", not throw. */
export async function signedPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_S);
  if (error || !data) return {};

  const urls: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl && !item.error) urls[item.path] = item.signedUrl;
  }
  return urls;
}
