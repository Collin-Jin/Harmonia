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
    { mark: 'A', label: 'Sing', target: 'sec-capture', on: true, active: phase !== 'ready' },
    { mark: 'C', label: 'Arrange', target: 'sec-harmony', on: ready, active: false },
    { mark: 'D', label: 'Edit & export', target: 'sec-score', on: ready, active: ready && !liveActive },
    { mark: 'F', label: 'Perform live', target: 'sec-live', on: ready, active: liveActive },
  ];
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
            className={`step ${s.active ? 'active' : ''}`}
            disabled={!s.on}
            onClick={() => go(s.target)}
            title={s.on ? `Go to ${s.label}` : 'Record or load a melody first'}
          >
            <span className="n">{s.mark}</span>
            {s.label}
          </button>
        ))}
      </nav>
      <button className="btn ghost sm" onClick={onHelp}>
        <CircleHelp size={16} /> Help
      </button>
    </header>
  );
}
