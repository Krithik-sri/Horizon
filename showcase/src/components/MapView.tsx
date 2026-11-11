// Declarative wrapper over maplibre-gl. Real OpenFreeMap tiles (no key), recoloured into the
// Aurora night palette at style load. Lines and markers are diffed by id on every render.
import type { Feature, LineString } from 'geojson';
import maplibregl, { type GeoJSONSource, type LngLatLike, type Map as MlMap, type PaddingOptions } from 'maplibre-gl';
import { useEffect, useRef, type CSSProperties } from 'react';
import type { LngLat } from '../mock/types';
import { recolorStyle } from './mapStyle';
import './map.css';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

export type LineVariant = 'glow' | 'dim' | 'dashed' | 'alt' | 'trace' | 'preview';

export interface MapLine {
  id: string;
  coords: LngLat[];
  variant: LineVariant;
  /** optional emphasis for 'alt' lines (the selected alternative) */
  selected?: boolean;
}

export type MarkerKind = 'self' | 'rider' | 'stop' | 'origin' | 'dest' | 'start' | 'end';

export interface MapMarker {
  id: string;
  lngLat: LngLat;
  kind: MarkerKind;
  color?: string;
  /** text inside the marker (stop number) or a name tag beside it */
  label?: string;
  stale?: boolean;
  /** self marker: heading cone rotation in screen degrees (0 = up) */
  heading?: number;
}

export interface Camera {
  center: LngLat;
  zoom: number;
  pitch?: number;
  bearing?: number;
  padding?: Partial<PaddingOptions>;
  /** ms; 0 jumps */
  duration?: number;
}

export interface MapViewProps {
  lines?: MapLine[];
  markers?: MapMarker[];
  camera?: Camera;
  /** fit these points; refits whenever `key` changes */
  fit?: { key: string; points: LngLat[]; padding?: number | Partial<PaddingOptions>; maxZoom?: number; duration?: number };
  interactive?: boolean;
  onTap?: (lngLat: LngLat) => void;
  onLongPress?: (lngLat: LngLat) => void;
  /** initial view before camera/fit apply */
  initial?: { center: LngLat; zoom: number };
  className?: string;
  style?: CSSProperties;
  /** colourful gradient vignette over the tiles */
  vignette?: boolean;
}

const VARIANT_LAYERS: Record<LineVariant, (id: string, selected?: boolean) => maplibregl.LayerSpecification[]> = {
  glow: (id) => [
    {
      id: `${id}-halo`,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#7c5cff', 'line-width': 22, 'line-blur': 14, 'line-opacity': 0.55 },
    },
    {
      id: `${id}-core`,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': 6,
        'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#22d3ee', 0.5, '#7c5cff', 1, '#ff4fd8'],
      },
    },
    {
      id: `${id}-shine`,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 1.4, 'line-opacity': 0.55 },
    },
  ],
  trace: (id) => [
    {
      id: `${id}-halo`,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ff4fd8', 'line-width': 16, 'line-blur': 10, 'line-opacity': 0.5 },
    },
    {
      id: `${id}-core`,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': 4.5,
        'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#ffd166', 0.45, '#ff7a59', 1, '#ff4fd8'],
      },
    },
  ],
  preview: (id) => [
    {
      id: `${id}-halo`,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#22d3ee', 'line-width': 18, 'line-blur': 12, 'line-opacity': 0.45 },
    },
    {
      id: `${id}-core`,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': 5,
        'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#b8ff5c', 0.5, '#22d3ee', 1, '#7c5cff'],
      },
    },
  ],
  dim: (id) => [
    {
      id: `${id}-core`,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#a8b4ff', 'line-width': 5, 'line-opacity': 0.42 },
    },
  ],
  alt: (id, selected) => [
    {
      id: `${id}-core`,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': selected ? '#22d3ee' : '#a594ff',
        'line-width': selected ? 5 : 4,
        'line-opacity': selected ? 0.9 : 0.35,
      },
    },
  ],
  dashed: (id) => [
    {
      id: `${id}-halo`,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ff4fd8', 'line-width': 14, 'line-blur': 10, 'line-opacity': 0.45 },
    },
    {
      id: `${id}-core`,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ff9cea', 'line-width': 4, 'line-dasharray': [1.2, 1.6] },
    },
  ],
};

function featureOf(coords: LngLat[]): Feature<LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function markerHtml(m: MapMarker): string {
  const color = m.color ?? '#22d3ee';
  switch (m.kind) {
    case 'self':
      return `<div class="mk-self" style="--c:${color}"><span class="mk-pulse"></span><span class="mk-pulse d2"></span><span class="mk-cone"></span><span class="mk-core"></span></div>`;
    case 'rider':
      return `<div class="mk-rider${m.stale ? ' stale' : ''}" style="--c:${color}"><span class="mk-core"></span>${
        m.label ? `<span class="mk-tag">${esc(m.label)}</span>` : ''
      }</div>`;
    case 'stop':
      return `<div class="mk-stop" style="--c:${color}"><span>${esc(m.label ?? '')}</span></div>`;
    case 'origin':
      return `<div class="mk-origin"><span class="mk-pulse"></span><span class="mk-core"></span></div>`;
    case 'dest':
      return `<div class="mk-dest" style="--c:${color}"><span class="mk-ring"></span><span class="mk-ring r2"></span><span class="mk-dot"></span></div>`;
    case 'start':
      return `<div class="mk-start" style="--c:${color}"></div>`;
    case 'end':
      return `<div class="mk-end" style="--c:${color}"></div>`;
  }
}

interface MarkerEntry {
  marker: maplibregl.Marker;
  el: HTMLDivElement;
  sig: string;
}

export function MapView(props: MapViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const lineSigs = useRef(new Map<string, string>());
  const markers = useRef(new Map<string, MarkerEntry>());
  const latest = useRef(props);
  latest.current = props;
  const lastFitKey = useRef<string | null>(null);
  const lastCamSig = useRef<string | null>(null);
  const lineCoords = useRef(new Map<string, LngLat[]>());

  // create once
  useEffect(() => {
    if (!host.current) return;
    const init = props.initial ?? props.camera ?? { center: [77.5946, 12.9716] as LngLat, zoom: 12 };
    const m = new maplibregl.Map({
      container: host.current,
      style: STYLE_URL,
      center: init.center as LngLatLike,
      zoom: init.zoom,
      pitch: props.camera?.pitch ?? 0,
      bearing: props.camera?.bearing ?? 0,
      interactive: props.interactive ?? false,
      attributionControl: { compact: true },
      pitchWithRotate: false,
      dragRotate: false,
      fadeDuration: 0,
    });
    map.current = m;
    // the style references sprite patterns we don't ship; answer with a transparent pixel
    m.on('styleimagemissing', (e) => {
      if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    m.on('style.load', () => {
      recolorStyle(m);
      ready.current = true;
      lineSigs.current.clear();
      syncLines();
      syncView(true);
    });

    // tap vs long-press
    let pressTimer: ReturnType<typeof setTimeout> | undefined;
    let longFired = false;
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      longFired = false;
      downAt = { x: e.point.x, y: e.point.y };
      const ll = e.lngLat;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        if (latest.current.onLongPress) {
          longFired = true;
          latest.current.onLongPress([ll.lng, ll.lat]);
        }
      }, 650);
    };
    const onMove = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (downAt && Math.hypot(e.point.x - downAt.x, e.point.y - downAt.y) > 8) clearTimeout(pressTimer);
    };
    const onUp = () => clearTimeout(pressTimer);
    m.on('mousedown', onDown);
    m.on('touchstart', onDown);
    m.on('mousemove', onMove);
    m.on('touchmove', onMove);
    m.on('mouseup', onUp);
    m.on('touchend', onUp);
    m.on('click', (e) => {
      if (longFired) return;
      latest.current.onTap?.([e.lngLat.lng, e.lngLat.lat]);
    });

    const ro = new ResizeObserver(() => m.resize());
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      clearTimeout(pressTimer);
      markers.current.forEach((e) => e.marker.remove());
      markers.current.clear();
      m.remove();
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function syncLines() {
    const m = map.current;
    if (!m || !ready.current) return;
    const want = latest.current.lines ?? [];
    const wantIds = new Set(want.map((l) => l.id));
    // remove stale
    for (const id of [...lineSigs.current.keys()]) {
      if (!wantIds.has(id)) {
        for (const layer of m.getStyle().layers ?? []) if ((layer as { source?: string }).source === `ln-${id}`) m.removeLayer(layer.id);
        if (m.getSource(`ln-${id}`)) m.removeSource(`ln-${id}`);
        lineSigs.current.delete(id);
        lineCoords.current.delete(id);
      }
    }
    for (const l of want) {
      const src = `ln-${l.id}`;
      const styleSig = `${l.variant}:${l.selected ? 1 : 0}`;
      const prevSig = lineSigs.current.get(l.id);
      const coords = l.coords.length > 1 ? l.coords : [l.coords[0] ?? [0, 0], l.coords[0] ?? [0, 0]];
      if (!m.getSource(src)) {
        m.addSource(src, { type: 'geojson', data: featureOf(coords), lineMetrics: true });
      } else if (lineCoords.current.get(l.id) !== l.coords) {
        (m.getSource(src) as GeoJSONSource).setData(featureOf(coords));
      }
      lineCoords.current.set(l.id, l.coords);
      if (prevSig !== styleSig) {
        for (const layer of m.getStyle().layers ?? []) if ((layer as { source?: string }).source === src) m.removeLayer(layer.id);
        for (const layer of VARIANT_LAYERS[l.variant](src, l.selected)) m.addLayer(layer);
        lineSigs.current.set(l.id, styleSig);
      }
    }
    // selected alternative draws on top
    for (const l of want)
      if (l.selected) for (const s of ['halo', 'core', 'shine']) if (m.getLayer(`ln-${l.id}-${s}`)) m.moveLayer(`ln-${l.id}-${s}`);
  }

  function syncMarkers() {
    const m = map.current;
    if (!m) return;
    const want = latest.current.markers ?? [];
    const wantIds = new Set(want.map((x) => x.id));
    for (const [id, e] of markers.current) {
      if (!wantIds.has(id)) {
        e.el.classList.add('mk-leave');
        const mk = e.marker;
        setTimeout(() => mk.remove(), 260);
        markers.current.delete(id);
      }
    }
    for (const x of want) {
      const sig = `${x.kind}|${x.color}|${x.label}|${x.stale ? 1 : 0}`;
      let e = markers.current.get(x.id);
      if (!e) {
        const el = document.createElement('div');
        el.className = 'mk-wrap mk-enter';
        el.innerHTML = markerHtml(x);
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat(x.lngLat as LngLatLike)
          .addTo(m);
        e = { marker, el, sig };
        markers.current.set(x.id, e);
      } else {
        e.marker.setLngLat(x.lngLat as LngLatLike);
        if (e.sig !== sig) {
          e.el.innerHTML = markerHtml(x);
          e.sig = sig;
        }
      }
      if (x.kind === 'self') {
        const cone = e.el.querySelector<HTMLElement>('.mk-cone');
        if (cone) cone.style.transform = `rotate(${x.heading ?? 0}deg)`;
      }
    }
  }

  function syncView(force = false) {
    const m = map.current;
    if (!m) return;
    const { camera, fit } = latest.current;
    if (fit && fit.points.length && (force || fit.key !== lastFitKey.current)) {
      lastFitKey.current = fit.key;
      const b = new maplibregl.LngLatBounds();
      fit.points.forEach((p) => b.extend(p as LngLatLike));
      if (fit.points.length === 1) {
        m.easeTo({ center: fit.points[0] as LngLatLike, zoom: fit.maxZoom ?? 13, duration: fit.duration ?? 600 });
      } else {
        const pad = typeof fit.padding === 'number' ? fit.padding : { top: 48, bottom: 48, left: 48, right: 48, ...fit.padding };
        m.fitBounds(b, { padding: pad, maxZoom: fit.maxZoom ?? 15, duration: force ? 0 : (fit.duration ?? 700) });
      }
      return;
    }
    if (camera) {
      const sig = JSON.stringify([camera.center, camera.zoom, camera.pitch, camera.bearing, camera.padding]);
      if (!force && sig === lastCamSig.current) return;
      lastCamSig.current = sig;
      const opts = {
        center: camera.center as LngLatLike,
        zoom: camera.zoom,
        pitch: camera.pitch ?? 0,
        bearing: camera.bearing ?? 0,
        padding: { top: 0, bottom: 0, left: 0, right: 0, ...camera.padding },
      };
      if (force || !camera.duration) m.jumpTo(opts);
      else m.easeTo({ ...opts, duration: camera.duration, easing: (t) => t });
    }
  }

  // every render: diff
  useEffect(() => {
    syncLines();
    syncMarkers();
    syncView();
  });

  return (
    <div className={`mapview ${props.vignette !== false ? 'mapview-vignette' : ''} ${props.className ?? ''}`} style={props.style}>
      <div ref={host} className="mapview-host" />
    </div>
  );
}
