// Planner — the Departure-register route builder. Mirrors mobile/src/app/plan/[code].tsx:
// origin = your location, an ordered list of up to 9 stops (search or tap the map), a debounced
// preview line, pre-commit alternatives when there is exactly one stop, then "Set destination".
import { AnimatePresence, LayoutGroup, animate, motion, useMotionValue, useMotionValueEvent } from 'framer-motion';
import { ArrowDown, ArrowLeft, ArrowUp, ChevronUp, LocateFixed, MapPin, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { MapView, type MapLine, type MapMarker } from '../../components/MapView';
import { DotMeter, Dots, GlowButton, IconButton, Note, fade, spring } from '../../components/ui';
import { ALTERNATIVES, ORIGIN, PLACES, RIDE_CODE, ROUTE_LINE } from '../../mock/data';
import { fmtEta } from '../../mock/format';
import { useApp } from '../../mock/store';
import type { LngLat, Stop } from '../../mock/types';
import './planner.css';

const MAX_STOPS = 9;
const SHEET_MAX = 492; // ≈58% of the 844px phone
const SHEET_PEEK = 268;
const SUGGESTED = ['Nandi Hills', 'Skandagiri', 'Coffee Brew Stop'];
const ORIGIN_LL: LngLat = [ORIGIN.lng, ORIGIN.lat];

const subFor = (s: Stop) => PLACES.find((p) => p.label === s.label && p.lat === s.lat)?.sub;
const coords = (s: Stop) => `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`;

export function PlannerScreen() {
  const back = useApp((s) => s.back);
  const activeCode = useApp((s) => s.activeCode);
  const originState = useApp((s) => s.originState);
  const locateOrigin = useApp((s) => s.locateOrigin);
  const stops = useApp((s) => s.stops);
  const search = useApp((s) => s.search);
  const setQuery = useApp((s) => s.setQuery);
  const runSearch = useApp((s) => s.runSearch);
  const addStop = useApp((s) => s.addStop);
  const addMapPoint = useApp((s) => s.addMapPoint);
  const moveStop = useApp((s) => s.moveStop);
  const removeStop = useApp((s) => s.removeStop);
  const selectedAlt = useApp((s) => s.selectedAlt);
  const selectAlt = useApp((s) => s.selectAlt);
  const preview = useApp((s) => s.preview);
  const committing = useApp((s) => s.committing);
  const commitRoute = useApp((s) => s.commitRoute);

  const [commitFailed, setCommitFailed] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    void locateOrigin();
  }, [locateOrigin]);
  useEffect(() => setCommitFailed(false), [stops]);

  /* ---------------- map ---------------- */
  const showAlts = preview === 'ready' && stops.length === 1 && ALTERNATIVES.length >= 2;
  const lines = useMemo<MapLine[]>(() => {
    if (preview !== 'ready' || !stops.length) return [];
    if (stops.length === 1) {
      const others = ALTERNATIVES.map((a, i) => ({ a, i })).filter(({ i }) => i !== selectedAlt);
      return [
        ...others.map(({ a, i }) => ({ id: `alt-${i}`, coords: a.polyline, variant: 'alt' as const })),
        { id: 'preview', coords: ALTERNATIVES[selectedAlt]?.polyline ?? ROUTE_LINE, variant: 'preview' as const },
      ];
    }
    return [{ id: 'preview', coords: ROUTE_LINE, variant: 'preview' as const }];
  }, [preview, stops.length, selectedAlt]);

  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    if (originState === 'ready') m.push({ id: 'origin', lngLat: ORIGIN_LL, kind: 'origin' });
    const last = stops[stops.length - 1];
    if (last) m.push({ id: 'dest', lngLat: [last.lng, last.lat], kind: 'dest' });
    stops.forEach((s, i) => {
      m.push({ id: s.id, lngLat: [s.lng, s.lat], kind: 'stop', label: String(i + 1) });
    });
    return m;
  }, [originState, stops]);

  const sheetH = expanded ? SHEET_MAX : SHEET_PEEK;
  const fit = useMemo(() => {
    // Always fit through fitBounds (never the single-point easeTo, which ignores padding), so the
    // origin lands in the clear map area above the sheet, not under it or on the city label.
    const pts: LngLat[] = [ORIGIN_LL, ...stops.map((s) => [s.lng, s.lat] as LngLat)];
    if (lines.length) pts.push(...lines[lines.length - 1].coords);
    if (pts.length === 1) pts.push(ORIGIN_LL);
    return {
      key: `${stops.map((s) => s.id).join('|')}:${lines.length}:${selectedAlt}:${sheetH}`,
      points: pts,
      padding: { top: 140, bottom: sheetH + 24, left: 40, right: 40 },
      maxZoom: stops.length ? 13 : 13.5,
      duration: 900,
    };
  }, [stops, lines, selectedAlt, sheetH]);

  /* ---------------- sheet drag ---------------- */
  const h = useMotionValue(SHEET_MAX);
  const startH = useRef(SHEET_MAX);
  const [liveH, setLiveH] = useState(SHEET_MAX);
  useMotionValueEvent(h, 'change', (v) => setLiveH(v));
  const snapTo = (open: boolean) => {
    setExpanded(open);
    animate(h, open ? SHEET_MAX : SHEET_PEEK, spring.soft);
  };

  /* ---------------- search ---------------- */
  const atMax = stops.length >= MAX_STOPS;
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (search.query.trim()) void runSearch();
  };
  const quick = (label: string) => {
    setQuery(label);
    void runSearch();
  };

  const onCommit = async () => {
    setCommitFailed(false);
    const ok = await commitRoute();
    if (ok) back();
    else setCommitFailed(true);
  };

  const maxDur = Math.max(...ALTERNATIVES.map((a) => a.summary.duration));
  const minDur = Math.min(...ALTERNATIVES.map((a) => a.summary.duration));
  const canCommit = stops.length > 0 && preview === 'ready' && originState === 'ready';

  return (
    <div className="pl-root">
      <MapView
        className="pl-map"
        interactive
        markers={markers}
        lines={lines}
        fit={fit}
        initial={{ center: ORIGIN_LL, zoom: 11 }}
        onTap={(ll) => {
          if (!atMax) addMapPoint(ll);
        }}
      />

      {/* top bar */}
      <motion.div className="pl-top" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={fade}>
        <IconButton label="Back" className="glass-map" size={44} onClick={back}>
          <ArrowLeft />
        </IconButton>
        <div className="pl-topmid glass glass-map">
          <span className="pl-toplabel t-label">Plan your route</span>
          <span className="pl-code t-mono">{activeCode ?? RIDE_CODE}</span>
        </div>
      </motion.div>

      {/* bottom sheet */}
      <motion.section
        className="pl-sheet glass glass-map"
        style={{ height: h }}
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={spring.soft}
      >
        <motion.div
          className="pl-handle"
          role="button"
          aria-label={expanded ? 'Collapse planner' : 'Expand planner'}
          onTap={() => snapTo(!expanded)}
          onPanStart={() => {
            startH.current = h.get();
          }}
          onPan={(_, info) => {
            h.set(Math.max(SHEET_PEEK - 30, Math.min(SHEET_MAX + 20, startH.current - info.offset.y)));
          }}
          onPanEnd={(_, info) => {
            const v = h.get() - info.velocity.y * 0.15;
            snapTo(v > (SHEET_MAX + SHEET_PEEK) / 2);
          }}
        >
          <i />
          <motion.span className="pl-handle-chev" animate={{ rotate: expanded ? 180 : 0, opacity: liveH < SHEET_MAX - 4 ? 1 : 0.35 }}>
            <ChevronUp size={14} />
          </motion.span>
        </motion.div>

        <div className="pl-scroll scroll">
          <div className="pl-head">
            <h1 className="pl-title t-display">Plan your route</h1>
            <span className="t-label pl-count">
              {stops.length ? `${stops.length} of ${MAX_STOPS} stops` : 'No stops yet'}
            </span>
          </div>

          {/* spine: origin + stops */}
          <div className="pl-spine">
            <div className="pl-row pl-origin">
              <div className="pl-rail">
                <span className={`pl-odot ${originState}`}>
                  <LocateFixed size={12} />
                </span>
                <span className="pl-vdots" aria-hidden />
              </div>
              <div className="pl-rowbody">
                <div className="pl-label">
                  {originState === 'ready' && 'Your location'}
                  {originState === 'finding' && (
                    <span className="pl-finding">
                      Finding your location… <Dots />
                    </span>
                  )}
                  {originState === 'unavailable' && <span className="pl-unavail">Your location — unavailable</span>}
                </div>
                {originState === 'ready' && <div className="pl-sub t-mono">{ORIGIN.sub}</div>}
              </div>
            </div>
            <AnimatePresence>
              {originState === 'unavailable' && (
                <div className="pl-note-wrap">
                  <Note action={{ label: 'Retry', onClick: () => void locateOrigin() }}>
                    Couldn’t get a location fix. Move somewhere with a clearer view of the sky, then retry.
                  </Note>
                </div>
              )}
            </AnimatePresence>

            <LayoutGroup>
              <AnimatePresence initial={false}>
                {stops.map((s, i) => {
                  const last = i === stops.length - 1;
                  return (
                    <motion.div
                      key={s.id}
                      layout
                      className="pl-row pl-stop"
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 16, transition: { duration: 0.18 } }}
                      transition={spring.snappy}
                    >
                      <div className="pl-rail">
                        <span className={`pl-sdot ${last ? 'is-dest' : ''}`}>{i + 1}</span>
                        {!last && <span className="pl-vdots" aria-hidden />}
                      </div>
                      <div className="pl-rowbody">
                        <div className="pl-label">{s.label}</div>
                        <div className="pl-sub t-mono">{subFor(s) ?? coords(s)}</div>
                      </div>
                      <div className="pl-acts">
                        <IconButton label="Move up" size={30} className="pl-ib" disabled={i === 0} onClick={() => moveStop(i, -1)}>
                          <ArrowUp />
                        </IconButton>
                        <IconButton label="Move down" size={30} className="pl-ib" disabled={last} onClick={() => moveStop(i, 1)}>
                          <ArrowDown />
                        </IconButton>
                        <IconButton label="Remove stop" size={30} className="pl-ib pl-rm" onClick={() => removeStop(i)}>
                          <X />
                        </IconButton>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </LayoutGroup>

            {!stops.length && (
              <motion.div className="pl-row pl-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
                <div className="pl-rail">
                  <span className="pl-ghost">
                    <i />
                  </span>
                </div>
                <div className="pl-rowbody">
                  <div className="pl-hint">Search, or tap the map to drop a stop.</div>
                </div>
              </motion.div>
            )}
          </div>

          {/* alternatives */}
          <AnimatePresence>
            {showAlts && (
              <motion.div
                className="pl-alts"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={fade}
              >
                <div className="t-label pl-altlabel">Routes</div>
                <div className="pl-altrow scroll">
                  {ALTERNATIVES.map((a, i) => {
                    const sel = i === selectedAlt;
                    const rel = maxDur === minDur ? 1 : 0.35 + (0.65 * (a.summary.duration - minDur)) / (maxDur - minDur);
                    return (
                      <motion.button
                        key={i}
                        className={`pl-alt glass ${sel ? 'holo is-sel' : 'glass-quiet'}`}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => selectAlt(i)}
                        aria-pressed={sel}
                      >
                        <span className="pl-alteta t-display">{fmtEta(a.summary.duration)}</span>
                        <span className="pl-altmeta t-mono">
                          {Math.round(a.summary.distance / 1000)} km · via {a.via}
                        </span>
                        <span className="pl-alttime" aria-label="Relative ride time">
                          <span className="t-label">Time</span>
                          <DotMeter value={rel} n={14} />
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* preview status */}
          <AnimatePresence>
            {preview === 'loading' && (
              <motion.div key="pload" className="pl-drawing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <span className="pl-drawbar shimmer" />
                <span className="t-mono">Drawing route…</span>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {preview === 'error' && <Note key="perr">Route unavailable.</Note>}
          </AnimatePresence>
          <AnimatePresence>
            {commitFailed && preview !== 'error' && <Note key="cerr">Couldn’t set that destination.</Note>}
          </AnimatePresence>
          {/* search */}
          {atMax ? (
            <div className="pl-max t-mono">Maximum 9 stops.</div>
          ) : (
            <div className="pl-search">
              <form className="pl-form" onSubmit={submit}>
                <MapPin className="pl-fieldicon" size={16} />
                <input
                  className="field pl-field"
                  placeholder="Search for a destination"
                  value={search.query}
                  onChange={(e) => setQuery(e.target.value)}
                  enterKeyHint="search"
                />
                <IconButton label="Search" size={38} className="pl-go" type="submit" disabled={!search.query.trim()}>
                  <Search />
                </IconButton>
              </form>

              <AnimatePresence mode="popLayout" initial={false}>
                {search.phase === 'idle' && !search.query && !stops.length && (
                  <motion.div key="chips" className="pl-chips" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
                    <span className="t-label pl-chiplabel">Try</span>
                    {SUGGESTED.map((s) => (
                      <motion.button key={s} className="pl-chip" whileTap={{ scale: 0.95 }} onClick={() => quick(s)}>
                        {s}
                      </motion.button>
                    ))}
                  </motion.div>
                )}
                {search.phase === 'searching' && (
                  <motion.div key="searching" className="pl-results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
                    <div className="pl-status t-mono">Searching…</div>
                    {[0, 1, 2].map((k) => (
                      <div key={k} className="pl-skel">
                        <i className="shimmer" style={{ width: `${62 - k * 12}%` }} />
                        <i className="shimmer" style={{ width: `${40 - k * 6}%` }} />
                      </div>
                    ))}
                  </motion.div>
                )}
                {search.phase === 'results' && (
                  <motion.ul key="results" className="pl-results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
                    {search.results.map((p, k) => (
                      <motion.li
                        key={p.label}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ ...fade, delay: k * 0.04 }}
                      >
                        <button className="pl-result" onClick={() => addStop(p)}>
                          <span className="pl-rdot" />
                          <span className="pl-rtext">
                            <span className="pl-label">{p.label}</span>
                            <span className="pl-sub t-mono">{p.sub}</span>
                          </span>
                          <span className="pl-radd t-label">Add</span>
                        </button>
                      </motion.li>
                    ))}
                  </motion.ul>
                )}
                {search.phase === 'empty' && (
                  <motion.div key="empty" className="pl-status t-mono" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    No results.
                  </motion.div>
                )}
                {search.phase === 'error' && (
                  <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <Note>Search unavailable.</Note>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

        </div>

        <div className="pl-foot">
          <AnimatePresence initial={false}>
            {stops.length > 0 && (
              <motion.div
                key="cap"
                className="pl-footcap t-label"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={fade}
              >
                Set destination · whole convoy
              </motion.div>
            )}
          </AnimatePresence>
          <GlowButton full size="lg" disabled={!canCommit || committing} loading={committing} onClick={onCommit}>
            {committing ? 'Setting…' : stops.length ? 'Send to convoy' : 'Set destination'}
          </GlowButton>
        </div>
      </motion.section>
    </div>
  );
}
