import { ALT_ROUTES, HIST_TRACKS, MAIN_ROUTE } from './geo';
import { cumulative } from './geoutil';
import type { LngLat, Place, Ride, Rider, RouteStep } from './types';

export const RIDE_CODE = 'H3K7M2';
/** The real app's join-code alphabet: no O/0/I/1. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** A code the showcase treats as "known" when joining, besides RIDE_CODE. */
export const JOINABLE_CODES = [RIDE_CODE, 'NANDI7', 'R4DX2Q'];

export const ME: Rider = {
  id: 'me',
  name: 'Alex',
  color: '#22d3ee',
  grad: 'linear-gradient(135deg,#22d3ee,#7c5cff)',
};

/** Convoy co-riders. Ordered by id — never a ranking. */
export const CONVOY: Rider[] = [
  { id: 'r1', name: 'Sam', color: '#ff4fd8', grad: 'linear-gradient(135deg,#ff4fd8,#ff7a59)' },
  { id: 'r2', name: 'Rio', color: '#b8ff5c', grad: 'linear-gradient(135deg,#b8ff5c,#22d3ee)' },
  { id: 'r3', name: 'Maya', color: '#ffd166', grad: 'linear-gradient(135deg,#ffd166,#ff5c8a)' },
];

/** Metres behind (−) or ahead (+) of you each co-rider rides, and their pace wobble phase. */
export const CONVOY_OFFSETS: Record<string, { gap: number; phase: number }> = {
  r1: { gap: -140, phase: 0.3 },
  r2: { gap: 95, phase: 1.7 },
  r3: { gap: -320, phase: 2.9 },
};

export const ROUTE_LINE = MAIN_ROUTE.polyline as LngLat[];
export const ROUTE_STEPS = MAIN_ROUTE.steps as RouteStep[];
export const ROUTE_SUMMARY = MAIN_ROUTE.summary;
export const ROUTE_CUM = cumulative(ROUTE_LINE);
export const ROUTE_TOTAL = ROUTE_CUM[ROUTE_CUM.length - 1];
export const ALTERNATIVES = ALT_ROUTES.map((a) => ({ ...a, polyline: a.polyline as LngLat[] }));

export const ORIGIN: Place = {
  label: 'Your location',
  sub: 'Cubbon Park, Bengaluru',
  lat: 12.97685,
  lng: 77.59236,
};

export const DESTINATION: Place = {
  label: 'Nandi Hills',
  sub: 'Chikkaballapur, Karnataka',
  lat: 13.3702,
  lng: 77.6835,
};

/** Mock geocoder catalogue. Search matches on label/sub, case-insensitive. */
export const PLACES: Place[] = [
  DESTINATION,
  { label: 'Nandi Hills Viewpoint', sub: 'Tipu’s Drop, Nandi Hills', lat: 13.3727, lng: 77.6829 },
  { label: 'Nandi Village', sub: 'Chikkaballapur district', lat: 13.3431, lng: 77.7026 },
  { label: 'Skandagiri', sub: 'Kalavara, Chikkaballapur', lat: 13.4204, lng: 77.6874 },
  { label: 'Devanahalli Fort', sub: 'Devanahalli, Bengaluru Rural', lat: 13.2437, lng: 77.7123 },
  { label: 'Hebbal Lake', sub: 'Hebbal, Bengaluru', lat: 13.0457, lng: 77.5901 },
  { label: 'Mysuru Palace', sub: 'Mysuru, Karnataka', lat: 12.3052, lng: 76.6552 },
  { label: 'Savandurga', sub: 'Magadi, Ramanagara', lat: 12.9196, lng: 77.2924 },
  { label: 'Ramanagara Hills', sub: 'Ramanagara', lat: 12.7209, lng: 77.2799 },
  { label: 'Coffee Brew Stop', sub: 'Yelahanka New Town', lat: 13.1007, lng: 77.5963 },
  { label: 'Café Noir', sub: 'Indiranagar, Bengaluru', lat: 12.9719, lng: 77.6412 },
  { label: 'Shell Fuel — Hebbal', sub: 'Bellary Road', lat: 13.0358, lng: 77.597 },
];

const DAY = 86400000;
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime();

function ride(
  i: number,
  title: string | null,
  start: number,
  movingS: number,
  pauseS: number,
  maxKmh: number,
  companions: string[],
  note: string | null,
  photos: number[],
): Ride {
  const h = HIST_TRACKS[i];
  return {
    id: `ride-${i + 1}`,
    title,
    startedAt: start,
    endedAt: start + (movingS + pauseS) * 1000,
    distanceM: h.distance,
    movingS,
    maxSpeedMps: maxKmh / 3.6,
    track: h.track as LngLat[],
    companions: companions.map((n) => {
      const r = CONVOY.find((c) => c.name === n);
      return { id: r?.id ?? n.toLowerCase(), name: n };
    }),
    note,
    photos,
    joinCode: ['M4YSR2', 'S4VDGA', 'RMNGR8', 'ECTY5K', 'CHKMG3', 'HSR9TN'][i],
  };
}

/** Past rides, newest first. Facts are about one ride only — no totals, no comparisons. */
export const SEED_RIDES: Ride[] = [
  ride(
    0,
    'Palace roads to Mysuru',
    at(2026, 10, 4, 5, 48),
    3 * 3600 + 22 * 60,
    38 * 60,
    96,
    ['Sam', 'Rio', 'Maya'],
    'Left before sunrise so the expressway was empty. Breakfast at Maddur — vadas, obviously. The last stretch into Mysuru in that gold light was the whole point.',
    [11, 12, 13, 14],
  ),
  ride(
    4,
    'Western Ghats, the long way',
    at(2026, 8, 16, 6, 10),
    6 * 3600 + 5 * 60,
    95 * 60,
    88,
    ['Maya'],
    'Fog on every hairpin past Mudigere. Coffee estates both sides. Maya’s visor fogged so badly we stopped twice just to laugh about it.',
    [21, 22, 23, 24, 25],
  ),
  ride(1, 'Savandurga sunrise', at(2026, 7, 6, 5, 20), 1 * 3600 + 34 * 60, 52 * 60, 79, ['Sam'], null, [31, 32]),
  ride(
    5,
    null,
    at(2026, 3, 21, 16, 40),
    1 * 3600 + 18 * 60,
    15 * 60,
    82,
    ['Rio', 'Sam'],
    'Quick loop to Hosur after work. Rio found a dhaba with the best chai of the year.',
    [41],
  ),
  ride(2, 'Ramanagara rocks', at(2025, 12, 14, 7, 5), 1 * 3600 + 26 * 60, 40 * 60, 84, ['Sam', 'Maya'], null, [51, 52, 53]),
  ride(
    3,
    'City evening ride',
    at(2025, 11, 2, 18, 15),
    52 * 60,
    6 * 60,
    61,
    [],
    'Just me and the lights on the elevated road.',
    [],
  ),
];

export const DAY_MS = DAY;
