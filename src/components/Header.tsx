import { useEffect, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { useStore } from '../state/store';
import { keyName } from '../music/theory';
import { Logo } from './Logo';

/** The column the visitor last moved in: its section is the one the header marks. */
let focusColumn: 'side' | 'main' = 'main';
const columnOf = (el: Element | null) => (el?.closest('.sidebar') ? 'side' : 'main');

const go = (id: string) => {
  const el = document.getElementById(id);
  focusColumn = columnOf(el);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

export function Header({ onHelp }: { onHelp: () => void }) {
  const phase = useStore((s) => s.phase);
  const title = useStore((s) => s.title);
  const liveActive = useStore((s) => s.liveActive);
  const tr = useStore((s) => s.transcription);
  const set = useStore((s) => s.set);
  const ready = phase === 'ready';
  const steps = [
    { mark: 'A', label: 'Sing', target: 'sec-capture', on: true },
    { mark: 'B', label: 'Check', target: phase === 'review' ? 'sec-review' : 'sec-analysis', on: ready || phase === 'review' },
    { mark: 'C', label: 'Arrange', target: 'sec-harmony', on: ready },
    { mark: 'D', label: 'Score', target: 'sec-score', on: ready },
    { mark: 'E', label: 'Mix', target: 'sec-mix', on: ready },
    { mark: 'F', label: 'Perform live', target: 'sec-live', on: ready },
  ];
  const inView = useSectionInView(steps.map((s) => s.target), phase);
  const ref = useRef<HTMLElement>(null);
  // the pinned side column and jump targets sit below the header at whatever height it wraps to
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header className="header" ref={ref}>
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
            className={`step ${(ready ? inView === s.target : s.mark === (phase === 'review' ? 'B' : 'A')) || (s.mark === 'F' && liveActive) ? 'active' : ''}`}
            aria-current={ready && inView === s.target ? 'location' : undefined}
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
 * one; the header marks the one in the column the visitor last scrolled or jumped to.
 */
function useSectionInView(ids: string[], phase: string): string | null {
  const [seen, setSeen] = useState<string | null>(null);
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
      setSeen((best.get(focusColumn) ?? best.get('main') ?? best.get('side'))?.id ?? null);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const onScroll = (e: Event) => {
      focusColumn = e.target instanceof Element ? columnOf(e.target) : 'main';
      schedule();
    };
    // scroll events don't bubble, but capturing on window catches the side column's too
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', schedule);
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    schedule();
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', schedule);
      mo.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [key, phase]);
  return seen;
}
