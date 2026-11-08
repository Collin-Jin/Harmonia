import { useEffect, useState } from 'react';
import { ChevronRight, Minus, Plus } from 'lucide-react';
import { useStore } from '../state/store';
import { ALL_KEYS, keyName, midiName } from '../music/theory';
import { PanelHead, Seg } from './ui';

export function AnalysisPanel() {
  const tr = useStore((s) => s.transcription)!;
  const retranscribe = useStore((s) => s.retranscribe);
  const [bpmText, setBpmText] = useState(String(Math.round(tr.bpm)));
  useEffect(() => setBpmText(String(Math.round(tr.bpm))), [tr.bpm]);
  // Open while the notes are being checked; afterwards a summary, and Fix goes back to checking.
  const open = useStore((s) => s.phase === 'review');
  const openReview = useStore((s) => s.openReview);

  const pitches = tr.notes.map((n) => n.midi);
  const lo = Math.min(...pitches);
  const hi = Math.max(...pitches);
  const avgDev = Math.round(tr.notes.reduce((s, n) => s + Math.abs(n.cents), 0) / tr.notes.length);
  const dur = tr.notes.length ? tr.notes[tr.notes.length - 1].end - tr.notes[0].time : 0;
  const keyIdx = ALL_KEYS.findIndex((k) => k.tonic === tr.key.tonic && k.mode === tr.key.mode);

  const commitBpm = (v: number) => {
    const b = Math.max(40, Math.min(220, Math.round(v)));
    setBpmText(String(b));
    if (b !== Math.round(tr.bpm)) retranscribe({ bpm: b });
  };

  return (
    <div className={`panel${open ? '' : ' compact'}`} data-testid="analysis-panel" id="sec-analysis">
      <PanelHead
        mark="B"
        title="What I heard"
        sub={open ? 'fix anything I got wrong' : 'tap Fix if anything is off'}
        right={
          open ? (
            <span className="chip" data-testid="note-count">
              <strong>{tr.notes.length}</strong> notes
            </span>
          ) : (
            <button className="btn sm" onClick={openReview} title="Check the notes, key, tempo or metre" data-testid="analysis-toggle">
              Fix <ChevronRight size={13} />
            </button>
          )
        }
      />
      {!open && (
        <div className="summary-chips" data-testid="analysis-summary">
          <span className="chip ink">{keyName(tr.key)}</span>
          <span className="chip">
            <strong>{Math.round(tr.bpm)}</strong> bpm
          </span>
          <span className="chip">{tr.timeSig.beats}/4</span>
          <span className="chip" data-testid="note-count">
            <strong>{tr.notes.length}</strong> notes
          </span>
        </div>
      )}
      {open && (
        <>
          <div className="field">
            <div className="label">
              <span>Key</span>
              {tr.key.confidence !== undefined && <span className="hint">confidence {Math.round(tr.key.confidence * 100)}%</span>}
            </div>
            <select
              className="select"
              value={keyIdx}
              data-testid="key-select"
              onChange={(e) => retranscribe({ key: ALL_KEYS[Number(e.target.value)] })}
            >
              {ALL_KEYS.map((k, i) => (
                <option key={i} value={i}>
                  {keyName(k)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <div className="label">
              <span>Tempo</span>
              <span className="hint">{tr.tempoSource === 'metronome' ? 'from metronome' : tr.tempoSource === 'manual' ? 'set manually' : 'detected'}</span>
            </div>
            <div className="tempo-row">
              <button className="btn icon sm" onClick={() => commitBpm(Number(bpmText) - 1)} aria-label="Slower">
                <Minus size={14} />
              </button>
              <input
                className="num"
                value={bpmText}
                inputMode="numeric"
                data-testid="bpm-input"
                onChange={(e) => setBpmText(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={() => commitBpm(Number(bpmText) || tr.bpm)}
                onKeyDown={(e) => e.key === 'Enter' && commitBpm(Number(bpmText) || tr.bpm)}
              />
              <button className="btn icon sm" onClick={() => commitBpm(Number(bpmText) + 1)} aria-label="Faster">
                <Plus size={14} />
              </button>
              <button className="btn sm" onClick={() => commitBpm(Number(bpmText) * 2)} title="Double tempo">
                ×2
              </button>
              <button className="btn sm" onClick={() => commitBpm(Number(bpmText) / 2)} title="Half tempo">
                ÷2
              </button>
            </div>
          </div>
          <div className="field">
            <div className="label">
              <span>Metre</span>
              <span className="hint">changing tempo or metre re-reads the rhythm</span>
            </div>
            <Seg
              value={tr.timeSig.beats}
              options={[2, 3, 4].map((b) => ({ value: b, label: `${b}/4` }))}
              onChange={(b) => retranscribe({ timeSig: { beats: b, beatType: 4 } })}
            />
          </div>
          <div className="stats">
            <div className="stat">
              <div className="k">Range</div>
              <div className="v">
                {midiName(lo)}–{midiName(hi)}
              </div>
            </div>
            <div className="stat">
              <div className="k">Intonation</div>
              <div className="v">
                ±{avgDev}¢ <small>avg</small>
              </div>
            </div>
            <div className="stat">
              <div className="k">Tuning offset</div>
              <div className="v">
                {tr.tuningCents > 0 ? '+' : ''}
                {tr.tuningCents}¢
              </div>
            </div>
            <div className="stat">
              <div className="k">Length</div>
              <div className="v">
                {dur.toFixed(1)}s <small>{tr.totalUnits / (tr.timeSig.beats * 4)} bars</small>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
