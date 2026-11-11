// The ride simulator. A pure step function over SimState, driven at 4 Hz by useSimDriver.
// Rules mirror mobile/src/features/motion: imminent < 30 m, off-route > 50 m, spoken tiers at
// 800 m / 200 m / speed×5 s (clamped 60–250 m), never speaking while imminent.
import { CONVOY, CONVOY_OFFSETS, ROUTE_CUM, ROUTE_LINE, ROUTE_STEPS, ROUTE_SUMMARY, ROUTE_TOTAL } from './data';
import { compass8, offset, pointAlong, sliceAlong } from './geoutil';
import type { LngLat, RouteStep } from './types';

export const IMMINENT_M = 30;
export const STALE_AFTER_S = 10;
export const OFF_ROUTE_M = 140;

export interface ConvoyDot {
  id: string;
  name: string;
  color: string;
  pos: LngLat;
  speed: number;
  ageSec: number;
}

export interface Caption {
  id: number;
  text: string;
  tier: 'far' | 'near' | 'final';
}

export interface SimState {
  running: boolean;
  /** demo time-lapse: distance advances this many times faster than the shown speed */
  timeScale: number;
  t: number;
  along: number;
  speed: number;
  heading: number;
  pos: LngLat;
  /** where the rider actually is (differs from pos only while off-route) */
  stoppedFor: number;
  movingS: number;
  maxSpeed: number;
  ridden: LngLat[];
  spoken: Record<string, true>;
  caption: Caption | null;
  convoy: ConvoyDot[];
  offRouteFor: number;
  staleFor: number;
}

export interface SimFlags {
  offRoute: boolean;
  staleRider: boolean;
  forceStop: boolean;
  voiceEnabled: boolean;
  coRiderTalking: boolean;
  waitingGps: boolean;
}

export function initialSim(): SimState {
  return {
    running: false,
    timeScale: 6,
    t: 0,
    along: 0,
    speed: 0,
    heading: pointAlong(ROUTE_LINE, ROUTE_CUM, 0).heading,
    pos: ROUTE_LINE[0],
    stoppedFor: 0,
    movingS: 0,
    maxSpeed: 0,
    ridden: [ROUTE_LINE[0]],
    spoken: {},
    caption: null,
    convoy: [],
    offRouteFor: 0,
    staleFor: 0,
  };
}

/** Index of the next maneuver step ahead of `along` (skips the depart step). */
export function nextStepIndex(along: number): number {
  for (let i = 1; i < ROUTE_STEPS.length; i++) {
    const startIdx = ROUTE_STEPS[i].wayPoints[0] as number;
    if (ROUTE_CUM[startIdx] > along + 1) return i;
  }
  return ROUTE_STEPS.length - 1;
}

export function stepAlong(i: number): number {
  return ROUTE_CUM[ROUTE_STEPS[i].wayPoints[0] as number];
}

export interface Derived {
  step: RouteStep;
  stepIndex: number;
  /** street the rider is on now */
  currentName: string;
  distToTurn: number;
  imminent: boolean;
  arrived: boolean;
  remaining: number;
  etaS: number;
  offRoute: boolean;
  offRouteText: string;
  /** dashed personal detour back to the shared line, once "rerouted" */
  rejoin: LngLat[] | null;
  selfPos: LngLat;
  endAvailable: boolean;
}

export function derive(s: SimState, flags: SimFlags): Derived {
  const stepIndex = nextStepIndex(s.along);
  const step = ROUTE_STEPS[stepIndex];
  const prev = ROUTE_STEPS[Math.max(0, stepIndex - 1)];
  const distToTurn = Math.max(0, stepAlong(stepIndex) - s.along);
  const remaining = Math.max(0, ROUTE_TOTAL - s.along);
  const arrived = remaining < 25;
  let selfPos = s.pos;
  let rejoin: LngLat[] | null = null;
  let offRouteText = '';
  if (flags.offRoute) {
    // You drifted onto a parallel road on your right. The way back is to your left.
    selfPos = offset(s.pos, s.heading + 90, OFF_ROUTE_M);
    offRouteText = `Off route · ${OFF_ROUTE_M} m ${compass8(s.heading - 90)}`;
    if (s.offRouteFor > 2.5) {
      const ahead = pointAlong(ROUTE_LINE, ROUTE_CUM, s.along + 650).point;
      const mid = offset(pointAlong(ROUTE_LINE, ROUTE_CUM, s.along + 320).point, s.heading + 90, OFF_ROUTE_M * 0.8);
      rejoin = [selfPos, mid, ahead];
    }
  }
  return {
    step,
    stepIndex,
    currentName: prev.name,
    distToTurn,
    imminent: !arrived && distToTurn < IMMINENT_M,
    arrived,
    remaining,
    etaS: (remaining / ROUTE_TOTAL) * ROUTE_SUMMARY.duration,
    offRoute: flags.offRoute,
    offRouteText,
    rejoin,
    selfPos,
    endAvailable: arrived || s.stoppedFor >= 5,
  };
}

function cruiseFor(stepIndex: number, distToTurn: number, arrived: boolean, forceStop: boolean): number {
  if (arrived || forceStop) return 0;
  const step = ROUTE_STEPS[stepIndex - 1] ?? ROUTE_STEPS[0];
  // city streets for the first few steps, highway after the Bellary Road merge, hill road at the end
  let cruise = step.distance > 5000 ? 21 : step.distance > 2000 ? 15 : 11;
  if (stepIndex >= ROUTE_STEPS.length - 2) cruise = 12;
  if (distToTurn < 90) cruise = Math.min(cruise, 6 + distToTurn * 0.06);
  return cruise;
}

let captionId = 0;

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Advance the sim by `dt` real seconds. */
export function stepSim(s: SimState, dt: number, flags: SimFlags): SimState {
  if (!s.running) return s;
  const n: SimState = { ...s, t: s.t + dt };
  const d0 = derive(s, flags);
  const target = flags.waitingGps ? s.speed : cruiseFor(d0.stepIndex, d0.distToTurn, d0.arrived, flags.forceStop);
  const wobble = Math.sin(n.t * 0.7) * 0.6;
  n.speed = Math.max(0, s.speed + (target + (target > 0 ? wobble : 0) - s.speed) * Math.min(1, dt * 1.6));
  if (n.speed < 0.3 && target === 0) n.speed = 0;

  if (!flags.waitingGps) {
    n.along = Math.min(ROUTE_TOTAL, s.along + n.speed * dt * s.timeScale);
    const p = pointAlong(ROUTE_LINE, ROUTE_CUM, n.along);
    n.pos = p.point;
    // ease heading so the heading-up camera doesn't snap at every vertex
    const dh = ((p.heading - s.heading + 540) % 360) - 180;
    n.heading = (s.heading + dh * Math.min(1, dt * 2.5) + 360) % 360;
  }

  n.stoppedFor = n.speed < 1 ? s.stoppedFor + dt : 0;
  if (n.speed >= 1) n.movingS = s.movingS + dt * s.timeScale;
  n.maxSpeed = Math.max(s.maxSpeed, n.speed);
  n.offRouteFor = flags.offRoute ? s.offRouteFor + dt : 0;
  n.staleFor = flags.staleRider ? s.staleFor + dt : 0;

  const last = s.ridden[s.ridden.length - 1];
  if (Math.abs(last[0] - n.pos[0]) + Math.abs(last[1] - n.pos[1]) > 0.00015) n.ridden = [...s.ridden, n.pos];

  // convoy — co-riders hold loose gaps around you; one can go stale (its fixes stop arriving)
  n.convoy = CONVOY.map((r, i) => {
    const o = CONVOY_OFFSETS[r.id];
    const isStale = flags.staleRider && i === 2;
    const prevDot = s.convoy[i];
    if (isStale && prevDot) return { ...prevDot, ageSec: STALE_AFTER_S + 1 + n.staleFor, speed: prevDot.speed };
    const along = Math.max(0, n.along + o.gap + Math.sin(n.t * 0.25 + o.phase) * 30);
    const p = pointAlong(ROUTE_LINE, ROUTE_CUM, along);
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      pos: offset(p.point, p.heading + 90, (i - 1) * 4),
      speed: Math.max(0, n.speed + Math.sin(n.t * 0.4 + o.phase)),
      ageSec: 0,
    };
  });

  // spoken guidance tiers
  const d = derive(n, flags);
  if (s.caption && n.t - s.caption.id / 1000 > 4) n.caption = null;
  if (flags.voiceEnabled && !d.arrived && !d.offRoute) {
    const finalM = Math.min(250, Math.max(60, n.speed * 5));
    const tiers: [Caption['tier'], number][] = [
      ['far', 800],
      ['near', 200],
      ['final', finalM],
    ];
    for (const [tier, m] of tiers) {
      const key = `${d.stepIndex}:${tier}`;
      if (n.spoken[key] || d.imminent) continue;
      if (d.distToTurn <= m && (tier !== 'far' || d.distToTurn > 200) && (tier !== 'near' || d.distToTurn > finalM)) {
        // a co-rider talking means: skip this fix, retry on the next — don't queue
        if (flags.coRiderTalking) break;
        const instr = d.step.instruction;
        const text = tier === 'final' ? instr : `In ${m} metres, ${lowerFirst(instr)}`;
        captionId = n.t * 1000;
        n.spoken = { ...n.spoken, [key]: true };
        n.caption = { id: captionId, text, tier };
        break;
      }
    }
    if (d.imminent && n.caption) n.caption = null;
  }
  return n;
}

/** Jump the sim to just before the next turn so the demo shows cues and speech. */
export function jumpBeforeNextTurn(s: SimState, metresBefore = 260): SimState {
  const i = nextStepIndex(s.along + metresBefore + 5);
  const along = Math.max(0, stepAlong(i) - metresBefore);
  const p = pointAlong(ROUTE_LINE, ROUTE_CUM, along);
  const spoken = { ...s.spoken };
  delete spoken[`${i}:near`];
  delete spoken[`${i}:final`];
  spoken[`${i}:far`] = true;
  return { ...s, along, pos: p.point, heading: p.heading, spoken, caption: null, ridden: [...s.ridden, ...sliceAlong(ROUTE_LINE, ROUTE_CUM, s.along, along)] };
}

export function jumpToArrival(s: SimState): SimState {
  const along = ROUTE_TOTAL - 180;
  const p = pointAlong(ROUTE_LINE, ROUTE_CUM, along);
  return { ...s, along, pos: p.point, heading: p.heading, caption: null, ridden: [...s.ridden, ...sliceAlong(ROUTE_LINE, ROUTE_CUM, s.along, along)] };
}
