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
 * the Held band doesn't render at all — a real zero-footprint collapse, not an
 * empty reserved box, so the bottom of the screen stays fully map-interactive.
 */
export default function HorizonLine({ register, ahead, now, held }: HorizonLineProps) {
  const insets = useSafeAreaInsets();
  const isMotion = register === 'motion';
  // Screen-edge inset per the register contract table (space[6]/32 in Motion,
  // space[5]/24 elsewhere) — applied here, at the band level, so HUD content is
  // inset from the screen edges the way "N screen padding" actually means, rather
  // than individual cards each reinventing their own edge padding.
  const padding = registerTokens[register].padding;

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top,
        bottom: insets.bottom,
        left: insets.left,
        right: insets.right,
        height: isMotion ? `${horizon.now * 100}%` : '100%',
      }}
    >
      <View pointerEvents="box-none" style={{ height: `${horizon.ahead * 100}%`, padding }}>
        {ahead}
      </View>
      <View pointerEvents="box-none" style={{ height: `${(horizon.now - horizon.ahead) * 100}%`, padding }}>
        {now}
      </View>
      {!isMotion && (
        <View pointerEvents="box-none" style={{ height: `${(horizon.held - horizon.now) * 100}%`, padding }}>
          {held}
        </View>
      )}
    </View>
  );
}
