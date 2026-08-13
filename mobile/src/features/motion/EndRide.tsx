import { useEffect, useRef, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { color, motion, radius, register, space, type } from '@/design/tokens';
import { useRide } from '@/state/useRide';

// Below this the rider reads as stopped for this control's purposes — a red light, a
// fuel stop, a photo. Not the same constant as core/rideTrack.ts's MOVING_SPEED_MPS
// (that one decides what counts toward *moving time*); the two are allowed to drift
// independently, so this doesn't import from there.
const STOP_SPEED_MPS = 1;
// "Sustained" is load-bearing: a rider slowing hard for a corner or a give-way must
// never see this control appear and vanish a beat later. Five full seconds below
// STOP_SPEED_MPS before it's even offered.
const STOP_SUSTAIN_MS = 5000;
const HOLD_MS = 800;

type EndRideProps = {
  /** ownFix.speed, m/s — null before the first GPS fix. */
  speed: number | null;
};

/**
 * Motion → Return. Explicit end-ride, never arrival detection — a rider stopped for
 * fuel 200m short of the destination must not have their map replaced, so the only
 * signal read here is "has this rider been stationary for a while," never route
 * progress or distance-to-destination.
 *
 * Meant to be rendered unconditionally in HorizonLine's Held slot by ride/[code].tsx
 * — visibility is entirely this component's own doing (opacity + pointerEvents),
 * gated on STOP_SPEED_MPS sustained for STOP_SUSTAIN_MS. HorizonLine.tsx's own
 * comment on its Held-band collapse names this component as the one thing allowed to
 * reopen it, on the condition that whatever renders there gates itself the same way.
 */
export default function EndRide({ speed }: EndRideProps) {
  const router = useRouter();
  const belowSinceRef = useRef<number | null>(null);
  const [stopped, setStopped] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // No interval: each fix (~1Hz) reruns this, and while still below threshold it
  // reschedules a timeout for whatever's left of the 5s window anchored at the
  // *first* below-threshold fix (belowSinceRef), not the latest one. If fixes stop
  // arriving entirely the last-scheduled timeout still fires on its own — real
  // wall-clock time, not dependent on another fix showing up.
  useEffect(() => {
    const isBelow = speed !== null && speed < STOP_SPEED_MPS;
    if (!isBelow) {
      belowSinceRef.current = null;
      setStopped(false);
      return;
    }
    if (belowSinceRef.current === null) {
      belowSinceRef.current = Date.now();
    }
    const elapsed = Date.now() - belowSinceRef.current;
    if (elapsed >= STOP_SUSTAIN_MS) {
      setStopped(true);
      return;
    }
    const timer = setTimeout(() => setStopped(true), STOP_SUSTAIN_MS - elapsed);
    return () => clearTimeout(timer);
  }, [speed]);

  // Moving again resets the whole control, not just its visibility — a stale "couldn't
  // save" message from a stop three towns ago has nothing to say about this one.
  useEffect(() => {
    if (!stopped) setSaveFailed(false);
  }, [stopped]);

  const opacity = useSharedValue(0);
  useEffect(() => {
    // Still Motion, not the register change itself — register.motion.maxAnimationDuration
    // (120ms) applies here, not motion.duration.considered (that's _layout.tsx's Stack
    // transition, once a ride actually ends).
    opacity.value = withTiming(stopped ? 1 : 0, { duration: motion.duration.quick });
  }, [stopped, opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  async function handleConfirm() {
    if (confirming) return;
    setConfirming(true);
    setSaveFailed(false);
    const id = await useRide.getState().endRide();
    if (id) {
      router.replace(`/return/${id}`);
      return;
    }
    // Save failed, but the ride isn't lost — endRide() already wrote the accurate
    // final snapshot to the pending-row guard (rides.ts) before attempting the
    // insert; flushPendingRide promotes it on the next launch. Stay put rather than
    // navigating to a ride that doesn't exist yet, and say so.
    setConfirming(false);
    setSaveFailed(true);
  }

  return (
    <Animated.View
      style={[{ alignItems: 'flex-end' }, animatedStyle]}
      pointerEvents={stopped ? 'auto' : 'none'}
    >
      {saveFailed && (
        <Text style={[type.motion.label, { color: color.ink.secondary, marginBottom: space[2] }]}>
          Couldn't save yet — still on this phone.
        </Text>
      )}
      <Pressable
        onLongPress={handleConfirm}
        delayLongPress={HOLD_MS}
        disabled={confirming}
        style={({ pressed }) => ({
          minWidth: register.motion.touchTarget,
          minHeight: register.motion.touchTarget,
          borderRadius: radius.full,
          paddingHorizontal: space[4],
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? color.amber.core : color.surface.overlay,
        })}
      >
        {({ pressed }) => (
          <Text style={[type.motion.label, { color: pressed ? color.surface.void : color.ink.primary }]}>
            {confirming ? 'Ending…' : 'Hold to end ride'}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}
