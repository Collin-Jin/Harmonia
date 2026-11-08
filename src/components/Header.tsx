import { useEffect, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { useStore } from '../state/store';
import { keyName } from '../music/theory';
import { Logo } from './Logo';

const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export function Header({ onHelp }: { onHelp: () => void }) {
  const phase = useStore((s) => s.phase);
  const title = useStore((s) => s.title);
  const liveActive = useStore((s) => s.liveActive);
  const tr = useStore((s) => s.transcription);
  const set = useStore((s) => s.set);
  const ready = phase === 'ready';
  const steps = [
    { mark: 'A', label: 'Sing', target: 'sec-capture', on: true },
    { mark: 'B', label: 'Check', target: 'sec-analysis', on: ready },
    { mark: 'C', label: 'Arrange', target: 'sec-harmony', on: ready },
    { mark: 'D', label: 'Score', target: 'sec-score', on: ready },
    { mark: 'E', label: 'Mix', target: 'sec-mix', on: ready },
    { mark: 'F', label: 'Perform live', target: 'sec-live', on: ready },
  ];
  const inView = useSectionsInView(steps.map((s) => s.target), phase);
  return (
    <header className="header">
      <div className="brand">
        <Logo />
        <div>
          <h1>Harmonia</h1>
          <span className="tag">a vocal harmony studio</span>
        </div>
      </div>
      {ready && tr && (
        <>
          <span className="sep hide-sm" />
          <input
            className="title-input"
            value={title}
            aria-label="Project title"
            title="Rename your song"
            onChange={(e) => set({ title: e.target.value })}
          />
          <div className="song-chips hide-sm">
            <span className="chip ink">{keyName(tr.key)}</span>
            <span className="chip">
              <strong>{Math.round(tr.bpm)}</strong> bpm · {tr.timeSig.beats}/4
            </span>
          </div>
        </>
      )}
      <span className="spacer" />
      <nav className="steps" aria-label="Sections">
        {steps.map((s) => (
          <button
            key={s.mark}
            className={`step ${(ready ? inView.has(s.target) : s.mark === 'A') || (s.mark === 'F' && liveActive) ? 'active' : ''}`}
            disabled={!s.on}
            onClick={() => go(s.target)}
            title={s.on ? `Go to ${s.mark} · ${s.label}` : 'Record or load a melody first'}
          >
            <span className="n">{s.mark}</span>
            <span className="lbl">{s.label}</span>
          </button>
        ))}
      </nav>
      <button className="btn ghost sm" onClick={onHelp}>
        <CircleHelp size={16} /> Help
      </button>
    </header>
  );
}

/**
 * The section mostly on screen. With the side column pinned on wide screens each column has
 * its own, so this is a set: one section per column.
 */
function useSectionsInView(ids: string[], phase: string): Set<string> {
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const key = ids.join(',');
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const h = window.innerHeight;
      // per column, the section showing the most of itself
      const best = new Map<string, { id: string; px: number }>();
      for (const id of key.split(',')) {
        const el = document.getElementById(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        // clip to the scrolling column it sits in, then to the window
        const col = el.closest('.sidebar');
        const clip = col && getComputedStyle(col).overflowY !== 'visible' ? col.getBoundingClientRect() : null;
        const top = Math.max(r.top, clip?.top ?? 0, 0);
        const bottom = Math.min(r.bottom, clip?.bottom ?? h, h);
        const px = bottom - top;
        if (px <= 0) continue;
        const column = col && clip ? 'side' : 'main';
        if (!best.has(column) || px > best.get(column)!.px) best.set(column, { id, px });
      }
      const next = new Set([...best.values()].map((b) => b.id));
      setSeen((prev) => (prev.size === next.size && [...next].every((x) => prev.has(x)) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    // scroll events don't bubble, but capturing on window catches the side column's too
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    schedule();
    return () => {
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      mo.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [key, phase]);
  return seen;
}
