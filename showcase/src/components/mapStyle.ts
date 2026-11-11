import type { Map as MlMap } from 'maplibre-gl';

/** Repaint the OpenFreeMap dark style into the Aurora night palette. */
export function recolorStyle(m: MlMap) {
  const layers = m.getStyle().layers ?? [];
  const set = (id: string, prop: string, value: unknown) => {
    try {
      m.setPaintProperty(id, prop, value);
    } catch {
      /* layer may not support the property — skip */
    }
  };
  const hide = (id: string) => {
    try {
      m.setLayoutProperty(id, 'visibility', 'none');
    } catch {
      /* ignore */
    }
  };
  for (const l of layers) {
    const id = l.id.toLowerCase();
    switch (l.type) {
      case 'background':
        set(l.id, 'background-color', '#080a12');
        break;
      case 'fill':
        if (id.includes('water')) set(l.id, 'fill-color', '#0c1630');
        else if (/park|wood|grass|forest|landcover|green/.test(id)) {
          set(l.id, 'fill-color', '#0b1a1c');
          set(l.id, 'fill-opacity', 0.7);
        } else if (id.includes('building')) {
          set(l.id, 'fill-color', '#121726');
          set(l.id, 'fill-outline-color', '#1a2033');
        } else set(l.id, 'fill-color', '#090b13');
        break;
      case 'fill-extrusion':
        set(l.id, 'fill-extrusion-color', '#141a2a');
        break;
      case 'line':
        if (id.includes('water') || id.includes('river')) set(l.id, 'line-color', '#13244a');
        else if (/motorway|trunk|primary/.test(id)) {
          set(l.id, 'line-color', id.includes('casing') ? '#10131e' : '#2b3350');
        } else if (/highway|road|street|minor|secondary|tertiary|transportation|bridge|tunnel|path|service/.test(id)) {
          set(l.id, 'line-color', id.includes('casing') ? '#0d1019' : '#1b2133');
        } else if (id.includes('rail')) set(l.id, 'line-color', '#1b2133');
        else if (id.includes('boundary') || id.includes('admin')) {
          set(l.id, 'line-color', '#3a4366');
          set(l.id, 'line-opacity', 0.4);
        }
        break;
      case 'symbol':
        if (/poi|airport|aeroway|transit|station/.test(id)) {
          hide(l.id);
          break;
        }
        set(l.id, 'text-color', /place|city|town|village/.test(id) ? '#c3c9e0' : '#7d86a8');
        set(l.id, 'text-halo-color', 'rgba(8,10,18,0.9)');
        set(l.id, 'text-halo-width', 1.4);
        set(l.id, 'icon-opacity', 0);
        break;
      default:
        break;
    }
  }
}
