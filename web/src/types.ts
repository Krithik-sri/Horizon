// The WebSocket contract (CLAUDE.md "WebSocket protocol" / SYSTEM_DESIGN.md §6).
// Internal messages use lat/lng. MapLibre + GeoJSON use [lng, lat] — we convert at the
// map boundary (see map/Map.tsx), never here.

// Client → server, ~1×/sec.
export interface LocMsg {
  type: "loc";
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  ts: number; // unix seconds
}

// Grey a rider out once their last fix is older than this (SYSTEM_DESIGN.md §6).
export const STALE_AFTER_SEC = 10;

// One rider in the server → clients broadcast.
export interface Rider {
  id: string;
  name: string;
  lat: number;
  lng: number;
  speed: number;
  ageSec: number; // seconds since this rider's last fix (server clock)
  pos: number; // 1 = leading
  distAlong: number; // metres along the route (0 until a route is set, Phase 2)
}

// Server → all clients in the room, on each tick.
export interface StateMsg {
  type: "state";
  ride: string;
  riders: Rider[];
}

// Server → one client on connect: its assigned id, so it can find its own dot.
export interface WelcomeMsg {
  type: "welcome";
  id: string;
}

export type ServerMsg = StateMsg | WelcomeMsg;
