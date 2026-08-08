import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, type TextStyle, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';

import { BASE_URL } from '@/core/config';
import { searchPlaces, type Place, type SearchError } from '@/core/geocode';
import { routeErrorText } from '@/core/route';
import { color, radius, register, space, type } from '@/design/tokens';
import { useRide } from '@/state/useRide';

// Mirrors backend/internal/hub/hub.go's codeAlphabet exactly — excludes O/0/I/1
// (CLAUDE.md).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function filterCode(text: string): string {
  return text
    .toUpperCase()
    .split('')
    .filter((c) => CODE_ALPHABET.includes(c))
    .join('')
    .slice(0, 6);
}

// "Large/tabular/spaced" numeric display, reused for both the confirmed ride code
// and the join-code input — tokens.ts has no dedicated code-display style, so this
// is departure.display plus a manual letter-spacing/tabular-nums treatment.
const codeDisplayStyle: TextStyle = {
  ...type.departure.display,
  letterSpacing: 8,
  fontVariant: ['tabular-nums'],
  textAlign: 'center',
};

type PermissionStatus = 'granted' | 'denied' | 'undetermined';
type StartFlowState = 'idle' | 'posting' | 'confirm';
type JoinFlowState = 'idle' | 'connecting';
type SearchFlowState = 'idle' | 'searching' | 'setting-route';

/** A failed searchPlaces call is otherwise invisible — same inline-error treatment
 * as startError/joinError below, just mapped from geocode.ts's error union. */
function searchErrorText(error: SearchError): string {
  switch (error) {
    case 'unavailable':
    case 'upstream-failed':
      return 'Search unavailable.';
    case 'network':
      return "Couldn't reach the search service.";
    case 'bad-query':
      return "Couldn't search for that.";
  }
}

export default function DepartureScreen() {
  const router = useRouter();
  const status = useRide((s) => s.status);

  const [name, setName] = useState('');
  const [permission, setPermission] = useState<PermissionStatus>('undetermined');

  const [startState, setStartState] = useState<StartFlowState>('idle');
  const [startCode, setStartCode] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState('');
  const [joinState, setJoinState] = useState<JoinFlowState>('idle');
  const [joinError, setJoinError] = useState<string | null>(null);

  // The one-shot fix used both as the search bias (`near`) and as waypoint 1 of the
  // route below. Departure otherwise never touches GPS — only Motion watches position
  // — so this is deliberately a single getCurrentPositionAsync() call, not a
  // subscription: a search field has no business keeping location watched.
  const [originFix, setOriginFix] = useState<{ lat: number; lng: number } | null>(null);
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchFlowState>('idle');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  // The chosen result's label, once picked — its presence swaps the search UI for a
  // plain confirmation line (see the render below).
  const [picked, setPicked] = useState<string | null>(null);

  async function requestPermission() {
    try {
      const { status: result } = await Location.requestForegroundPermissionsAsync();
      setPermission(result === 'granted' ? 'granted' : 'denied');
    } catch {
      setPermission('denied');
    }
  }

  useEffect(() => {
    requestPermission();
  }, []);

  // Start flow: watch connection status once join() has been called for a
  // just-created ride code.
  useEffect(() => {
    if (startState !== 'confirm' || !startCode) return;
    if (status === 'rejected') {
      setStartError('Something went wrong connecting — try again.');
      useRide.getState().leave();
      setStartState('idle');
      setStartCode(null);
    }
  }, [status, startState, startCode]);

  // Start flow: if the backend is unreachable after POST /rides succeeded, connect()
  // just keeps looping connecting/reconnecting with backoff — no 'rejected' ever
  // arrives, so "Start Riding" would stay disabled forever with no explanation. Bail
  // after 10s if we still haven't reached 'open'. Deps deliberately exclude `status` —
  // this timer runs once per confirm attempt, not once per connecting/reconnecting
  // flicker, and checks the live status only when it fires.
  useEffect(() => {
    if (startState !== 'confirm' || !startCode) return;
    const timer = setTimeout(() => {
      if (useRide.getState().status === 'open') return; // connected in time
      setStartError("Couldn't reach the ride server.");
      useRide.getState().leave();
      setStartState('idle');
      setStartCode(null);
    }, 10000);
    return () => clearTimeout(timer);
  }, [startState, startCode]);

  // Join flow: watch connection status once join() has been called for a typed code.
  useEffect(() => {
    if (joinState !== 'connecting') return;
    if (status === 'open') {
      router.replace(`/ride/${joinCode}`);
    } else if (status === 'rejected') {
      setJoinError("That code wasn't found — check it and try again.");
      useRide.getState().leave();
      setJoinState('idle');
    }
  }, [status, joinState, joinCode, router]);

  // Join flow: same timeout guard as the start flow above — an unreachable backend
  // would otherwise leave the Join button stuck on "Connecting…" forever.
  useEffect(() => {
    if (joinState !== 'connecting') return;
    const timer = setTimeout(() => {
      if (useRide.getState().status === 'open') return;
      setJoinError("Couldn't reach the ride server.");
      useRide.getState().leave();
      setJoinState('idle');
    }, 10000);
    return () => clearTimeout(timer);
  }, [joinState]);

  // Fetch a one-shot fix the moment the confirm state is entered — a ride code exists
  // and the socket is open by then, which is what setDestination requires. Deps are
  // just [startState] so this fires once per confirm attempt, not on every keystroke
  // in the search field below.
  useEffect(() => {
    if (startState !== 'confirm') return;
    (async () => {
      try {
        const pos = await Location.getCurrentPositionAsync();
        setOriginFix({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch {
        // A permissions edge case must never crash the screen — handleSearch below
        // surfaces the missing fix instead.
      }
    })();
  }, [startState]);

  async function handleSearch() {
    setSearchError(null);
    setPlaces(null);
    const text = query.trim();
    if (!text) return; // nothing typed — silent no-op, not an error
    if (!originFix) {
      setSearchError('Need your location to plan a route.');
      return;
    }
    setSearchState('searching');
    const result = await searchPlaces(text, originFix);
    setSearchState('idle');
    if (!result.ok) {
      setSearchError(searchErrorText(result.error));
      return;
    }
    setPlaces(result.places);
  }

  // Sets the ride's one route via the store (which POSTs and records routeError —
  // not duplicated here); the route then reaches every rider over the WebSocket.
  // `picked` is set only after that await resolves WITHOUT a routeError — setting it
  // optimistically would show the rider a confirmed destination for a route that
  // never actually happened (no-route, quota, unreachable server), the same silent
  // failure DestinationMarker exists to avoid on the map side.
  async function handlePick(place: Place) {
    if (!originFix) return; // unreachable: handleSearch already required a fix
    setPlaces(null);
    setSearchError(null);
    setSearchState('setting-route');
    await useRide.getState().setDestination([
      [originFix.lat, originFix.lng],
      [place.lat, place.lng],
    ]);
    setSearchState('idle');
    const { routeError } = useRide.getState();
    if (routeError) {
      // unknown-ride is genuinely reachable here (unlike the long-press path in
      // ride/[code].tsx) — the room can GC between minting the code and picking a
      // destination — so routeErrorText's null case still needs a visible fallback.
      setSearchError(routeErrorText(routeError) ?? "Couldn't set that destination.");
      return; // picked stays unset — search UI stays up so the rider can retry
    }
    setPicked(place.label);
  }

  async function handleStart() {
    setStartError(null);
    setStartState('posting');
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/rides`, { method: 'POST' });
    } catch {
      setStartError('Could not start a ride. Check your connection.');
      setStartState('idle');
      return;
    }
    if (res.status !== 200) {
      setStartError('Could not start a ride. Try again.');
      setStartState('idle');
      return;
    }
    const data = (await res.json()) as { code: string };
    setStartCode(data.code);
    setStartState('confirm');
    useRide.getState().join(data.code, name.trim());
  }

  function handleStartRiding() {
    if (status === 'open' && startCode) {
      router.replace(`/ride/${startCode}`);
    }
  }

  function handleJoin() {
    setJoinError(null);
    setJoinState('connecting');
    useRide.getState().join(joinCode, name.trim());
  }

  const nameValid = name.trim().length > 0;
  const startEnabled = nameValid && startState === 'idle';
  const joinEnabled = nameValid && joinCode.length === 6 && joinState === 'idle';
  const startRidingEnabled = status === 'open';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface.base }} edges={['top', 'bottom', 'left', 'right']}>
      <View style={{ flex: 1, padding: register.departure.padding }}>
        <Text style={[type.departure.display, { color: color.ink.primary }]}>Horizon</Text>

        {permission === 'granted' && (
          <Text style={[type.departure.body, { color: color.signal.good, marginTop: space[4] }]}>
            Location ready.
          </Text>
        )}
        {permission === 'denied' && (
          <View style={{ marginTop: space[4] }}>
            <Text style={[type.departure.body, { color: color.ink.secondary }]}>
              Horizon uses your location to show you to your ride group. You can still start or join
              without it.
            </Text>
            <Pressable
              onPress={requestPermission}
              style={{ minHeight: register.departure.touchTarget, justifyContent: 'center' }}
            >
              <Text style={[type.departure.body, { color: color.amber.core }]}>Retry</Text>
            </Pressable>
          </View>
        )}

        <Text style={[type.departure.label, { color: color.ink.secondary, marginTop: space[6] }]}>
          Your name
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={color.ink.tertiary}
          autoCapitalize="words"
          style={[
            type.departure.body,
            {
              color: color.ink.primary,
              minHeight: register.departure.touchTarget,
              borderBottomWidth: 1,
              borderColor: color.surface.hairline,
              marginTop: space[2],
            },
          ]}
        />

        <Text style={[type.departure.title, { color: color.ink.primary, marginTop: space[7] }]}>
          Start a ride
        </Text>
        {startState !== 'confirm' ? (
          <>
            <Pressable
              disabled={!startEnabled}
              onPress={handleStart}
              style={{
                marginTop: space[4],
                minHeight: register.departure.touchTarget,
                borderRadius: radius.card,
                backgroundColor: startEnabled ? color.amber.core : color.ink.disabled,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={[type.departure.body, { color: startEnabled ? color.surface.void : color.ink.secondary }]}>
                {startState === 'posting' ? 'Starting…' : 'Start a ride'}
              </Text>
            </Pressable>
            {startError && (
              <Text style={[type.departure.body, { color: color.ink.primary, marginTop: space[2] }]}>
                {startError}
              </Text>
            )}
          </>
        ) : (
          <View style={{ marginTop: space[4] }}>
            <Text style={codeDisplayStyle}>{startCode}</Text>

            <Text style={[type.departure.title, { color: color.ink.primary, marginTop: space[7] }]}>
              Where to?
            </Text>
            {picked ? (
              <Text style={[type.departure.body, { color: color.ink.primary, marginTop: space[2] }]}>
                {picked}
              </Text>
            ) : (
              <>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search for a destination"
                  placeholderTextColor={color.ink.tertiary}
                  returnKeyType="search"
                  onSubmitEditing={handleSearch}
                  style={[
                    type.departure.body,
                    {
                      color: color.ink.primary,
                      minHeight: register.departure.touchTarget,
                      borderBottomWidth: 1,
                      borderColor: color.surface.hairline,
                      marginTop: space[2],
                    },
                  ]}
                />
                {searchState === 'searching' && (
                  <Text style={[type.departure.body, { color: color.ink.secondary, marginTop: space[2] }]}>
                    Searching…
                  </Text>
                )}
                {searchState === 'setting-route' && (
                  <Text style={[type.departure.body, { color: color.ink.secondary, marginTop: space[2] }]}>
                    Setting route…
                  </Text>
                )}
                {places?.length === 0 && (
                  <Text style={[type.departure.body, { color: color.ink.secondary, marginTop: space[2] }]}>
                    No results.
                  </Text>
                )}
                {places?.map((place, i) => (
                  <Pressable
                    key={`${place.lat},${place.lng},${i}`}
                    onPress={() => handlePick(place)}
                    style={{ minHeight: register.departure.touchTarget, justifyContent: 'center' }}
                  >
                    <Text style={[type.departure.body, { color: color.ink.primary }]}>{place.label}</Text>
                  </Pressable>
                ))}
                {searchError && (
                  <Text style={[type.departure.body, { color: color.ink.primary, marginTop: space[2] }]}>
                    {searchError}
                  </Text>
                )}
              </>
            )}

            <Pressable
              disabled={!startRidingEnabled}
              onPress={handleStartRiding}
              style={{
                marginTop: space[4],
                minHeight: register.departure.touchTarget,
                borderRadius: radius.card,
                backgroundColor: startRidingEnabled ? color.amber.core : color.ink.disabled,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={[
                  type.departure.body,
                  { color: startRidingEnabled ? color.surface.void : color.ink.secondary },
                ]}
              >
                Start Riding
              </Text>
            </Pressable>
            {startError && (
              <Text style={[type.departure.body, { color: color.ink.primary, marginTop: space[2] }]}>
                {startError}
              </Text>
            )}
          </View>
        )}

        <Text style={[type.departure.title, { color: color.ink.primary, marginTop: space[7] }]}>
          Join a ride
        </Text>
        <TextInput
          value={joinCode}
          onChangeText={(text) => setJoinCode(filterCode(text))}
          placeholder="CODE"
          placeholderTextColor={color.ink.tertiary}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          editable={joinState === 'idle'}
          style={[codeDisplayStyle, { color: color.ink.primary, marginTop: space[4] }]}
        />
        <Pressable
          disabled={!joinEnabled}
          onPress={handleJoin}
          style={{
            marginTop: space[4],
            minHeight: register.departure.touchTarget,
            borderRadius: radius.card,
            backgroundColor: joinEnabled ? color.amber.core : color.ink.disabled,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={[type.departure.body, { color: joinEnabled ? color.surface.void : color.ink.secondary }]}>
            {joinState === 'connecting' ? 'Connecting…' : 'Join'}
          </Text>
        </Pressable>
        {joinError && (
          <Text style={[type.departure.body, { color: color.ink.primary, marginTop: space[2] }]}>
            {joinError}
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}
