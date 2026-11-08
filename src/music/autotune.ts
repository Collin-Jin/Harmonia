// Offline pitch correction ("autotune") and clean-up for the recorded voice.
// TD-PSOLA: the signal is cut into pitch-synchronous grains which are
// re-spaced to the corrected period, so formants (the character of the
// voice) are preserved while the pitch moves onto the written notes.

export type AutotuneMode = 'off' | 'natural' | 'hard';

export interface AutotuneSettings {
  /** Fraction of the singer's vibrato/expression kept around the corrected pitch. */
  keepVibrato: number;
  /** Time constant (ms) for moving onto a new note; small = robotic snap. */
  retuneMs: number;
}

export const AUTOTUNE_PRESETS: Record<Exclude<AutotuneMode, 'off'>, AutotuneSettings> = {
  natural: { keepVibrato: 0.5, retuneMs: 40 },
  hard: { keepVibrato: 0, retuneMs: 5 },
};

export interface TuneFrame {
  t: number; // seconds (window centre)
  midi: number | null; // absolute sung pitch, null when unvoiced
}

export interface TuneNote {
  time: number;
  end: number;
  midi: number; // target (written) pitch
}

const HOP_FALLBACK = 0.008;

/** Per-frame pitch shift in semitones that moves the voice onto the notes. */
export function correctionCurve(frames: TuneFrame[], notes: TuneNote[], s: AutotuneSettings): Float32Array {
  const n = frames.length;
  const hop = n > 1 ? frames[1].t - frames[0].t : HOP_FALLBACK;
  const shift = new Float32Array(n);
  const known = new Uint8Array(n);
  const half = Math.max(1, Math.round(0.06 / hop));
  let ni = 0;
  for (let f = 0; f < n; f++) {
    const m = frames[f].midi;
    if (m === null) continue;
    const t = frames[f].t;
    while (ni < notes.length - 1 && notes[ni].end + 0.02 < t) ni++;
    const note = notes[ni];
    if (!note || t < note.time - 0.02 || t > note.end + 0.02) continue;
    // Local centre of the sung pitch (vibrato removed) within this note.
    let sum = 0;
    let cnt = 0;
    for (let k = Math.max(0, f - half); k <= Math.min(n - 1, f + half); k++) {
      const v = frames[k].midi;
      if (v === null || frames[k].t < note.time - 0.02 || frames[k].t > note.end + 0.02) continue;
      sum += v;
      cnt++;
    }
    const centre = sum / cnt;
    const target = note.midi + s.keepVibrato * (m - centre);
    const d = target - m;
    if (Math.abs(d) > 2.5) continue; // tracking glitch or a different note: leave it alone
    shift[f] = d;
    known[f] = 1;
  }
  // Voiced frames between notes (glides) borrow the nearest correction; silence gets none.
  const reach = Math.round(0.05 / hop);
  for (let f = 0; f < n; f++) {
    if (known[f] || frames[f].midi === null) continue;
    let best = 0;
    for (let k = 1; k <= reach; k++) {
      if (f - k >= 0 && known[f - k]) {
        best = shift[f - k] * (1 - k / (reach + 1));
        break;
      }
      if (f + k < n && known[f + k]) {
        best = shift[f + k] * (1 - k / (reach + 1));
        break;
      }
    }
    shift[f] = best;
  }
  // Zero-phase one-pole smoothing = retune speed (glides into notes).
  const a = Math.exp(-hop / Math.max(0.001, s.retuneMs / 1000));
  for (let f = 1; f < n; f++) shift[f] = a * shift[f - 1] + (1 - a) * shift[f];
  for (let f = n - 2; f >= 0; f--) shift[f] = a * shift[f + 1] + (1 - a) * shift[f];
  return shift;
}

/** Join notes that sit close together so a phrase is one sustained window, not a row of chops. */
export function phraseWindows(notes: TuneNote[], joinGap = 0.45): TuneNote[] {
  if (!notes.length) return [];
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const out: TuneNote[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const p = out[out.length - 1];
    if (sorted[i].time - p.end <= joinGap) p.end = Math.max(p.end, sorted[i].end);
    else out.push({ ...sorted[i] });
  }
  return out;
}

/** Unvoiced runs no longer than `maxSec` that sit inside the given windows. */
export function holdUnvoiced(frames: TuneFrame[], windows: TuneNote[], maxSec: number): Uint8Array {
  const hold = new Uint8Array(frames.length);
  if (!frames.length) return hold;
  const inside = (t: number) => windows.some((w) => t >= w.time - 0.04 && t <= w.end + 0.04);
  let i = 0;
  while (i < frames.length) {
    if (frames[i].midi !== null || !inside(frames[i].t)) {
      i++;
      continue;
    }
    let j = i;
    while (j < frames.length && frames[j].midi === null && inside(frames[j].t)) j++;
    const bounded = i > 0 && frames[i - 1].midi !== null && j < frames.length && frames[j].midi !== null;
    if (bounded && frames[j].t - frames[i - 1].t <= maxSec) hold.fill(1, i, j);
    i = j;
  }
  return hold;
}

/**
 * Fill pitch-tracker dropouts shorter than `maxGap` seconds inside sung passages, so a
 * momentary miss doesn't jump the shifted voice back to its original pitch.
 */
export function bridgeFrames(frames: TuneFrame[], maxGap: number): TuneFrame[] {
  const out = frames.map((f) => ({ ...f }));
  let i = 0;
  while (i < out.length) {
    if (out[i].midi !== null) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && out[j].midi === null) j++;
    const a = out[i - 1]?.midi;
    const b = out[j]?.midi;
    if (a != null && b != null && out[j].t - out[i - 1].t <= maxGap) {
      for (let k = i; k < j; k++) out[k].midi = a + ((b - a) * (k - i + 1)) / (j - i + 1);
    }
    i = j;
  }
  return out;
}

/**
 * TD-PSOLA pitch shifting with a time-varying semitone curve. `formant` > 1 reads each
 * grain faster (brighter, smaller voice), < 1 slower (darker, bigger voice). Where `hold`
 * is set on an unvoiced frame, the last voiced grain is repeated: the vowel sustains
 * through the gap (legato backing vowels).
 */
export function psolaShift(x: Float32Array, sr: number, frames: TuneFrame[], shift: Float32Array, formant = 1, hold?: Uint8Array): Float32Array {
  const N = x.length;
  const n = frames.length;
  if (!n) return x.slice();
  const t0 = frames[0].t;
  const hop = n > 1 ? frames[1].t - frames[0].t : HOP_FALLBACK;
  const frameAt = (pos: number) => Math.min(n - 1, Math.max(0, Math.round((pos / sr - t0) / hop)));
  const unvoicedP = Math.round(sr * 0.01);
  const periodAt = (pos: number) => {
    const m = frames[frameAt(pos)].midi;
    if (m === null) return unvoicedP;
    return sr / (440 * Math.pow(2, (m - 69) / 12));
  };
  // Analysis marks, one per (local) period.
  const marks: number[] = [];
  const periods: number[] = [];
  for (let pos = 0; pos < N; ) {
    const P = Math.max(16, periodAt(pos));
    marks.push(pos);
    periods.push(P);
    pos += P;
  }
  const out = new Float32Array(N);
  const wsum = new Float32Array(N);
  let k = 0;
  let lastVoiced = -1;
  let held = 0;
  for (let ts = 0; ts < N; ) {
    while (k + 1 < marks.length && Math.abs(marks[k + 1] - ts) <= Math.abs(marks[k] - ts)) k++;
    let g = k;
    if (frames[frameAt(marks[k])].midi !== null) {
      lastVoiced = k;
      held = 0;
    } else if (hold && lastVoiced >= 0 && hold[frameAt(ts)]) {
      // wander back and forth over the last few periods so the held vowel stays alive
      const back = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1][held++ % 10];
      g = lastVoiced - back;
      if (g < 0 || frames[frameAt(marks[g])].midi === null) g = lastVoiced;
    }
    const ma = Math.round(marks[g]);
    const Pa = periods[g];
    const voiced = frames[frameAt(ma)].midi !== null;
    const r = voiced ? Math.pow(2, shift[frameAt(ts)] / 12) : 1;
    const L = Math.round(Pa);
    const c = Math.round(ts);
    const phi = voiced ? formant : 1;
    for (let j = -L; j <= L; j++) {
      const si = c + j;
      if (si < 0 || si >= N) continue;
      let v: number;
      if (phi === 1) {
        const ai = ma + j;
        if (ai < 0 || ai >= N) continue;
        v = x[ai];
      } else {
        const p = ma + j * phi;
        const i0 = Math.floor(p);
        if (i0 < 0 || i0 + 1 >= N) continue;
        v = x[i0] + (x[i0 + 1] - x[i0]) * (p - i0);
      }
      const w = 0.5 * (1 + Math.cos((Math.PI * j) / L));
      out[si] += v * w;
      wsum[si] += w;
    }
    ts += Pa / r;
  }
  for (let i = 0; i < N; i++) out[i] = wsum[i] > 0.05 ? out[i] / wsum[i] : 0;
  return out;
}

/**
 * High-pass (rumble/hum), gate between notes, and gentle leveling. `mutes` are stretches the
 * user removed (a breath or noise read as a note): they are faded out even inside a phrase.
 */
export function cleanVoice(x: Float32Array, sr: number, notes: TuneNote[], mutes: TuneNote[] = []): Float32Array {
  const N = x.length;
  const y = new Float32Array(N);
  // 2nd-order Butterworth high-pass at 75 Hz.
  const w0 = (2 * Math.PI * 75) / sr;
  const cs = Math.cos(w0);
  const al = Math.sin(w0) / Math.SQRT2;
  const a0 = 1 + al;
  const b0 = (1 + cs) / 2 / a0;
  const b1 = -(1 + cs) / a0;
  const b2 = b0;
  const a1 = (-2 * cs) / a0;
  const a2 = (1 - al) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < N; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  // Gate: open around whole sung phrases (notes closer than ~half a second stay joined),
  // so consonants and breaths between notes are not chopped out. Still quiets the take's tail.
  const open = new Uint8Array(N);
  phraseWindows(notes, 0.5).forEach((nt) => {
    const a = Math.max(0, Math.floor((nt.time - 0.12) * sr));
    const b = Math.min(N, Math.ceil((nt.end + 0.12) * sr));
    open.fill(1, a, b);
  });
  const floor = 0.063;
  const att = Math.exp(-1 / (0.018 * sr));
  const rel = Math.exp(-1 / (0.06 * sr));
  let g = floor;
  for (let i = 0; i < N; i++) {
    const target = open[i] ? 1 : floor;
    g = target > g ? att * g + (1 - att) * target : rel * g + (1 - rel) * target;
    y[i] *= g;
  }
  // Removed notes go fully silent, with short fades so the cut doesn't click.
  const fade = Math.round(0.015 * sr);
  for (const m of mutes) {
    const a = Math.floor(m.time * sr);
    const b = Math.ceil(m.end * sr);
    for (let i = Math.max(0, a - fade); i < Math.min(N, b + fade); i++) {
      const g = i < a ? (a - i) / fade : i >= b ? (i - b + 1) / fade : 0;
      y[i] *= Math.min(1, g);
    }
  }
  // Leveling: slow RMS compressor (3:1 above -16 dB of the loudest passage), then normalize.
  const win = Math.round(0.05 * sr);
  const env = new Float32Array(N);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc += y[i] * y[i];
    if (i >= win) acc -= y[i - win] * y[i - win];
    env[i] = Math.sqrt(Math.max(0, acc) / win);
  }
  let loud = 0;
  for (let i = 0; i < N; i++) loud = Math.max(loud, env[i]);
  if (loud > 0) {
    const thr = loud * 0.16;
    let gs = 1;
    const sm = Math.exp(-1 / (0.03 * sr));
    for (let i = 0; i < N; i++) {
      const e = env[Math.min(N - 1, i + (win >> 1))];
      const want = e > thr ? Math.pow(e / thr, 1 / 3 - 1) : 1;
      gs = sm * gs + (1 - sm) * want;
      y[i] *= gs;
    }
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(y[i]));
  if (peak > 0) {
    const k = 0.8 / peak;
    for (let i = 0; i < N; i++) y[i] *= k;
  }
  return y;
}

/** Full chain: pitch-correct onto the notes (unless off), then clean up. */
export function processVoice(
  samples: Float32Array,
  sampleRate: number,
  frames: TuneFrame[],
  notes: TuneNote[],
  mode: AutotuneMode,
  mutes: TuneNote[] = [],
): Float32Array {
  const smooth = bridgeFrames(frames, 0.14);
  const windows = phraseWindows(notes, 0.5);
  const hold = holdUnvoiced(smooth, windows, 0.08);
  const tuned =
    mode === 'off' ? samples : psolaShift(samples, sampleRate, smooth, correctionCurve(smooth, notes, AUTOTUNE_PRESETS[mode]), 1, hold);
  return cleanVoice(tuned, sampleRate, notes, mutes);
}
