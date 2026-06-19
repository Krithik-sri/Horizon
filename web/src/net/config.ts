// Where the Go backend lives. In dev, Vite serves the app on :5173 while the Go server
// runs on :8080 of the same host (works for a phone on the LAN too, since location.hostname
// is then the LAN IP). In a deployed build we assume the backend is reachable on the same
// origin (e.g. behind a Cloudflare Tunnel). Override either with a .env value.

const devHost = location.hostname || "localhost";

export const httpBase: string =
  import.meta.env.VITE_BACKEND_HTTP ??
  (import.meta.env.DEV ? `http://${devHost}:8080` : location.origin);

export const wsBase: string =
  import.meta.env.VITE_BACKEND_WS ??
  (import.meta.env.DEV
    ? `ws://${devHost}:8080`
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
