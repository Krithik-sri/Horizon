/**
 * Speaks maneuver cues (ADR-015). The hook half of the voiceGuidance split — the
 * only place in this pair that imports `expo-speech`, the store, or React; the
 * firing rules themselves live in ./voiceGuidance, pure, so that module's check
 * script runs under plain `tsx` the same way reroute.ts / useReroute.ts already do
 * (see ./voiceGuidance's doc comment for why the split exists at all).
 */
import { useEffect, useRef } from 'react';
import * as Speech from 'expo-speech';

import type { Step } from '@/core/models';
import type { Progress } from '@/core/routeProgress';
import { useRide } from '@/state/useRide';

import { dueTier, phrase, type CueTier } from './voiceGuidance';

/**
 * No-op entirely when `!enabled`, `progress` is null, off-route, or arrived
 * (ADR-015 §4 — arrival and off-route are never spoken).
 *
 * `remoteSpeaking` answers ADR-015's open audio-contention item, per ADR-020 §5: a
 * co-rider talking defers a due cue exactly the way this hook already defers its own
 * in-flight utterance — see the comment on `speakingRef` below, at the one line this
 * changed.
 */
export function useVoiceGuidance(progress: Progress | null, enabled: boolean, remoteSpeaking: boolean): void {
  // The step this ref pair's bookkeeping belongs to, compared by object identity.
  // step.wayPoints[0] is the human-meaningful key (ADR-015 §3's de-dup key), but
  // comparing the Step object itself also covers the active route swapping identity
  // (a rejoin starting or clearing, ADR-014 §1) for free: a new RouteData always
  // constructs fresh Step objects (useRide.ts's applyMessage), even on the rare
  // chance a new route's next maneuver lands on the same wayPoints[0] index as the
  // old one — so one comparison here does what the brief describes as two rules.
  const currentStepRef = useRef<Step | null>(null);
  const spokenRef = useRef<Set<CueTier>>(new Set());
  const entryMetersRef = useRef(0); // max metersToStep seen since currentStepRef became current

  // Edge-detects the crossing into `imminent` (ADR-015 §2 mechanism 3) — Speech.stop()
  // fires once, on the transition, not on every tick already inside it.
  const wasImminentRef = useRef(false);

  // Maintained from Speech.speak's own onDone/onStopped/onError callbacks, per the
  // brief — not isSpeakingAsync polling. Gates a newly-due tier from being spoken
  // while another cue is still mid-utterance: expo-speech's own doc comment says
  // speak() during an active utterance silently queues rather than replaces, and
  // stacking queued cues is worse than a short delay. Deferring costs nothing: a due
  // tier isn't added to `spokenRef` until it's actually spoken, so the next fix
  // (~1Hz, CLAUDE.md) tries again rather than ever dropping the cue.
  const speakingRef = useRef(false);

  // An utterance handed to the OS TTS engine outlives this component: Speech.speak is
  // fire-and-forget at the native layer, so nothing about unmounting React cancels it.
  // Without this, leaving Motion mid-cue (ending the ride, bailing to Departure on a
  // rejected rejoin) leaves a voice announcing a turn over a screen that has no route
  // — and toggling guidance off would finish saying the thing the rider just asked it
  // to stop saying.
  //
  // This is cleanup, not a fourth corner-guard mechanism: ADR-015 §2's "the only
  // Speech.stop() call" is about the *guidance* logic having exactly one place that
  // cuts a cue for safety. Tearing down a resource on unmount is a different concern
  // and is not what that sentence constrains.
  useEffect(() => {
    if (!enabled) {
      Speech.stop();
      speakingRef.current = false;
    }
    return () => {
      Speech.stop();
      speakingRef.current = false;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !progress || !progress.onRoute || progress.arrived) return;

    // ADR-015 §2 mechanism 3: cut an in-flight utterance the instant the rider
    // crosses into imminent. This is the only Speech.stop() call in the app —
    // mechanism 1 (dueTier's own imminent guard, below) means this isn't load-
    // bearing for correctness, only for cutting an utterance already under way.
    if (progress.imminent && !wasImminentRef.current) {
      Speech.stop();
      speakingRef.current = false;
    }
    wasImminentRef.current = progress.imminent;

    const step = progress.step;
    if (!step) return;

    if (currentStepRef.current !== step) {
      currentStepRef.current = step;
      spokenRef.current = new Set();
      entryMetersRef.current = progress.metersToStep;
    } else {
      entryMetersRef.current = Math.max(entryMetersRef.current, progress.metersToStep);
    }

    if (speakingRef.current) return; // let the in-flight utterance finish; re-check next fix

    // ADR-020 §5, the answer to ADR-015's open audio-contention item: a co-rider
    // talking defers a due cue exactly like an in-flight utterance of our own does,
    // one line above — skipped for this fix, retried on the next one, never queued
    // or delayed. That distinction is the whole safety argument, not a style choice:
    // a *delayed* cue would fire the instant the human stopped talking, which could
    // land inside the corner and defeat ADR-015 §2's guarantee outright. A *skipped*
    // cue costs nothing extra to get right — this effect already reruns on every fix
    // (~1Hz), and `spokenRef` was never marked for this tier, so the next fix asks
    // `dueTier` again for free. If the rider has crossed into `imminent` by then,
    // `dueTier`'s own guard returns null and the cue is silently dropped rather than
    // spoken late. Deliberately NOT in this effect's dependency array below: adding
    // it would rerun this effect the moment `remoteSpeaking` itself flips back to
    // false, which is precisely the "speak when the human stops" behaviour this
    // paragraph exists to rule out. Reading it fresh here, on a fix-driven rerun, is
    // what keeps the retry tied to a GPS fix and nothing else.
    if (remoteSpeaking) return;

    const tier = dueTier({
      metersToStep: progress.metersToStep,
      entryMeters: entryMetersRef.current,
      speedMps: useRide.getState().ownFix?.speed ?? 0,
      imminent: progress.imminent,
      spoken: spokenRef.current,
    });
    if (!tier) return;

    spokenRef.current.add(tier);
    speakingRef.current = true;
    Speech.speak(phrase(step, tier), {
      onDone: () => {
        speakingRef.current = false;
      },
      onStopped: () => {
        speakingRef.current = false;
      },
      onError: () => {
        speakingRef.current = false;
      },
    });
  }, [progress, enabled]);
}
