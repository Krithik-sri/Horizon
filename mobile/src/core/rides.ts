/**
 * Return register I/O: the durable ride record, written by the rider's own device
 * straight to Supabase (docs/ADR/ADR-018.md §1) — there is no server-side writer, and
 * there never will be one (ADR-008 forbids a DB driver in the Go server). Matches
 * supabase.ts's pattern of thin functions over the shared `supabase` client, same as
 * every other core/*.ts I/O module.
 *
 * Column <-> field mapping happens once, at rowToRide below — nothing above this
 * layer (state/useRide.ts, and whatever the Return screens turn out to be) should
 * ever see a snake_case column name.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { RouteData } from './models';
import { supabase } from './supabase';

/** The other agent building the Return screens builds against this exactly — do not
 * deviate without updating docs/ADR/ADR-018.md and telling them. */
export type Ride = {
  id: string;
  startedAt: string; // ISO 8601
  endedAt: string;
  distanceM: number;
  movingS: number;
  maxSpeedMps: number; // highest single-fix speed seen — a fact about this ride only (ADR-019 §2)
  track: [number, number][] | null; // [lng, lat] — GeoJSON order, like route.polyline
  route: RouteData | null;
  companions: { id: string; name: string }[];
  title: string | null;
  note: string | null;
  joinCode: string | null;
};

// The shape public.rides actually stores (0001_return.sql) — snake_case, plus the
// user_id this module never surfaces above rowToRide.
type RideRow = {
  id: string;
  join_code: string | null;
  started_at: string;
  ended_at: string;
  distance_m: number;
  moving_s: number;
  max_speed_mps: number;
  track: [number, number][] | null;
  route: RouteData | null;
  companions: { id: string; name: string }[];
  title: string | null;
  note: string | null;
};

function rowToRide(row: RideRow): Ride {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    distanceM: row.distance_m,
    movingS: row.moving_s,
    maxSpeedMps: row.max_speed_mps,
    track: row.track,
    route: row.route,
    companions: row.companions,
    title: row.title,
    note: row.note,
    joinCode: row.join_code,
  };
}

// Mirrors getAccessToken()'s use of getSession() (supabase.ts) rather than getUser():
// a cached-session read, not a network round trip, and auto-refreshes an expired
// token first. user_id is taken from here, never from a caller-supplied parameter —
// that's what makes it impossible for a caller to write another user's row; RLS
// (0001_return.sql) enforces the same thing server-side, this just avoids a doomed
// round trip when there's no session at all.
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Inserts a finished ride under the current session's user. Null on any failure
 * (no session, RLS rejection, network) — callers already have to handle "the ride
 * didn't save" via the pending-row guard below, so this doesn't need its own error
 * union on top of that. */
export async function saveRide(r: Omit<Ride, 'id'>): Promise<Ride | null> {
  const userId = await currentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from('rides')
    .insert({
      user_id: userId,
      join_code: r.joinCode,
      started_at: r.startedAt,
      ended_at: r.endedAt,
      distance_m: r.distanceM,
      moving_s: r.movingS,
      max_speed_mps: r.maxSpeedMps,
      track: r.track,
      route: r.route,
      companions: r.companions,
      title: r.title,
      note: r.note,
    })
    .select()
    .single();

  if (error || !data) return null;
  return rowToRide(data as RideRow);
}

/**
 * Rows for the archive list, newest ride first — and that is *all* this exposes.
 *
 * ADR-019 §4 is explicit: `core/rides.ts` exposes no cross-ride aggregate query.
 * No `getStats()`, no totals, no "longest ride" — ADR-019 §1's whole test is "does
 * this number require a second ride to compute?", and every one of those numbers
 * does. Don't add one here; read the ADR first.
 */
export async function listRides(): Promise<Ride[]> {
  const { data, error } = await supabase
    .from('rides')
    .select('*')
    .order('started_at', { ascending: false });
  if (error || !data) return [];
  return (data as RideRow[]).map(rowToRide);
}

export async function getRide(id: string): Promise<Ride | null> {
  const { data, error } = await supabase.from('rides').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return rowToRide(data as RideRow);
}

/** The only mutable fields post-save — everything else about a ride is a fact fixed
 * at the moment it ended. */
export async function updateRide(id: string, patch: Partial<Pick<Ride, 'title' | 'note'>>): Promise<boolean> {
  const update: { title?: string | null; note?: string | null } = {};
  if ('title' in patch) update.title = patch.title;
  if ('note' in patch) update.note = patch.note;
  if (Object.keys(update).length === 0) return true;

  const { error } = await supabase.from('rides').update(update).eq('id', id);
  return !error;
}

/**
 * Deletes a ride. Storage objects go first, then the row (ADR-018's Negative
 * consequences) — a kill between the two leaves an orphaned Storage object, not an
 * orphaned DB row: an object with nothing pointing at it is invisible and merely
 * costs bytes against the free tier, while the reverse order could leave a photo row
 * referencing an object that's already gone. `ride_photos` rows themselves don't need
 * deleting here — they cascade with the `rides` row (`on delete cascade`,
 * 0001_return.sql).
 */
export async function deleteRide(id: string): Promise<boolean> {
  const { data: photos } = await supabase.from('ride_photos').select('path').eq('ride_id', id);
  if (photos && photos.length > 0) {
    await supabase.storage.from('ride-photos').remove(photos.map((p: { path: string }) => p.path));
  }

  const { error } = await supabase.from('rides').delete().eq('id', id);
  return !error;
}

// --- the pending-row guard (ADR-018 §3) -------------------------------------------
//
// Not optional: the app being killed mid-ride (crash, flat battery, no signal at the
// roadside) must not lose the ride. A pending row is written to AsyncStorage at ride
// start and kept current as the ride progresses (state/useRide.ts calls
// savePendingRide on every decimated track point — see its comment for why that
// cadence, not every GPS fix), so whatever's on disk is always a promotable snapshot
// of the ride so far. Writing on *start* rather than only on *end* is the whole
// point: the failure this guards against is the one where "end ride" never runs at
// all, not a crash in the few hundred milliseconds around the final insert.
//
// No queue library, no retry framework — this is the current best snapshot,
// overwritten in place, promoted by the next launch if nobody got around to it.

const PENDING_KEY = 'horizon.pendingRide';

export async function savePendingRide(ride: Omit<Ride, 'id'>): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(ride));
}

export async function clearPendingRide(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_KEY);
}

/** Promotes an orphaned pending ride (previous launch died before clearing it) to
 * Supabase. Call once at app start, after a session exists. A ride that ended
 * cleanly leaves nothing here — this is then a no-op read. */
export async function flushPendingRide(): Promise<void> {
  const raw = await AsyncStorage.getItem(PENDING_KEY);
  if (!raw) return;
  const saved = await saveRide(JSON.parse(raw) as Omit<Ride, 'id'>);
  if (saved) await clearPendingRide();
}
