import { useState } from "react";
import { useRideStore } from "./store/ride";
import { createRide } from "./net/api";
import { Ride } from "./Ride";

export function App() {
  const code = useRideStore((s) => s.code);
  return code ? <Ride /> : <Lobby />;
}

function Lobby() {
  const name = useRideStore((s) => s.name);
  const setName = useRideStore((s) => s.setName);
  const startRide = useRideStore((s) => s.startRide);

  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      startRide(await createRide());
    } catch {
      setError("Couldn't reach the server. Is the backend running?");
      setBusy(false);
    }
  };

  const onJoin = () => {
    if (joinCode.trim().length < 4) {
      setError("Enter the ride code your friend shared.");
      return;
    }
    startRide(joinCode.trim());
  };

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1 className="brand">Horizon</h1>
        <p className="tagline">Live group ride tracking</p>

        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sam"
            maxLength={20}
            autoComplete="off"
          />
        </label>

        <button className="btn primary" onClick={onCreate} disabled={busy}>
          {busy ? "Starting…" : "Start a ride"}
        </button>

        <div className="divider"><span>or join one</span></div>

        <div className="join-row">
          <input
            className="code-input"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
          />
          <button className="btn" onClick={onJoin}>Join</button>
        </div>

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
