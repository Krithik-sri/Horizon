import { Text, View } from 'react-native';

import { color, radius, space, type } from '@/design/tokens';

type SpeedReadoutProps = {
  speedMps: number | null;
};

/**
 * The one number that matters in Motion. An em dash stands in for "no fix yet" —
 * a real "0" would be a truth claim about being stationary (Confidence pillar).
 */
export default function SpeedReadout({ speedMps }: SpeedReadoutProps) {
  const value = speedMps === null ? '–' : `${Math.round(speedMps * 3.6)}`;

  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: color.surface.void,
        borderRadius: radius.card,
        // Snug card padding — the screen-edge padding (space[6]) is applied once,
        // at the HorizonLine band level, so this doesn't double it.
        padding: space[4],
        alignItems: 'center',
      }}
    >
      <Text style={[type.motion.primary, { color: color.ink.primary }]}>{value}</Text>
      {/* textTransform: 'uppercase' on the label token renders this as KM/H. */}
      <Text style={[type.motion.label, { color: color.ink.primary }]}>km/h</Text>
    </View>
  );
}
