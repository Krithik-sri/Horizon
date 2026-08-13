import { BASE_URL, WS_BASE_URL } from './config';
import type { ServerMessage } from './models';
import { getAccessToken, supabase } from './supabase';
import { backoffDelayCapMs, shouldPrecheck, shouldSendLoc } from './wsProtocol';

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
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: ConnStatus) => void;
};

export type WsHandle = {
  /** Throttled to ~1 Hz (MIN_LOC_INTERVAL_MS) even if called faster; excess calls are dropped. */
  sendLoc: (fix: LocFix) => void;
  /** Closes the connection and stops all reconnect attempts, including any pending backoff timer. */
  close: () => void;
};

/** See the cast site in open() below for why this exists. */
type RNWebSocketCtor = new (
  url: string,
  protocols: undefined,
  options: { headers: Record<string, string> },
) => WebSocket;

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
 *
 * ADR-017 §4 adds a fourth outcome: 'unauthorized'. The Go server now requires a
 * verified bearer token on this route too, so a rejected precheck can mean either the
 * ride code is gone OR the token is. A single 401 gets exactly one retry, after a
 * *forced* session refresh (not just re-reading the cached session — the whole point
 * is the cached token is the one that just failed): a second consecutive 401 means the
 * token is not the problem, or refreshing can't fix it, and either way retrying
 * forever gets us nowhere. The caller treats 'unauthorized' the same as 'not-found' —
 * terminal, surfaced as 'rejected'.
 */
async function checkRideExists(code: string): Promise<'exists' | 'not-found' | 'unauthorized' | 'unknown'> {
  const attemptOnce = async (): Promise<'exists' | 'not-found' | 'unauthorized' | 'unknown'> => {
    try {
      const token = await getAccessToken();
      const res = await fetch(`${BASE_URL}/ws?ride=${encodeURIComponent(code)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.status === 401) return 'unauthorized';
      return res.status === 404 ? 'not-found' : 'exists';
    } catch {
      return 'unknown'; // network failure — can't tell either way, let the caller retry as usual
    }
  };

  const first = await attemptOnce();
  if (first !== 'unauthorized') return first;

  await supabase.auth.refreshSession(); // one forced refresh, not a loop — see doc comment above
  return attemptOnce();
}

/**
 * Opens a connection to a ride room and keeps it alive.
 *
 * Reconnects on every drop with exponential backoff + jitter (mobile networks drop
 * constantly), except after an explicit close() or a 404/401 (unknown/expired ride
 * code, or a token the server won't accept even after one refresh — retrying either
 * forever is a battery drain and a lie to the user, so both are surfaced as the
 * terminal 'rejected' status instead).
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
      if (exists === 'not-found' || exists === 'unauthorized') {
        setStatus('rejected'); // terminal — do not retry an unminted/expired code or a dead token
        return;
      }
    }

    // Fetched fresh on *every* attempt, never cached from an earlier open() or from
    // connect()'s call site — this is the single most important sequencing detail in
    // ADR-017 §4. A ride can run for hours; a token fetched once at the first connect
    // would still be the one presented on a reconnect attempt long after it expired.
    // getAccessToken() goes through getSession(), which auto-refreshes an expired
    // token, so this is normally free (a cache read) and only occasionally a network
    // call.
    const token = await getAccessToken();
    if (closed) return;

    const url = `${WS_BASE_URL}/ws?ride=${encodeURIComponent(opts.code)}&name=${encodeURIComponent(opts.name)}`;
    // The token rides in a header, not the query string (ADR-008, ADR-017). Note the
    // reason usually given for that rule — "the server logs request URLs" — is false:
    // internal/httpx/logging.go logs r.URL.Path only. The rule holds for the reason that
    // does apply: a URL reaches proxies and CDN logs in a way a header doesn't.
    // React Native's WebSocket takes a non-standard third `options` argument with a
    // `headers` field for exactly this case (ADR-017 §2). `headers` is a required key
    // of that options object even when there's nothing to send (no session yet — the
    // ADR-016 "first launch had no network" case) — in that case the server's own 401
    // is what surfaces, via the ordinary close-and-reconnect path.
    //
    // TypeScript doesn't know about this argument: this project has no
    // @types/react-native, and lib.dom.d.ts's 2-arg WebSocket constructor wins by
    // default (expo/tsconfig.base sets lib: ["DOM", "ESNext"]). RNWebSocketCtor is a
    // narrow local view of the real (native, Flow-typed) constructor in
    // react-native/Libraries/WebSocket/WebSocket.js — cast rather than augmented,
    // since the global `WebSocket` is a `declare var` of an object-literal type, which
    // declaration merging can't extend the way it can an `interface`.
    const socket = new (WebSocket as unknown as RNWebSocketCtor)(url, undefined, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
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
