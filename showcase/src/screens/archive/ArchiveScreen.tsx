import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { Avatar, Backdrop, DotRule, IconButton, stagger } from '../../components/ui';
import { PhotoArt } from '../../components/fx';
import { fmtDuration, fmtShortDate } from '../../mock/format';
import { useApp } from '../../mock/store';
import type { Ride } from '../../mock/types';
import { RideThumb, companionGrad } from './rideArt';
import './archive.css';

type Row = { kind: 'year'; year: number } | { kind: 'ride'; ride: Ride; hero: boolean };

/**
 * Year dividers exist for navigation only (ADR-019 §2) — never a count or total beside them.
 */
function toRows(rides: Ride[]): Row[] {
  const rows: Row[] = [];
  let lastYear: number | null = null;
  rides.forEach((ride, i) => {
    const year = new Date(ride.startedAt).getFullYear();
    if (year !== lastYear) {
      rows.push({ kind: 'year', year });
      lastYear = year;
    }
    rows.push({ kind: 'ride', ride, hero: i === 0 });
  });
  return rows;
}

function meta(r: Ride) {
  return `${fmtShortDate(r.startedAt)} · ${(r.distanceM / 1000).toFixed(1)} km · ${fmtDuration(r.movingS)}`;
}

function Companions({ ride, size = 22 }: { ride: Ride; size?: number }) {
  if (ride.companions.length === 0) return null;
  return (
    <span className="ar-faces" aria-label={`With ${ride.companions.map((c) => c.name).join(', ')}`}>
      {ride.companions.map((c) => (
        <Avatar key={c.id} name={c.name} grad={companionGrad(c.name)} size={size} />
      ))}
    </span>
  );
}

function Photos({ ride, size = 26 }: { ride: Ride; size?: number }) {
  if (ride.photos.length === 0) return null;
  return (
    <span className="ar-photos" aria-hidden>
      {ride.photos.slice(0, 3).map((seed, i) => (
        <span key={seed} className="ar-photo" style={{ transform: `rotate(${[-6, 3, -2][i]}deg)` }}>
          <PhotoArt seed={seed} width={size} height={size} radius={6} />
        </span>
      ))}
    </span>
  );
}

function Title({ ride, className }: { ride: Ride; className: string }) {
  return ride.title ? (
    <div className={className}>{ride.title}</div>
  ) : (
    <div className={`${className} ar-untitled`}>Untitled ride</div>
  );
}

function HeroCard({ ride, onOpen }: { ride: Ride; onOpen: () => void }) {
  return (
    <motion.button variants={stagger.item} className="ar-hero glass holo" onClick={onOpen} whileTap={{ scale: 0.985 }}>
      <div className="ar-hero-map">
        <div className="ar-hero-dots halftone-accent" aria-hidden />
        <RideThumb track={ride.track} width={318} height={150} pad={18} draw weight={1.3} />
        <span className="ar-hero-tag t-label">Most recent</span>
      </div>
      <div className="ar-hero-body">
        <Title ride={ride} className="ar-hero-title t-serif" />
        <div className="ar-meta t-mono">{meta(ride)}</div>
        {(ride.companions.length > 0 || ride.photos.length > 0) && (
          <div className="ar-row">
            <Companions ride={ride} size={24} />
            <Photos ride={ride} size={30} />
          </div>
        )}
      </div>
    </motion.button>
  );
}

function RideRow({ ride, onOpen }: { ride: Ride; onOpen: () => void }) {
  return (
    <motion.button variants={stagger.item} className="ar-card glass glass-quiet" onClick={onOpen} whileTap={{ scale: 0.985 }}>
      <div className="ar-thumb">
        <div className="ar-thumb-dots" aria-hidden />
        <RideThumb track={ride.track} width={78} height={78} pad={10} />
      </div>
      <div className="ar-card-body">
        <Title ride={ride} className="ar-card-title t-serif" />
        <div className="ar-meta t-mono">{meta(ride)}</div>
        {(ride.companions.length > 0 || ride.photos.length > 0) && (
          <div className="ar-row">
            <Companions ride={ride} />
            <Photos ride={ride} />
          </div>
        )}
      </div>
    </motion.button>
  );
}

function EmptyHorizon() {
  // A dotted sun half-sunk behind a dotted horizon line — drawn, not a stock illustration.
  const sun: { x: number; y: number; r: number; o: number }[] = [];
  for (let row = 0; row < 9; row++) {
    const y = 96 - row * 9;
    const half = Math.sqrt(Math.max(0, 70 * 70 - (row * 9) ** 2));
    for (let x = 140 - half; x <= 140 + half; x += 9) {
      sun.push({ x, y, r: 2.4 - row * 0.15, o: 1 - row * 0.08 });
    }
  }
  const ground = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 32 }, (_, i) => ({ x: 4 + i * 8.9, y: 108 + row * 10 + row * row * 2, o: 0.55 - row * 0.12 })),
  ).flat();
  return (
    <svg className="ar-empty-art" width="280" height="160" viewBox="0 0 280 160" aria-hidden>
      <defs>
        <linearGradient id="ar-empty-g" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#ff4fd8" />
          <stop offset="50%" stopColor="#ff7a59" />
          <stop offset="100%" stopColor="#ffd166" />
        </linearGradient>
      </defs>
      <g fill="url(#ar-empty-g)" className="ar-empty-sun">
        {sun.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.r} opacity={d.o} />
        ))}
      </g>
      <line x1="0" x2="280" y1="102" y2="102" stroke="url(#ar-empty-g)" strokeWidth="1" opacity="0.6" />
      <g fill="#ffffff">
        {ground.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={1.1} opacity={d.o * (1 - Math.abs(d.x - 140) / 170)} />
        ))}
      </g>
    </svg>
  );
}

export function ArchiveScreen() {
  const rides = useApp((s) => s.rides);
  const empty = useApp((s) => s.scenario.emptyHistory) || rides.length === 0;
  const go = useApp((s) => s.go);
  const back = useApp((s) => s.back);
  const rows = empty ? [] : toRows(rides);

  return (
    <div className="ar-root">
      <Backdrop palette="sunset" />
      <div className="ar-scroll scroll">
        <header className="ar-head">
          <IconButton label="Back" onClick={back}>
            <ArrowLeft size={18} />
          </IconButton>
          <motion.h1
            className="ar-title t-serif"
            initial={{ opacity: 0, y: 10, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            Rides
          </motion.h1>
          <motion.p className="ar-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.6 }}>
            Every road you finished, kept as you left it.
          </motion.p>
        </header>

        {empty ? (
          <motion.div className="ar-empty" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.6 }}>
            <EmptyHorizon />
            <p className="ar-empty-text t-serif">Your first finished ride will show up here.</p>
          </motion.div>
        ) : (
          <motion.div className="ar-list" variants={stagger.container} initial="hidden" animate="show">
            {rows.map((row) =>
              row.kind === 'year' ? (
                <motion.div key={`y-${row.year}`} variants={stagger.item} className="ar-year">
                  <span className="t-label">{row.year}</span>
                  <DotRule n={24} />
                </motion.div>
              ) : row.hero ? (
                <HeroCard key={row.ride.id} ride={row.ride} onOpen={() => go('detail', { rideId: row.ride.id })} />
              ) : (
                <RideRow key={row.ride.id} ride={row.ride} onOpen={() => go('detail', { rideId: row.ride.id })} />
              ),
            )}
          </motion.div>
        )}
      </div>
      <div className="ar-topshade" aria-hidden />
    </div>
  );
}
