import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, type TextStyle, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';

import { BASE_URL } from '@/core/config';
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
