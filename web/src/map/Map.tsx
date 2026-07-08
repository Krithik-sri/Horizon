import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRideStore } from "../store/ride";
import { STALE_AFTER_SEC } from "../types";

// Free tiles, no key, no card (CLAUDE.md). MapLibre GL JS is the browser sibling of the
// native @maplibre/maplibre-react-native renderer the mobile app would use.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function Map() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Record<string, maplibregl.Marker>>({});
  const centeredRef = useRef(false);

  const riders = useRideStore((s) => s.riders);
  const selfId = useRideStore((s) => s.selfId);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [0, 20],
      zoom: 1.5,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
      centeredRef.current = false;
    };
  }, []);

  // Reconcile one marker per rider against the latest broadcast.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const seen = new Set<string>();
    for (const r of riders) {
      seen.add(r.id);
      const isSelf = r.id === selfId;
      let marker = markersRef.current[r.id];

      if (!marker) {
        const el = document.createElement("div");
        el.className = "rider-dot";
        // CONVERT lat/lng (our wire format) → [lng, lat] (MapLibre/GeoJSON). This is the trap.
        marker = new maplibregl.Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(map);
        markersRef.current[r.id] = marker;
      } else {
        marker.setLngLat([r.lng, r.lat]); // [lng, lat]
      }

      const el = marker.getElement();
      el.classList.toggle("self", isSelf);
      el.classList.toggle("stale", r.ageSec > STALE_AFTER_SEC); // dead zone — last-known position
      el.dataset.pos = String(r.pos);
      el.title = isSelf ? `${r.name} (you)` : r.name;
    }

    // Drop markers for riders who left.
    for (const id of Object.keys(markersRef.current)) {
      if (!seen.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    }

    // Center on ourselves the first time we have a fix.
    if (!centeredRef.current && selfId) {
      const me = riders.find((r) => r.id === selfId);
      if (me) {
        map.easeTo({ center: [me.lng, me.lat], zoom: 15 });
        centeredRef.current = true;
      }
    }
  }, [riders, selfId]);

  return <div ref={containerRef} className="map" />;
}
