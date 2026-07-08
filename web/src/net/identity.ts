// riderId returns a stable per-tab rider id, sent as ?rider= on the WebSocket so the
// server can recognise us across reconnects (mobile networks drop — CLAUDE.md) and
// replace the zombie connection instead of seating a duplicate "ghost" rider.
//
// sessionStorage, deliberately NOT localStorage: it survives a page reload mid-ride,
// but each tab gets its own id — with localStorage, the two-tab test in SETUP_WEB.md
// would share one id and the tabs would kick each other in a loop.
const KEY = "horizon-rider-id";

export function riderId(): string {
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    // crypto.randomUUID needs a secure context (fine on localhost/HTTPS); the
    // fallback keeps insecure LAN dev pages from crashing here.
    id = crypto.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    sessionStorage.setItem(KEY, id);
  }
  return id;
}
