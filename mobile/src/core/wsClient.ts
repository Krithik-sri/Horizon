import { BASE_URL, WS_BASE_URL } from './config';
import type { ServerMessage } from './models';

/**
 * Connection status, exposed so the UI can honour PRODUCT.md's Confidence pillar
 * ("if information cannot be trusted, it should not be shown"). `reconnecting` and
 * `rejected` in particular exist so stale data never masquerades as live.
 */
export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'rejected';

/** A location fix to send. `ts` defaults to "now" if omitted. */
export type LocFix = {
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  ts?: number;
};

export type ConnectOptions = {
  code: string;
  name: string;
  riderId: string;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: ConnStatus) => void;
};

export type WsHandle = {
  /** Throttled to ~1 Hz (MIN_LOC_INTERVAL_MS) even if called faster; excess calls are dropped. */
  sendLoc: (fix: LocFix) => void;
  /** Closes the connection and stops all reconnect attempts, including any pending backoff timer. */
  close: () => void;
};

export const MIN_LOC_INTERVAL_MS = 1000; // throttle outbound `loc` to ~1 Hz
const BASE_BACKOFF_MS = 500;
export const MAX_BACKOFF_MS = 15000; // cap on reconnect delay

/**
 * Deterministic upper bound for the reconnect delay before a given attempt (1-based).
 * Exponential, capped at MAX_BACKOFF_MS. The actual delay used by connect() applies
 * full jitter on top of this (Math.random() * cap) so a batch of clients dropped by
 * the same network hiccup doesn't all reconnect in lockstep. Exported (pure, no
 * randomness) so wsClient.check.ts can assert the schedule without mocking timers.
 */
export function backoffDelayCapMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
}

/**
 * Whether a `loc` send at `now` should go out, given the last send at `lastSentAt`.
 * Exported (pure) for the same reason as backoffDelayCapMs — testable without a timer.
 */
export function shouldSendLoc(lastSentAt: number, now: number): boolean {
  return now - lastSentAt >= MIN_LOC_INTERVAL_MS;
}

/**
 * Whether `code`'s room exists, checked with a plain HTTP GET against the same /ws
 * path the WebSocket upgrade would use (not a WS handshake — no Upgrade headers).
 *
 * Why this exists: the built-in global WebSocket gives no reliable, cross-platform way
 * to read the HTTP status of a failed upgrade — a rejected handshake surfaces only as
 * a generic 'error' + 'close' event, and the only extra detail (the native error
 * message text) is a platform-specific string (e.g. OkHttp's "Expected HTTP 101
 * response but was '404 Not Found'" on Android; something else again on iOS) that
 * would have to be pattern-matched to recover a status code. hub.go's ServeWS checks
 * whether the room exists *before* attempting the upgrade, for both a real WS
 * handshake and a plain GET — so this cheap precheck gets the same 404 the actual
 * upgrade would, without depending on any native library's error string.
 *
 * A known code that has since been GC'd (5 min empty grace) or a code that was never
 * minted both read as 'not-found' here, matching what the real upgrade would do.
 *
 * Deliberately NOT run before every reconnect — see shouldPrecheck. A valid code costs
 * a logged 400 on the server every time this runs (the room check passes, then the
 * upgrade fails because a plain GET carries no Upgrade headers), so a precheck on every
 * drop would fill the access log with 400s that mean "everything is fine".
 */
async function checkRideExists(code: string): Promise<'exists' | 'not-found' | 'unknown'> {
  try {
    const res = await fetch(`${BASE_URL}/ws?ride=${encodeURIComponent(code)}`);
    return res.status === 404 ? 'not-found' : 'exists';
  } catch {
    return 'unknown'; // network failure — can't tell either way, let the caller retry as usual
  }
}

/**
 * Whether to spend an HTTP precheck before this attempt (0-based; 0 is the first connect).
 *
 * Only two moments are worth it:
 *   - the first attempt, so a mistyped or expired code fails fast with a real reason
 *     instead of retrying silently behind a spinner;
 *   - once backoff has saturated, meaning we've been failing for a while. If the server
 *     is reachable at that point, the likely cause is a room GC'd after its 5-minute
 *     empty grace — a dead code we should stop retrying rather than drain the battery on.
 *
 * Everything in between is an ordinary network drop, where the room is almost certainly
 * still there and a precheck buys nothing but a spurious 400 in the server log.
 */
export function shouldPrecheck(attempt: number): boolean {
  return attempt === 0 || backoffDelayCapMs(attempt) >= MAX_BACKOFF_MS;
}

/**
 * Opens a connection to a ride room and keeps it alive.
 *
 * Reconnects on every drop with exponential backoff + jitter (mobile networks drop
 * constantly), except after an explicit close() or a 404 (unknown/expired ride code —
 * retrying that forever is a battery drain and a lie to the user, so it's surfaced as
 * the terminal 'rejected' status instead).
 */
export function connect(opts: ConnectOptions): WsHandle {
  let ws: WebSocket | null = null;
  let closed = false; // true once close() is called — stops all further attempts
  let attempt = 0; // reconnect attempt count; 0 = first connect. Reset on a successful open.
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSentAt = 0;

  function setStatus(status: ConnStatus) {
    opts.onStatus(status);
  }

  function scheduleReconnect() {
    if (closed) return;
    attempt += 1;
    setStatus('reconnecting');
    const delay = Math.random() * backoffDelayCapMs(attempt); // full jitter
    reconnectTimer = setTimeout(open, delay);
  }

  async function open() {
    if (closed) return;
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting');

    if (shouldPrecheck(attempt)) {
      const exists = await checkRideExists(opts.code);
      if (closed) return;
      if (exists === 'not-found') {
        setStatus('rejected'); // terminal — do not retry an unminted/expired code
        return;
      }
    }

    const url =
      `${WS_BASE_URL}/ws?ride=${encodeURIComponent(opts.code)}` +
      `&name=${encodeURIComponent(opts.name)}&rider=${encodeURIComponent(opts.riderId)}`;
    // No auth today, so nothing sensitive rides in this URL — but never put a token in
    // a query string even so: the server logs request URLs (CLAUDE.md).
    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = () => {
      attempt = 0; // reset backoff on a successful open
      setStatus('open');
    };
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        opts.onMessage(msg);
      } catch {
        // Malformed frame — drop it rather than let a bad message crash the app.
      }
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      if (closed) return;
      scheduleReconnect();
    };
    // onerror carries no usable detail beyond what the close event that immediately
    // follows it already gives us (see checkRideExists's doc comment) — nothing to do
    // here beyond letting onclose run the reconnect logic.
  }

  open();

  return {
    sendLoc(fix) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (!shouldSendLoc(lastSentAt, now)) return;
      lastSentAt = now;
      const ts = fix.ts ?? Math.floor(now / 1000);
      ws.send(JSON.stringify({ type: 'loc', lat: fix.lat, lng: fix.lng, heading: fix.heading, speed: fix.speed, ts }));
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      setStatus('closed');
      ws?.close();
      ws = null;
    },
  };
}
