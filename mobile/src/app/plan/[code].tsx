import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';

import type { Place } from '@/core/geocode';
import { formatDistanceKm, formatDuration } from '@/core/format';
import type { LngLat, RouteData } from '@/core/models';
import { fetchRoute, type FetchRouteError, type Waypoint } from '@/core/route';
import { routeErrorText, viaLabel } from '@/core/route.pure';
import { color, radius, register, space, type } from '@/design/tokens';
import DestinationSearch from '@/features/departure/DestinationSearch';
import PlannerMap from '@/features/departure/PlannerMap';
import { useRide } from '@/state/useRide';

// The backend caps a route request at 10 waypoints including the origin — one rider
// stop budget short of that so the rider never sees a raw 400.
const MAX_STOPS = 9;
const PREVIEW_DEBOUNCE_MS = 600;

// How long to wait for a first GPS fix before telling the rider it isn't coming. Long
// enough for a genuine cold start on a phone that has been indoors, short enough that
// nobody stands at a petrol pump wondering whether the screen is broken.
const ORIGIN_TIMEOUT_MS = 12_000;

// "1 h 12 · 58 km · via NH 44" — no "FASTEST"/"BEST" chip and no rider count: a
// superlative label or a ranking is exactly what CLAUDE.md's no-gamification rule
// forbids, even applied to routes instead of riders.
function routeSummaryText(route: RouteData): string {
  const via = viaLabel(route);
  if (!route.summary) return via ?? 'Route';
  // Whole km here, per ADR-013's worked example — this line exists to be compared
  // against two others at a glance, and a tenth of a km isn't a difference anyone
  // picks a road on.
  const base = `${formatDuration(route.summary.duration)} · ${formatDistanceKm(route.summary.distance, 0)}`;
  return via ? `${base} · ${via}` : base;
}

export default function PlannerScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();

  // A planner with no socket cannot commit — bail to Departure rather than showing
  // a screen that can only ever fail (mirrors ride/[code].tsx's own dead-code bail,
  // just without a rejoin: Departure is what starts a connection in the first place).
  useEffect(() => {
    if (useRide.getState().code !== code) router.replace('/');
  }, [code, router]);

  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  // Null while still trying; a string once we've given up and owe the rider a reason.
  const [originError, setOriginError] = useState<string | null>(null);
  const [stops, setStops] = useState<Place[]>([]);
  const [previewRoutes, setPreviewRoutes] = useState<RouteData[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<FetchRouteError | null>(null);
  const [committing, setCommitting] = useState(false);

  // Acquiring the origin is deliberately bounded, and the reason is worth spelling out:
  // Location.getCurrentPositionAsync() has no timeout option and waits **indefinitely**
  // for a fresh fix. It does not throw, so a try/catch around it catches nothing — the
  // screen simply sits on "Finding your location…" forever, with no error and no way
  // out. That is not only an emulator quirk (an emulator with no location pushed to it
  // never produces a fix at all): a rider in a basement car park, a covered petrol
  // station, or with a cold GPS under heavy tree cover hits exactly the same wall.
  //
  // So: last-known first, which the OS answers instantly when it has anything cached and
  // is more than good enough to plan a route *from*; then a bounded attempt at a fresh
  // fix; then an honest failure with a Retry, rather than a spinner that never resolves.
  const acquireOrigin = useCallback(async () => {
    setOriginError(null);

    // Non-prompting: Departure already asked (ADR-021 §8), and re-prompting here would
    // be a second permission dialog for something the rider already answered.
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      setOriginError('Horizon needs location permission to plan a route from where you are.');
      return;
    }

    const last = await Location.getLastKnownPositionAsync();
    if (last) {
      setOrigin({ lat: last.coords.latitude, lng: last.coords.longitude });
      return;
    }

    // Promise.race, not an option — see above, there is no timeout parameter to pass.
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ORIGIN_TIMEOUT_MS)),
    ]);
    if (fresh) {
      setOrigin({ lat: fresh.coords.latitude, lng: fresh.coords.longitude });
      return;
    }
    setOriginError("Couldn't get a location fix. Move somewhere with a clearer view of the sky, then retry.");
  }, []);

  useEffect(() => {
    acquireOrigin();
  }, [acquireOrigin]);

  // The waypoint array (≤10 elements — MAX_STOPS plus the origin) last successfully
  // previewed, as its own JSON string. That size is small enough that JSON.stringify
  // is the right lazy answer for "did anything actually change" — no real deep-equal
  // needed.
  const lastPreviewedRef = useRef<string | null>(null);

  useEffect(() => {
    if (stops.length === 0 || !origin) {
      // Nothing to preview — and nothing stale should stay drawn either (a route line
      // for a destination the rider just removed is exactly the untrustworthy
      // information PRODUCT.md's Confidence pillar forbids).
      setPreviewRoutes([]);
      setSelectedIndex(0);
      lastPreviewedRef.current = null;
      return;
    }

    const waypoints: Waypoint[] = [[origin.lat, origin.lng], ...stops.map((s): Waypoint => [s.lat, s.lng])];
    const key = JSON.stringify(waypoints);
    if (key === lastPreviewedRef.current) return; // settled already — no-op edit (e.g. an undo)

    const timer = setTimeout(async () => {
      setError(null);
      const result = await fetchRoute(code, waypoints, {
        preview: true,
        alternatives: waypoints.length === 2, // exactly one stop — ADR-013 §3
      });
      if (result.ok) {
        lastPreviewedRef.current = key;
        setPreviewRoutes(result.routes);
        setSelectedIndex(result.selected);
      } else {
        setError(result.error);
      }
    }, PREVIEW_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [stops, origin, code]);

  function addStop(place: Place) {
    setStops((prev) => (prev.length >= MAX_STOPS ? prev : [...prev, place]));
  }

  function handleMapPress(coord: LngLat) {
    // MapLibre gives [lng, lat] — swap at the boundary. No reverse geocode
    // (ADR-013 "Alternatives Considered"): it would spend a geocode call on a label
    // for a place the rider just tapped and already knows.
    addStop({ label: 'Point on map', lat: coord[1], lng: coord[0] });
  }

  function moveStop(index: number, direction: -1 | 1) {
    setStops((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeStop(index: number) {
    setStops((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCommit() {
    if (!origin || stops.length === 0) return;
    setError(null);
    setCommitting(true);
    const waypoints: Waypoint[] = [[origin.lat, origin.lng], ...stops.map((s): Waypoint => [s.lat, s.lng])];
    await useRide.getState().setDestination(waypoints, selectedIndex);
    setCommitting(false);
    const { routeError } = useRide.getState();
    if (routeError) {
      // unknown-ride is genuinely reachable here: the 5-minute room GC doesn't wait
      // for an open socket to close first, so a long-backgrounded planner can 404 on
      // commit (ADR-013, Consequences) — routeErrorText's null case still needs a
      // visible fallback, same as DestinationSearch used to carry.
      setError(routeError);
      return;
    }
    router.back();
  }

  const stopLngLats: LngLat[] = origin
    ? [[origin.lng, origin.lat], ...stops.map((s): LngLat => [s.lng, s.lat])]
    : [];
  const previewPolyline = previewRoutes[selectedIndex]?.polyline ?? [];
  const canCommit = origin !== null && stops.length > 0 && !committing;

  return (
    <View style={{ flex: 1, backgroundColor: color.surface.base }}>
      <PlannerMap stops={stopLngLats} polyline={previewPolyline} onPress={handleMapPress} />

      <SafeAreaView
        edges={['bottom']}
        style={{
          maxHeight: '55%',
          backgroundColor: color.surface.raised,
          borderTopLeftRadius: radius.sheet,
          borderTopRightRadius: radius.sheet,
        }}
      >
        <ScrollView contentContainerStyle={{ padding: space[5] }} keyboardShouldPersistTaps="handled">
          <Text style={[type.departure.title, { color: color.ink.primary }]}>Plan your route</Text>

          <Text style={[type.departure.body, { color: color.ink.secondary, marginTop: space[3] }]}>
            {origin ? 'Your location' : originError ? 'Your location — unavailable' : 'Finding your location…'}
          </Text>

          {/* Only reachable once acquireOrigin has actually given up, so this never
              competes with the "Finding…" state above. Retry rather than a dead end:
              stepping outside, or pushing a fix to an emulator, is usually all it takes. */}
          {originError !== null && (
            <View style={{ marginTop: space[2] }}>
              <Text style={[type.departure.body, { color: color.ink.primary }]}>{originError}</Text>
              <Pressable
                onPress={acquireOrigin}
                style={{ minHeight: register.departure.touchTarget, justifyContent: 'center' }}
              >
                <Text style={[type.departure.body, { color: color.amber.core }]}>Retry</Text>
              </Pressable>
            </View>
          )}

          {stops.map((stop, i) => (
            <View
              key={`${stop.lat},${stop.lng},${i}`}
              style={{ flexDirection: 'row', alignItems: 'center', marginTop: space[2] }}
            >
              <Text style={[type.departure.body, { color: color.ink.primary, flex: 1 }]} numberOfLines={1}>
                {i + 1}. {stop.label}
              </Text>
              <Pressable
                disabled={i === 0}
                onPress={() => moveStop(i, -1)}
                style={{
                  minWidth: register.departure.touchTarget,
                  minHeight: register.departure.touchTarget,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={[type.departure.body, { color: i === 0 ? color.ink.disabled : color.amber.core }]}>↑</Text>
              </Pressable>
              <Pressable
                disabled={i === stops.length - 1}
                onPress={() => moveStop(i, 1)}
                style={{
                  minWidth: register.departure.touchTarget,
                  minHeight: register.departure.touchTarget,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={[
                    type.departure.body,
                    { color: i === stops.length - 1 ? color.ink.disabled : color.amber.core },
                  ]}
                >
                  ↓
                </Text>
              </Pressable>
              <Pressable
                onPress={() => removeStop(i)}
                style={{
                  minWidth: register.departure.touchTarget,
                  minHeight: register.departure.touchTarget,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={[type.departure.body, { color: color.signal.critical }]}>×</Text>
              </Pressable>
            </View>
          ))}

          {stops.length < MAX_STOPS ? (
            <DestinationSearch near={origin} onPick={addStop} />
          ) : (
            <Text style={[type.departure.body, { color: color.ink.secondary, marginTop: space[4] }]}>
              Maximum {MAX_STOPS} stops.
            </Text>
          )}

          {/* A single route is not a choice — nothing renders unless there's an
              actual pick to make (CLAUDE.md: no ranking, no superlative label). */}
          {previewRoutes.length > 1 && (
            <View style={{ marginTop: space[4] }}>
              {previewRoutes.map((route, i) => (
                <Pressable
                  key={i}
                  onPress={() => setSelectedIndex(i)}
                  style={{ minHeight: register.departure.touchTarget, justifyContent: 'center' }}
                >
                  <Text
                    style={[
                      type.departure.body,
                      { color: i === selectedIndex ? color.amber.core : color.ink.primary },
                    ]}
                  >
                    {routeSummaryText(route)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {error && (
            <Text style={[type.departure.body, { color: color.ink.primary, marginTop: space[2] }]}>
              {routeErrorText(error) ?? "Couldn't set that destination."}
            </Text>
          )}

          <Pressable
            disabled={!canCommit}
            onPress={handleCommit}
            style={{
              marginTop: space[4],
              minHeight: register.departure.touchTarget,
              borderRadius: radius.card,
              backgroundColor: canCommit ? color.amber.core : color.ink.disabled,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={[type.departure.body, { color: canCommit ? color.surface.void : color.ink.secondary }]}>
              {committing ? 'Setting…' : 'Set destination'}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
