import { useEffect, useRef, useState } from 'react';
import { Square, X } from 'lucide-react';
import { mic } from '../audio/mic';
import { cancelRecording, recordingInfo, stopRecording } from '../state/controller';
import { freqToMidi, midiName } from '../music/theory';
import { useStore } from '../state/store';

/** Scrolling live pitch trace while recording. */
export function RecordingStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState<{ name: string; cents: number } | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [countIn, setCountIn] = useState<number>(-1);
  const metronome = useStore((s) => s.metronome);

  useEffect(() => {
    const l = () => setCountIn(recordingInfo.countInBeat);
    recordingInfo.listeners.add(l);
    return () => void recordingInfo.listeners.delete(l);
  }, []);

  useEffect(() => {
    const pts: { t: number; m: number | null; r: number }[] = [];
    let lastUi = 0;
    const unsub = mic.onPitch((p) => {
      const m = p.f0 > 0 && p.clarity > 0.8 && p.rms > 0.006 ? freqToMidi(p.f0) : null;
      pts.push({ t: performance.now(), m, r: p.rms });
      if (pts.length > 2000) pts.splice(0, pts.length - 2000);
      const now = performance.now();
      if (now - lastUi > 60) {
        lastUi = now;
        setLevel(Math.min(1, p.rms * 6));
        if (m !== null) setNote({ name: midiName(m), cents: Math.round((m - Math.round(m)) * 100) });
      }
    });
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      setElapsed((performance.now() - recordingInfo.startedAt) / 1000);
      const c = canvasRef.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== W * dpr) {
        c.width = W * dpr;
        c.height = H * dpr;
      }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const now = performance.now();
      const span = 6000;
      const voiced = pts.filter((p) => p.m !== null).map((p) => p.m as number);
      const center = voiced.length ? voiced.slice(-200).reduce((a, b) => a + b, 0) / Math.min(200, voiced.length) : 62;
      const lo = center - 12;
      const hi = center + 12;
      const y = (m: number) => H - 30 - ((m - lo) / (hi - lo)) * (H - 80);
      // semitone grid
      for (let m = Math.ceil(lo); m <= hi; m++) {
        const isC = ((m % 12) + 12) % 12 === 0;
        g.strokeStyle = isC ? 'rgba(29,26,22,0.28)' : 'rgba(29,26,22,0.07)';
        g.beginPath();
        g.moveTo(0, y(m));
        g.lineTo(W, y(m));
        g.stroke();
        if (isC) {
          g.fillStyle = 'rgba(29,26,22,0.55)';
          g.font = '500 11px "DM Mono", monospace';
          g.fillText(midiName(m), 8, y(m) - 4);
        }
      }
      // energy
      g.fillStyle = 'rgba(29,26,22,0.08)';
      for (const p of pts) {
        const x = W - ((now - p.t) / span) * W;
        if (x < 0) continue;
        const h = Math.min(1, p.r * 5) * 60;
        g.fillRect(x, H - h, 2, h);
      }
      // pitch trace
      const grad = g.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, 'rgba(200,64,42,0.15)');
      grad.addColorStop(1, '#c8402a');
      g.strokeStyle = grad;
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      let pen = false;
      for (const p of pts) {
        const x = W - ((now - p.t) / span) * W;
        if (x < 0 || p.m === null) {
          pen = false;
          continue;
        }
        if (!pen) g.moveTo(x, y(p.m));
        else g.lineTo(x, y(p.m));
        pen = true;
      }
      g.stroke();
    };
    draw();
    return () => {
      unsub();
      cancelAnimationFrame(raf);
    };
  }, []);

  const mm = Math.floor(elapsed / 60);
  const ss = Math.floor(elapsed % 60)
    .toString()
    .padStart(2, '0');

  return (
    <div className="panel rec-stage" data-testid="recording-stage">
      <canvas ref={canvasRef} />
      <div className="rec-hud">
        <span className="rec-dot" />
        <span className="rec-word">Recording</span>
        <b className="rec-clock">
          {mm}:{ss}
        </b>
        <div className="meter">
          <div style={{ width: `${level * 100}%` }} />
        </div>
        <div className="grow" />
        <div style={{ textAlign: 'right' }}>
          <div className="big-note">{note?.name ?? '—'}</div>
          <div className="hint">{note ? `${note.cents > 0 ? '+' : ''}${note.cents}¢` : 'listening…'}</div>
        </div>
      </div>
      {metronome && countIn > 0 && (
        <div className="rec-overlay">
          <div className="count-in" key={countIn}>
            {countIn}
          </div>
        </div>
      )}
      <div className="rec-actions row">
        <button className="btn sm ghost" onClick={() => cancelRecording()} title="Throw this take away">
          <X size={14} /> Discard
        </button>
        <button className="btn sm primary" onClick={() => stopRecording()} data-testid="stop-button">
          <Square size={13} /> Finish & harmonize
        </button>
      </div>
    </div>
  );
}
