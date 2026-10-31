// Offline formant "singer" used to create realistic test material (vibrato,
// pitch scoops, syllable dips, breath noise). Dependency-free so that Node
// scripts can import it with native TypeScript type stripping.

export interface RenderNote {
  midi: number;
  start: number; // seconds
  dur: number; // seconds
}

export interface RenderOptions {
  sampleRate?: number;
  tail?: number; // seconds of silence after the last note
  vibratoCents?: number;
  vibratoRate?: number;
  scoopCents?: number;
  detuneCents?: number; // constant intonation offset of the singer
  noteDetuneCents?: number[]; // per-note intonation error
  driftCents?: number; // pitch drift accumulated linearly over the whole take
  noise?: number; // background noise amplitude
  seed?: number;
  formants?: [number, number, number];
  formantGains?: [number, number, number];
  /** Fraction of the raw (unfiltered) source mixed in; small for a closed-mouth hum. */
  direct?: number;
}

class BandPass {
  b0: number;
  b2: number;
  a1: number;
  a2: number;
  x1 = 0;
  x2 = 0;
  y1 = 0;
  y2 = 0;
  constructor(f: number, q: number, sr: number) {
    const w0 = (2 * Math.PI * f) / sr;
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w0)) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  run(x: number) {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export function renderSungMelody(notes: RenderNote[], opts: RenderOptions = {}): { samples: Float32Array; sampleRate: number } {
  const sr = opts.sampleRate ?? 48000;
  const tail = opts.tail ?? 1.0;
  const end = notes.length ? Math.max(...notes.map((n) => n.start + n.dur)) + tail : tail;
  const len = Math.ceil(end * sr);
  const out = new Float32Array(len);
  let seed = opts.seed ?? 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const vibC = opts.vibratoCents ?? 28;
  const vibR = opts.vibratoRate ?? 5.4;
  const scoop = opts.scoopCents ?? 70;
  const detune = opts.detuneCents ?? 0;
  const [f1, f2, f3] = opts.formants ?? [750, 1150, 2800];
  const filters = [new BandPass(f1, f1 / 90, sr), new BandPass(f2, f2 / 110, sr), new BandPass(f3, f3 / 150, sr)];
  const gains = opts.formantGains ?? [1.0, 0.55, 0.22];
  const direct = opts.direct ?? 0.015;

  // Per-sample pitch (midi) and amplitude curves.
  const pitch = new Float32Array(len).fill(-1);
  const amp = new Float32Array(len);
  const sorted = notes.slice().sort((a, b) => a.start - b.start);
  sorted.forEach((n, i) => {
    const s0 = Math.floor(n.start * sr);
    const s1 = Math.min(len, Math.floor((n.start + n.dur) * sr));
    const next = sorted[i + 1];
    const legatoNext = next && Math.abs(next.start - (n.start + n.dur)) < 0.02;
    const prev = sorted[i - 1];
    const legatoPrev = prev && Math.abs(n.start - (prev.start + prev.dur)) < 0.02;
    for (let k = s0; k < s1; k++) {
      const t = (k - s0) / sr;
      const remain = (s1 - k) / sr;
      let m = n.midi + (detune + (opts.noteDetuneCents?.[i] ?? 0) + ((opts.driftCents ?? 0) * k) / len) / 100;
      // scoop into the note, faster when coming legato from another note
      const scoopDur = legatoPrev ? 0.035 : 0.06;
      if (t < scoopDur) m -= (scoop / 100) * (1 - t / scoopDur) ** 2;
      const vibEnv = Math.min(1, Math.max(0, (t - 0.22) / 0.25));
      m += (vibC / 100) * vibEnv * Math.sin(2 * Math.PI * vibR * t + i);
      pitch[k] = m;
      // envelope: attack, syllable dip at boundaries, release
      let a = 1;
      const att = legatoPrev ? 0.03 : 0.05;
      if (t < att) a = 0.25 + 0.75 * (t / att);
      if (!legatoPrev && t < att) a = t / att;
      const rel = legatoNext ? 0.035 : 0.07;
      if (remain < rel) a *= legatoNext ? 0.25 + 0.75 * (remain / rel) : remain / rel;
      a *= 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.7 * (n.start + t));
      amp[k] = Math.max(amp[k], a);
    }
  });

  let phase = 0;
  let lastPitch = 60;
  for (let k = 0; k < len; k++) {
    const m = pitch[k] >= 0 ? pitch[k] : lastPitch;
    lastPitch = m;
    const f0 = 440 * Math.pow(2, (m - 69) / 12);
    phase += f0 / sr;
    if (phase > 1) phase -= 1;
    const a = amp[k];
    let src = 0;
    if (a > 0.0005) {
      const maxH = Math.min(36, Math.floor(sr / 2 / f0) - 1);
      for (let h = 1; h <= maxH; h++) src += Math.sin(2 * Math.PI * h * phase) / Math.pow(h, 1.15);
      src += (rnd() - 0.5) * 0.15; // breath
    }
    let y = 0;
    for (let i = 0; i < 3; i++) y += filters[i].run(src) * gains[i];
    out[k] = y * a * 0.5 + src * a * direct + (rnd() - 0.5) * (opts.noise ?? 0.0015);
  }
  let peak = 0;
  for (let k = 0; k < len; k++) peak = Math.max(peak, Math.abs(out[k]));
  const g = peak > 0 ? 0.7 / peak : 1;
  for (let k = 0; k < len; k++) out[k] *= g;
  return { samples: out, sampleRate: sr };
}

/** Encode mono float samples as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}
