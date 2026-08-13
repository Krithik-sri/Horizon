import { Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, horizon } from '@/design/tokens';
import type { Voice } from '@/features/convoy/useVoice';

// The one pixel this control is ever allowed to draw (ADR-020 §2) — 2pt, amber.core,
// gone the instant the button is released.
const HAIRLINE_HEIGHT = 2;

type PushToTalkProps = {
  // Owned by ride/[code].tsx, one `useVoice(code)` call, passed down — NOT called
  // again in here. `useVoice` opens a real Room connection as a side effect of being
  // called; a second call would open a second Room (double mic, double subscription,
  // and a `talking`/status that could disagree with this one), not share the first.
  // useVoiceGuidance needs the same hook's `remoteSpeaking` (ADR-020 §5), which is
  // the other reason this has to be a single call the screen owns and threads to both.
  voice: Voice;
};

/**
 * ADR-020 §2: the push-to-talk surface is the invisible bottom band, not a button.
 * HorizonLine lays Ahead/Now out across 0 → horizon.now, so the band below that is
 * bare map — a transparent, full-width Pressable over exactly that band, computed
 * the same way MapCanvas.tsx derives its camera padding (window height minus the
 * safe-area insets), so this control's top edge lines up with where the Now band
 * actually ends rather than an approximation of it.
 *
 * "The only control findable by feel is a screen edge" — bottom: 0 against the raw
 * window, not insets.bottom, because a gloved thumb reaching for the bottom of the
 * phone doesn't stop at a notch.
 *
 * Renders nothing at rest. No level meter, no speaking-rider list, no participant
 * count — ADR-020 §1 forbids any visual arriving from a co-rider talking, so nothing
 * about `voice.remoteSpeaking` renders here at all; it isn't even read below.
 *
 * Mount order matters: ride/[code].tsx renders this BEFORE <HorizonLine>, so
 * EndRide's own button — which lives in HorizonLine's Held band, i.e. the same
 * bottom strip — sits on top of this Pressable and wins the touch when it's visible.
 * Everywhere else in the band, including the rest of Held whenever EndRide is
 * hidden, falls through to this control, which is the intended split.
 */
export default function PushToTalk({ voice }: PushToTalkProps) {
  const { status, talking, press, release } = voice;
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // ADR-020 §6: an affordance that does nothing is worse than no affordance — render
  // no control at all once voice is known to be unavailable (503, or any token/
  // connect failure).
  if (status === 'unavailable') return null;

  const safeAreaHeight = windowHeight - insets.top - insets.bottom;
  const bandHeight = (1 - horizon.now) * safeAreaHeight;

  return (
    <Pressable
      onPressIn={press}
      onPressOut={release}
      style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: bandHeight }}
    >
      {talking && (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: HAIRLINE_HEIGHT,
            backgroundColor: color.amber.core,
          }}
        />
      )}
    </Pressable>
  );
}
