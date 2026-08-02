import AsyncStorage from '@react-native-async-storage/async-storage';
import { uuid } from 'expo-modules-core';

const STORAGE_KEY = 'horizon.riderId';

/**
 * getRiderId — a stable per-install id, generated once and persisted to
 * AsyncStorage, returned unchanged on every later call.
 *
 * Why this matters: the server evicts a previously-seated connection presenting the
 * same rider id (backend/internal/hub/hub.go, ServeWS) — that's what makes a
 * reconnect *replace* a rider rather than leave a ghost dot on everyone's map for up
 * to roomGrace (5 minutes). If this id changed across an app restart, that protection
 * would be lost and every relaunch would look like a brand-new rider joining.
 *
 * The server validates it as 8-64 chars of [A-Za-z0-9_-] (hub.go validRiderID) — a
 * UUID v4 satisfies that.
 *
 * On crypto.randomUUID(): it does NOT exist in this runtime. Hermes (React Native's
 * JS engine) implements no Web Crypto API on any current RN version, including 0.85 —
 * this is an engine gap, not something Expo SDK 56 changed. `expo-crypto`, which was
 * expected to already be a transitive dependency, is not actually present anywhere in
 * node_modules or package-lock.json in this repo. Rather than add a new native
 * dependency (which would need a dev-client rebuild) for a single UUID call, this uses
 * `expo-modules-core`'s exported `uuid.v4()` instead: expo-modules-core is already
 * installed (every Expo package depends on it), and `uuid.v4()` calls the same
 * native-backed, cryptographically random UUID v4 generator
 * (`globalThis.expo.uuidv4`, implemented natively for both platforms in
 * expo-modules-core) that Expo's own packages use internally for this exact purpose.
 */
export async function getRiderId(): Promise<string> {
  const existing = await AsyncStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const id = uuid.v4();
  await AsyncStorage.setItem(STORAGE_KEY, id);
  return id;
}
