import AsyncStorage from '@react-native-async-storage/async-storage';

const VOICE_ENABLED_KEY = 'horizon.voiceEnabled';

/**
 * loadVoiceEnabled / saveVoiceEnabled — the rider's spoken-guidance preference
 * (ADR-015 §5: on by default, and the toggle lives in Departure only). Mirrors
 * riderName.ts's AsyncStorage pattern; kept out of that module because riderName.ts
 * is about the display name, and this is an unrelated preference.
 *
 * Stored as '1'/'0' rather than JSON.parse(AsyncStorage.getItem(...) ?? 'true') —
 * no parsing, no possible parse failure, and default-true falls out for free from
 * "anything other than the string '0' reads as on."
 */
export async function loadVoiceEnabled(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(VOICE_ENABLED_KEY);
  return stored !== '0';
}

export async function saveVoiceEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(VOICE_ENABLED_KEY, on ? '1' : '0');
}
