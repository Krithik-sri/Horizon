import { useRideStore } from "./store/ride";
import { useRideSocket } from "./net/ws";
import { useGeo } from "./location/useGeo";
import { useWakeLock } from "./location/useWakeLock";
import { Map } from "./map/Map";
import { STALE_AFTER_SEC } from "./types";

const STATUS_LABEL: Record<string, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  connected: "Live",
  reconnecting: "Reconnecting…",
};

export function Ride() {
  const code = useRideStore((s) => s.code);
  const status = useRideStore((s) => s.status);
  const riders = useRideStore((s) => s.riders);
  const selfId = useRideStore((s) => s.selfId);
  const leaveRide = useRideStore((s) => s.leaveRide);

  // The pipe: GPS → server → everyone's dots. Keep the screen on while we ride.
  const { sendLoc } = useRideSocket();
  useGeo(true, (f) => sendLoc(f.lat, f.lng, f.heading, f.speed));
  useWakeLock(true);

  return (
    <div className="ride">
      <Map />

      <header className="topbar">
        <button className="btn ghost" onClick={leaveRide}>← Leave</button>
        <div className="ride-code">{code}</div>
        <div className={`status ${status}`}>
          <span className="dot" />
          {STATUS_LABEL[status] ?? status}
        </div>
      </header>

      <section className="standings">
        {riders.length === 0 ? (
          <p className="hint">Waiting for a GPS fix… (allow location access)</p>
        ) : (
          <ol>
            {riders.map((r) => {
              const stale = r.ageSec > STALE_AFTER_SEC; // dead zone — show last-seen, not a frozen speed
              return (
                <li key={r.id} className={`${r.id === selfId ? "me" : ""}${stale ? " stale" : ""}`}>
                  <span className="pos">{r.pos}</span>
                  <span className="name">{r.name}{r.id === selfId ? " (you)" : ""}</span>
                  <span className="speed">{stale ? `${r.ageSec}s ago` : `${(r.speed * 3.6).toFixed(1)} km/h`}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
