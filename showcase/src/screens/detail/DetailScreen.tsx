import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ImagePlus, PenLine, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PhotoArt } from '../../components/fx';
import { MapView, type MapLine, type MapMarker } from '../../components/MapView';
import { Avatar, Backdrop, DotRule, GlowButton, IconButton, Sheet, stagger } from '../../components/ui';
import { fmtClock, fmtDuration, fmtLongDate, fmtWeekday, kmh } from '../../mock/format';
import { currentRoute, useApp } from '../../mock/store';
import type { LngLat, Ride } from '../../mock/types';
import { companionGrad } from '../archive/rideArt';
import './detail.css';

const DRAW_STEPS = 36;
const DRAW_MS = 1200;
const DRAW_DELAY_MS = 900;

/* ---------------- Hero: the ride's own trace, drawn on ---------------- */
function RideTrace({ track }: { track: LngLat[] }) {
  // Memoised slices so MapView only receives a new coords array when the step changes.
  const slices = useMemo(
    () =>
      Array.from({ length: DRAW_STEPS + 1 }, (_, k) =>
        track.slice(0, Math.max(2, Math.ceil((track.length * k) / DRAW_STEPS))),
      ),
    [track],
  );
  const [step, setStep] = useState(0);
  useEffect(() => {
    let raf = 0;
    let t0 = 0;
    const timer = setTimeout(() => {
      const tick = (now: number) => {
        if (!t0) t0 = now;
        const p = Math.min(1, (now - t0) / DRAW_MS);
        const eased = 1 - Math.pow(1 - p, 3);
        setStep(Math.round(eased * DRAW_STEPS));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, DRAW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [slices]);

  const done = step >= DRAW_STEPS;
  const lines = useMemo<MapLine[]>(() => (step > 0 ? [{ id: 'dt-trace', coords: slices[step], variant: 'trace' }] : []), [slices, step]);
  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [{ id: 'dt-start', lngLat: track[0], kind: 'start' }];
    if (done) m.push({ id: 'dt-end', lngLat: track[track.length - 1], kind: 'end' });
    return m;
  }, [track, done]);
  const fit = useMemo(
    () => ({ key: `fit-${track.length}-${track[0]?.join(',')}`, points: track, padding: { top: 90, right: 56, bottom: 130, left: 40 }, maxZoom: 14, duration: 0 }),
    [track],
  );
  return <MapView className="dt-map" lines={lines} markers={markers} fit={fit} initial={{ center: track[0], zoom: 10 }} vignette={false} />;
}

/* ---------------- Title (tap to rename) ---------------- */
function Title({ ride }: { ride: Ride }) {
  const renameRide = useApp((s) => s.renameRide);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(ride.title ?? '');
  const commit = () => {
    renameRide(ride.id, value);
    setEditing(false);
  };
  const words = (ride.title ?? 'Ride').split(' ');
  const last = words.pop();
  const head = words.length ? `${words.join(' ')} ` : '';
  if (editing) {
    return (
      <input
        className="dt-title dt-title-input t-serif"
        value={value}
        autoFocus
        placeholder="Name this ride"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setValue(ride.title ?? '');
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <button
      className={`dt-title t-serif ${ride.title ? '' : 'dt-title-empty'}`}
      onClick={() => {
        setValue(ride.title ?? '');
        setEditing(true);
      }}
      aria-label="Rename this ride"
    >
      {head}
      <span className="dt-title-last">
        {last}
        <PenLine size={15} className="dt-title-pen" />
      </span>
    </button>
  );
}

/* ---------------- RideFacts: this ride only, no comparisons ---------------- */
function Fact({ label, value, unit, wide }: { label: string; value: string; unit?: string; wide?: boolean }) {
  return (
    <motion.div variants={stagger.item} className={`dt-fact glass glass-quiet ${wide ? 'dt-fact-wide' : ''}`}>
      <div className="t-label">{label}</div>
      <div className="dt-fact-v">
        <span className="dt-fact-num t-display">{value}</span>
        {unit && <span className="dt-fact-unit t-mono">{unit}</span>}
      </div>
    </motion.div>
  );
}

/** "1 h 12" → number/unit pairs so the numerals carry and the units whisper. */
function Duration({ s }: { s: number }) {
  const parts = fmtDuration(s).split(' ');
  return (
    <>
      {parts.map((p, i) =>
        /\d/.test(p) ? (
          <span key={i} className="dt-fact-num t-display">
            {p}
          </span>
        ) : (
          <span key={i} className="dt-fact-unit t-mono">
            {p}
          </span>
        ),
      )}
    </>
  );
}

function RideFacts({ ride }: { ride: Ride }) {
  const elapsed = Math.max(0, (ride.endedAt - ride.startedAt) / 1000);
  const avg = ride.movingS > 0 ? Math.round((ride.distanceM / ride.movingS) * 3.6) : null;
  return (
    <motion.div className="dt-facts" variants={stagger.container} initial="hidden" animate="show">
      <motion.div variants={stagger.item} className="dt-fact dt-fact-hero glass holo">
        <div className="dt-fact-dots halftone-accent" aria-hidden />
        <div className="t-label">Distance</div>
        <div className="dt-fact-v">
          <span className="dt-hero-num t-display grad-text-accent">{(ride.distanceM / 1000).toFixed(1)}</span>
          <span className="dt-fact-unit t-mono">km</span>
        </div>
      </motion.div>
      <motion.div variants={stagger.item} className="dt-fact glass glass-quiet">
        <div className="t-label">Moving time</div>
        <div className="dt-fact-v">
          <Duration s={ride.movingS} />
        </div>
      </motion.div>
      <motion.div variants={stagger.item} className="dt-fact glass glass-quiet">
        <div className="t-label">Elapsed time</div>
        <div className="dt-fact-v">
          <Duration s={elapsed} />
        </div>
      </motion.div>
      {avg !== null && <Fact label="Average speed" value={String(avg)} unit="km/h" />}
      <Fact label="Max speed" value={String(kmh(ride.maxSpeedMps))} unit="km/h" />
      <motion.div variants={stagger.item} className="dt-fact dt-fact-wide dt-with glass glass-quiet">
        <div className="t-label">With</div>
        {ride.companions.length > 0 ? (
          <div className="dt-with-list">
            {ride.companions.map((c) => (
              <span key={c.id} className="dt-with-item">
                <Avatar name={c.name} grad={companionGrad(c.name)} size={28} />
                <span>{c.name}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="dt-solo t-serif">Solo</div>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ---------------- PhotoStrip ---------------- */
const TILT = [-2.5, 1.8, -1.2, 2.4, -1.8, 1.1];

function PhotoStrip({ ride, onOpen }: { ride: Ride; onOpen: (seed: number) => void }) {
  const addPhoto = useApp((s) => s.addPhoto);
  const [adding, setAdding] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const toEnd = () => requestAnimationFrame(() => strip.current?.scrollTo({ left: strip.current.scrollWidth, behavior: 'smooth' }));
  const add = async () => {
    if (adding) return;
    setAdding(true);
    toEnd();
    await addPhoto(ride.id);
    setAdding(false);
    toEnd();
  };
  return (
    <div className="dt-strip scroll" ref={strip}>
      <motion.button className="dt-add" onClick={add} disabled={adding} whileTap={{ scale: 0.95 }}>
        <ImagePlus size={22} />
        <span>{adding ? 'Adding…' : 'Add a photo'}</span>
      </motion.button>
      <AnimatePresence initial={false}>
        {ride.photos.map((seed, i) => (
          <motion.button
            key={seed}
            className="dt-photo"
            style={{ rotate: TILT[i % TILT.length] }}
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onOpen(seed)}
            aria-label="Open photo"
          >
            <PhotoArt seed={seed} width={112} height={112} radius={10} />
          </motion.button>
        ))}
        {adding && (
          <motion.div
            key="pending"
            className="dt-photo dt-photo-pending"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            <div className="dt-pending-fill shimmer" />
            <span className="t-label">Adding…</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Lightbox({ seed, ride, onClose }: { seed: number | null; ride: Ride; onClose: () => void }) {
  return (
    <AnimatePresence>
      {seed !== null && (
        <motion.div className="dt-lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            className="dt-lightbox-frame"
            initial={{ scale: 0.85, rotate: -3, y: 20 }}
            animate={{ scale: 1, rotate: 0, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            <PhotoArt seed={seed} width={318} height={318} radius={12} />
            <div className="dt-lightbox-cap">
              <span className="t-serif">{ride.title ?? 'Ride'}</span>
              <span className="t-mono">{fmtLongDate(ride.startedAt)}</span>
            </div>
          </motion.div>
          <IconButton label="Close" className="dt-lightbox-close glass-map" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------- JournalNote ---------------- */
function JournalNote({ ride }: { ride: Ride }) {
  const updateNote = useApp((s) => s.updateNote);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(ride.note ?? '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    await updateNote(ride.id, value);
    setSaving(false);
    setValue(value.trim());
    setEditing(false);
  };
  return (
    <AnimatePresence mode="wait" initial={false}>
      {editing ? (
        <motion.div key="edit" className="dt-journal-edit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <textarea
            className="field dt-textarea t-serif"
            value={value}
            autoFocus
            placeholder="Write something about this ride…"
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="dt-journal-actions">
            <GlowButton size="sm" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Done'}
            </GlowButton>
          </div>
        </motion.div>
      ) : (
        <motion.button
          key="read"
          className={`dt-journal t-serif ${ride.note ? '' : 'dt-journal-empty'}`}
          onClick={() => {
            setValue(ride.note ?? '');
            setEditing(true);
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {ride.note ?? 'Add a note about this ride…'}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dt-section">
      <div className="dt-section-head">
        <span className="t-label">{title}</span>
        <DotRule n={22} />
      </div>
      {children}
    </section>
  );
}

/* ---------------- Screen ---------------- */
export function DetailScreen() {
  const rideId = useApp((s) => currentRoute(s).params?.rideId);
  const live = useApp((s) => s.rides.find((r) => r.id === rideId));
  const back = useApp((s) => s.back);
  const replace = useApp((s) => s.replace);
  const belowIsArchive = useApp((s) => s.stack[s.stack.length - 2]?.screen === 'archive');
  const deleteRide = useApp((s) => s.deleteRide);

  // Keep showing the last-known ride while deleting, so the exit doesn't flash "not found".
  const lastRide = useRef<Ride | undefined>(live);
  if (live) lastRide.current = live;
  const [deleting, setDeleting] = useState(false);
  const ride = live ?? (deleting ? lastRide.current : undefined);

  const [confirm, setConfirm] = useState(false);
  const [photo, setPhoto] = useState<number | null>(null);

  const leave = () => (belowIsArchive ? back() : replace('archive'));

  if (!ride) {
    return (
      <div className="dt-root">
        <Backdrop palette="sunset" />
        <IconButton label="Back" className="dt-back" onClick={leave}>
          <ArrowLeft size={18} />
        </IconButton>
        <motion.div className="dt-missing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <DotRule n={18} />
          <p className="t-serif">This ride isn’t here anymore.</p>
          <GlowButton variant="glass" size="sm" onClick={leave}>
            Back to rides
          </GlowButton>
        </motion.div>
      </div>
    );
  }

  const doDelete = async () => {
    setDeleting(true);
    await deleteRide(ride.id);
    setConfirm(false);
    leave();
  };

  return (
    <div className="dt-root">
      <Backdrop palette="sunset" />
      <div className="dt-scroll scroll">
        <div className="dt-hero">
          <RideTrace track={ride.track} />
          <div className="dt-hero-fade" aria-hidden />
        </div>

        <div className="dt-body">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
            <Title ride={ride} />
            <div className="dt-date t-mono">
              {fmtWeekday(ride.startedAt)} · {fmtLongDate(ride.startedAt)} · {fmtClock(ride.startedAt)}
            </div>
          </motion.div>

          <RideFacts ride={ride} />

          <Section title="Photos">
            <PhotoStrip ride={ride} onOpen={setPhoto} />
          </Section>

          <Section title="Journal">
            <JournalNote ride={ride} />
          </Section>

          <div className="dt-foot">
            <GlowButton variant="ghost" size="sm" icon={<Trash2 size={15} />} onClick={() => setConfirm(true)} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete this ride'}
            </GlowButton>
            <DotRule n={14} />
            <span className="dt-code t-mono">Ride {ride.joinCode}</span>
          </div>
        </div>
      </div>

      <div className="dt-topshade" aria-hidden />
      <IconButton label="Back" className="dt-back glass-map" onClick={leave}>
        <ArrowLeft size={18} />
      </IconButton>

      <Lightbox seed={photo} ride={ride} onClose={() => setPhoto(null)} />

      <Sheet open={confirm} onClose={() => !deleting && setConfirm(false)}>
        <div className="dt-sheet">
          <h2 className="t-serif">Delete this ride?</h2>
          <p>This removes the ride and its photos. This can’t be undone.</p>
          <div className="dt-sheet-actions">
            <GlowButton variant="glass" full onClick={() => setConfirm(false)} disabled={deleting}>
              Cancel
            </GlowButton>
            <GlowButton variant="danger" full onClick={doDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </GlowButton>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
