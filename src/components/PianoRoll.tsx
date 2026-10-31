import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../state/store';
import { currentPosition, play } from '../state/controller';
import { TimeMap } from '../music/timemap';
import { midiName } from '../music/theory';
import { UNITS_PER_BEAT } from '../music/types';

const H = 360;
const TOP = 30;
const GUTTER = 38;

/** Piano-roll view: sung pitch curve, quantized melody, harmony voices, chords, playhead. */
export function PianoRoll() {
  const arr = useStore((s) => s.arrangement)!;
  const tr = useStore((s) => s.transcription)!;
  const frames = useStore((s) => s.frames);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const geom = useRef({ pxPerUnit: 4, lo: 48, hi: 72, width: 800 });

  const curve = useMemo(() => {
    const map = TimeMap.fromPerformance(tr.notes, tr.bpm, tr.originSec);
    return frames.map((f) => ({ u: map.unit(f.t), m: f.midi }));
  }, [frames, tr]);

  useEffect(() => {
    const draw = () => {
      const wrap = wrapRef.current;
      const c = canvasRef.current;
      if (!wrap || !c) return;
      const all = [...arr.melody.notes, ...arr.harmonies.flatMap((h) => h.notes)].map((n) => n.midi);
      const lo = Math.min(...all) - 2;
      const hi = Math.max(...all) + 2;
      const avail = wrap.clientWidth - GUTTER;
      const pxPerUnit = Math.max(avail / arr.totalUnits, 7);
      const width = GUTTER + arr.totalUnits * pxPerUnit;
      geom.current = { pxPerUnit, lo, hi, width };
      const dpr = window.devicePixelRatio || 1;
      const off = document.createElement('canvas');
      off.width = width * dpr;
      off.height = H * dpr;
      const g = off.getContext('2d')!;
      g.scale(dpr, dpr);
      const rowH = (H - TOP - 10) / (hi - lo + 1);
      const y = (m: number) => TOP + (hi - m) * rowH;
      const x = (u: number) => GUTTER + u * pxPerUnit;
      g.fillStyle = '#fbf7ef';
      g.fillRect(0, 0, width, H);
      // rows
      for (let m = lo; m <= hi; m++) {
        const black = [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
        if (black) {
          g.fillStyle = 'rgba(29,26,22,0.035)';
          g.fillRect(GUTTER, y(m), width, rowH);
        }
        if (m % 12 === 0) {
          g.fillStyle = 'rgba(29,26,22,0.55)';
          g.font = '500 10px "DM Mono", monospace';
          g.fillText(midiName(m), 4, y(m) + rowH - 2);
          g.fillStyle = 'rgba(29,26,22,0.12)';
          g.fillRect(GUTTER, y(m) + rowH - 1, width, 1);
        }
      }
      // bars & beats
      const bar = arr.timeSig.beats * UNITS_PER_BEAT;
      for (let u = 0; u <= arr.totalUnits; u += UNITS_PER_BEAT) {
        g.fillStyle = u % bar === 0 ? 'rgba(29,26,22,0.32)' : 'rgba(29,26,22,0.07)';
        g.fillRect(x(u), TOP - 6, 1, H);
        if (u % bar === 0 && u < arr.totalUnits) {
          g.fillStyle = 'rgba(29,26,22,0.5)';
          g.font = '500 10px "DM Mono", monospace';
          g.fillText(String(u / bar + 1), x(u) + 3, 11);
        }
      }
      // chords
      g.font = 'italic 600 13px Fraunces, Georgia, serif';
      g.fillStyle = '#1d1a16';
      for (const ch of arr.chords) g.fillText(ch.symbol, x(ch.start) + 4, 26);
      const rr = (x0: number, y0: number, w: number, h: number, r: number) => {
        g.beginPath();
        g.roundRect(x0, y0, Math.max(2, w), h, r);
      };
      // harmonies
      arr.harmonies.forEach((h) => {
        for (const n of h.notes) {
          rr(x(n.start) + 1, y(n.midi) + 1, n.dur * pxPerUnit - 2, rowH - 2, 3);
          g.fillStyle = h.color + 'b0';
          g.fill();
          g.strokeStyle = h.color;
          g.lineWidth = 1;
          g.stroke();
        }
      });
      // melody
      for (const n of arr.melody.notes) {
        rr(x(n.start) + 1, y(n.midi) + 0.5, n.dur * pxPerUnit - 2, rowH - 1, 3);
        g.fillStyle = arr.melody.color;
        g.fill();
        g.strokeStyle = '#1d1a16';
        g.lineWidth = 1.2;
        g.stroke();
      }
      // sung pitch curve
      g.strokeStyle = 'rgba(29,26,22,0.8)';
      g.lineWidth = 1.4;
      g.beginPath();
      let pen = false;
      for (const p of curve) {
        if (p.m === null || p.u < -2 || p.u > arr.totalUnits + 2) {
          pen = false;
          continue;
        }
        const yy = y(p.m) + rowH / 2;
        if (!pen) g.moveTo(x(p.u), yy);
        else g.lineTo(x(p.u), yy);
        pen = true;
      }
      g.stroke();
      staticRef.current = off;
      c.width = width * dpr;
      c.height = H * dpr;
      c.style.width = `${width}px`;
      c.style.height = `${H}px`;
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [arr, curve]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = canvasRef.current;
      const off = staticRef.current;
      if (!c || !off) return;
      const g = c.getContext('2d')!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(off, 0, 0);
      const pos = currentPosition();
      if (pos !== null) {
        const dpr = window.devicePixelRatio || 1;
        const px = (GUTTER + pos * geom.current.pxPerUnit) * dpr;
        g.fillStyle = '#c8402a';
        g.fillRect(px - dpr, 0, 2 * dpr, c.height);
        g.fillStyle = 'rgba(200,64,42,0.12)';
        g.fillRect(px - 10 * dpr, 0, 10 * dpr, c.height);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="roll-wrap" ref={wrapRef} style={{ overflowX: 'auto' }}>
      <canvas
        ref={canvasRef}
        data-testid="piano-roll"
        onClick={(e) => {
          const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
          const u = (e.clientX - rect.left - GUTTER) / geom.current.pxPerUnit;
          void play(Math.max(0, Math.floor(u / UNITS_PER_BEAT) * UNITS_PER_BEAT));
        }}
      />
    </div>
  );
}
