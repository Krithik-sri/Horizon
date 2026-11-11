// The signature moment: the word HORIZON assembling out of a halftone dot field.
// Pure canvas — the word is rasterised offscreen, sampled on a fine grid, and every lit sample
// becomes a dot that flies in from a scattered start, sweeping left to right.
import { useEffect, useRef } from 'react';

interface Dot {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  delay: number;
}

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

export function DotWordmark({
  text = 'HORIZON',
  width = 340,
  height = 96,
  animate = true,
}: {
  text?: string;
  width?: number;
  height?: number;
  animate?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    let started = false;

    const run = () => {
      const c = ref.current;
      if (!c || cancelled || started) return;
      started = true;
      const dpr = window.devicePixelRatio || 1;
      c.width = width * dpr;
      c.height = height * dpr;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      // rasterise the word offscreen
      const off = document.createElement('canvas');
      off.width = width;
      off.height = height;
      const o = off.getContext('2d', { willReadFrequently: true });
      if (!o) return;
      const family = getComputedStyle(c).getPropertyValue('--font-display').trim() || 'sans-serif';
      let fs = 60;
      o.font = `700 ${fs}px ${family}`;
      const w = o.measureText(text).width;
      fs = Math.min(fs, (fs * (width - 12)) / w);
      o.font = `700 ${fs}px ${family}`;
      o.textAlign = 'center';
      o.textBaseline = 'middle';
      o.fillStyle = '#fff';
      o.fillText(text, width / 2, height / 2 + 2);
      const data = o.getImageData(0, 0, width, height).data;

      const step = 4;
      const dots: Dot[] = [];
      for (let y = step / 2; y < height; y += step) {
        for (let x = step / 2; x < width; x += step) {
          const a = data[(Math.round(y) * width + Math.round(x)) * 4 + 3];
          if (a > 110) {
            const ang = Math.random() * Math.PI * 2;
            const dist = 40 + Math.random() * 140;
            dots.push({
              tx: x,
              ty: y,
              sx: x + Math.cos(ang) * dist * 0.6 - 30,
              sy: height / 2 + Math.sin(ang) * dist * 0.5,
              delay: (x / width) * 0.5 + Math.random() * 0.22,
            });
          }
        }
      }

      const cs = getComputedStyle(c);
      const c1 = cs.getPropertyValue('--lime').trim() || '#b8ff5c';
      const c2 = cs.getPropertyValue('--cyan').trim() || '#22d3ee';
      const grad = ctx.createLinearGradient(0, 0, width, 0);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);

      const t0 = performance.now();
      const frame = (now: number) => {
        if (cancelled) return;
        const t = animate ? (now - t0) / 1000 : 10;
        ctx.clearRect(0, 0, width, height);

        // ambient dot field — faint, breathing
        ctx.fillStyle = 'rgba(255,255,255,1)';
        for (let y = 6; y < height; y += 12) {
          for (let x = 6; x < width; x += 12) {
            const k = 0.05 + 0.04 * Math.sin(t * 1.4 + x * 0.04 + y * 0.09);
            ctx.globalAlpha = Math.max(0, k * Math.min(1, t * 2));
            ctx.beginPath();
            ctx.arc(x, y, 0.8, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        ctx.fillStyle = grad;
        for (const d of dots) {
          const p = Math.max(0, Math.min(1, (t - d.delay) / 0.85));
          if (p <= 0) continue;
          const e = easeOut(p);
          const x = d.sx + (d.tx - d.sx) * e;
          const y = d.sy + (d.ty - d.sy) * e;
          const settle = p >= 1 ? 0.28 * Math.sin(t * 3.2 - d.tx * 0.045) : 0;
          const r = 0.5 + 1.15 * e + settle;
          ctx.globalAlpha = Math.min(1, p * 1.6);
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0.3, r), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.load) fonts.load('700 60px Unbounded').then(run, run);
    const fallback = setTimeout(run, 450);
    return () => {
      cancelled = true;
      clearTimeout(fallback);
      cancelAnimationFrame(raf);
    };
  }, [text, width, height, animate]);

  return <canvas ref={ref} className="boot-canvas" style={{ width, height }} aria-label={text} role="img" />;
}
