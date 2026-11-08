import { useEffect, useRef, useState } from 'react';
import { ChevronUp, Mic2, Music2, Upload } from 'lucide-react';
import { useStore } from '../state/store';
import { importAudioFile, loadSample, startRecording, stopRecording } from '../state/controller';
import { SAMPLES } from '../music/samples';
import { PanelHead, Seg, Toggle } from './ui';

export function CapturePanel() {
  const phase = useStore((s) => s.phase);
  const metronome = useStore((s) => s.metronome);
  const bpm = useStore((s) => s.metronomeBpm);
  const timeSig = useStore((s) => s.timeSig);
  const detectLyrics = useStore((s) => s.detectLyrics);
  const hasTake = useStore((s) => !!s.transcription);
  const title = useStore((s) => s.title);
  const notes = useStore((s) => s.transcription?.notes.length ?? 0);
  const set = useStore((s) => s.set);
  const fileRef = useRef<HTMLInputElement>(null);
  const recording = phase === 'recording';
  const busy = phase === 'analyzing';
  // Once a take is in, recording options step aside so the arrangement is within reach.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (phase === 'ready' || phase === 'review') setOpen(false);
  }, [phase, title]);

  if ((phase === 'ready' || phase === 'review') && hasTake && !open)
    return (
      <div className="panel compact" id="sec-capture" data-testid="capture-compact">
        <PanelHead mark="A" title="Sing" sub={<>your take · <b>{title}</b> · {notes} notes</>} />
        <div className="compact-actions">
          <button className="btn sm primary" onClick={() => startRecording()} data-testid="record-again">
            <span className="rec-dot" aria-hidden /> Record new take
          </button>
          <button className="btn sm ghost" onClick={() => setOpen(true)} data-testid="capture-expand">
            Load another…
          </button>
        </div>
      </div>
    );

  return (
    <div className="panel" id="sec-capture">
      <PanelHead
        mark="A"
        title="Sing"
        sub="record, hum, or bring a melody"
        right={
          (phase === 'ready' || phase === 'review') &&
          hasTake && (
            <button className="btn sm ghost icon" onClick={() => setOpen(false)} aria-label="Fold up" title="Fold up">
              <ChevronUp size={14} />
            </button>
          )
        }
      />
      <div className="rec-hero">
        <button
          className={`rec-button ${recording ? 'recording' : ''}`}
          onClick={() => (recording ? stopRecording() : startRecording())}
          disabled={busy}
          aria-label={recording ? 'Stop recording' : 'Start recording'}
          data-testid="record-button"
        >
          <span className="inner" />
          <span className="rec-label">{recording ? 'stop' : 'rec'}</span>
        </button>
        <div className="rec-copy">
          <h3>{recording ? 'Recording… press to finish' : hasTake ? 'Record a new take' : 'Press to record'}</h3>
          <p>{recording ? 'Sing your melody, then press the button again.' : 'One melody line: sing the words, sing on “la”, or just hum. 5–40 seconds.'}</p>
        </div>
      </div>

      <div className="capture-opts">
        <div>
          <div className="label">Time signature</div>
          <Seg
            value={timeSig.beats}
            disabled={recording}
            options={[2, 3, 4].map((b) => ({ value: b, label: `${b}/4` }))}
            onChange={(b) => set({ timeSig: { beats: b, beatType: 4 } })}
          />
        </div>
        <div>
          <div className="label">
            <span>Metronome</span>
            {metronome && <span>{bpm} bpm</span>}
          </div>
          <Toggle on={metronome} onChange={(v) => set({ metronome: v })} disabled={recording} label={metronome ? 'Count-in + click' : 'Free tempo'} />
        </div>
      </div>
      {metronome && (
        <div className="field" style={{ marginTop: 12 }}>
          <input
            type="range"
            min={50}
            max={180}
            value={bpm}
            disabled={recording}
            style={{ ['--fill' as string]: `${((bpm - 50) / 130) * 100}%` }}
            onChange={(e) => set({ metronomeBpm: Number(e.target.value) })}
            aria-label="Metronome tempo"
          />
          <div className="hint" style={{ marginTop: 6 }}>
            One bar count-in. Use headphones so the click stays out of the recording.
          </div>
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <Toggle
          on={detectLyrics}
          onChange={(v) => set({ detectLyrics: v })}
          testId="detect-lyrics"
          label="Harmony sings the words"
          sub="If you sing lyrics, the backing voices sing them too. Humming stays wordless."
        />
      </div>

      <div className="or">
        <span>or try one of these</span>
      </div>
      <div className="sample-list">
        {SAMPLES.map((s) => (
          <button key={s.id} className="sample-row" onClick={() => loadSample(s.id)} disabled={recording || busy} data-testid={`sample-${s.id}`}>
            <span className="ic">{s.syllables ? <Mic2 size={14} /> : <Music2 size={14} />}</span>
            <span className="grow">
              <b>{s.title}</b>
              <small>
                {s.syllables ? 'sung with words' : 'sung on “la”'} · {s.keyLabel} · {s.beatsPerBar}/4
              </small>
            </span>
          </button>
        ))}
        <button className="sample-row" onClick={() => fileRef.current?.click()} disabled={recording || busy} data-testid="import-audio">
          <span className="ic">
            <Upload size={14} />
          </span>
          <span className="grow">
            <b>Import a recording</b>
            <small>WAV, MP3, M4A, OGG or FLAC from your computer</small>
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm,.flac"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importAudioFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
