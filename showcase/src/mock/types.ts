export type LngLat = [number, number];

/** ORS step `type` codes, same numbering the real app's TurnGlyph uses. */
export type StepType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export interface RouteStep {
  instruction: string;
  distance: number;
  duration: number;
  type: number;
  name: string;
  /** indices into polyline */
  wayPoints: [number, number] | number[];
}

export interface RouteData {
  polyline: LngLat[] | number[][];
  steps: RouteStep[];
  summary: { distance: number; duration: number };
}

export interface AltRoute {
  polyline: LngLat[] | number[][];
  summary: { distance: number; duration: number };
  via: string;
}

export interface HistTrack {
  track: LngLat[] | number[][];
  distance: number;
  duration: number;
}

export interface Rider {
  id: string;
  name: string;
  color: string;
  /** initials avatar gradient */
  grad: string;
}

export interface Place {
  label: string;
  sub: string;
  lat: number;
  lng: number;
}

export interface Stop {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export interface Ride {
  id: string;
  title: string | null;
  startedAt: number;
  endedAt: number;
  distanceM: number;
  movingS: number;
  maxSpeedMps: number;
  track: LngLat[];
  companions: { id: string; name: string }[];
  note: string | null;
  /** seeds for generated photo art */
  photos: number[];
  joinCode: string;
}

export type Screen = 'boot' | 'departure' | 'planner' | 'motion' | 'archive' | 'detail';
