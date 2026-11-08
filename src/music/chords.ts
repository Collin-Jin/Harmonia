import { mod12, pcNameInKey, type Key } from './theory';
import { findCadences } from './phrases';
import { UNITS_PER_BEAT, type Chord, type ChordQuality, type HarmonicRhythm, type HarmonyStyle, type ScoreNote, type TimeSignature } from './types';

export const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus4: [0, 5, 7],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  hdim7: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  dom9: [0, 4, 7, 10, 2],
  maj9: [0, 4, 7, 11, 2],
  min9: [0, 3, 7, 10, 2],
};

export const SUFFIX: Record<ChordQuality, string> = {
  maj: '',
  min: 'm',
  dim: '°',
  aug: '+',
  sus4: 'sus4',
  dom7: '7',
  maj7: 'maj7',
  min7: 'm7',
  hdim7: 'm7♭5',
  dim7: '°7',
  dom9: '9',
  maj9: 'maj9',
  min9: 'm9',
};

export const MUSICXML_KIND: Record<ChordQuality, string> = {
  maj: 'major',
  min: 'minor',
  dim: 'diminished',
  aug: 'augmented',
  sus4: 'suspended-fourth',
  dom7: 'dominant',
  maj7: 'major-seventh',
  min7: 'minor-seventh',
  hdim7: 'half-diminished',
  dim7: 'diminished-seventh',
  dom9: 'dominant-ninth',
  maj9: 'major-ninth',
  min9: 'minor-ninth',
};

export function chordPcs(c: { root: number; quality: ChordQuality }): number[] {
  return QUALITY_INTERVALS[c.quality].map((i) => mod12(c.root + i));
}

interface Candidate {
  rel: number; // root relative to tonic
  quality: ChordQuality;
  roman: string;
  fn: Chord['fn'];
  prior: number; // log-ish prior
  target?: number; // for applied chords: relative root of the resolution chord
  kind: 'triad' | 'seventh' | 'secondary' | 'borrowed' | 'extended';
}

function vocabulary(key: Key, style: HarmonyStyle, complexity: number): Candidate[] {
  const c = complexity;
  const seventhW = style === 'jazz' ? 0.3 : style === 'barbershop' ? 0 : -1.2 + c * 0.9;
  // Chromatic chords only appear in plain styles once the colour slider is turned up.
  const secW = style === 'jazz' || style === 'barbershop' ? -0.5 + c * 0.6 : c < 0.5 ? -4 : -3.4 + c * 2.4;
  const borrowW = c < 0.5 ? -3.5 : -2.6 + c * 1.6;
  const pop = style === 'pop' || style === 'pad';
  const list: Candidate[] = [];
  if (key.mode === 'major') {
    list.push(
      { rel: 0, quality: 'maj', roman: 'I', fn: 'T', prior: 0.5, kind: 'triad' },
      { rel: 2, quality: 'min', roman: 'ii', fn: 'S', prior: style === 'choral' ? 0.2 : 0.05, kind: 'triad' },
      { rel: 4, quality: 'min', roman: 'iii', fn: 'T', prior: -0.6, kind: 'triad' },
      { rel: 5, quality: 'maj', roman: 'IV', fn: 'S', prior: pop ? 0.45 : 0.35, kind: 'triad' },
      { rel: 7, quality: 'maj', roman: 'V', fn: 'D', prior: 0.4, kind: 'triad' },
      { rel: 9, quality: 'min', roman: 'vi', fn: 'T', prior: pop ? 0.35 : 0.1, kind: 'triad' },
      { rel: 11, quality: 'dim', roman: 'vii°', fn: 'D', prior: -1.4, kind: 'triad' },
      { rel: 7, quality: 'dom7', roman: 'V7', fn: 'D', prior: seventhW + (style === 'barbershop' ? 0.9 : style === 'jazz' ? 0.3 : 0.6), kind: 'seventh' },
      { rel: 2, quality: 'min7', roman: 'ii7', fn: 'S', prior: seventhW + (style === 'choral' ? 0.2 : 0), kind: 'seventh' },
      { rel: 0, quality: 'maj7', roman: 'Imaj7', fn: 'T', prior: seventhW - (style === 'barbershop' ? 1.5 : 0.2), kind: 'seventh' },
      { rel: 5, quality: 'maj7', roman: 'IVmaj7', fn: 'S', prior: seventhW - (style === 'barbershop' ? 1.5 : 0.2), kind: 'seventh' },
      { rel: 9, quality: 'min7', roman: 'vi7', fn: 'T', prior: seventhW - 0.2, kind: 'seventh' },
      { rel: 2, quality: 'dom7', roman: 'V7/V', fn: 'X', prior: secW, target: 7, kind: 'secondary' },
      { rel: 4, quality: 'dom7', roman: 'V7/vi', fn: 'X', prior: secW, target: 9, kind: 'secondary' },
      { rel: 9, quality: 'dom7', roman: 'V7/ii', fn: 'X', prior: secW - 0.2, target: 2, kind: 'secondary' },
      { rel: 0, quality: 'dom7', roman: 'V7/IV', fn: 'X', prior: secW - 0.3, target: 5, kind: 'secondary' },
      { rel: 5, quality: 'min', roman: 'iv', fn: 'S', prior: borrowW + (pop ? 0.4 : 0), kind: 'borrowed' },
      { rel: 10, quality: 'maj', roman: '♭VII', fn: 'S', prior: borrowW, kind: 'borrowed' },
    );
    if (style === 'jazz') {
      list.push(
        { rel: 0, quality: 'maj9', roman: 'Imaj9', fn: 'T', prior: -0.4, kind: 'extended' },
        { rel: 2, quality: 'min9', roman: 'ii9', fn: 'S', prior: -0.4, kind: 'extended' },
        { rel: 7, quality: 'dom9', roman: 'V9', fn: 'D', prior: -0.3, kind: 'extended' },
        { rel: 4, quality: 'min7', roman: 'iii7', fn: 'T', prior: -0.6, kind: 'seventh' },
        { rel: 11, quality: 'hdim7', roman: 'viiø7', fn: 'D', prior: -0.9, kind: 'seventh' },
        { rel: 1, quality: 'dom7', roman: 'subV7', fn: 'X', prior: -2.4 + c * 1.6, target: 0, kind: 'secondary' },
      );
    }
    if (style === 'barbershop') list.push({ rel: 4, quality: 'dom7', roman: 'III7', fn: 'X', prior: secW - 0.1, target: 9, kind: 'secondary' });
    if (pop) list.push({ rel: 7, quality: 'sus4', roman: 'Vsus4', fn: 'D', prior: -1.3 + c * 0.5, kind: 'extended' });
  } else {
    list.push(
      { rel: 0, quality: 'min', roman: 'i', fn: 'T', prior: 0.5, kind: 'triad' },
      { rel: 2, quality: 'dim', roman: 'ii°', fn: 'S', prior: -0.9, kind: 'triad' },
      { rel: 3, quality: 'maj', roman: 'III', fn: 'T', prior: 0.0, kind: 'triad' },
      { rel: 5, quality: 'min', roman: 'iv', fn: 'S', prior: 0.3, kind: 'triad' },
      { rel: 7, quality: 'maj', roman: 'V', fn: 'D', prior: 0.35, kind: 'triad' },
      { rel: 7, quality: 'min', roman: 'v', fn: 'D', prior: -0.6, kind: 'triad' },
      { rel: 8, quality: 'maj', roman: 'VI', fn: 'S', prior: 0.15, kind: 'triad' },
      { rel: 10, quality: 'maj', roman: 'VII', fn: 'D', prior: 0.0, kind: 'triad' },
      { rel: 11, quality: 'dim', roman: 'vii°', fn: 'D', prior: -1.2, kind: 'triad' },
      { rel: 7, quality: 'dom7', roman: 'V7', fn: 'D', prior: seventhW + 0.6, kind: 'seventh' },
      { rel: 5, quality: 'min7', roman: 'iv7', fn: 'S', prior: seventhW - 0.1, kind: 'seventh' },
      { rel: 2, quality: 'hdim7', roman: 'iiø7', fn: 'S', prior: seventhW - 0.1, kind: 'seventh' },
      { rel: 8, quality: 'maj7', roman: 'VImaj7', fn: 'S', prior: seventhW - 0.2, kind: 'seventh' },
      { rel: 3, quality: 'maj7', roman: 'IIImaj7', fn: 'T', prior: seventhW - 0.3, kind: 'seventh' },
      { rel: 0, quality: 'min7', roman: 'i7', fn: 'T', prior: seventhW - 0.3, kind: 'seventh' },
      { rel: 0, quality: 'dom7', roman: 'V7/iv', fn: 'X', prior: secW - 0.2, target: 5, kind: 'secondary' },
      { rel: 10, quality: 'dom7', roman: 'V7/III', fn: 'X', prior: secW - 0.2, target: 3, kind: 'secondary' },
      { rel: 0, quality: 'maj', roman: 'I', fn: 'T', prior: borrowW - 0.3, kind: 'borrowed' },
    );
    if (style === 'jazz') {
      list.push(
        { rel: 0, quality: 'min9', roman: 'i9', fn: 'T', prior: -0.5, kind: 'extended' },
        { rel: 7, quality: 'dom9', roman: 'V9', fn: 'D', prior: -0.4, kind: 'extended' },
      );
    }
  }
  return list;
}

const isTonic = (c: Candidate) => c.rel === 0 && c.fn === 'T';
const isDominant = (c: Candidate) => c.rel === 7 && c.fn === 'D';

function transitionScore(a: Candidate, b: Candidate, sameAllowed: number, style: HarmonyStyle): number {
  if (a.rel === b.rel && a.quality === b.quality) return sameAllowed;
  let s = 0;
  if (a.kind === 'secondary') return a.target === b.rel && b.kind !== 'secondary' ? 1.0 : a.target === b.rel ? 0.8 : -0.9;
  if (b.kind === 'secondary' && mod12((b.target ?? 0) - b.rel) === 5 && mod12(b.rel - a.rel) === 5 && style === 'barbershop') s += 0.3; // circle of fifths chains
  const motion = mod12(b.rel - a.rel);
  if (motion === 5) s += 0.35; // root falls a fifth: the strongest progression
  if (motion === 7) s += 0.05;
  if (motion === 3 || motion === 9) s += 0.08; // falling/rising thirds share two notes
  if (motion === 2 && a.fn === 'S' && b.fn === 'D') s += 0.1; // IV → V
  if (a.fn === 'T' && b.fn === 'S') s += 0.3;
  if (a.fn === 'S' && b.fn === 'D') s += 0.45;
  // V → I is rewarded mostly at cadences (see detectChords); mid-phrase it must be earned by the melody.
  if (a.fn === 'D' && b.fn === 'T') s += isDominant(a) && isTonic(b) ? 0.3 : 0.2;
  if (a.fn === 'D' && b.fn === 'S') s -= 0.6; // retrogression
  if (a.rel === b.rel) s -= 0.1; // same root, different colour
  if (isDominant(a) && b.rel === 9 && b.fn === 'T') s += 0.3; // deceptive cadence
  if (style === 'pop' || style === 'pad') {
    if (isTonic(a) && b.rel === 9) s += 0.2; // I → vi
    if (a.rel === 9 && b.rel === 5 && b.fn === 'S') s += 0.35; // vi → IV
    if (a.rel === 5 && a.fn === 'S' && isTonic(b)) s += 0.25; // plagal IV → I
    if (a.rel === 5 && a.quality === 'maj' && b.rel === 5 && b.quality === 'min') s += 0.7; // IV → iv
    if (a.rel === 5 && a.quality === 'min' && isTonic(b)) s += 0.5; // iv → I
  }
  if (style === 'jazz') {
    if (a.rel === 2 && a.fn === 'S' && isDominant(b)) s += 0.6; // ii → V
    if (isDominant(a) && isTonic(b)) s += 0.3;
  }
  return s;
}

function segmentLength(hr: HarmonicRhythm, ts: TimeSignature): number {
  const bar = ts.beats * UNITS_PER_BEAT;
  switch (hr) {
    case 'bar':
      return bar;
    case 'beat':
      return UNITS_PER_BEAT;
    case 'half':
      return ts.beats % 2 === 0 ? bar / 2 : ts.beats === 3 ? UNITS_PER_BEAT : bar;
    case 'auto':
      return ts.beats % 2 === 0 ? bar / 2 : ts.beats === 3 ? UNITS_PER_BEAT : bar;
  }
}

/**
 * How well a chord fits the melody between units a and b: chord tones on strong beats and long
 * notes score, passing and neighbour tones are expected, accented clashes cost.
 */
function melodyFit(melody: ScoreNote[], a: number, b: number, pcs: number[], bar: number, colourful: boolean): number {
  let score = 0;
  let total = 0;
  for (let k = 0; k < melody.length; k++) {
    const n = melody[k];
    const ov = Math.min(b, n.start + n.dur) - Math.max(a, n.start);
    if (ov <= 0) continue;
    const startsHere = n.start >= a;
    const posInBar = ((n.start % bar) + bar) % bar;
    let metric = 0.8;
    if (startsHere) metric = posInBar === 0 ? 1.6 : posInBar % UNITS_PER_BEAT === 0 ? 1.15 : 0.7;
    else metric = 1.3; // sustained across the chord change: very audible
    const w = Math.sqrt(ov) * metric;
    total += w;
    const idx = pcs.indexOf(mod12(n.midi));
    if (idx === 0) score += 1.08 * w;
    else if (idx === 1) score += 1.05 * w;
    else if (idx === 2) score += 1.0 * w;
    else if (idx >= 3) score += (idx === 4 ? 0.5 : colourful ? 0.85 : 0.55) * w;
    else {
      const p = melody[k - 1];
      const q = melody[k + 1];
      const stepTo = (x?: ScoreNote) => !!x && x.midi !== n.midi && Math.abs(x.midi - n.midi) <= 2;
      // Passing / neighbour tones off the beat are expected, not clashes.
      const passing = posInBar !== 0 && n.dur <= UNITS_PER_BEAT && stepTo(p) && stepTo(q);
      // Appoggiatura: an accented dissonance resolving by step onto a chord tone.
      const appog = metric > 1 && stepTo(q) && q!.start < b && pcs.includes(mod12(q!.midi)) && n.dur <= UNITS_PER_BEAT * 2;
      score -= (passing ? 0.15 : appog ? 0.45 : metric > 1 ? 1.4 : 0.6) * w;
    }
  }
  return total > 0 ? (3.2 * score) / total : 0;
}

export interface ChordDetectOptions {
  key: Key;
  timeSig: TimeSignature;
  harmonicRhythm: HarmonicRhythm;
  style: HarmonyStyle;
  complexity: number;
  totalUnits: number;
  seed?: number;
  /** Melody note indices that end a lyric line (phrase). */
  phraseHints?: number[];
  /** Chords the user pinned: segments they cover keep them, and the rest is chosen to fit around them. */
  locks?: Chord[];
}

/**
 * Infer a chord progression for a melody with a second-order Viterbi search.
 * Emissions reward chord tones on strong beats and long notes (passing and
 * neighbour tones are expected); transitions encode functional harmony
 * (T→S→D→T, falling fifths, resolving applied dominants) plus style idioms;
 * the second-order term discourages aimless A–B–A–B alternation; every phrase
 * ending gets a cadence (authentic or half, chosen by the melody), the last one
 * a full pre-dominant → dominant → tonic close.
 */
export function detectChords(melody: ScoreNote[], o: ChordDetectOptions): Chord[] {
  const seg = segmentLength(o.harmonicRhythm, o.timeSig);
  const bar = o.timeSig.beats * UNITS_PER_BEAT;
  const nSeg = Math.max(1, Math.ceil(o.totalUnits / seg));
  const vocab = vocabulary(o.key, o.style, o.complexity);
  const locks = o.locks ?? [];
  const lockIdx = locks.map((c) => candidateIndex(vocab, o.key, c));
  const colourful = o.style === 'jazz' || o.style === 'barbershop';
  const plain = o.style === 'choral';
  const seed = o.seed ?? 0;
  const noise = (s: number, j: number) => {
    if (!seed) return 0;
    let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(s + 1, 0xc2b2ae35) ^ Math.imul(j + 7, 0x27d4eb2f);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h ^= h >>> 13;
    return ((h >>> 0) / 4294967296) * 0.9;
  };
  const sameBonus = o.harmonicRhythm === 'auto' ? 0.45 : o.harmonicRhythm === 'beat' ? 0.15 : -0.1;
  // In auto mode harmony moves with the bar line; mid-bar (or mid-beat in 3/4) changes need real evidence.
  const offGridCost = (s: number) => {
    if (o.harmonicRhythm !== 'auto') return 0;
    const u = s * seg;
    if (u % bar === 0) return 0;
    return o.timeSig.beats === 3 ? 1.5 : 1.1;
  };

  const cadences = findCadences(melody, o.timeSig, o.phraseHints);
  const cadAt = new Map<number, { final: boolean; mel: number }>();
  for (const c of cadences) {
    const s = Math.min(nSeg - 1, Math.floor(c.unit / seg));
    cadAt.set(s, { final: c.final, mel: melody[c.noteIndex].midi });
  }
  const lastSounding = melody.length ? Math.floor(melody[melody.length - 1].start / seg) : nSeg - 1;
  // Segments approaching a cadence may change chord mid-bar freely (harmonic rhythm speeds up).
  const preCad = new Set<number>();
  cadAt.forEach((_, s) => {
    preCad.add(s);
    preCad.add(s - 1);
  });

  const emission = (s: number, c: Candidate) =>
    melodyFit(melody, s * seg, (s + 1) * seg, chordPcs({ root: mod12(o.key.tonic + c.rel), quality: c.quality }), bar, colourful);

  const N = vocab.length;
  const firstStart = melody.length ? Math.max(0, melody[0].start) : 0;
  const s0 = Math.min(nSeg - 1, Math.floor(firstStart / seg));
  const pickup = firstStart % bar !== 0;
  // local[s][j]: everything that depends on one segment only
  const local: number[][] = [];
  for (let s = 0; s < nSeg; s++) {
    const row = new Array(N).fill(-Infinity);
    if (s >= s0) {
      const cad = cadAt.get(s);
      for (let j = 0; j < N; j++) {
        const c = vocab[j];
        // Evidence and priors accrue per unit of time, so meters with shorter segments weigh the same.
        let v = (emission(s, c) + c.prior + noise(s, j)) * (seg / (2 * UNITS_PER_BEAT));
        if (s === lastSounding || s === nSeg - 1 || cad?.final) {
          v += isTonic(c) && c.kind !== 'secondary' && c.quality !== 'dom7' ? 1.8 : -0.8;
        } else if (cad) {
          // Internal phrase end: rest on I (authentic) or V (half cadence).
          if ((isTonic(c) && c.kind === 'triad') || (isDominant(c) && (c.kind === 'triad' || c.kind === 'seventh'))) v += 0.6;
          else v -= 0.25;
        }
        if (s === lastSounding - 1 && c.fn === 'D') v += 0.6;
        if (s === s0) {
          // Openings: on the tonic (or the dominant for a pickup).
          v += isTonic(c) && c.kind !== 'secondary' ? 1.5 : pickup && isDominant(c) ? 0.5 : -0.3;
        }
        row[j] = v;
      }
      // A pinned chord owns every segment whose middle it covers.
      const mid = (s + 0.5) * seg;
      const li = locks.findIndex((c) => c.start <= mid && c.start + c.dur > mid);
      if (li >= 0) for (let j = 0; j < N; j++) if (j !== lockIdx[li]) row[j] = -Infinity;
    }
    local.push(row);
  }

  // Second-order Viterbi: state = (previous chord, current chord).
  const NEG = -Infinity;
  let dp = new Float64Array(N * N).fill(NEG); // [i * N + j], i = previous chord (row N used for "none")
  const backs: Int32Array[] = [];
  let dp0 = new Float64Array(N).fill(NEG);
  for (let j = 0; j < N; j++) dp0[j] = local[s0][j];
  // after s0, states have a real predecessor
  let hasPrev = false;
  for (let s = s0 + 1; s < nSeg; s++) {
    const next = new Float64Array(N * N).fill(NEG);
    const back = new Int32Array(N * N).fill(-1);
    const cad = cadAt.get(s);
    const finalCad = cad?.final || s === lastSounding;
    const ogc = preCad.has(s) || preCad.has(s + 1) ? Math.min(offGridCost(s), o.timeSig.beats === 3 ? 0.8 : 0.2) : offGridCost(s);
    for (let j = 0; j < N; j++) {
      // j = previous (at s-1), k = current (at s)
      for (let k = 0; k < N; k++) {
        const loc = local[s][k];
        if (loc === NEG) continue;
        const a = vocab[j];
        const b = vocab[k];
        // Holding a chord through a bar line is fine but should not be the default: harmony
        // usually moves with the bar (slow pads excepted).
        const same = (s * seg) % bar === 0 ? (o.style === 'pad' ? 0.4 : o.timeSig.beats === 3 ? 0.3 : 0.15) : sameBonus;
        let t = transitionScore(a, b, same, o.style) + loc - (j !== k ? ogc : 0);
        if (cad) {
          if (isDominant(a) && isTonic(b)) t += finalCad ? 0.9 : 0.35;
          if ((a.fn === 'S' || a.fn === 'T') && isDominant(b) && !finalCad) t += 0.35;
        }
        let best = NEG;
        let arg = -1;
        if (!hasPrev) {
          best = dp0[j] + t;
          arg = N; // no grand-parent
        } else {
          for (let i = 0; i < N; i++) {
            const prev = dp[i * N + j];
            if (prev === NEG) continue;
            let v = prev + t;
            const g = vocab[i];
            if (i === k && j !== k) {
              // A–B–A: fine once (I–V–I), but plain alternation sounds aimless in pop/pad/jazz
              if (!plain && !cad) v -= 0.25;
              if (g.kind === 'secondary' || a.kind === 'secondary') v -= 0.6;
            }
            if (finalCad && g.fn === 'S' && isDominant(a) && isTonic(b)) v += 0.4; // full cadence S → D → T
            if (v > best) {
              best = v;
              arg = i;
            }
          }
        }
        if (best === NEG) continue;
        next[j * N + k] = best;
        back[j * N + k] = arg;
      }
    }
    dp = next;
    backs.push(back);
    hasPrev = true;
  }

  // Backtrack.
  const path: number[] = new Array(nSeg).fill(0);
  if (!hasPrev) {
    let bj = 0;
    for (let j = 1; j < N; j++) if (dp0[j] > dp0[bj]) bj = j;
    path[s0] = bj;
  } else {
    let bestV = NEG;
    let bj = 0;
    let bk = 0;
    for (let j = 0; j < N; j++)
      for (let k = 0; k < N; k++)
        if (dp[j * N + k] > bestV) {
          bestV = dp[j * N + k];
          bj = j;
          bk = k;
        }
    path[nSeg - 1] = bk;
    path[nSeg - 2] = bj;
    for (let s = nSeg - 1; s > s0 + 1; s--) {
      const back = backs[s - s0 - 1];
      const i = back[path[s - 1] * N + path[s]];
      path[s - 2] = i;
    }
  }

  // Merge repeated chords into longer events.
  const chords: Chord[] = [];
  path.forEach((j, s) => {
    if (s < s0) return;
    const c = vocab[j];
    const root = mod12(o.key.tonic + c.rel);
    const prev = chords[chords.length - 1];
    if (prev && prev.root === root && prev.quality === c.quality) {
      prev.dur += seg;
      return;
    }
    chords.push({
      root,
      quality: c.quality,
      start: s === s0 ? firstStart : s * seg,
      dur: s === s0 ? (s + 1) * seg - firstStart : seg,
      symbol: pcNameInKey(root, o.key) + SUFFIX[c.quality],
      roman: c.roman,
      fn: c.fn,
    });
  });
  const lastC = chords[chords.length - 1];
  lastC.dur = Math.max(1, o.totalUnits - lastC.start);
  return locks.length ? applyChordEdits(chords, locks) : chords;
}

/** Index of a chord in the vocabulary, adding it (as a borrowed colour) when the style doesn't offer it. */
function candidateIndex(vocab: Candidate[], key: Key, c: Chord): number {
  const rel = mod12(c.root - key.tonic);
  const i = vocab.findIndex((v) => v.rel === rel && v.quality === c.quality);
  if (i >= 0) return i;
  vocab.push({ rel, quality: c.quality, roman: c.roman, fn: c.fn, prior: -1, kind: 'borrowed' });
  return vocab.length - 1;
}

/**
 * Lay the user's chords over a progression: each edit owns exactly its span, chords it
 * overlaps are trimmed around it, and everything else is left as it was.
 */
export function applyChordEdits(base: Chord[], edits: Chord[]): Chord[] {
  const out: Chord[] = [];
  for (const c of base) {
    let pieces = [{ start: c.start, end: c.start + c.dur }];
    for (const e of edits) {
      const es = e.start;
      const ee = e.start + e.dur;
      pieces = pieces.flatMap((p) =>
        ee <= p.start || es >= p.end
          ? [p]
          : [
              ...(es > p.start ? [{ start: p.start, end: es }] : []),
              ...(ee < p.end ? [{ start: ee, end: p.end }] : []),
            ],
      );
    }
    for (const p of pieces) out.push({ ...c, start: p.start, dur: p.end - p.start });
  }
  for (const e of edits) out.push({ ...e });
  out.sort((a, b) => a.start - b.start);
  return out;
}

export interface ChordSuggestion {
  chord: Chord;
  /** Higher fits better: melody fit over the span plus how naturally it follows and leads on. */
  score: number;
}

/**
 * Every chord the style offers for one span, ranked by how well it fits the melody there
 * and connects to the chords either side.
 */
export function suggestChords(melody: ScoreNote[], o: ChordDetectOptions, span: { start: number; dur: number }, prev?: Chord, next?: Chord): ChordSuggestion[] {
  const bar = o.timeSig.beats * UNITS_PER_BEAT;
  const vocab = vocabulary(o.key, o.style, o.complexity);
  const colourful = o.style === 'jazz' || o.style === 'barbershop';
  const find = (c?: Chord) => (c ? vocab.find((v) => v.rel === mod12(c.root - o.key.tonic) && v.quality === c.quality) : undefined);
  const before = find(prev);
  const after = find(next);
  return vocab
    .map((v) => {
      const root = mod12(o.key.tonic + v.rel);
      const pcs = chordPcs({ root, quality: v.quality });
      let score = melodyFit(melody, span.start, span.start + span.dur, pcs, bar, colourful) + v.prior;
      if (before) score += transitionScore(before, v, 0, o.style);
      if (after) score += transitionScore(v, after, 0, o.style);
      const chord: Chord = { root, quality: v.quality, start: span.start, dur: span.dur, symbol: pcNameInKey(root, o.key) + SUFFIX[v.quality], roman: v.roman, fn: v.fn };
      return { chord, score };
    })
    .sort((a, b) => b.score - a.score);
}

export function chordAt(chords: Chord[], unit: number): Chord {
  for (let i = chords.length - 1; i >= 0; i--) if (chords[i].start <= unit) return chords[i];
  return chords[0];
}
