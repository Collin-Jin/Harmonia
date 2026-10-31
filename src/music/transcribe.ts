import { Yin, decimate, decimationFactor } from './pitch';
import { freqToMidi, mod12, scaleOf, type Key } from './theory';
import { detectKey } from './key';
import {
  UNITS_PER_BEAT,
  type MelodyNote,
  type PitchFrame,
  type RawNote,
  type TimeSignature,
  type Transcription,
} from './types';

export const ANALYSIS_HOP_SEC = 0.008;

/* ------------------------------------------------------------------ */
/* 1. Pitch tracking                                                    */
/* ------------------------------------------------------------------ */

export function trackPitch(samples: Float32Array, sampleRate: number, hopSec = ANALYSIS_HOP_SEC): PitchFrame[] {
  const factor = decimationFactor(sampleRate);
  const x = decimate(samples, factor);
  const sr = sampleRate / factor;
  const W = Math.round(0.025 * sr);
  const yin = new Yin(sr, W, 65, 1100, 0.15);
  const hop = Math.max(1, Math.round(hopSec * sr));
  const frames: PitchFrame[] = [];
  const len = yin.frameLength;
  for (let i = 0; i + len <= x.length; i += hop) {
    let e = 0;
    for (let j = 0; j < W; j++) e += x[i + j] * x[i + j];
    const rms = Math.sqrt(e / W);
    const t = (i + W / 2) / sr;
    if (rms < 2e-4) {
      frames.push({ t, midi: null, clarity: 0, rms });
      continue;
    }
    const r = yin.detect(x, i);
    const midi = r.freq > 0 ? freqToMidi(r.freq) : null;
    frames.push({ t, midi: midi !== null && isFinite(midi) ? midi : null, clarity: r.clarity, rms });
  }
  return frames;
}

/* ------------------------------------------------------------------ */
/* 2. Note segmentation                                                 */
/* ------------------------------------------------------------------ */

const median = (arr: number[]) => {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (arr: number[], p: number) => {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};

export interface SegmentResult {
  notes: RawNote[];
  tuningCents: number;
  voiced: boolean[];
  smoothed: (number | null)[];
}

export function segmentNotes(frames: PitchFrame[], hopSec = ANALYSIS_HOP_SEC): SegmentResult {
  const n = frames.length;
  const rmsAll = frames.map((f) => f.rms);
  const aperiodic = frames.filter((f) => f.clarity < 0.6).map((f) => f.rms);
  // Aperiodic frames include consonants and attacks; the quietest frames bound the true floor.
  const noise = Math.min(aperiodic.length >= 10 ? percentile(aperiodic, 0.5) : Infinity, Math.max(percentile(rmsAll, 0.1), percentile(rmsAll, 0.02)));
  const peak = percentile(rmsAll, 0.99);
  const thr = Math.min(Math.max(noise * 3, peak * 0.06, 0.002), peak * 0.3);

  const voiced = frames.map(
    (f) => f.midi !== null && f.clarity >= 0.78 && f.rms >= thr && f.midi >= 33 && f.midi <= 98,
  );

  // Octave-error repair + median smoothing over voiced neighbours.
  const raw = frames.map((f, i) => (voiced[i] ? (f.midi as number) : null));
  const smoothed: (number | null)[] = raw.map((m, i) => {
    if (m === null) return null;
    const neigh: number[] = [];
    for (let k = -3; k <= 3; k++) {
      const v = raw[i + k];
      if (v !== null && v !== undefined) neigh.push(v);
    }
    const med = median(neigh);
    let v = m;
    if (Math.abs(v - med) > 6) v += 12 * Math.round((med - v) / 12);
    return v;
  });
  const sm: (number | null)[] = smoothed.map((m, i) => {
    if (m === null) return null;
    const a = smoothed[i - 1];
    const b = smoothed[i + 1];
    if (a == null || b == null) return m;
    return median([a, m, b]);
  });

  // Global tuning offset (circular mean of fractional pitch), so a singer who is
  // consistently sharp/flat still gets the intended notes.
  let sx = 0;
  let sy = 0;
  sm.forEach((m, i) => {
    if (m === null) return;
    const a = 2 * Math.PI * (m - Math.round(m));
    const w = frames[i].rms;
    sx += Math.cos(a) * w;
    sy += Math.sin(a) * w;
  });
  const tuning = sx || sy ? Math.atan2(sy, sx) / (2 * Math.PI) : 0;
  const p = sm.map((m) => (m === null ? null : m - tuning));

  // Smoothed energy for re-articulation (repeated note) detection.
  const env = rmsAll.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = -1; k <= 1; k++) if (rmsAll[i + k] !== undefined) (s += rmsAll[i + k]), c++;
    return s / c;
  });

  interface Seg {
    frames: number[];
    gap: number;
    peak: number;
  }
  const segs: number[][] = [];
  const gapLimit = Math.ceil(0.06 / hopSec);
  const look = Math.ceil(0.045 / hopSec);
  const riseWin = Math.ceil(0.16 / hopSec);
  const preWin = Math.ceil(0.12 / hopSec);
  // Energy dips followed by a re-attack mark syllable boundaries (repeated notes).
  const isDip = env.map((e, i) => {
    if (i === 0 || i === n - 1 || !(e <= env[i - 1] && e < env[i + 1])) return false;
    let pre = 0;
    for (let k = Math.max(0, i - preWin); k <= i - 2; k++) pre = Math.max(pre, env[k]);
    let post = 0;
    for (let k = i + 1; k < Math.min(n, i + riseWin); k++) post = Math.max(post, env[k]);
    if (!(pre > thr && post > thr * 1.2)) return false;
    // A deep dip is an articulation even if the re-attack is softer than the previous note.
    if (e < 0.45 * pre && post > 0.55 * pre) return true;
    if (post <= 0.8 * pre) return false;
    if (e < 0.65 * pre) return true;
    // Shallower dip: accept it only when it is narrow (an articulation, not a slow
    // swell or vibrato trough) and the pitch re-attacks (scoops up) right after it.
    const narrow = i >= 5 && e < 0.82 * env[i - 5] && e < 0.82 * Math.max(...env.slice(i + 1, i + 9));
    if (narrow && e < 0.78 * pre && p[i] != null) {
      let rise = 0;
      for (let k = i + 1; k < Math.min(n, i + look + 3); k++) if (p[k] != null) rise = Math.max(rise, (p[k] as number) - (p[i] as number));
      return rise > 0.2;
    }
    return false;
  });
  let cur: Seg | null = null;
  const close = () => {
    if (cur && cur.frames.length) segs.push(cur.frames);
    cur = null;
  };

  for (let i = 0; i < n; i++) {
    if (!voiced[i]) {
      if (cur) {
        const c = cur as Seg;
        c.gap++;
        if (c.gap > gapLimit) close();
      }
      continue;
    }
    const pi = p[i] as number;
    if (!cur) {
      cur = { frames: [i], gap: 0, peak: env[i] };
      continue;
    }
    const c = cur as Seg;
    // Energy dip followed by a re-attack => new syllable / repeated note.
    const lastIdx = c.frames[c.frames.length - 1];
    let dipSplit = false;
    if (c.frames.length > 5) {
      for (let k = lastIdx + 1; k <= i; k++) if (isDip[k]) dipSplit = true;
      if (!dipSplit && i - lastIdx - 1 >= 3) {
        let rise = 0;
        for (let k = i; k < Math.min(n, i + riseWin); k++) rise = Math.max(rise, env[k]);
        if (rise > 0.6 * c.peak) dipSplit = true;
      }
    }
    if (dipSplit) {
      close();
      cur = { frames: [i], gap: 0, peak: env[i] };
      continue;
    }
    c.gap = 0;
    const recent = c.frames.slice(-40).map((k) => p[k] as number);
    const ref = median(recent);
    if (Math.abs(pi - ref) > 0.45) {
      const ahead: number[] = [];
      for (let k = i; k < Math.min(n, i + look); k++) if (voiced[k]) ahead.push(p[k] as number);
      if (ahead.length >= look * 0.8) {
        const med = median(ahead);
        const spread = Math.max(...ahead) - Math.min(...ahead);
        if (Math.abs(med - ref) > 0.45 && spread < 0.8) {
          close();
          cur = { frames: [i], gap: 0, peak: env[i] };
          continue;
        }
      }
    }
    c.frames.push(i);
    c.peak = Math.max(c.peak * 0.995, env[i]);
  }
  close();

  let notes: RawNote[] = segs
    .map((fr) => {
      const vals = fr.map((k) => p[k] as number);
      const a = vals.length >= 8 ? Math.floor(vals.length * 0.25) : 0;
      const b = vals.length >= 8 ? Math.ceil(vals.length * 0.85) : vals.length;
      const core = vals.slice(a, b);
      const med = median(core);
      const midi = Math.round(med);
      return {
        midi,
        cents: Math.round((med - midi) * 100),
        time: frames[fr[0]].t - hopSec / 2,
        end: frames[fr[fr.length - 1]].t + hopSec / 2,
        pitch: med,
        level: median(fr.map((k) => frames[k].rms)),
        spread: percentile(vals, 0.75) - percentile(vals, 0.25),
      };
    })
    .filter((nt) => nt.end - nt.time >= 0.05);

  // Absorb very short glide fragments into adjacent notes.
  const out: RawNote[] = [];
  for (let i = 0; i < notes.length; i++) {
    const nt = notes[i];
    const dur = nt.end - nt.time;
    const prev = out[out.length - 1];
    const next = notes[i + 1];
    const touchesPrev = prev && nt.time - prev.end < 0.03;
    const touchesNext = next && next.time - nt.end < 0.03;
    if (dur < 0.085 && (touchesPrev || touchesNext)) {
      if (touchesNext && next && (!touchesPrev || Math.abs(next.midi - nt.midi) <= Math.abs(prev.midi - nt.midi))) {
        next.time = nt.time;
      } else if (prev) {
        prev.end = nt.end;
      }
      continue;
    }
    out.push({ ...nt });
  }
  notes = rejectNoise(out);
  return { notes, tuningCents: Math.round(tuning * 100), voiced, smoothed: p };
}

/** Drop segments that are breaths, clicks, squeaks or throat noise rather than sung notes. */
export function rejectNoise(notes: RawNote[]): RawNote[] {
  if (notes.length < 3) return notes;
  const dur = (n: RawNote) => n.end - n.time;
  const solid = notes.filter((n) => dur(n) >= 0.15);
  const ref = solid.length >= 3 ? solid : notes;
  const level = median(ref.map((n) => n.level ?? 1));
  const pitches = ref.map((n) => n.pitch ?? n.midi);
  const lo = percentile(pitches, 0.05);
  const hi = percentile(pitches, 0.95);
  // A word-final consonant (l, r, n, m) after a sung vowel leaves a short, much quieter
  // fragment on the same pitch (or an octave below); it belongs to the note before it.
  const merged: RawNote[] = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const prev = merged[merged.length - 1];
    const d = dur(n);
    const iv = prev ? Math.abs((n.pitch ?? n.midi) - (prev.pitch ?? prev.midi)) : 99;
    const octave = Math.abs(iv - 12) < 0.7;
    const tail = (iv < 0.7 || octave) && d < 0.22 && (n.level ?? 1) < (prev?.level ?? 1) * 0.6;
    // a creak between two parts of the same held note
    const next = notes[i + 1];
    const glitch =
      d < 0.1 && !!next && next.time - n.end < 0.16 && Math.abs((next.pitch ?? next.midi) - (prev?.pitch ?? prev?.midi ?? 0)) < 0.7;
    if (prev && n.time - prev.end < 0.16 && (tail || glitch || (octave && d < 0.12))) {
      prev.end = n.end;
      continue;
    }
    merged.push({ ...n });
  }
  notes = merged;
  return notes.filter((n, i) => {
    const d = dur(n);
    const p = n.pitch ?? n.midi;
    if (d < 0.08) return false;
    if ((n.level ?? 1) < level * 0.18) return false;
    if ((n.spread ?? 0) > 0.9 && d < 0.25) return false;
    if ((p > hi + 5 || p < lo - 5) && d < 0.3) return false;
    const gapPrev = i > 0 ? n.time - notes[i - 1].end : Infinity;
    const gapNext = i < notes.length - 1 ? notes[i + 1].time - n.end : Infinity;
    if (gapPrev > 0.4 && gapNext > 0.4 && d < 0.2) return false;
    return true;
  });
}

/**
 * Choose the intended semitone for every note. The singer's tuning reference is
 * a hidden state that drifts slowly (Viterbi over 5-cent steps); each note is
 * rounded against it, with notes outside the key needing extra evidence. A
 * slow drift therefore can never "wrap" into the neighbouring semitone, and
 * individual sharp/flat notes are read as the note the singer was aiming for.
 */
export function fitPitchesToKey(raw: RawNote[], key: Key): RawNote[] {
  return fitWithKey(raw, key).notes;
}

/** Fit against every key's scale and keep the one that explains the singing best. */
export function fitPitchesAnyKey(raw: RawNote[]): RawNote[] {
  let best: { notes: RawNote[]; cost: number } | null = null;
  for (let t = 0; t < 12; t++) {
    const r = fitWithKey(raw, { tonic: t, mode: 'major' });
    // Scales sharing the melody's notes tie on fit cost; the key profile of the
    // fitted melody (major or its relative minor) breaks the tie.
    const ranked = detectKey(r.notes.map((n) => ({ midi: n.midi, dur: n.end - n.time })));
    const fit = Math.max(...ranked.filter((k) => (k.mode === 'major' ? k.tonic === t : k.tonic === mod12(t + 9))).map((k) => k.score));
    const total = r.cost - 4 * fit;
    if (!best || total < best.cost) best = { notes: r.notes, cost: total };
  }
  return best ? best.notes : raw;
}

function fitWithKey(raw: RawNote[], key: Key): { notes: RawNote[]; cost: number } {
  const n = raw.length;
  if (!n) return { notes: raw, cost: 0 };
  const scale = new Set(scaleOf(key));
  const soft = key.mode === 'minor' ? new Set([mod12(key.tonic + 9), mod12(key.tonic + 11)]) : new Set<number>();
  const keyCost = (c: number) => (scale.has(mod12(c)) ? 0 : soft.has(mod12(c)) ? 0.5 : 2.2);
  const x = raw.map((r) => r.pitch ?? r.midi + r.cents / 100);
  const D: number[] = [];
  for (let d = -0.8; d <= 0.8001; d += 0.05) D.push(Math.round(d * 100) / 100);
  const S = D.length;
  // Best written note (and its cost) for note i if the singer's reference is D[s].
  const noteFor = (i: number, s: number) => {
    const y = x[i] - D[s];
    let best = { c: Math.round(y), cost: Infinity };
    for (const c of [Math.floor(y), Math.ceil(y)]) {
      const v = 7 * (y - c) ** 2 + keyCost(c);
      if (v < best.cost) best = { c, cost: v };
    }
    return best;
  };
  const prior = (s: number) => 0.8 * D[s] * D[s];
  let cost = D.map((_, s) => noteFor(0, s).cost + prior(s));
  const back: Int16Array[] = [new Int16Array(S)];
  for (let i = 1; i < n; i++) {
    const dt = Math.max(0.3, raw[i].time - raw[i - 1].time);
    const k = 6 / dt;
    const next = new Array<number>(S);
    const bk = new Int16Array(S);
    for (let s = 0; s < S; s++) {
      let best = Infinity;
      let arg = 0;
      for (let r = 0; r < S; r++) {
        const v = cost[r] + k * (D[s] - D[r]) ** 2;
        if (v < best) (best = v), (arg = r);
      }
      next[s] = best + noteFor(i, s).cost + prior(s) * 0.05;
      bk[s] = arg;
    }
    cost = next;
    back.push(bk);
  }
  const path = new Array<number>(n);
  const total = Math.min(...cost);
  path[n - 1] = cost.indexOf(total);
  for (let i = n - 1; i > 0; i--) path[i - 1] = back[i][path[i]];
  const notes = raw.map((r, i) => {
    const { c } = noteFor(i, path[i]);
    return { ...r, midi: c, cents: Math.round((x[i] - D[path[i]] - c) * 100) };
  });
  return { notes, cost: total };
}

/* ------------------------------------------------------------------ */
/* 3. Tempo + metre + quantisation                                      */
/* ------------------------------------------------------------------ */

export interface QuantizeOptions {
  timeSig: TimeSignature;
  bpm?: number; // known tempo (metronome or manual)
  gridOriginSec?: number; // time of a downbeat (metronome)
}

export function estimateTempo(onsets: number[]): number {
  if (onsets.length < 3) return 100;
  const iois = onsets.slice(1).map((t, i) => t - onsets[i]).filter((d) => d > 0.05);
  const medIoi = median(iois);
  let best = 100;
  let bestCost = Infinity;
  for (let bpm = 50; bpm <= 190; bpm += 0.5) {
    const beat = 60 / bpm;
    const e8 = beat / 2;
    // Least-squares phase: try several anchors to avoid dependence on the first onset only.
    let errBest = Infinity;
    for (const anchor of onsets.slice(0, Math.min(4, onsets.length))) {
      let err = 0;
      for (const t of onsets) {
        const x = (t - anchor) / e8;
        const d8 = Math.abs(x - Math.round(x));
        const d16 = Math.abs(2 * x - Math.round(2 * x)) / 2;
        err += Math.min(d8 * d8, d16 * d16 + 0.025);
      }
      errBest = Math.min(errBest, err / onsets.length);
    }
    const prior = 0.08 * Math.log2(bpm / 100) ** 2;
    const shortFrac = iois.filter((d) => d < 0.7 * e8).length / Math.max(1, iois.length);
    const ioiFit = 0.02 * Math.log2(medIoi / beat) ** 2;
    const cost = errBest + prior + 0.12 * shortFrac + ioiFit;
    if (cost < bestCost) {
      bestCost = cost;
      best = bpm;
    }
  }
  return best;
}

function fitGrid(onsets: number[], e8Init: number, t0Init: number, fixedPeriod: boolean) {
  let e8 = e8Init;
  let t0 = t0Init;
  for (let iter = 0; iter < 4; iter++) {
    const k = onsets.map((t) => Math.round((t - t0) / e8));
    if (fixedPeriod) {
      t0 = median(onsets.map((t, i) => t - k[i] * e8));
    } else {
      const n = onsets.length;
      const mk = k.reduce((s, v) => s + v, 0) / n;
      const mt = onsets.reduce((s, v) => s + v, 0) / n;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += (k[i] - mk) * (onsets[i] - mt);
        den += (k[i] - mk) ** 2;
      }
      if (den > 0) {
        const slope = num / den;
        if (slope > e8 * 0.85 && slope < e8 * 1.15) e8 = slope;
      }
      t0 = mt - e8 * mk;
    }
  }
  return { e8, t0 };
}

export function quantize(raw: RawNote[], opts: QuantizeOptions): {
  notes: MelodyNote[];
  bpm: number;
  originSec: number;
  totalUnits: number;
  tempoSource: Transcription['tempoSource'];
} {
  const barUnits = opts.timeSig.beats * UNITS_PER_BEAT;
  if (!raw.length) return { notes: [], bpm: opts.bpm ?? 100, originSec: 0, totalUnits: barUnits, tempoSource: 'estimated' };
  const onsets = raw.map((r) => r.time);
  const tempoSource: Transcription['tempoSource'] =
    opts.gridOriginSec !== undefined && opts.bpm ? 'metronome' : opts.bpm ? 'manual' : 'estimated';
  let bpm = opts.bpm ?? estimateTempo(onsets);
  let e8 = 60 / bpm / 2;
  let t0: number;
  if (tempoSource === 'metronome') {
    t0 = opts.gridOriginSec as number;
  } else {
    const fit = fitGrid(onsets, e8, onsets[0], tempoSource === 'manual');
    e8 = fit.e8;
    t0 = fit.t0;
    bpm = Math.round((60 / (e8 * 2)) * 10) / 10;
  }
  const unit = e8 / 2;
  // Sung onsets land late after consonants, so stay on the eighth grid unless the
  // neighbouring notes really are sixteenths.
  const fast = (i: number) =>
    (i > 0 && raw[i].time - raw[i - 1].time < 0.7 * e8) || (i + 1 < raw.length && raw[i + 1].time - raw[i].time < 0.7 * e8);
  const qPos = (t: number, i: number) => {
    const x8 = (t - t0) / e8;
    if (!fast(i) || Math.abs(x8 - Math.round(x8)) < 0.3) return 2 * Math.round(x8);
    return Math.round((t - t0) / unit);
  };
  const starts: number[] = [];
  raw.forEach((r, i) => {
    let s = qPos(r.time, i);
    if (i > 0 && s <= starts[i - 1]) s = starts[i - 1] + 1;
    starts.push(s);
  });
  const notes: MelodyNote[] = raw.map((r, i) => {
    const start = starts[i];
    let end = Math.max(start + 1, Math.round((r.end - t0) / unit));
    const nextStart = starts[i + 1];
    if (nextStart !== undefined) {
      if (end > nextStart) end = nextStart;
      const gapSec = raw[i + 1].time - r.end;
      const ioi = raw[i + 1].time - r.time;
      // detached singing is still written legato; only real breaks become rests
      const detached = (r.end - r.time) / ioi >= 0.5 && gapSec < 2 * e8;
      if (gapSec < 0.6 * e8 || nextStart - end <= 1 || detached) end = nextStart;
    } else {
      // Final note: a whole number of beats for clean notation.
      end = start + Math.max(UNITS_PER_BEAT, Math.round((end - start) / UNITS_PER_BEAT) * UNITS_PER_BEAT);
    }
    return { midi: r.midi, start, dur: Math.max(1, end - start), time: r.time, end: r.end, cents: r.cents };
  });

  // Choose the bar alignment (downbeat position) for free-tempo recordings.
  let offset = 0;
  if (tempoSource !== 'metronome') {
    const first = notes[0].start;
    let bestScore = -Infinity;
    for (let o = 0; o < barUnits; o += 2) {
      let score = o === 0 ? 1.5 : 0;
      notes.forEach((nt, i) => {
        const pos = ((nt.start - first + o) % barUnits + barUnits) % barUnits;
        let acc = 0;
        if (pos === 0) acc = 1;
        else if (opts.timeSig.beats === 4 && pos === 8) acc = 0.5;
        else if (pos % UNITS_PER_BEAT === 0) acc = 0.25;
        score += acc * (1 + Math.min(nt.dur, 8) / 4);
        // Notes held across a bar line (syncopation) are less likely.
        if (pos + nt.dur > barUnits && pos !== 0) score -= 0.4;
        if (i === notes.length - 1) score += pos === 0 ? 1 : opts.timeSig.beats === 4 && pos === 8 ? 0.5 : 0;
      });
      if (score > bestScore) {
        bestScore = score;
        offset = o;
      }
    }
    const shift = offset - notes[0].start;
    notes.forEach((nt) => (nt.start += shift));
    t0 -= shift * unit;
  }
  // Remove leading empty bars / negative positions so the first note sits in bar 1.
  const firstBar = Math.floor(notes[0].start / barUnits);
  if (firstBar !== 0) {
    notes.forEach((nt) => (nt.start -= firstBar * barUnits));
    t0 += firstBar * barUnits * unit;
  }
  notes.forEach((nt) => (nt.start = nt.start + 0)); // normalise -0
  const last = notes[notes.length - 1];
  const totalUnits = Math.ceil((last.start + last.dur) / barUnits) * barUnits;
  return { notes, bpm: Math.round(bpm * 10) / 10, originSec: t0, totalUnits, tempoSource };
}

/* ------------------------------------------------------------------ */
/* 4. Full pipeline                                                     */
/* ------------------------------------------------------------------ */

export interface AnalyzeOptions extends QuantizeOptions {
  key?: Key;
}

export function transcribeFromRaw(rawIn: RawNote[], tuningCents: number, opts: AnalyzeOptions): Transcription {
  const raw = opts.key ? fitPitchesToKey(rawIn, opts.key) : fitPitchesAnyKey(rawIn);
  const q = quantize(raw, opts);
  const key = opts.key ?? detectKey(q.notes.map((n) => ({ midi: n.midi, dur: n.dur })))[0];
  return {
    notes: q.notes,
    bpm: q.bpm,
    timeSig: opts.timeSig,
    key: { tonic: key.tonic, mode: key.mode, confidence: key.confidence },
    tuningCents,
    originSec: q.originSec,
    totalUnits: q.totalUnits,
    rawNotes: raw,
    tempoSource: q.tempoSource,
  };
}

export interface AnalysisResult {
  frames: PitchFrame[];
  transcription: Transcription;
}

export function analyzeRecording(samples: Float32Array, sampleRate: number, opts: AnalyzeOptions): AnalysisResult {
  const frames = trackPitch(samples, sampleRate);
  const seg = segmentNotes(frames);
  const transcription = transcribeFromRaw(seg.notes, seg.tuningCents, opts);
  // Store the tuning-corrected curve for display.
  const display = frames.map((f, i) => ({ ...f, midi: seg.voiced[i] ? (seg.smoothed[i] as number) : null }));
  return { frames: display, transcription };
}
