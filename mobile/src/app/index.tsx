import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, type TextStyle, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';

import { api } from '@/core/api';
import { loadVoiceEnabled, saveVoiceEnabled } from '@/core/prefs';
import { ensureSession } from '@/core/supabase';
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
type JoinFlowState = 'idle' | 'connecting' | 'connected';

export default function DepartureScreen() {
  const router = useRouter();
  const status = useRide((s) => s.status);

  const [name, setName] = useState('');
  const [permission, setPermission] = useState<PermissionStatus>('undetermined');

  // ADR-016: _layout.tsx already ran ensureSession() once behind the splash screen —
  // this re-checks it here so a first-ever-launch failure (no network, per ADR-016's
  // "Negative" consequences) surfaces as a real message instead of a Start button that
  // silently does nothing. ensureSession() is cheap to call again: a cached session
  // resolves with no network call at all.
  // Holds the *reason*, not a flag — see ensureSession's doc comment. A project with
  // anonymous sign-ins still switched off and a phone with no signal fail identically
  // from here, and only one of them is fixed by anything the rider can do.
  const [sessionError, setSessionError] = useState<string | null>(null);
  useEffect(() => {
    ensureSession().then((r) => setSessionError(r.ok ? null : r.reason));
  }, []);
  function retrySession() {
    ensureSession().then((r) => setSessionError(r.ok ? null : r.reason));
  }

  // ADR-015 §5: on by default, and the toggle lives here — Departure — only, never
  // in Motion. Default true matches loadVoiceEnabled's own default, so there's no
  // flash-of-off before the AsyncStorage read resolves.
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  const [startState, setStartState] = useState<StartFlowState>('idle');
  const [startCode, setStartCode] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState('');
  const [joinState, setJoinState] = useState<JoinFlowState>('idle');
  const [joinError, setJoinError] = useState<string | null>(null);

  async function requestPermission() {
    try {
      const { status: result } = await Location.requestForegroundPermissionsAsync();
      setPermission(result === 'granted' ? 'granted' : 'denied');
      if (result !== 'granted') return; // Android requires foreground granted before background can even be asked

      // ADR-021 §8: background location joins the foreground request here, once, in
      // Departure — never mid-ride, which is exactly the interruption CLAUDE.md
      // forbids. What the rider actually sees is the OS permission dialog itself,
      // whose rationale text (app.config.ts's locationAlwaysAndWhenInUsePermission)
      // already says what this does: "Keeps sharing your position during a ride when
      // the screen is off." Denial isn't fatal — without it the background task still
      // runs while the app is foregrounded, which is exactly today's behaviour, so
      // this degrades quietly rather than blocking Start/Join. No separate state to
      // track: nothing in this screen's UI depends on the background grant. Caught
      // locally rather than left to the outer catch, which would otherwise flip
      // `permission` back to 'denied' — the foreground grant two lines up must stand
      // on its own.
      await Location.requestBackgroundPermissionsAsync().catch(() => {});
    } catch {
      setPermission('denied');
    }
  }

  useEffect(() => {
    requestPermission();
  }, []);

  useEffect(() => {
    loadVoiceEnabled().then(setVoiceEnabled);
  }, []);

  function handleVoiceToggle(next: boolean) {
    setVoiceEnabled(next);
    saveVoiceEnabled(next);
  }

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
  // Transitions to 'connected' rather than navigating immediately — this is what makes
  // the destination search reachable on the join path (previously this effect
  // redirected to /ride/[code] the instant the socket opened, so a joiner never got a
  // render with search on screen). The guard covers 'connecting' AND 'connected' so a
  // later drop (e.g. the room GC's mid-search) is still caught, mirroring the start
  // flow's rejection watch, which persists through its whole 'confirm' state.
  useEffect(() => {
    if (joinState === 'idle') return;
    if (status === 'open') {
      setJoinState('connected');
    } else if (status === 'rejected') {
      setJoinError("That code wasn't found — check it and try again.");
      useRide.getState().leave();
      setJoinState('idle');
    }
  }, [status, joinState]);

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

  async function handleStart() {
    setStartError(null);
    setStartState('posting');
    let res: Response;
    try {
      res = await api('/rides', { method: 'POST' });
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

  function handleJoinRide() {
    if (status === 'open') {
      router.replace(`/ride/${joinCode}`);
    }
  }

  const nameValid = name.trim().length > 0;
  const startEnabled = nameValid && startState === 'idle' && !sessionError;
  const joinEnabled = nameValid && joinCode.length === 6 && joinState === 'idle' && !sessionError;
  const startRidingEnabled = status === 'open';
  const joinRideEnabled = status === 'open';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.surface.base }} edges={['top', 'bottom', 'left', 'right']}>
      {/* ScrollView, not a plain View: the screen already runs long once the confirm
          step's extra rows (code, Plan the route, Start/Join Riding) are in view, so
          the keyboard can cover the button beneath it. keyboardShouldPersistTaps
          ="handled" so a tap still registers instead of just dismissing the keyboard
          first. */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: register.departure.padding }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[type.departure.display, { color: color.ink.primary }]}>Horizon</Text>

        {sessionError !== null && (
          <View style={{ marginTop: space[4] }}>
            <Text style={[type.departure.body, { color: color.ink.primary }]}>{sessionError}</Text>
            <Pressable
              onPress={retrySession}
              style={{ minHeight: register.departure.touchTarget, justifyContent: 'center' }}
            >
              <Text style={[type.departure.body, { color: color.amber.core }]}>Retry</Text>
            </Pressable>
          </View>
        )}

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

        {/* ADR-015 §5: the only place in the app a rider can reach this control —
            Motion never shows it, so reaching for it mid-ride is never an option. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: space[6],
            minHeight: register.departure.touchTarget,
          }}
        >
          <Text style={[type.departure.body, { color: color.ink.primary }]}>Spoken directions</Text>
          <Switch
            value={voiceEnabled}
            onValueChange={handleVoiceToggle}
            trackColor={{ false: color.ink.disabled, true: color.amber.core }}
            thumbColor={color.ink.primary}
          />
        </View>

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

            <Pressable
              onPress={() => router.push(`/plan/${startCode}`)}
              style={{
                marginTop: space[4],
                minHeight: register.departure.touchTarget,
                borderRadius: radius.card,
                backgroundColor: color.amber.core,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={[type.departure.body, { color: color.surface.void }]}>Plan the route</Text>
            </Pressable>

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
        {joinState !== 'connected' ? (
          <>
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
          </>
        ) : (
          // Connected but not yet navigated — same shape as the start flow's confirm
          // step, and for the same reason: this is what makes the destination search
          // reachable on the join path instead of the old immediate router.replace.
          <View style={{ marginTop: space[4] }}>
            <Text style={codeDisplayStyle}>{joinCode}</Text>

            <Pressable
              onPress={() => router.push(`/plan/${joinCode}`)}
              style={{
                marginTop: space[4],
                minHeight: register.departure.touchTarget,
                borderRadius: radius.card,
                backgroundColor: color.amber.core,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={[type.departure.body, { color: color.surface.void }]}>Plan the route</Text>
            </Pressable>

            <Pressable
              disabled={!joinRideEnabled}
              onPress={handleJoinRide}
              style={{
                marginTop: space[4],
                minHeight: register.departure.touchTarget,
                borderRadius: radius.card,
                backgroundColor: joinRideEnabled ? color.amber.core : color.ink.disabled,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={[
                  type.departure.body,
                  { color: joinRideEnabled ? color.surface.void : color.ink.secondary },
                ]}
              >
                Join Ride
              </Text>
            </Pressable>
          </View>
        )}
        {joinError && (
          <Text style={[type.departure.body, { color: color.ink.primary, marginTop: space[2] }]}>
            {joinError}
          </Text>
        )}

        {/* A text link, not a tab bar — nav chrome would compete with Departure's one
            question, "am I ready to ride?" (docs/PRODUCT.md). Placed last, below both
            flows, so it's the quietest thing on the screen. */}
        <Pressable
          onPress={() => router.push('/return')}
          style={{ marginTop: space[7], minHeight: register.departure.touchTarget, justifyContent: 'center' }}
        >
          <Text style={[type.departure.label, { color: color.ink.secondary }]}>Past rides</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
