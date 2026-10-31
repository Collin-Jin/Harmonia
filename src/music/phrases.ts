import { UNITS_PER_BEAT, type ScoreNote, type TimeSignature } from './types';

export interface Cadence {
  noteIndex: number; // melody note that closes the phrase
  unit: number; // where the cadence chord should arrive
  final: boolean;
}

/**
 * Locate phrase endings. Sung melodies overwhelmingly fall into 2- or 4-bar
 * phrases closed by a longer note or a breath (rest), and lyrics end lines at
 * the same places; `hints` are note indices that end a lyric line.
 */
export function findCadences(melody: ScoreNote[], ts: TimeSignature, hints: number[] = []): Cadence[] {
  const n = melody.length;
  if (!n) return [];
  const bar = ts.beats * UNITS_PER_BEAT;
  const ends = new Set<number>([n - 1]);
  hints.forEach((h) => h >= 0 && h < n - 1 && ends.add(h));
  // Breaths: a rest of at least a beat after a note.
  for (let i = 0; i < n - 1; i++) if (melody[i + 1].start - (melody[i].start + melody[i].dur) >= UNITS_PER_BEAT) ends.add(i);
  // Regular phrase grid measured from the first full bar.
  const firstBar = Math.ceil(melody[0].start / bar);
  const lastBar = Math.floor((melody[n - 1].start + melody[n - 1].dur - 1) / bar);
  const bars = lastBar - firstBar + 1;
  const P = bars >= 8 ? 4 : 2;
  for (let b = firstBar + P - 1; b < lastBar; b += P) {
    const a = b * bar;
    const e = a + bar;
    // the cadence note: the longest note starting in that bar (later wins ties), else the one sounding through it
    let best = -1;
    for (let i = 0; i < n; i++) {
      const nt = melody[i];
      if (nt.start >= a && nt.start < e && (best < 0 || nt.dur >= melody[best].dur)) best = i;
    }
    if (best < 0) for (let i = 0; i < n; i++) if (melody[i].start < a) best = i;
    if (best >= 0 && !nearExisting(best)) ends.add(best);
  }
  function nearExisting(i: number) {
    for (const e of ends) if (Math.abs(melody[e].start - melody[i].start) < bar && e !== i) return true;
    return false;
  }
  return [...ends]
    .sort((a, b) => a - b)
    .map((i) => ({ noteIndex: i, unit: melody[i].start, final: i === n - 1 }));
}
