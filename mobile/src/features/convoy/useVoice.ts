/**
 * Convoy push-to-talk (ADR-020). Lives in features/convoy, not a new features/voice —
 * CLAUDE.md's folder convention mirrors the three registers plus `convoy/` for
 * the-group-as-a-thing, and voice is the group talking.
 *
 * Drives a plain livekit-client Room imperatively — no <LiveKitRoom> provider
 * (ADR-020 §3). Motion renders zero LiveKit UI (ADR-020 §1 forbids any visual
 * arriving from voice — no speaker list, no level meter, no participant count), so
 * there is nothing here for a provider to hand components anyway.
 */
import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, type Participant } from 'livekit-client';
import { AudioSession } from '@livekit/react-native';

import { fetchVoiceToken } from '@/core/voiceToken';

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'unavailable';

export type Voice = {
  status: VoiceStatus;
  /** This rider is holding the button — the only thing that ever publishes the mic. */
  talking: boolean;
  /** A co-rider is currently speaking. Never true for the local participant — a
   *  rider's own transmission must not suppress their own navigation cue (ADR-020 §5). */
  remoteSpeaking: boolean;
  press: () => void;
  release: () => void;
};

/**
 * `code === null` (no ride yet) stays 'idle' and never connects. Otherwise connects
 * on mount with the microphone muted and subscription on (the default `autoSubscribe`),
 * so every rider hears the convoy from metre zero without a gesture — ADR-020 §3's
 * whole point. `status` is 'unavailable' on a 503, a token failure, or a connect
 * failure — never thrown, so PushToTalk.tsx can render null off it directly.
 */
export function useVoice(code: string | null): Voice {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [talking, setTalking] = useState(false);
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    if (!code) {
      setStatus('idle');
      return;
    }
    const rideCode = code; // narrow once; the closures below capture this, not `code`

    // Guards every async continuation below (the token fetch, room.connect, and the
    // re-mint-on-disconnect loop) against running after this effect's own cleanup —
    // without it, a fast unmount (leaving the ride mid-connect) could resurrect a
    // room nobody holds a reference to anymore.
    let live = true;
    const room = new Room();
    roomRef.current = room;

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      setRemoteSpeaking(speakers.some((p) => !p.isLocal));
    });

    async function connect() {
      setStatus('connecting');
      const result = await fetchVoiceToken(rideCode);
      if (!live) return;
      if (!result.ok) {
        setStatus('unavailable');
        return;
      }
      try {
        await room.connect(result.url, result.token);
      } catch {
        if (live) setStatus('unavailable');
        return;
      }
      if (!live) {
        room.disconnect();
        return;
      }
      setStatus('connected'); // mic stays unpublished — press() is the only opener
    }

    room.on(RoomEvent.Disconnected, () => {
      // ADR-020 §4: a one-hour token plus a tunnel means the socket can drop long
      // before the token expires and long before the ride ends. Re-mint and
      // reconnect rather than leaving voice dead for the rest of the ride.
      if (!live) return;
      setTalking(false); // the reconnected room starts muted same as the first one
      setRemoteSpeaking(false);
      connect();
    });

    AudioSession.startAudioSession()
      .then(connect)
      .catch(() => {
        if (live) setStatus('unavailable');
      });

    return () => {
      live = false;
      room.removeAllListeners();
      room.disconnect();
      AudioSession.stopAudioSession().catch(() => {});
      roomRef.current = null;
    };
  }, [code]);

  function press() {
    if (status !== 'connected' || !roomRef.current) return;
    setTalking(true);
    roomRef.current.localParticipant.setMicrophoneEnabled(true).catch(() => {
      // Enabling can fail (permission, device); don't leave the hairline asserting
      // an open mic that isn't actually there — PRODUCT.md's Confidence pillar
      // applied to the one pixel this control is allowed to draw.
      setTalking(false);
    });
  }

  function release() {
    if (!roomRef.current) return;
    setTalking(false);
    roomRef.current.localParticipant.setMicrophoneEnabled(false).catch(() => {});
  }

  return { status, talking, remoteSpeaking, press, release };
}
