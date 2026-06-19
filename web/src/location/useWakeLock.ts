import { useEffect } from "react";

// useWakeLock keeps the screen awake while `active` so GPS + the map keep running on a
// handlebar-mounted phone. The OS drops the lock when the tab is hidden (e.g. an app switch
// on iOS), so we re-acquire on visibilitychange. This is the key that makes a foreground-only
// PWA viable for rides; background tracking remains the reason to build the native app.
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let stopped = false;

    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // The UA can refuse (e.g. low battery). Nothing to do but try again on next focus.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      sentinel?.release().catch(() => {});
    };
  }, [active]);
}
