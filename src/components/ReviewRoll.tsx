import { useEffect, useMemo, useRef, useState } from 'react';
import { noteKey, useStore } from '../state/store';
import { currentPosition } from '../state/controller';
import { audition } from '../audio/audition';
import { TimeMap } from '../music/timemap';
import { midiName, mod12, scaleOf } from '../music/theory';
import { UNITS_PER_BEAT, type MelodyNote } from '../music/types';

const KEYS = 64; // keyboard width
const TOP = 24; // bar-number strip
const ROW = 15;
const PAD = 4; // spare rows above and below the melody, so notes can be dragged past it

interface Drag {
  key: string;
  from: number; // pitch when the drag started
  to: number;
  y0: number;
  moved: boolean;
}

/**
 * "Check your notes": the melody as heard, on a piano roll. Drag a note up or down to fix its
 * pitch; select one and press Delete to remove it (a breath or noise heard as a note); click a
 * removed note's outline to bring it back. Click the bar numbers or an empty spot to choose
 * where Play starts.
 */
export function ReviewRoll({
  selected,
  onSelect,
  from,
  onSeek,
}: {
  selected: string | null;
  onSelect: (key: string | null) => void;
  from: number;
  onSeek: (unit: number) => void;
}) {
  const tr = useStore((s) => s.transcription)!;
  const base = useStore((s) => s.baseTranscription)!;
  const deleted = useStore((s) => s.deletedNotes);
  const frames = useStore((s) => s.frames);
  const editNotePitch = useStore((s) => s.editNotePitch);
  const deleteNote = useStore((s) => s.deleteNote);
  const restoreNote = useStore((s) => s.restoreNote);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rollRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<HTMLCanvasElement>(null);
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(800);

  const ghosts = useMemo(() => base.notes.filter((n) => deleted[noteKey(n)]), [base, deleted]);
  const all = useMemo(() => [...tr.notes, ...ghosts].map((n) => n.midi), [tr, ghosts]);
  const lo = Math.min(...all) - PAD;
  const hi = Math.max(...all) + PAD;
  const height = TOP + (hi - lo + 1) * ROW + 6;
  // the whole take fits where it can; eighth notes stay wide enough to grab
  const pxPerUnit = Math.max((width - KEYS - 4) / tr.totalUnits, 7);
  const rollWidth = tr.totalUnits * pxPerUnit;
  const y = (m: number) => TOP + (hi - m) * ROW;
  const x = (u: number) => u * pxPerUnit;
  const inKey = useMemo(() => new Set(scaleOf(tr.key)), [tr.key]);
  const curve = useMemo(() => {
    const map = TimeMap.fromPerformance(tr.notes, tr.bpm, tr.originSec);
    return frames.map((f) => ({ u: map.unit(f.t), m: f.midi === null ? null : f.midi + tr.tuningCents / 100 }));
  }, [frames, tr]);

  useEffect(() => {
    const el = scrollRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pitchOf = (n: MelodyNote) => (drag && drag.key === noteKey(n) ? drag.to : n.midi);

  // static layer: grid, sung line, notes
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const off = document.createElement('canvas');
    off.width = rollWidth * dpr;
    off.height = height * dpr;
    const g = off.getContext('2d')!;
    g.scale(dpr, dpr);
    g.fillStyle = '#fbf7ef';
    g.fillRect(0, 0, rollWidth, height);
    for (let m = lo; m <= hi; m++) {
      // rows outside the key are shaded, so a note sitting on one stands out
      g.fillStyle = inKey.has(mod12(m)) ? 'rgba(29,26,22,0)' : 'rgba(29,26,22,0.05)';
      g.fillRect(0, y(m), rollWidth, ROW);
      g.fillStyle = mod12(m) === 0 ? 'rgba(29,26,22,0.16)' : 'rgba(29,26,22,0.05)';
      g.fillRect(0, y(m) + ROW - 1, rollWidth, 1);
    }
    const bar = tr.timeSig.beats * UNITS_PER_BEAT;
    const pickup = (tr.notes[0]?.start ?? 0) % bar !== 0;
    for (let u = 0; u <= tr.totalUnits; u += UNITS_PER_BEAT) {
      g.fillStyle = u % bar === 0 ? 'rgba(29,26,22,0.3)' : 'rgba(29,26,22,0.07)';
      g.fillRect(x(u), TOP - 4, 1, height);
      if (u % bar === 0 && u < tr.totalUnits) {
        g.fillStyle = 'rgba(29,26,22,0.55)';
        g.font = '500 10px "DM Mono", monospace';
        g.fillText(String(u / bar + (pickup ? 0 : 1)), x(u) + 4, 15);
      }
    }
    // what was actually sung
    g.strokeStyle = 'rgba(29,26,22,0.35)';
    g.lineWidth = 1.3;
    g.beginPath();
    let pen = false;
    for (const p of curve) {
      if (p.m === null || p.m < lo - 1 || p.m > hi + 1 || p.u < 0 || p.u > tr.totalUnits) {
        pen = false;
        continue;
      }
      const yy = y(p.m) + ROW / 2;
      if (!pen) g.moveTo(x(p.u), yy);
      else g.lineTo(x(p.u), yy);
      pen = true;
    }
    g.stroke();
    const rr = (n: { start: number; dur: number }, m: number) => {
      g.beginPath();
      g.roundRect(x(n.start) + 1, y(m) + 1, Math.max(3, n.dur * pxPerUnit - 2), ROW - 2, 3);
    };
    // removed notes: a dashed outline to click to bring back
    for (const n of ghosts) {
      rr(n, n.midi);
      g.setLineDash([3, 3]);
      g.strokeStyle = hoverKey === noteKey(n) ? '#1d1a16' : 'rgba(29,26,22,0.45)';
      g.lineWidth = 1.2;
      g.stroke();
      g.setLineDash([]);
    }
    for (const n of tr.notes) {
      const k = noteKey(n);
      const m = pitchOf(n);
      if (drag?.key === k && drag.to !== drag.from) {
        rr(n, drag.from);
        g.strokeStyle = 'rgba(29,26,22,0.3)';
        g.lineWidth = 1;
        g.stroke();
      }
      rr(n, m);
      g.fillStyle = '#c8402a';
      g.fill();
      g.strokeStyle = '#1d1a16';
      g.lineWidth = selected === k ? 2.4 : n.edited || (drag?.key === k && drag.to !== drag.from) ? 1.6 : 0.8;
      g.stroke();
      if (n.edited) {
        g.fillStyle = '#fff6ea';
        g.beginPath();
        g.arc(x(n.start) + 6, y(m) + ROW / 2, 2, 0, Math.PI * 2);
        g.fill();
      }
      if (drag?.key === k || selected === k) {
        g.fillStyle = '#1d1a16';
        g.font = '600 10.5px "DM Mono", monospace';
        g.fillText(midiName(m), x(n.start) + 2, y(m) - 3);
      }
    }
    // where Play starts
    if (from > 0) {
      g.fillStyle = 'rgba(29,26,22,0.5)';
      for (let yy = TOP; yy < height; yy += 6) g.fillRect(x(from), yy, 1, 3);
    }
    g.fillStyle = '#1d1a16';
    g.beginPath();
    g.moveTo(x(from), TOP - 2);
    g.lineTo(x(from) + 7, TOP - 9);
    g.lineTo(x(from), TOP - 16);
    g.closePath();
    g.fill();
    staticRef.current = off;
    const c = rollRef.current;
    if (c) {
      c.width = rollWidth * dpr;
      c.height = height * dpr;
      c.style.width = `${rollWidth}px`;
      c.style.height = `${height}px`;
    }
    // keyboard
    const k = keysRef.current;
    if (k) {
      k.width = KEYS * dpr;
      k.height = height * dpr;
      k.style.width = `${KEYS}px`;
      k.style.height = `${height}px`;
      const kg = k.getContext('2d')!;
      kg.scale(dpr, dpr);
      kg.fillStyle = '#fbf7ef';
      kg.fillRect(0, 0, KEYS, height);
      const lit = drag ? drag.to : null;
      for (let m = lo; m <= hi; m++) {
        const black = [1, 3, 6, 8, 10].includes(mod12(m));
        kg.fillStyle = m === lit ? '#c8402a' : black ? '#2e2923' : '#fffdf8';
        kg.fillRect(0, y(m), black ? KEYS * 0.62 : KEYS - 1, ROW - 1);
        if (!black) {
          kg.fillStyle = m === lit ? '#fff6ea' : mod12(m) === 0 ? 'rgba(29,26,22,0.8)' : 'rgba(29,26,22,0.42)';
          kg.font = `${mod12(m) === 0 ? 600 : 500} 9.5px "DM Mono", monospace`;
          kg.fillText(midiName(m), KEYS - 26, y(m) + ROW - 4);
        }
      }
      kg.fillStyle = 'rgba(29,26,22,0.5)';
      kg.fillRect(KEYS - 1, 0, 1, height);
    }
  }, [tr, ghosts, curve, selected, drag, hoverKey, rollWidth, height, lo, hi, inKey, from]);

  // playhead over the static layer
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = rollRef.current;
      const off = staticRef.current;
      if (!c || !off) return;
      const g = c.getContext('2d')!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(off, 0, 0);
      const pos = currentPosition();
      if (pos !== null) {
        const dpr = window.devicePixelRatio || 1;
        g.fillStyle = '#c8402a';
        g.fillRect(x(pos) * dpr - dpr, 0, 2 * dpr, c.height);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  // keyboard: Delete removes the selected note, ↑/↓ nudge it, Esc lets go
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      const i = tr.notes.findIndex((n) => noteKey(n) === selected);
      if (i < 0) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteNote(i);
        onSelect(null);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const m = tr.notes[i].midi + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
        editNotePitch('melody', i, m);
        void audition(m);
      } else if (e.key === 'Escape') onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, tr, deleteNote, editNotePitch, onSelect]);

  const hit = (e: React.PointerEvent) => {
    const r = rollRef.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const at = (n: MelodyNote, m: number) => px >= x(n.start) && px <= x(n.start + n.dur) && py >= y(m) && py <= y(m) + ROW;
    const note = tr.notes.find((n) => at(n, n.midi));
    const ghost = note ? undefined : ghosts.find((n) => at(n, n.midi));
    // the beat the pointer is in, for choosing where Play starts
    const beat = Math.floor(px / pxPerUnit / UNITS_PER_BEAT) * UNITS_PER_BEAT;
    return { note, ghost, py, beat: Math.max(0, Math.min(beat, tr.totalUnits - 1)) };
  };

  return (
    <div className="review-roll">
      <canvas
        ref={keysRef}
        className="review-keys"
        onPointerDown={(e) => {
          const r = keysRef.current!.getBoundingClientRect();
          const m = hi - Math.floor((e.clientY - r.top - TOP) / ROW);
          if (m >= lo && m <= hi) void audition(m);
        }}
        aria-hidden
      />
      <div className="review-scroll" ref={scrollRef}>
        <canvas
          ref={rollRef}
          data-testid="review-roll"
          onPointerDown={(e) => {
            const { note, ghost, py, beat } = hit(e);
            if (py < TOP) {
              onSeek(beat);
              return;
            }
            if (ghost) {
              restoreNote(noteKey(ghost));
              return;
            }
            if (!note) {
              onSelect(null);
              onSeek(beat);
              return;
            }
            const k = noteKey(note);
            onSelect(k);
            void audition(note.midi);
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            setDrag({ key: k, from: note.midi, to: note.midi, y0: py, moved: false });
          }}
          onPointerMove={(e) => {
            if (!drag) {
              const { note, ghost, py } = hit(e);
              setHoverKey(ghost ? noteKey(ghost) : null);
              (e.target as HTMLCanvasElement).style.cursor = py < TOP ? 'pointer' : note ? 'ns-resize' : ghost ? 'pointer' : 'default';
              return;
            }
            const r = rollRef.current!.getBoundingClientRect();
            const to = Math.max(lo, Math.min(hi, drag.from + Math.round((drag.y0 - (e.clientY - r.top)) / ROW)));
            if (to !== drag.to) {
              void audition(to);
              setDrag({ ...drag, to, moved: true });
            }
          }}
          onPointerUp={() => {
            if (!drag) return;
            const i = tr.notes.findIndex((n) => noteKey(n) === drag.key);
            if (drag.moved && drag.to !== drag.from && i >= 0) editNotePitch('melody', i, drag.to);
            setDrag(null);
          }}
          onPointerCancel={() => setDrag(null)}
        />
      </div>
    </div>
  );
}
