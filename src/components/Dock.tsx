import { useEffect, useState } from 'react';
import { Loader2, Play, Square } from 'lucide-react';
import { useStore } from '../state/store';
import { currentPosition, play, stopPlayback } from '../state/controller';
import { UNITS_PER_BEAT } from '../music/types';
import { Seg } from './ui';

/** The take whose harmony has been heard at least once; until then the play button is pointed out. */
let heardTake: unknown = null;

export function Dock() {
  const playing = useStore((s) => s.playing);
  const liveActive = useStore((s) => s.liveActive);
  const arr = useStore((s) => s.arrangement)!;
  const melodySource = useStore((s) => s.melodySource);
  const hasRecording = useStore((s) => !!s.recording);
  const set = useStore((s) => s.set);
  const partsBusy = useStore((s) => s.voicePartsBusy && s.harmonySource === 'voice');
  const recording = useStore((s) => s.recording);
  if (playing) heardTake = recording;
  const cue = !playing && !liveActive && heardTake !== recording;
  const [pos, setPos] = useState<number | null>(null);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 80) return;
      last = t;
      setPos(currentPosition());
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const bar = arr.timeSig.beats * UNITS_PER_BEAT;
  const totalBars = Math.ceil(arr.totalUnits / bar);
  const p = pos !== null ? Math.max(0, pos) : 0;
  const curBar = Math.min(totalBars, Math.floor(p / bar) + 1);
  const curBeat = Math.floor((p % bar) / UNITS_PER_BEAT) + 1;
  const pct = Math.min(100, (p / arr.totalUnits) * 100);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const unit = Math.floor((f * arr.totalUnits) / UNITS_PER_BEAT) * UNITS_PER_BEAT;
    void play(Math.min(unit, Math.max(0, arr.totalUnits - UNITS_PER_BEAT)));
  };

  return (
    <div className="dock" data-testid="dock">
      {cue && (
        <div className="dock-cue" role="status" data-testid="play-cue">
          Your harmony is ready. Press play to hear it.
        </div>
      )}
      <button
        className={`play-btn ${playing ? 'on' : ''} ${cue ? 'cue' : ''}`}
        onClick={() => (playing ? stopPlayback() : play(0))}
        aria-label={playing ? 'Stop' : 'Play arrangement'}
        title={playing ? 'Stop' : 'Play from the beginning'}
        data-testid="play-button"
      >
        {playing ? <Square size={16} fill="currentColor" /> : <Play size={19} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>
      <div className="time" aria-live="off">
        <span className="counter">
          {String(curBar).padStart(2, '0')}
          <i>:</i>
          {curBeat}
        </span>
        <small>
          bar {curBar} of {totalBars} · {Math.round(arr.bpm)} bpm
        </small>
      </div>
      <div className="progress" onClick={seek} title="Click to play from here" role="slider" aria-label="Position" aria-valuemin={1} aria-valuemax={totalBars} aria-valuenow={curBar}>
        {Array.from({ length: totalBars - 1 }, (_, i) => (
          <span key={i} className="tick" style={{ left: `${(((i + 1) * bar) / arr.totalUnits) * 100}%` }} />
        ))}
        <div className="fill" style={{ width: `${pct}%` }} />
        <span className="head" style={{ left: `${pct}%` }} />
      </div>
      {partsBusy && (
        <span className="chip dark" title="Re-pitching your recording onto every harmony line">
          <Loader2 size={12} className="spin" /> Voicing harmonies
        </span>
      )}
      {liveActive && <span className="chip onair">● On air</span>}
      <span className="divider hide-sm" />
      <div className="dock-melody hide-sm">
        <span className="dock-label">Melody</span>
        <Seg
          value={melodySource}
          onChange={(v) => {
            set({ melodySource: v });
            if (playing) setTimeout(() => void play(0), 0);
          }}
          options={[
            { value: 'recording', label: 'Your voice', disabled: !hasRecording, title: 'Hear your own recording as the lead' },
            { value: 'synth', label: 'Synth', title: 'Hear the written melody played by the synth' },
            { value: 'off', label: 'Off', title: 'Harmony only, so you can sing along' },
          ]}
        />
      </div>
    </div>
  );
}
