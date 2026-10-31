// Harmony sung in the singer's own voice. Each harmony part is the recorded take,
// pitch-shifted (TD-PSOLA) note by note onto the harmony line: the words, breaths
// and timing are the singer's, so the harmony moves exactly with the melody.
// A slight formant offset per part makes it sound like a section rather than a copy;
// wordless sounds ("ooh", "mmm") swap the vocal-tract shape by LPC cross-synthesis.
import { bridgeFrames, cleanVoice, holdUnvoiced, phraseWindows, psolaShift, type TuneFrame, type TuneNote } from './autotune';
import type { Vowel } from './types';

export interface VoicePartSpec {
  id: string;
  /** Harmony notes in recording seconds. */
  notes: TuneNote[];
  /** null: sing the words as recorded; otherwise the wordless vowel. */
  vowel: Vowel | null;
  /** Grain resampling factor: >1 smaller/brighter voice, <1 bigger/darker. */
  formant: number;
  seed: number;
}

export interface VoiceHarmonyInput {
  samples: Float32Array;
  sampleRate: number;
  frames: TuneFrame[];
  /** Melody notes (recording seconds, written pitch). */
  melody: TuneNote[];
  parts: VoicePartSpec[];
}

/** Share of the singer's own vibrato and expression kept in the harmony parts. */
const KEEP = 0.5;

/** Formant factor for a part sitting `semis` from the melody on average (bigger voices sing lower). */
export function formantFor(semis: number, index: number): number {
  const base = Math.pow(2, (semis * 0.16) / 12);
  const spread = [1.0, 0.975, 1.025, 0.96][index % 4];
  return Math.max(0.84, Math.min(1.12, base * spread));
}

/** Per-frame semitone shift from the sung pitch to the harmony line, and where the part sounds. */
export function harmonyShiftCurve(frames: TuneFrame[], melody: TuneNote[], part: TuneNote[], seed: number) {
  const n = frames.length;
  const hop = n > 1 ? frames[1].t - frames[0].t : 0.008;
  const shift = new Float32Array(n);
  const on = new Float32Array(n);
  const half = Math.max(1, Math.round(0.06 / hop));
  let mi = 0;
  let hi = 0;
  for (let f = 0; f < n; f++) {
    const t = frames[f].t;
    while (hi < part.length - 1 && part[hi].end <= t) hi++;
    const h = part[hi];
    if (!h || t < h.time || t >= h.end) continue;
    on[f] = 1;
    while (mi < melody.length - 1 && melody[mi].end + 0.02 < t) mi++;
    let m = melody[mi];
    if (m && t < m.time - 0.02 && mi > 0 && t - melody[mi - 1].end < m.time - t) m = melody[mi - 1];
    if (!m) continue;
    const interval = h.midi - m.midi;
    const sung = frames[f].midi;
    if (sung === null) {
      shift[f] = interval;
      continue;
    }
    let sum = 0;
    let cnt = 0;
    for (let k = Math.max(0, f - half); k <= Math.min(n - 1, f + half); k++) {
      const v = frames[k].midi;
      if (v !== null && Math.abs(v - sung) < 1.5) {
        sum += v;
        cnt++;
      }
    }
    const centre = sum / cnt;
    const correction = m.midi + KEEP * (sung - centre) - sung;
    shift[f] = interval + (Math.abs(correction) > 2.5 ? 0 : correction);
  }
  const phrases = phraseWindows(part, 0.45);
  for (let f = 0; f < n; f++) {
    const t = frames[f].t;
    if (phrases.some((w) => t >= w.time - 0.05 && t <= w.end + 0.06)) on[f] = 1;
  }
  const a = Math.exp(-hop / 0.018);
  for (let f = 1; f < n; f++) shift[f] = a * shift[f - 1] + (1 - a) * shift[f];
  for (let f = n - 2; f >= 0; f--) shift[f] = a * shift[f + 1] + (1 - a) * shift[f];
  let drift = 0;
  let rnd = (seed * 9301 + 49297) % 233280;
  for (let f = 0; f < n; f++) {
    rnd = (rnd * 9301 + 49297) % 233280;
    drift = 0.995 * drift + 0.005 * ((rnd / 233280 - 0.5) * 0.16);
    shift[f] += drift;
  }
  return { shift, on, hop };
}

/** Sample-rate envelope from a per-frame 0..1 curve, with attack/release smoothing. */
function frameEnvelope(curve: Float32Array, frames: TuneFrame[], N: number, sr: number, attack: number, release: number) {
  const env = new Float32Array(N);
  if (!frames.length) return env;
  const t0 = frames[0].t;
  const hop = frames.length > 1 ? frames[1].t - frames[0].t : 0.008;
  const aa = Math.exp(-1 / (attack * sr));
  const ar = Math.exp(-1 / (release * sr));
  let g = 0;
  for (let i = 0; i < N; i++) {
    const f = Math.min(frames.length - 1, Math.max(0, Math.round((i / sr - t0) / hop)));
    const target = curve[f];
    g = target > g ? aa * g + (1 - aa) * target : ar * g + (1 - ar) * target;
    env[i] = g;
  }
  return env;
}

export function renderVoicePart(input: VoiceHarmonyInput, spec: VoicePartSpec): Float32Array {
  const { samples, sampleRate: sr } = input;
  const N = samples.length;
  if (!spec.notes.length || !input.frames.length) return new Float32Array(N);
  const frames = bridgeFrames(input.frames, 0.08);
  const phrases = phraseWindows(spec.notes, 0.5);
  const { shift, on } = harmonyShiftCurve(frames, input.melody, spec.notes, spec.seed);
  const hop = frames.length > 1 ? frames[1].t - frames[0].t : 0.008;
  const pre = Math.round(0.08 / hop);
  const open = on.slice();
  for (let f = 0; f + 1 < on.length; f++) if (!on[f] && on[f + 1]) open.fill(1, Math.max(0, f - pre), f + 1);
  // Hold the vowel through consonants and short breaths so the line sings, not chatters.
  const hold = holdUnvoiced(frames, phrases, spec.vowel ? 0.35 : 0.08);
  let y = psolaShift(samples, sr, frames, shift, spec.formant, hold);
  const gate = frameEnvelope(open, frames, N, sr, 0.02, 0.12);
  for (let i = 0; i < N; i++) y[i] *= gate[i];
  if (spec.vowel) {
    const vmask = new Float32Array(frames.length);
    frames.forEach((f, i) => (vmask[i] = f.midi !== null || hold[i] ? 1 : 0));
    y = vowelCrossSynth(y, sr, spec.vowel, frameEnvelope(vmask, frames, N, sr, 0.02, 0.1), spec.formant);
  }
  const out = cleanVoice(y, sr, phrases);
  for (let i = 0; i < N; i++) out[i] *= 0.85;
  return out;
}

export function renderVoiceHarmonies(input: VoiceHarmonyInput): Record<string, Float32Array> {
  const out: Record<string, Float32Array> = {};
  for (const p of input.parts) out[p.id] = renderVoicePart(input, p);
  return out;
}

/* ---------------- LPC vowel cross-synthesis ---------------- */

const VOWEL_FORMANTS: Record<Vowel, { f: number[]; g: number[]; bw: number[] }> = {
  ah: { f: [730, 1090, 2440, 3400], g: [1, 0.5, 0.25, 0.1], bw: [90, 110, 150, 200] },
  oh: { f: [570, 840, 2410, 3300], g: [1, 0.42, 0.12, 0.06], bw: [80, 100, 140, 200] },
  oo: { f: [320, 870, 2240, 3200], g: [1, 0.25, 0.06, 0.03], bw: [70, 100, 140, 200] },
  ee: { f: [280, 2250, 2900, 3500], g: [1, 0.3, 0.22, 0.1], bw: [70, 120, 150, 200] },
  mm: { f: [260, 1200, 2500, 3400], g: [1, 0.035, 0.012, 0.008], bw: [60, 120, 160, 200] },
};

const BW_SCALE = 3;

function levinson(r: Float64Array, p: number): Float64Array {
  const a = new Float64Array(p + 1);
  a[0] = 1;
  let err = r[0];
  const tmp = new Float64Array(p + 1);
  for (let i = 1; i <= p; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    tmp.set(a);
    for (let j = 1; j < i; j++) a[j] = tmp[j] + k * tmp[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 1e-12) break;
  }
  return a;
}

/**
 * Keep the singer's glottal source (pitch, breath, vibrato) but impose the vocal-tract
 * shape of `vowel`: whiten each frame with its own LPC filter, then colour it with the
 * vowel's formants, and restore the original loudness contour.
 */
export function vowelCrossSynth(x: Float32Array, sr: number, vowel: Vowel, voicedEnv: Float32Array, formant = 1): Float32Array {
  const N = x.length;
  const p = Math.min(28, Math.round(sr / 1000) + 4);
  const size = 1024 * Math.max(1, Math.round(sr / 44100));
  const hopN = size >> 1;
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const res = new Float32Array(N);
  const r = new Float64Array(p + 1);
  for (let s = -hopN; s < N; s += hopN) {
    let energy = 0;
    for (let i = 0; i < size; i++) {
      const v = s + i >= 0 && s + i < N ? x[s + i] : 0;
      energy += v * v;
    }
    if (energy < 1e-9) continue;
    for (let lag = 0; lag <= p; lag++) {
      let acc = 0;
      for (let i = lag; i < size; i++) {
        const a = s + i;
        const b = s + i - lag;
        if (a < 0 || a >= N || b < 0) continue;
        acc += x[a] * win[i] * x[b] * win[i - lag];
      }
      r[lag] = acc * (lag === 0 ? 1.0001 : 1 - (lag / (p * 8)) ** 2);
    }
    const a = levinson(r, p);
    for (let i = 0; i < size; i++) {
      const n = s + i;
      if (n < 0 || n >= N) continue;
      let e = x[n];
      for (let k = 1; k <= p; k++) if (n - k >= 0) e += a[k] * x[n - k];
      res[n] += e * win[i];
    }
  }
  // glottal tilt (~ -6 dB/oct above 250 Hz) then the vowel's formant bank
  const lp = Math.exp((-2 * Math.PI * 250) / sr);
  let z = 0;
  for (let i = 0; i < N; i++) {
    z = lp * z + (1 - lp) * res[i];
    res[i] = z * 6;
  }
  const v = VOWEL_FORMANTS[vowel];
  const y = new Float32Array(N);
  for (let k = 0; k < 4; k++) {
    const f0 = Math.min(sr * 0.45, v.f[k] * formant);
    const w0 = (2 * Math.PI * f0) / sr;
    // Broad resonances: sung harmonics are widely spaced, and narrow peaks would make the
    // level pump as each harmonic slides past them with vibrato.
    const alpha = Math.sin(w0) / (2 * (f0 / (v.bw[k] * BW_SCALE)));
    const a0 = 1 + alpha;
    const b0 = alpha / a0;
    const a1 = (-2 * Math.cos(w0)) / a0;
    const a2 = (1 - alpha) / a0;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < N; i++) {
      const o = b0 * res[i] - b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = res[i];
      y2 = y1;
      y1 = o;
      y[i] += o * v.g[k];
    }
  }
  // loudness follows the original (30 ms RMS), only where the voice is pitched
  const W = Math.round(sr * 0.03);
  const out = new Float32Array(N);
  let ax = 0;
  let ay = 0;
  let g = 0;
  const sm = Math.exp(-1 / (0.015 * sr));
  for (let i = 0; i < N; i++) {
    ax += x[i] * x[i];
    ay += y[i] * y[i];
    if (i >= W) {
      ax -= x[i - W] * x[i - W];
      ay -= y[i - W] * y[i - W];
    }
    const want = ay > 1e-12 ? Math.sqrt(Math.max(0, ax) / Math.max(1e-12, ay)) : 0;
    g = sm * g + (1 - sm) * Math.min(want, 50);
    out[i] = y[i] * g * voicedEnv[i];
  }
  return out;
}
