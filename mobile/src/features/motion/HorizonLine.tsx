import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { horizon, register as registerTokens } from '@/design/tokens';

export type HorizonLineProps = {
  register: 'departure' | 'motion' | 'return';
  ahead?: ReactNode;
  now?: ReactNode;
  held?: ReactNode;
};

/**
 * The Horizon Line: a compositional principle, not a drawn line (DESIGN.md §5).
 * Divides the safe-area height into Ahead/Now/Held bands by fraction. In Motion,
 * the Held band doesn't render at all by default — a real zero-footprint collapse,
 * not an empty reserved box, so the bottom of the screen stays fully map-interactive.
 */
export default function HorizonLine({ register, ahead, now, held }: HorizonLineProps) {
  const insets = useSafeAreaInsets();
  const isMotion = register === 'motion';
  // Screen-edge inset per the register contract table (space[6]/32 in Motion,
  // space[5]/24 elsewhere) — applied here, at the band level, so HUD content is
  // inset from the screen edges the way "N screen padding" actually means, rather
  // than individual cards each reinventing their own edge padding.
  const padding = registerTokens[register].padding;

  // Motion's Held band stays collapsed by default, but a caller MAY still pass `held`
  // while in Motion — that reopens it. Today the only one that does is EndRide
  // (features/motion/EndRide.tsx, rendered by ride/[code].tsx), and it earns the
  // exception by gating its OWN visibility on a sustained-stopped speed check before
  // it renders anything a rider can see or touch — this component has no way to
  // enforce that from here, it only decides whether to allocate the band at all. Any
  // FUTURE Motion `held` content must carry that same gate itself, or the "Held is
  // collapsed in Motion" rule quietly stops being true.
  //
  // Allocating the band also fixes a latent misalignment, which is worth recording
  // because it looks like a regression and is the opposite. The band heights below are
  // percentages of THIS container, so collapsing it to horizon.now (58%) also squeezed
  // Ahead and Now into 58% of the height their tokens describe: Now then centred at
  // ~0.27 of the safe area rather than horizon.nowCenter's stated 0.46. With the band
  // allocated, Now spans 0.34 → 0.58 and centres at exactly 0.46, and the layout finally
  // agrees with MapCanvas.tsx, which has always computed its camera padding as
  // horizon.ahead × the FULL safe-area height. The tokens were right; the collapse was
  // quietly disagreeing with them.
  //
  // The collapse was never what kept the map touchable, either — pointerEvents="box-none"
  // is, on every View here.
  const showHeld = !isMotion || held != null;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top,
        bottom: insets.bottom,
        left: insets.left,
        right: insets.right,
        height: showHeld ? '100%' : `${horizon.now * 100}%`,
      }}
    >
      <View pointerEvents="box-none" style={{ height: `${horizon.ahead * 100}%`, padding }}>
        {ahead}
      </View>
      <View pointerEvents="box-none" style={{ height: `${(horizon.now - horizon.ahead) * 100}%`, padding }}>
        {now}
      </View>
      {showHeld && (
        <View pointerEvents="box-none" style={{ height: `${(horizon.held - horizon.now) * 100}%`, padding }}>
          {held}
        </View>
      )}
    </View>
  );
}
