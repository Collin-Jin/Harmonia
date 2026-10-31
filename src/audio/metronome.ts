import { getAudioContext } from './context';

/** Sample-accurate click track scheduled with a look-ahead timer. */
export class Metronome {
  private timer: number | null = null;
  private nextBeat = 0;
  private beatIndex = 0;
  private gain: GainNode | null = null;
  onBeat?: (beatIndex: number, time: number) => void;

  constructor(private bpm: number, private beatsPerBar: number) {}

  /** Starts clicking at `startTime`; returns that time. */
  start(startTime: number, volume = 0.5) {
    const ctx = getAudioContext();
    this.gain = ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(ctx.destination);
    this.nextBeat = startTime;
    this.beatIndex = 0;
    const tick = () => {
      const now = ctx.currentTime;
      while (this.nextBeat < now + 0.12) {
        this.click(this.nextBeat, this.beatIndex % this.beatsPerBar === 0);
        const idx = this.beatIndex;
        const t = this.nextBeat;
        const delay = Math.max(0, (t - now) * 1000);
        window.setTimeout(() => this.onBeat?.(idx, t), delay);
        this.nextBeat += 60 / this.bpm;
        this.beatIndex++;
      }
    };
    tick();
    this.timer = window.setInterval(tick, 25);
    return startTime;
  }

  private click(time: number, accent: boolean) {
    const ctx = getAudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.55, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    o.connect(g).connect(this.gain!);
    o.start(time);
    o.stop(time + 0.08);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const g = this.gain;
    if (g) setTimeout(() => g.disconnect(), 300);
    this.gain = null;
  }
}
