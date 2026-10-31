import { useState } from 'react';
import { Download, FileAudio, FileMusic, FileText, KeyboardMusic, Loader2, Music, RotateCcw, Rows3 } from 'lucide-react';
import { useStore } from '../state/store';
import { exportMidi, exportMusicXml, exportPdf, exportWav } from '../export/exports';
import { playbackOptions } from '../state/controller';
import { STYLE_INFO } from '../music/harmony';
import { keyName } from '../music/theory';
import { ScoreView } from './ScoreView';
import { PianoRoll } from './PianoRoll';

function LyricsStatus() {
  const lyrics = useStore((s) => s.lyrics);
  const status = lyrics.status === 'downloading' && lyrics.progress >= 0.995 ? 'listening' : lyrics.status;
  switch (status) {
    case 'downloading':
      return (
        <span className="chip violet" data-testid="lyrics-status" data-status="downloading" title="One-time download of the speech model (~77 MB), then cached">
          <Loader2 size={12} className="spin" /> Getting the lyrics model {Math.round(lyrics.progress * 100)}%
        </span>
      );
    case 'listening':
      return (
        <span className="chip violet" data-testid="lyrics-status" data-status="listening">
          <Loader2 size={12} className="spin" /> Listening for lyrics…
        </span>
      );
    case 'done':
      return (
        <span className="chip teal" data-testid="lyrics-status" data-status="done">
          ✓ Lyrics detected
        </span>
      );
    case 'none':
      return (
        <span className="chip" data-testid="lyrics-status" data-status={lyrics.hummed ? 'hummed' : 'none'}>
          {lyrics.hummed ? 'Hummed — no lyrics' : 'No words detected'}
        </span>
      );
    case 'error':
      return (
        <span className="chip amber" data-testid="lyrics-status" data-status="error" title={lyrics.error}>
          Lyrics unavailable
        </span>
      );
    default:
      return null;
  }
}

export function ScorePanel() {
  const view = useStore((s) => s.view);
  const set = useStore((s) => s.set);
  const arr = useStore((s) => s.arrangement)!;
  const title = useStore((s) => s.title);
  const toast = useStore((s) => s.toast);
  const hasEdits = useStore((s) => Object.keys(s.pitchEdits).length + Object.keys(s.lyricEdits).length + Object.keys(s.harmonyEdits).length > 0);
  const resetEdits = useStore((s) => s.resetEdits);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (name: string, fn: () => unknown) => {
    setBusy(name);
    try {
      await fn();
      toast(`${name} exported`, 'success');
    } catch (e) {
      toast(`${name} export failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };
  const spin = (n: string, icon: React.ReactNode) => (busy === n ? <Loader2 size={14} className="spin" /> : icon);
  const bars = Math.round(arr.totalUnits / (arr.timeSig.beats * 4));

  return (
    <div className="panel score-panel" id="sec-score">
      <div className="score-top">
        <span className="mark">D</span>
        <div className="score-title grow">
          <h2>{title}</h2>
          <div className="meta">
            <span className="chip ink">{keyName(arr.key)}</span>
            <span className="chip">
              <strong>{Math.round(arr.bpm)}</strong> bpm
            </span>
            <span className="chip">
              {arr.timeSig.beats}/4 · {bars} bars
            </span>
            <span className="chip">
              {STYLE_INFO[arr.options.style].label} · {arr.harmonies.length} {arr.harmonies.length === 1 ? 'voice' : 'voices'}
            </span>
            <LyricsStatus />
          </div>
        </div>
      </div>
      <div className="score-tools">
        <div className="tabs" role="tablist">
          <button className={view === 'score' ? 'on' : ''} onClick={() => set({ view: 'score' })} role="tab" data-testid="tab-score">
            <Music size={13} /> Sheet music
          </button>
          <button className={view === 'roll' ? 'on' : ''} onClick={() => set({ view: 'roll' })} role="tab" data-testid="tab-roll">
            <Rows3 size={13} /> Piano roll
          </button>
        </div>
        {hasEdits && (
          <button className="btn sm ghost" onClick={resetEdits} data-testid="reset-edits" title="Undo all your note and lyric changes">
            <RotateCcw size={13} /> Undo my edits
          </button>
        )}
        <div className="export-bar">
          <span className="export-label hide-sm">
            <Download size={13} /> Save as
          </span>
          <button className="btn sm" disabled={!!busy} onClick={() => run('MIDI', () => exportMidi(arr, title))} data-testid="export-midi" title="Notes for a DAW (one track per part)">
            {spin('MIDI', <KeyboardMusic size={14} />)} MIDI
          </button>
          <button className="btn sm" disabled={!!busy} onClick={() => run('MusicXML', () => exportMusicXml(arr, title))} data-testid="export-musicxml" title="Editable score for MuseScore, Sibelius, Finale or Dorico">
            {spin('MusicXML', <FileMusic size={14} />)} MusicXML
          </button>
          <button className="btn sm" disabled={!!busy} onClick={() => run('PDF', () => exportPdf(arr, title))} data-testid="export-pdf" title="Printable sheet music">
            {spin('PDF', <FileText size={14} />)} PDF
          </button>
          <button
            className="btn sm"
            disabled={!!busy}
            data-testid="export-wav"
            title="Audio of the full mix, as you hear it"
            onClick={() => run('WAV', async () => exportWav(useStore.getState().arrangement ?? arr, title, await playbackOptions()))}
          >
            {spin('WAV', <FileAudio size={14} />)} WAV
          </button>
        </div>
      </div>
      {view === 'score' ? <ScoreView /> : <PianoRoll />}
      <div className="legend">
        <span style={{ color: arr.melody.color }}>
          <i style={{ background: arr.melody.color }} />
          <span style={{ color: 'var(--muted)' }}>Melody</span>
        </span>
        {arr.harmonies.map((h) => (
          <span key={h.id} style={{ color: h.color }}>
            <i style={{ background: h.color }} />
            <span style={{ color: 'var(--muted)' }}>{h.name}</span>
          </span>
        ))}
        {view === 'roll' && <span className="hint">The thin dark line is the pitch you actually sang · click anywhere to play from there</span>}
      </div>
    </div>
  );
}
