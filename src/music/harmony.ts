import { applyChordEdits, chordAt, chordPcs, detectChords, QUALITY_INTERVALS } from './chords';
import { diatonicStep, mod12, scaleOf, type Key } from './theory';
import { findCadences } from './phrases';
import {
  MELODY_COLOR,
  UNITS_PER_BEAT,
  VOICE_COLORS,
  type Arrangement,
  type Chord,
  type ClefKind,
  type HarmonyOptions,
  type HarmonyStyle,
  type LiveStep,
  type MelodyNote,
  type Placement,
  type ScoreNote,
  type TimeSignature,
  type VoicePart,
  type Vowel,
} from './types';

interface Slot {
  name: string;
  short: string;
  offset: number; // centre relative to the melody's median pitch
  bass?: boolean;
  parallel?: boolean; // favours parallel 3rds/6ths with the melody
  /** Diatonic steps from the melody this voice prefers to shadow (2 = 3rd above, -5 = 6th below). */
  shadow?: number;
  /** May double the melody or the high harmony an octave up instead of a line of its own. */
  doubles?: boolean;
}

export const STYLE_INFO: Record<HarmonyStyle, { label: string; blurb: string; maxVoices: number; placement: boolean }> = {
  pop: { label: 'Pop Stack', blurb: '3rds and 6ths that follow your melody and land on the chord — modern vocal stacks.', maxVoices: 3, placement: false },
  choral: { label: 'Choral SATB', blurb: 'Your melody as soprano over classical four-part voice leading.', maxVoices: 4, placement: false },
  jazz: { label: 'Jazz Close', blurb: 'Close-voiced 7ths, 9ths & colour tones beneath the lead.', maxVoices: 4, placement: false },
  barbershop: { label: 'Barbershop', blurb: 'Lead melody with tenor on top, ringing dominant sevenths.', maxVoices: 3, placement: false },
  pad: { label: 'Ambient Pad', blurb: 'Sustained “oohs” that bloom on each chord and hold common tones.', maxVoices: 4, placement: true },
};

function slotsFor(style: HarmonyStyle, n: number, placement: Placement, variant: number): Slot[] {
  const S = (name: string, short: string, offset: number, extra: Partial<Slot> = {}): Slot => ({ name, short, offset, ...extra });
  let list: Slot[];
  switch (style) {
    case 'pop': {
      // A 3rd above, a 3rd or 4th below, then a top part. No bass: the singer's voice re-pitched
      // that far down buzzes. Variations swap between equally idiomatic shapes rather than
      // adding randomness.
      const alt = variant % 2 === 1;
      const hi = S('High Harmony', 'Hi', 4, { parallel: true, shadow: 2 });
      const lo = alt ? S('Low Harmony', 'Lo', -5, { parallel: true, shadow: -3 }) : S('Low Harmony', 'Lo', -4, { parallel: true, shadow: -2 });
      list = [hi, lo, S('Top Harmony', 'Top', 8, { doubles: true })];
      break;
    }
    case 'choral':
      list =
        n === 1
          ? [S('Alto', 'A', -5)]
          : n === 2
            ? [S('Alto', 'A', -5), S('Bass', 'B', -15, { bass: true })]
            : n === 3
              ? [S('Alto', 'A', -5), S('Tenor', 'T', -11), S('Bass', 'B', -19, { bass: true })]
              : [S('Descant', 'D', 7), S('Alto', 'A', -5), S('Tenor', 'T', -11), S('Bass', 'B', -19, { bass: true })];
      break;
    case 'jazz':
      list =
        n === 4
          ? [S('Voice 2', 'V2', -3), S('Voice 3', 'V3', -7), S('Voice 4', 'V4', -10), S('Bass', 'B', -17, { bass: true })]
          : [S('Voice 2', 'V2', -3), S('Voice 3', 'V3', -7), S('Voice 4', 'V4', -10)];
      break;
    case 'barbershop':
      list = [S('Tenor', 'Ten', 4, { parallel: true, shadow: 2 }), S('Baritone', 'Bari', -5), S('Bass', 'Bass', -12, { bass: true }), S('Descant', 'Desc', 9)];
      if (n === 2) list = [list[0], list[2]];
      break;
    case 'pad':
      list =
        placement === 'above'
          ? [S('Pad High', 'P1', 5), S('Pad Higher', 'P2', 9), S('Pad Low', 'P3', -7), S('Pad Root', 'P4', -14, { bass: true })]
          : placement === 'below'
            ? [S('Pad 1', 'P1', -5), S('Pad 2', 'P2', -9), S('Pad 3', 'P3', -14), S('Pad Root', 'P4', -20, { bass: true })]
            : [S('Pad Low', 'P1', -5), S('Pad High', 'P2', 6), S('Pad Lower', 'P3', -11), S('Pad Root', 'P4', -18, { bass: true })];
      break;
  }
  return list.slice(0, n);
}

/** Deterministic hash-based noise in [0,1). */
function hashNoise(seed: number, a: number, b: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(a + 1, 0xc2b2ae35) ^ Math.imul(b | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

interface Event {
  start: number;
  dur: number;
  chord: Chord;
  melody: { midi: number; weight: number }[]; // melody notes sounding during the event
  lead: number; // principal melody pitch
  leadIsChordTone: boolean;
  holdable: boolean; // weak, short non-chord tone: harmony may sustain through it
  melodyIndex: number; // homophonic: index of the melody note; pad: -1
  prevContiguous: boolean; // previous event ends where this starts
  first?: boolean;
  final?: boolean;
  cadence?: boolean; // closes a phrase
}

interface Ctx {
  style: HarmonyStyle;
  key: Key;
  slots: Slot[];
  centres: number[];
  complexity: number;
  seed: number;
  leadingTone: number;
}

function buildEvents(melody: ScoreNote[], chords: Chord[], style: HarmonyStyle, ts: TimeSignature): Event[] {
  const bar = ts.beats * UNITS_PER_BEAT;
  if (style === 'pad') {
    const events: Event[] = [];
    for (const c of chords) {
      // Split long chords at bar lines to keep pad events readable.
      for (let s = c.start; s < c.start + c.dur; ) {
        const e = Math.min(c.start + c.dur, (Math.floor(s / bar) + 1) * bar);
        const inside = melody.filter((n) => n.start < e && n.start + n.dur > s);
        if (inside.length) {
          const pcs = chordPcs(c);
          const mel = inside.map((n) => ({
            midi: n.midi,
            weight: Math.sqrt(Math.min(e, n.start + n.dur) - Math.max(s, n.start)) * (pcs.includes(mod12(n.midi)) ? 1 : 1.4),
          }));
          const lead = inside.reduce((a, b) => (b.dur > a.dur ? b : a)).midi;
          const prev = events[events.length - 1];
          events.push({
            start: s,
            dur: e - s,
            chord: c,
            melody: mel,
            lead,
            leadIsChordTone: pcs.includes(mod12(lead)),
            holdable: false,
            melodyIndex: -1,
            prevContiguous: !!prev && prev.start + prev.dur === s,
          });
        }
        s = e;
      }
    }
    return events;
  }
  return melody.map((n, i) => {
    // A note sung just before a chord change (an anticipation) mostly sounds under the next
    // chord, so it is harmonized with that one.
    let chord = chordAt(chords, n.start);
    const next = chords[chords.indexOf(chord) + 1];
    if (next && next.start > n.start && n.start + n.dur - next.start > next.start - n.start) chord = next;
    const pcs = chordPcs(chord);
    const isCT = pcs.includes(mod12(n.midi));
    const onBeat = n.start % UNITS_PER_BEAT === 0;
    const prev = melody[i - 1];
    const contiguous = !!prev && prev.start + prev.dur === n.start;
    return {
      start: n.start,
      dur: n.dur,
      chord,
      melody: [{ midi: n.midi, weight: 1 }],
      lead: n.midi,
      leadIsChordTone: isCT,
      // passing tones, and notes that only stretch a syllable (melisma): the harmony can sustain
      holdable: contiguous && chordAt(chords, prev.start) === chord && ((!isCT && !onBeat && n.dur <= 2) || !!n.melisma),
      melodyIndex: i,
      prevContiguous: contiguous,
    };
  });
}

function candidatePitches(ctx: Ctx, ev: Event, v: number): { midi: number; penalty: number }[] {
  const slot = ctx.slots[v];
  const c = ctx.centres[v];
  const lo = Math.max(33, c - 8);
  const hi = Math.min(86, c + 8);
  const pcs = chordPcs(ev.chord);
  const allowed = new Map<number, number>();
  pcs.forEach((p) => allowed.set(p, 0));
  const scale = scaleOf(ctx.key);
  if (ctx.style === 'jazz') {
    // Colour tones: 9th and 13th when diatonic.
    for (const iv of [2, 9]) {
      const p = mod12(ev.chord.root + iv);
      if (!allowed.has(p) && scale.includes(p) && !(ev.chord.quality === 'min' && iv === 9)) allowed.set(p, 0.35);
    }
  }
  if (ctx.style === 'pad' && ctx.complexity > 0.5) {
    const p = mod12(ev.chord.root + 2);
    if (!allowed.has(p) && scale.includes(p)) allowed.set(p, 0.8 - ctx.complexity * 0.5);
  }
  const out: { midi: number; penalty: number }[] = [];
  for (let m = lo; m <= hi; m++) {
    const pen = allowed.get(mod12(m));
    if (pen !== undefined) out.push({ midi: m, penalty: pen });
  }
  // Parallel diatonic 3rds/6ths through the melody's passing tones (pop stacks, barbershop tenor).
  // Where the melody sits on a chord tone the harmony must too, or the voicing contradicts the chord symbol.
  if ((slot.parallel || ctx.style === 'pop') && !ev.leadIsChordTone) {
    for (const steps of [2, -2, 5, -5]) {
      const m = diatonicStep(ev.lead, steps, ctx.key);
      if (m >= lo && m <= hi && !out.some((o) => o.midi === m)) out.push({ midi: m, penalty: 0.3 });
    }
  }
  out.sort((a, b) => Math.abs(a.midi - c) - Math.abs(b.midi - c));
  const kept = out.slice(0, ctx.style === 'jazz' ? 8 : 7);
  if (slot.bass) {
    // The root (in either nearby octave) must always be available to the bass.
    for (let m = lo - 4; m <= hi + 4; m++)
      if (mod12(m) === ev.chord.root && m >= 33 && !kept.some((o) => o.midi === m)) kept.push({ midi: m, penalty: 0 });
  }
  if (slot.shadow !== undefined) {
    const m = diatonicStep(ev.lead, slot.shadow, ctx.key);
    const fits = pcs.includes(mod12(m)) || !ev.leadIsChordTone;
    if (fits && m >= 33 && m <= 86 && !kept.some((o) => o.midi === m)) kept.push({ midi: m, penalty: 0 });
  }
  return kept;
}

function enumerateCombos(ctx: Ctx, ev: Event): { combo: number[]; penalty: number }[] {
  const per = ctx.slots.map((_, v) => candidatePitches(ctx, ev, v));
  const order = ctx.slots.map((s, i) => ({ i, off: s.offset })).sort((a, b) => b.off - a.off);
  const results: { combo: number[]; penalty: number }[] = [];
  const combo = new Array(ctx.slots.length).fill(0);
  const strict = (relax: boolean) => {
    const rec = (k: number, above: number, pen: number) => {
      if (k === order.length) {
        results.push({ combo: combo.slice(), penalty: pen });
        return;
      }
      const vi = order[k].i;
      for (const cand of per[vi]) {
        if (!relax) {
          if (cand.midi >= above) continue;
          // voices above the melody must stay above it
          if (order[k].off > 0 && cand.midi <= ev.lead) continue;
          if (order[k].off < 0 && cand.midi >= ev.lead) continue;
        }
        combo[vi] = cand.midi;
        rec(k + 1, cand.midi, pen + cand.penalty);
      }
    };
    rec(0, 200, 0);
  };
  strict(false);
  if (!results.length) strict(true);
  return results;
}

const motionCost = (d: number, bass: boolean) => {
  const a = Math.abs(d);
  if (a === 0) return 0;
  if (a <= 2) return 0.25;
  if (a <= 4) return 0.7;
  if (a === 5 || a === 7) return bass ? 0.45 : a === 5 ? 1.1 : 1.4;
  if (a === 6) return 2.2;
  if (a === 12) return bass ? 0.9 : 3;
  if (a <= 12) return 2.2 + (a - 8) * 0.25;
  return 4 + (a - 12) * 0.5;
};

function staticCost(ctx: Ctx, ev: Event, h: number[]): number {
  const { style, slots } = ctx;
  let cost = 0;
  const iv = QUALITY_INTERVALS[ev.chord.quality];
  const pcs = chordPcs(ev.chord);
  const counts = new Map<number, number>();
  const all = [...h, ev.lead];
  all.forEach((m) => counts.set(mod12(m), (counts.get(mod12(m)) ?? 0) + 1));
  const has = (idx: number) => idx < pcs.length && counts.has(pcs[idx]);
  const nVoices = h.length;

  if (nVoices >= 2 || style === 'choral') {
    // Pop stacks are parallel lines; full chord coverage only matters on long, strong-beat notes.
    const cover = style === 'pop' ? (ev.dur >= UNITS_PER_BEAT * 2 && ev.start % UNITS_PER_BEAT === 0 ? 0.5 : 0.2) : 1;
    if (!has(0)) cost += cover * (style === 'jazz' ? 0.3 : nVoices >= 2 ? 2.0 : 0.5);
    if (!has(1)) cost += cover * (nVoices >= 2 ? 3.0 : 1.0);
    if (iv.length >= 4 && !has(3)) cost += cover * (style === 'jazz' || style === 'barbershop' ? 2.0 : 0.8);
    if (!has(2)) cost += cover * 0.25;
  } else if (!ev.leadIsChordTone) {
    // single harmony voice under a non-chord tone: 3rd/6th away is ideal
  }
  // Doubling rules
  counts.forEach((cnt, p) => {
    if (cnt < 2) return;
    if (p === ctx.leadingTone && ev.chord.fn === 'D') cost += 3;
    const idx = pcs.indexOf(p);
    if (idx === 3) cost += 2.2; // doubled 7th
    if (idx === 1 && (style === 'choral' || style === 'barbershop')) cost += 0.6;
    if (idx === -1) cost += 1.5; // doubled non-chord tone
    if (style === 'pop' && nVoices <= 2 && p === mod12(ev.lead)) cost += 0.9;
    if (style === 'barbershop') cost += 0.7 * (cnt - 1);
  });

  for (let v = 0; v < nVoices; v++) {
    const m = h[v];
    const slot = slots[v];
    const dist = Math.abs(m - ctx.centres[v]);
    cost += 0.045 * dist * dist;
    for (const mel of ev.melody) {
      const d = Math.abs(m - mel.midi);
      const i = d % 12;
      let c = 0;
      if (i === 1 || i === 11) c = ev.leadIsChordTone || style === 'pad' ? 7 : style === 'jazz' ? 2.5 : 5;
      else if (i === 2 || i === 10) c = style === 'jazz' ? 0.1 : ev.leadIsChordTone ? 0.9 : 0.35;
      else if (i === 6) c = style !== 'pop' && ['dom7', 'dim', 'hdim7', 'dim7', 'dom9'].includes(ev.chord.quality) ? 0.1 : 0.9;
      else if (i === 0) c = style === 'pop' ? 0.7 : 0.15;
      if (d <= 2 && d > 0) c += 2;
      cost += c * mel.weight;
    }
    if (slot.shadow !== undefined) {
      // A voice that keeps one shape against the melody reads as a line, not a sequence of
      // chord tones — as long as the shape agrees with the harmony where it is exposed.
      // Only a preference: long runs of it are broken up in transitionCost.
      if (m === diatonicStep(ev.lead, slot.shadow, ctx.key)) cost -= pcs.includes(mod12(m)) ? 1.0 : 0.8;
    } else if (slot.parallel || style === 'pop') {
      const d = Math.abs(m - ev.lead);
      if ([3, 4, 8, 9, 15, 16].includes(d)) cost -= slot.parallel ? 0.9 : 0.4;
      else if (d === 5 || d === 7) cost -= 0.1;
    }
    if (slot.bass) {
      // Root position by default; first inversion for a smoother line; cadences, the
      // opening and the final chord always stand on the root.
      const idx = pcs.indexOf(mod12(m));
      let b = idx === 0 ? -1.2 : idx === 1 ? 0.35 : idx === 2 ? 1.5 : 1.8;
      if (ev.final || ev.first) b += idx === 0 ? -1.5 : 3;
      else if (ev.cadence) b += idx === 0 ? -0.8 : 1.5;
      cost += b;
    }
  }
  // Through a passing tone one voice may shadow the melody; the rest hold chord tones, so the
  // moment still sounds like the written chord rather than a new one.
  if (style === 'pop' || style === 'barbershop') {
    const foreign = h.filter((m) => !pcs.includes(mod12(m))).length;
    if (foreign) cost += (foreign - 1) * 3 + (ev.start % (UNITS_PER_BEAT * 2) === 0 ? 0.6 : 0);
  }
  // Every upper voice should add something: avoid octave duplicates among the harmony parts.
  if (style !== 'choral' && style !== 'barbershop') {
    const hp = h.filter((_, v) => !slots[v].bass).map(mod12);
    for (let i = 0; i < hp.length; i++) for (let j = i + 1; j < hp.length; j++) if (hp[i] === hp[j]) cost += 1.2;
  }
  // Spacing between adjacent upper voices (including the melody).
  const upper = [...h.filter((_, v) => !slots[v].bass), ev.lead].sort((a, b) => b - a);
  for (let i = 0; i + 1 < upper.length; i++) if (upper[i] - upper[i + 1] > 12) cost += 1.5;
  if (style === 'jazz' && upper.length >= 3 && upper[0] - upper[upper.length - 1] > 14) cost += 1.2;
  return cost;
}

function transitionCost(ctx: Ctx, prevEv: Event, ev: Event, a: number[], b: number[], pre: number[] | null): number {
  const { style, slots } = ctx;
  let cost = 0;
  const scale = ev.prevContiguous ? 1 : 0.5;
  const melD = ev.lead - prevEv.lead;
  const chordChange = prevEv.chord !== ev.chord;
  for (let v = 0; v < a.length; v++) {
    const d = b[v] - a[v];
    const bass = !!slots[v].bass;
    cost += motionCost(d, bass) * scale;
    if (pre) {
      // A leap is recovered by step in the opposite direction, never followed by another leap the same way.
      const d0 = a[v] - pre[v];
      if (Math.abs(d0) >= 5 && d !== 0) {
        if (Math.sign(d) === Math.sign(d0) && Math.abs(d) >= 3) cost += bass ? 0.5 : 1.0;
        else if (Math.sign(d) !== Math.sign(d0) && Math.abs(d) <= 2) cost -= 0.25;
      }
    }
    // A bass that sits still under a new chord sounds stuck (pads may pedal).
    if (bass && chordChange && d === 0 && style !== 'pad') cost += 0.15;
    if (style === 'pad' && d === 0) cost -= 0.35;
    if ((slots[v].parallel || style === 'pop') && melD !== 0 && Math.sign(d) === Math.sign(melD) && Math.abs(Math.abs(d) - Math.abs(melD)) <= 1)
      cost -= 0.35;
    if (slots[v].bass && style === 'choral' && melD !== 0 && Math.sign(d) === -Math.sign(melD)) cost -= 0.2;
  }
  // Parallel perfect intervals between every pair (melody included).
  const pa = [...a, prevEv.lead];
  const pb = [...b, ev.lead];
  const par = style === 'choral' ? 4 : style === 'pop' ? 3 : style === 'barbershop' ? 1.5 : style === 'pad' ? 1 : style === 'jazz' ? 0.6 : 0.8;
  for (let i = 0; i < pa.length; i++) {
    for (let j = i + 1; j < pa.length; j++) {
      const di = pb[i] - pa[i];
      const dj = pb[j] - pa[j];
      if (di === 0 || dj === 0 || Math.sign(di) !== Math.sign(dj)) continue;
      const i1 = mod12(Math.abs(pa[i] - pa[j]));
      const i2 = mod12(Math.abs(pb[i] - pb[j]));
      if (i1 === i2 && (i1 === 7 || i1 === 0)) cost += i1 === 0 ? par * 1.3 : par;
    }
  }
  // Voice overlap: a part moving past where its neighbour just was.
  const order = slots.map((s, i) => ({ i, off: s.offset })).sort((x, y) => y.off - x.off);
  for (let k = 0; k + 1 < order.length; k++) {
    const u = order[k].i;
    const w = order[k + 1].i;
    if (b[w] > a[u] || b[u] < a[w]) cost += 0.6;
  }
  // Hidden (direct) 5ths/8ves between the outer voices when the melody leaps.
  if (style === 'choral' || style === 'barbershop') {
    const bv = slots.findIndex((s) => s.bass);
    if (bv >= 0) {
      const bd = b[bv] - a[bv];
      const iv = mod12(ev.lead - b[bv]);
      if (Math.abs(melD) > 2 && bd !== 0 && Math.sign(bd) === Math.sign(melD) && (iv === 0 || iv === 7)) cost += 0.8;
    }
  }
  // Tendency tones (classical-ish styles).
  if (style === 'choral' || style === 'barbershop' || style === 'jazz') {
    const prevPcs = chordPcs(prevEv.chord);
    const resolvesHome = ev.chord.root === ctx.key.tonic;
    for (let v = 0; v < a.length; v++) {
      const p = mod12(a[v]);
      const d = b[v] - a[v];
      if (prevEv.chord.fn === 'D' && resolvesHome && p === ctx.leadingTone && !slots[v].bass && d !== 1)
        cost += style === 'choral' ? 1.0 : 0.4;
      const seventh = prevPcs[3];
      if (seventh !== undefined && p === seventh && prevEv.chord !== ev.chord && !(d === -1 || d === -2))
        cost += style === 'choral' ? 1.0 : 0.3;
    }
  }
  return cost;
}

/**
 * Per voice: how many moves in a row it has copied the melody's motion at the same interval.
 * More than three in a row stops sounding like a harmony and starts sounding like a transposed copy.
 */
function parallelRuns(prevEv: Event, ev: Event, a: number[], b: number[], runs: number[]): number[] {
  const melD = ev.lead - prevEv.lead;
  return a.map((x, v) => {
    const d = b[v] - x;
    if (melD === 0 && d === 0) return runs[v]; // a repeated note neither extends nor breaks the run
    const same = melD !== 0 && Math.sign(d) === Math.sign(melD) && Math.abs(b[v] - ev.lead - (x - prevEv.lead)) <= 1;
    return same ? runs[v] + 1 : 0;
  });
}

type TopMode = 'own' | 'melody' | 'high';

/** Event ranges [first, last] of each phrase: up to a cadence or a rest of a beat or more. */
function phrasesOf(events: Event[]): [number, number][] {
  const out: [number, number][] = [];
  let a = 0;
  events.forEach((ev, i) => {
    const next = events[i + 1];
    if (!next || ev.cadence || next.start - (ev.start + ev.dur) >= UNITS_PER_BEAT) {
      out.push([a, i]);
      a = i + 1;
    }
  });
  return out;
}

/** The part the top voice may double: the next one down. */
const highOf = (ctx: Ctx, top: number) =>
  ctx.slots.reduce((best, s, v) => (v !== top && (best < 0 || s.offset > ctx.slots[best].offset) ? v : best), -1);

const topPitch = (mode: TopMode, ev: Event, combo: number[], top: number, high: number) =>
  mode === 'melody' ? ev.lead + 12 : mode === 'high' && high >= 0 ? combo[high] + 12 : combo[top];

/**
 * Pop's top part, phrase by phrase: its own line, the melody an octave up, or the high harmony
 * an octave up. Its own line is kept where it moves and fits the chord; where it would park on
 * one note while the melody moves, or sit off the chord, a doubling sounds better.
 */
function topModes(ctx: Ctx, voiced: { events: Event[]; path: number[][] }, top: number): TopMode[] {
  const high = highOf(ctx, top);
  const bias: Record<TopMode, number> = { own: 0, melody: 0.35, high: 0.45 };
  return phrasesOf(voiced.events).map(([a, b], p) => {
    let best: TopMode = 'own';
    let bestCost = Infinity;
    for (const mode of ['own', 'melody', 'high'] as TopMode[]) {
      if (mode === 'high' && high < 0) continue;
      let cost = ctx.seed ? 0.3 * hashNoise(ctx.seed, 500 + p, mode.length) * (b - a + 1) : 0;
      for (let i = a; i <= b; i++) {
        const ev = voiced.events[i];
        const combo = voiced.path[i];
        if (!combo) continue;
        const m = topPitch(mode, ev, combo, top, high);
        // stays the top part, within reach of the singer's voice
        if ((high >= 0 && m <= combo[high]) || m > 81) cost = Infinity;
        cost += bias[mode];
        if (mode === 'own' && ev.leadIsChordTone && !chordPcs(ev.chord).includes(mod12(m))) cost += 2;
        for (const o of [ev.lead, ...combo.filter((_, v) => v !== top)]) if ([1, 11].includes(mod12(Math.abs(m - o)))) cost += 3;
        if (i > a) {
          const prev = topPitch(mode, voiced.events[i - 1], voiced.path[i - 1] ?? combo, top, high);
          if (prev === m && voiced.events[i - 1].lead !== ev.lead) cost += 0.6;
        }
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = mode;
      }
    }
    return best;
  });
}

function clefFor(notes: { midi: number }[]): ClefKind {
  if (!notes.length) return 'treble';
  const sorted = notes.map((n) => n.midi).sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  if (med >= 59) return 'treble';
  if (med >= 50 && sorted[0] >= 45) return 'treble8';
  return 'bass';
}

export interface HarmonizeInput {
  melody: MelodyNote[];
  key: Key;
  timeSig: TimeSignature;
  bpm: number;
  totalUnits: number;
  /** Melody note indices that end a lyric line. */
  phraseHints?: number[];
  /** Chords the user picked, each pinned to its own span; the rest of the progression is left alone. */
  chordEdits?: Chord[];
  /** Pinned chords the rest of the progression was re-fitted around ("Re-fit the rest"). */
  refitLocks?: Chord[];
}

export function harmonize(input: HarmonizeInput, opts: HarmonyOptions): Arrangement {
  const { melody, key, timeSig } = input;
  const style = opts.style;
  const nVoices = Math.max(1, Math.min(opts.voices, STYLE_INFO[style].maxVoices));
  const base = melody.length
    ? detectChords(melody, {
        key,
        timeSig,
        harmonicRhythm: opts.harmonicRhythm,
        style,
        complexity: opts.complexity,
        totalUnits: input.totalUnits,
        seed: opts.chordSeed ?? opts.seed,
        phraseHints: input.phraseHints,
        locks: input.refitLocks,
      })
    : [];
  const edits = melody.length ? (input.chordEdits ?? []) : [];
  const chords = edits.length ? applyChordEdits(base, edits.map((e) => ({ ...e, edited: true }))) : base;
  const melPitches = melody.map((n) => n.midi).sort((a, b) => a - b);
  const melMed = melPitches.length ? melPitches[melPitches.length >> 1] : 60;
  const slots = slotsFor(style, nVoices, opts.placement, opts.seed);
  const ctx: Ctx = {
    style,
    key,
    slots,
    centres: slots.map((s, v) => {
      const shift = opts.seed ? Math.round((hashNoise(opts.seed, 999, v) - 0.5) * 4) : 0;
      return Math.max(38, Math.min(80, melMed + s.offset + shift));
    }),
    complexity: opts.complexity,
    seed: opts.seed,
    leadingTone: mod12(key.tonic + 11),
  };
  const cadences = findCadences(melody, timeSig, input.phraseHints);

  /**
   * Beam search over voicings. With `keep`, events away from the edited chords reuse the
   * voicing of `keep.base`: changing one chord re-voices only that chord and the notes either
   * side of it, so the rest of the arrangement stays exactly as it was.
   */
  const voiceLead = (progression: Chord[], keep?: { spans: Chord[]; base: { events: Event[]; path: number[][] } }) => {
    const events = melody.length ? buildEvents(melody, progression, style, timeSig) : [];
    if (events.length) {
      events[0].first = true;
      events[events.length - 1].final = true;
      for (const cad of cadences) {
        const ev = events.find((e) => e.start <= cad.unit && e.start + e.dur > cad.unit);
        if (ev) ev.cadence = true;
      }
    }
    const free = new Set<number>();
    if (keep)
      events.forEach((ev, i) => {
        if (keep.spans.some((c) => ev.start < c.start + c.dur && ev.start + ev.dur > c.start)) [i - 1, i, i + 1].forEach((j) => free.add(j));
      });
    const kept = (ev: Event, i: number): number[] | null => {
      if (!keep || free.has(i)) return null;
      const bi = keep.base.events.findIndex((b) => b.start <= ev.start && b.start + b.dur > ev.start);
      return keep.base.path[bi] ?? null;
    };

    interface State {
      combo: number[];
      cost: number;
      parent: State | null;
      runs: number[];
    }
    const BEAM = 40;
    let beam: State[] = [];
    const noiseAmp = opts.seed ? 0.35 : 0;
    events.forEach((ev, ei) => {
      const fixed = kept(ev, ei);
      const combos = (fixed ? [{ combo: fixed, penalty: 0 }] : enumerateCombos(ctx, ev)).map((c) => ({
        ...c,
        stat: staticCost(ctx, ev, c.combo) + c.penalty + (noiseAmp ? noiseAmp * hashNoise(opts.seed, ei, c.combo.reduce((s, m) => s * 131 + m, 7)) : 0),
        key: c.combo.join(','),
      }));
      const next = new Map<string, State>();
      if (ei === 0) {
        for (const c of combos) next.set(c.key, { combo: c.combo, cost: c.stat, parent: null, runs: c.combo.map(() => 0) });
      } else {
        const prevEv = events[ei - 1];
        for (const s of beam) {
          const sKey = s.combo.join(',');
          for (const c of combos) {
            const runs = parallelRuns(prevEv, ev, s.combo, c.combo, s.runs);
            let total = s.cost + c.stat + transitionCost(ctx, prevEv, ev, s.combo, c.combo, s.parent?.combo ?? null);
            if (style !== 'pad') for (const r of runs) if (r > 3) total += 0.8 * (r - 3);
            if (ev.holdable && c.key === sKey) total -= 1.0;
            const ex = next.get(c.key);
            if (!ex || total < ex.cost) next.set(c.key, { combo: c.combo, cost: total, parent: s, runs });
          }
        }
      }
      beam = [...next.values()].sort((a, b) => a.cost - b.cost).slice(0, BEAM);
    });
    const path: number[][] = new Array(events.length);
    let st: State | null = beam[0] ?? null;
    for (let i = events.length - 1; i >= 0 && st; i--) {
      path[i] = st.combo;
      st = st.parent;
    }
    return { events, path };
  };
  const auto = edits.length ? voiceLead(base) : null;
  const { events, path } = auto ? voiceLead(chords, { spans: edits, base: auto }) : voiceLead(chords);
  const top = slots.findIndex((s) => s.doubles);
  if (top >= 0) {
    // the choice is made on the automatic progression, so a chord edit doesn't flip whole phrases
    const modes = topModes(ctx, auto ?? { events, path }, top);
    phrasesOf(events).forEach(([a, b], p) => {
      for (let i = a; i <= b; i++) {
        if (!path[i]) continue;
        path[i] = path[i].slice();
        path[i][top] = topPitch(modes[p] ?? 'own', events[i], path[i], top, highOf(ctx, top));
      }
    });
  }

  // Build voice parts.
  const vowels: Vowel[] = style === 'pad' ? ['oo', 'oo', 'oo', 'oo'] : style === 'jazz' ? ['oo', 'oo', 'oo', 'oo'] : ['ah', 'ah', 'ah', 'ah'];
  const partNotes: ScoreNote[][] = slots.map(() => []);
  events.forEach((ev, ei) => {
    const combo = path[ei];
    if (!combo) return;
    combo.forEach((m, v) => {
      const notes = partNotes[v];
      const prev = notes[notes.length - 1];
      const contiguous = prev && prev.start + prev.dur === ev.start;
      const hold = contiguous && prev.midi === m && (style === 'pad' || (ev.holdable && path[ei - 1]?.join(',') === combo.join(',')));
      if (hold) {
        prev.dur = ev.start + ev.dur - prev.start;
      } else {
        notes.push({ midi: m, start: ev.start, dur: ev.dur });
      }
    });
  });
  const harmonies: VoicePart[] = slots.map((s, v) => ({
    id: `h${v + 1}`,
    name: s.name,
    short: s.short,
    clef: clefFor(partNotes[v]),
    notes: partNotes[v],
    color: VOICE_COLORS[v % VOICE_COLORS.length],
    vowel: vowels[v],
    sound: vowels[v],
  }));
  // Order parts from highest to lowest for the score.
  harmonies.sort((a, b) => avg(b.notes) - avg(a.notes));

  const melodyPart: VoicePart = {
    id: 'melody',
    name: 'Melody',
    short: 'Mel',
    clef: clefFor(melody),
    notes: melody.map((n) => ({
      midi: n.midi,
      start: n.start,
      dur: n.dur,
      ...(n.lyric ? { lyric: n.lyric } : {}),
      ...(n.melisma ? { melisma: true } : {}),
      ...(n.edited ? { edited: true } : {}),
    })),
    color: MELODY_COLOR,
    vowel: 'ah',
    sound: 'lyrics',
  };

  return {
    melody: melodyPart,
    harmonies,
    chords,
    key,
    timeSig,
    bpm: input.bpm,
    totalUnits: input.totalUnits,
    live: liveSteps(melody, harmonies, style),
    options: { ...opts, voices: nVoices },
  };
}

/** For each melody note: the harmony pitches sounding when it begins, and which voices re-attack. */
export function liveSteps(melody: ScoreNote[], harmonies: VoicePart[], style: HarmonyStyle): LiveStep[] {
  return melody.map((n, i) => {
    const prevStart = i > 0 ? melody[i - 1].start : -Infinity;
    const pitches: (number | null)[] = [];
    const retrigger: boolean[] = [];
    for (const h of harmonies) {
      const hn = h.notes.find((x) => x.start <= n.start && x.start + x.dur > n.start);
      pitches.push(hn ? hn.midi : null);
      retrigger.push(hn ? hn.start > prevStart && (hn.start === n.start || style === 'pad') : false);
    }
    return { pitches, retrigger };
  });
}

function avg(notes: ScoreNote[]) {
  return notes.length ? notes.reduce((s, n) => s + n.midi, 0) / notes.length : 0;
}
