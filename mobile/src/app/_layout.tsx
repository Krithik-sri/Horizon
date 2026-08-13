import { useEffect, useState } from 'react';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { Newsreader_400Regular } from '@expo-google-fonts/newsreader';
import { registerGlobals } from '@livekit/react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Side-effect only: registers TaskManager.defineTask(LOCATION_TASK, …) at module
// scope. ADR-021 §3 — this must run on EVERY JS context creation, including a
// headless restart where React never mounts at all, so it cannot live behind a hook
// or a screen's own import. Root layout module scope is the one place guaranteed to
// run before Expo Router loads any screen, same reasoning as registerGlobals() below.
import '@/core/backgroundLocation';
import { flushPendingRide } from '@/core/rides';
import { ensureSession } from '@/core/supabase';
import { motion } from '@/design/tokens';

// Keep the splash screen up until fonts are ready — called at module scope so it
// fires before the first render, not inside an effect.
SplashScreen.preventAutoHideAsync();

// LiveKit's hard requirement (ADR-020 §4/§3): registers the WebRTC globals, the
// crypto/streams polyfills, and the LiveKitReactNativeGlobal it reads at import
// time — must run before anything touches livekit-client. This is the single
// easiest thing to omit, and the failure mode is a silent, hard-to-diagnose native
// crash deep in useVoice.ts's Room, not a helpful error here. Root layout module
// scope is the one place guaranteed to run before Expo Router loads any screen
// (ride/[code].tsx, which imports useVoice.ts) — DO NOT move this into a hook or a
// component body, where it would run too late for whichever screen mounts first.
registerGlobals();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    // tokens.ts's three type.reflective.* styles have named this family since before
    // Return existed — this is the load that makes them stop silently falling back to
    // the system font.
    Newsreader_400Regular,
  });

  // ADR-016 §1: signed in anonymously, once, behind the splash screen this already
  // holds for fonts — every later launch reads a cached session with no network call,
  // so the Departure flow doesn't cost a single extra tap. `sessionReady` (rather than
  // just gating on fontsLoaded) makes sure the splash doesn't drop before this settles.
  // A failure still resolves `sessionReady` — the app must render either way (index.tsx
  // surfaces the no-session case with a real message) rather than hang on the splash
  // screen forever.
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    ensureSession().finally(() => {
      setSessionReady(true);
      // ADR-018 §3's pending-row guard is only real if something promotes an orphaned
      // row — this is that call, made once, right after ensureSession() resolves. A
      // failed sign-in still calls it: flushPendingRide's own saveRide just no-ops
      // without a session. Fire-and-forget: a slow or failed flush must not hold the
      // splash screen open, and a ride that still can't save simply stays pending for
      // the next launch to try again.
      flushPendingRide();
    });
  }, []);

  useEffect(() => {
    if (fontsLoaded && sessionReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, sessionReady]);

  if (!fontsLoaded || !sessionReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Motion → Return is DESIGN.md's one place a register change is allowed to be
            felt (motion.duration.considered, 380ms) — every other transition in this
            app stays under the 120/220ms caps. "return" matches app/return/index.tsx
            (expo-router resolves an index screen's own name to its directory name),
            which is the only entry point this animation needs: EndRide.tsx is the
            sole thing that navigates here. animationDuration is iOS-only
            (react-navigation native-stack); Android has no equivalent knob on a
            plain push, so this still documents the intended value even though today
            it only takes visible effect on iOS. */}
        <Stack.Screen name="return" options={{ animation: 'fade', animationDuration: motion.duration.considered }} />
      </Stack>
      {/* Every surface in this app is dark, so status bar content renders light to stay visible. */}
      <StatusBar style="light" />
    </GestureHandlerRootView>
  );
}
