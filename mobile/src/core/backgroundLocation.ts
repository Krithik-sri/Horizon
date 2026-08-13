import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { color } from '@/design/tokens';
import { loadRideCode, loadRiderName } from '@/core/riderName';
import { useRide } from '@/state/useRide';

/** Task name, shared between the definition below and start/stop. */
export const LOCATION_TASK = 'horizon.location';

// ADR-021 §3: `defineTask` MUST run at module scope — not inside a hook, not inside a
// component, not inside any function only called once a screen mounts. Android can
// spin the JS bundle back up headlessly, with no React tree at all, purely to hand a
// batched location update to a registered task; TaskManager only knows about a task
// that was already `defineTask`d by the time that happens. This is the single easiest
// thing to get wrong here, because it works perfectly in every manual test — the app
// is always already open when a human is testing it — right up until the one time it
// matters, a headless restart days into a real ride. `app/_layout.tsx` imports this
// file for its side effect for exactly the same reason; see the comment there.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error) return; // nothing actionable — the OS already logged its own reason

  const locations = data?.locations;
  if (!locations || locations.length === 0) return;

  // Android batches multiple fixes into one delivery; only the most recent one is a
  // current position worth sending — ADR-021 §4 explicitly rejects trying to replay
  // or backfill the rest (that's a store-and-forward buffer the ADR turns down).
  const fix = locations[locations.length - 1];

  // useRide's module-scope `handle`/`code` normally survive backgrounding (the
  // foreground service keeps the process alive), so this is usually the same store
  // the UI was already using. `code === null` is the tell for the other case (ADR-021
  // §4): a headless restart, where the OS killed the process and woke it purely to
  // deliver this fix, so there's no React tree and no live join() to lean on.
  if (useRide.getState().code === null) {
    const [code, name] = await Promise.all([loadRideCode(), loadRiderName()]);
    if (!code || !name) {
      // Nothing to rejoin. One of the two stop paths ADR-021 §6 requires: a
      // foreground-service notification with no ride behind it is the worst bug this
      // feature can ship, a battery drain and a privacy alarm at once, with no
      // "unmount" ever coming to clean it up because there's no screen mounted at all.
      await stopBackgroundLocation();
      return;
    }
    await useRide.getState().join(code, name);
  }

  // The same store action the UI's own effect calls (ADR-021 §2) — no bridge, no
  // queue, no separate background-only path. sendLoc already throttles to ~1Hz, sets
  // ownFix, and folds the fix into the ADR-018 track accumulator, so a backgrounded
  // ride still records its distance and track.
  useRide.getState().sendLoc({
    lat: fix.coords.latitude,
    lng: fix.coords.longitude,
    heading: fix.coords.heading ?? 0,
    speed: fix.coords.speed ?? 0,
  });
});

/**
 * Starts the one GPS subscription a ride uses, in both foreground and background
 * (ADR-021 §1) — this replaces `watchPositionAsync` entirely rather than running
 * alongside it.
 *
 * Takes no ride code on purpose. The task above reaches the ride through the store,
 * exactly as the UI does, and `join()` is what persists the code for the headless
 * restart path — so a `code` parameter here would be read by nothing. Passing one to
 * make the call site read nicely would be a parameter a future reader reasonably
 * assumes is load-bearing.
 */
export async function startBackgroundLocation(): Promise<void> {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    // Same values ride/[code].tsx's old watchPositionAsync call used — this task is a
    // direct replacement, not a battery-motivated change to fix cadence.
    accuracy: Location.Accuracy.High,
    // ~1 Hz, the rate CLAUDE.md's protocol section specifies for `loc`.
    timeInterval: 1000,
    // 0, NOT 5 — and this one is worth the paragraph, because 5 looks like a harmless
    // battery optimisation and is actually a guarantee that a stationary rider never
    // gets a position at all.
    //
    // distanceInterval is a *displacement filter*: Android delivers nothing until the
    // device has moved that far. A rider always starts stationary — at a petrol pump, on
    // a driveway, at the kerb — so with 5 here, Motion shows an empty map and no speed
    // until the bike physically moves five metres, and there is no way to tell that from
    // a broken GPS. Worse mid-ride: a rider stopped at a light stops reporting, so the
    // hub's ageSec climbs and the rest of the convoy watches them grey out and vanish
    // while they are sitting right there — the exact opposite of what a convoy display
    // is for, and it contradicts pausesUpdatesAutomatically: false immediately below,
    // which is set to prevent precisely that.
    //
    // Diagnosed on a device, from the system's own log: `FusedLocation: location
    // delivery blocked - too close`. Nothing throws, nothing warns, no fix ever arrives.
    // Time-based delivery alone already gives the ~1 Hz the protocol asks for.
    distanceInterval: 0,
    // iOS: don't let the OS pause updates on its own judgement of "unlikely to move" —
    // a stopped rider at a light is exactly a moment the convoy still needs a fix for.
    pausesUpdatesAutomatically: false,
    // iOS: the status-bar indicator that location is in active use — the platform's
    // own privacy affordance, not a Horizon addition.
    showsBackgroundLocationIndicator: true,
    // Deliberately NO deferredUpdatesInterval/-Distance/-Timeout: ADR-021 rejects
    // batched delivery outright (see its "Alternatives Considered"). A convoy needs
    // live positions — a fix that arrives 30s late would be presented as current, and
    // `ageSec` exists precisely so stale data is never shown as live. Don't add batching
    // here to save battery without re-reading that section first.
    foregroundService: {
      // ADR-021 §5: Android will not run this as a foreground service without a
      // notification, and that notification is not the kind CLAUDE.md's Do/Don't bans
      // ("no notification, badge, count, or ranking") — it's an OS-mandated service
      // indicator with no badge, no count, no action, generated by the platform rather
      // than by Horizon deciding the rider should be told something. It also does real
      // work: it's the privacy affordance that says location is currently in use.
      notificationTitle: 'Horizon',
      notificationBody: 'Sharing your position with your ride.',
      notificationColor: color.amber.core,
    },
  });
}

/**
 * Stops the task. Safe to call unconditionally — checks
 * `hasStartedLocationUpdatesAsync` first, since `stopLocationUpdatesAsync` throws if
 * the task was never started (e.g. permission was denied, or this is the task's own
 * self-stop path finding nothing to rejoin, above).
 */
export async function stopBackgroundLocation(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}
