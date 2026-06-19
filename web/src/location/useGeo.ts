import { useEffect, useRef } from "react";

export interface Fix {
  lat: number;
  lng: number;
  heading: number; // degrees; 0 if the device can't supply it
  speed: number; // m/s; 0 if unavailable
}

// useGeo watches the device GPS while `active`, throttled to ~1 Hz (CLAUDE.md), and calls
// onFix with each kept fix. Foreground-only: browsers stop delivering positions when the tab
// is backgrounded / screen locked — which is fine for the mounted, screen-on ride use-case
// (a screen wake-lock keeps it alive; see useWakeLock). True background GPS is the native app.
export function useGeo(active: boolean, onFix: (fix: Fix) => void, minIntervalMs = 1000): void {
  const onFixRef = useRef(onFix);
  onFixRef.current = onFix;
  const lastRef = useRef(0);

  useEffect(() => {
    if (!active || !("geolocation" in navigator)) return;

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastRef.current < minIntervalMs) return; // throttle to ~1 Hz
        lastRef.current = now;
        const { latitude, longitude, heading, speed } = pos.coords;
        onFixRef.current({
          lat: latitude,
          lng: longitude,
          heading: heading ?? 0,
          speed: speed ?? 0,
        });
      },
      (err) => console.warn("geolocation error:", err.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );

    return () => navigator.geolocation.clearWatch(id);
  }, [active]);
}
