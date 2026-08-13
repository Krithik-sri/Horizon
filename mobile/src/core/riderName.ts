import AsyncStorage from '@react-native-async-storage/async-storage';

const NAME_KEY = 'horizon.riderName';

/**
 * saveRiderName / loadRiderName — the display name this device last rode under.
 *
 * Why it's persisted: ride/[code].tsx can be reached without Departure ever calling
 * join() — a deep link (horizon://ride/ABC123), a Fast Refresh remount, or Android
 * killing the backgrounded app all skip it. The ride code comes from the route param
 * in that case, but the name has nowhere else to come from, and rejoining without one
 * would relabel the rider mid-ride on everyone else's map.
 *
 * Deliberately *not* cleared on leave(). The name alone can't cause a stray rejoin —
 * that only happens when a real /ride/{code} route is mounted, and the code always
 * comes from the route, never from here. Clearing it would also race: join() calls
 * leave() before writing, so a fire-and-forget clear could land after the save and
 * wipe it.
 *
 * Split out of riderId.ts (ADR-016 §3): the rider id is gone — it's the JWT `sub`
 * now (core/supabase.ts) — but the display name is an unrelated per-ride cosmetic
 * value with no reason to move to Supabase (ADR-016 §"Store the display name in
 * user_metadata").
 */
export async function saveRiderName(name: string): Promise<void> {
  await AsyncStorage.setItem(NAME_KEY, name);
}

export async function loadRiderName(): Promise<string | null> {
  return AsyncStorage.getItem(NAME_KEY);
}

const RIDE_CODE_KEY = 'horizon.rideCode';

/**
 * saveRideCode / loadRideCode / clearRideCode — the ride this device last joined.
 *
 * Why it's persisted (ADR-021 §4): the location task can run headlessly, in a JS
 * context the OS spun up with no React tree at all, purely to deliver a batched fix.
 * There's no route param to read the code from in that world — `ride/[code].tsx` never
 * mounted — so the task rejoins from here instead, the same way it reads the rider
 * name above.
 *
 * Unlike the name, this IS cleared on leave() (ADR-021 §6): a stale code left behind
 * would have a headless restart days later rejoin a long since GC'd room, get
 * `rejected`, and burn battery retrying forever. See useRide.ts's join()/leave() for
 * how the clear-then-save ordering trap below is handled — the same one this file's
 * saveRiderName doc comment already called out for the rider name.
 */
export async function saveRideCode(code: string): Promise<void> {
  await AsyncStorage.setItem(RIDE_CODE_KEY, code);
}

export async function loadRideCode(): Promise<string | null> {
  return AsyncStorage.getItem(RIDE_CODE_KEY);
}

export async function clearRideCode(): Promise<void> {
  await AsyncStorage.removeItem(RIDE_CODE_KEY);
}
