/**
 * Wire types for the Horizon WebSocket protocol and the route HTTP endpoint
 * (CLAUDE.md, "WebSocket protocol" — the contract these types implement).
 *
 * Coordinate order is a known trap and deliberately encoded in the type names, not
 * just in comments: `loc`, `state`'s `Rider`, and route waypoints all use *named*
 * lat/lng fields. `route.polyline` is the one *positional* pair in the whole protocol
 * — MapLibre/GeoJSON's [lng, lat] order — so it gets its own named type, `LngLat`,
 * that is never reused for anything lat-first.
 */

/**
 * [lng, lat] — MapLibre/GeoJSON order. The one positional coordinate pair anywhere in
 * this protocol. Do not reuse this type for a lat-first pair (loc/state/waypoints all
 * use named lat/lng fields instead, precisely to avoid this mix-up).
 */
export type LngLat = [number, number];

// --- client -> server ---

/** Sent ~1x/sec once connected. */
export type LocMessage = {
  type: 'loc';
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  /** Unix seconds. */
  ts: number;
};

// --- server -> client ---

/** Sent once, to one client, right after connect. */
export type WelcomeMessage = {
  type: 'welcome';
  /** This client's rider id — echoes the `rider` query param if it was valid, else a
   * server-minted one. Use this to pick your own dot out of `state.riders`. */
  id: string;
};

/**
 * One rider's latest fix, as broadcast in a `state` frame.
 *
 * Deliberately carries no position/rank field. Riders arrive pre-sorted by `id` for
 * frame stability only — that is not a ranking (docs/ADR/ADR-009.md) and nothing here
 * should ever be used to compute one.
 */
export type Rider = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  speed: number;
  /** Seconds since this rider's last fix, server clock. UI greys a rider out past ~10s. */
  ageSec: number;
};

/** Sent to every client in the room on a fixed ~4 Hz tick. */
export type StateMessage = {
  type: 'state';
  ride: string;
  riders: Rider[];
};

/** One turn-by-turn instruction. `wayPoints` are indices into the route's `polyline`. */
export type Step = {
  instruction: string;
  distance: number;
  duration: number;
  type: number;
  name: string;
  wayPoints: number[];
};

export type RouteSummary = {
  distance: number;
  duration: number;
};

/** The route itself, shared by the WS `route` message and the HTTP POST /route response. */
export type RouteData = {
  polyline: LngLat[];
  steps: Step[] | null;
  summary: RouteSummary | null;
};

/** Sent on join if the room already has a route, and to everyone when one is set. */
export type RouteMessage = {
  type: 'route';
  ride: string;
} & RouteData;

/** Discriminated union of everything the server can send. */
export type ServerMessage = WelcomeMessage | StateMessage | RouteMessage;
