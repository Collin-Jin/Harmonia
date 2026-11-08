import { describe, expect, it } from 'vitest';
import { harmonize } from '../../src/music/harmony';
import { applyChordEdits, chordAt, chordPcs, suggestChords } from '../../src/music/chords';
import { mod12 } from '../../src/music/theory';
import type { Arrangement, Chord, HarmonyOptions } from '../../src/music/types';
import { CORPUS, tuneMelody } from './helpers/corpus';

const ode = CORPUS.find((t) => t.id === 'ode-to-joy')!;
const m = tuneMelody(ode);
const input = { melody: m.notes, key: ode.key, timeSig: ode.ts, bpm: 100, totalUnits: m.totalUnits };
const base: HarmonyOptions = { style: 'pop', voices: 2, placement: 'around', harmonicRhythm: 'auto', complexity: 0.35, seed: 0 };
const detectOpts = (o: HarmonyOptions) => ({ key: ode.key, timeSig: ode.ts, harmonicRhythm: o.harmonicRhythm, style: o.style, complexity: o.complexity, totalUnits: m.totalUnits });

/** The chord the user picks for a span, as the panel builds it from a suggestion. */
function pick(arr: Arrangement, start: number, symbol: string): Chord {
  const span = arr.chords.find((c) => c.start === start)!;
  const i = arr.chords.indexOf(span);
  const s = suggestChords(arr.melody.notes, detectOpts(arr.options), span, arr.chords[i - 1], arr.chords[i + 1]).find((x) => x.chord.symbol === symbol);
  expect(s, `${symbol} offered at ${start}`).toBeDefined();
  return s!.chord;
}

const pitchAt = (arr: Arrangement, part: number, u: number) => arr.harmonies[part].notes.find((n) => n.start <= u && n.start + n.dur > u)?.midi;

describe('editable chords', () => {
  const before = harmonize(input, base);
  // bar 4 (units 48–56) is Am under "E. D" in the automatic progression; an arranger might prefer C
  const am = before.chords.find((c) => c.start === 48)!;

  it('the automatic progression has the chord we are about to change', () => {
    expect(am.symbol).toBe('Am');
  });

  it('changes only the chosen chord; every other chord stays exactly as it was', () => {
    const after = harmonize({ ...input, chordEdits: [pick(before, 48, 'C')] }, base);
    const edited = after.chords.filter((c) => c.edited);
    expect(edited).toHaveLength(1);
    expect(edited[0]).toMatchObject({ symbol: 'C', start: 48, dur: am.dur });
    const rest = (a: Arrangement) => a.chords.filter((c) => c.start !== 48).map((c) => `${c.symbol}@${c.start}+${c.dur}`);
    expect(rest(after)).toEqual(rest(before));
  });

  it('re-voices only the edited chord and the notes either side of it', () => {
    const after = harmonize({ ...input, chordEdits: [pick(before, 48, 'C')] }, base);
    const notes = m.notes;
    const first = notes.findIndex((n) => n.start >= 48);
    const last = notes.findIndex((n) => n.start >= 48 + am.dur) - 1;
    notes.forEach((n, i) => {
      if (i >= first - 1 && i <= last + 1) return;
      for (let v = 0; v < before.harmonies.length; v++) expect(pitchAt(after, v, n.start), `voice ${v} at ${n.start}`).toBe(pitchAt(before, v, n.start));
    });
    // and the harmony now sings the new chord where the melody is on it
    for (let i = first; i <= last; i++) {
      const pcs = chordPcs(chordAt(after.chords, notes[i].start));
      if (!pcs.includes(mod12(notes[i].midi))) continue;
      for (let v = 0; v < after.harmonies.length; v++) expect(pcs).toContain(mod12(pitchAt(after, v, notes[i].start)!));
    }
  });

  it('keeps an edit pinned to its span when the chord-change rate changes', () => {
    const edit = pick(before, 48, 'C');
    for (const harmonicRhythm of ['bar', 'half', 'beat'] as const) {
      const arr = harmonize({ ...input, chordEdits: [edit] }, { ...base, harmonicRhythm });
      const e = arr.chords.filter((c) => c.edited);
      expect(e, harmonicRhythm).toHaveLength(1);
      expect(e[0]).toMatchObject({ symbol: 'C', start: 48, dur: am.dur });
      // the progression still covers the song without gaps or overlaps
      for (let i = 1; i < arr.chords.length; i++) expect(arr.chords[i].start).toBe(arr.chords[i - 1].start + arr.chords[i - 1].dur);
    }
  });

  it('re-fitting keeps the edits and lets the other chords move to suit them', () => {
    const edit = pick(before, 48, 'C');
    const arr = harmonize({ ...input, chordEdits: [edit], refitLocks: [edit] }, base);
    const e = arr.chords.filter((c) => c.edited);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ symbol: 'C', start: 48 });
    expect(arr.chords[0].start).toBe(0);
    for (let i = 1; i < arr.chords.length; i++) expect(arr.chords[i].start).toBe(arr.chords[i - 1].start + arr.chords[i - 1].dur);
  });

  it('suggests chords that fit the melody first', () => {
    const c0 = before.chords[0]; // bar 1: E E F G
    const s = suggestChords(before.melody.notes, detectOpts(base), c0, undefined, before.chords[1]);
    expect(s[0].chord.symbol).toBe('C');
    expect(s.length).toBeGreaterThan(10);
    for (let i = 1; i < s.length; i++) expect(s[i].score).toBeLessThanOrEqual(s[i - 1].score);
    // a chord that clashes with the melody is ranked well below
    const fsharp = s.findIndex((x) => x.chord.symbol === 'B°' || x.chord.root === 11);
    expect(fsharp).toBeGreaterThan(3);
  });

  it('applyChordEdits trims overlapped chords and leaves no gaps', () => {
    const chords: Chord[] = [
      { root: 0, quality: 'maj', start: 0, dur: 16, symbol: 'C', roman: 'I', fn: 'T' },
      { root: 7, quality: 'maj', start: 16, dur: 16, symbol: 'G', roman: 'V', fn: 'D' },
    ];
    const out = applyChordEdits(chords, [{ root: 5, quality: 'maj', start: 8, dur: 16, symbol: 'F', roman: 'IV', fn: 'S' }]);
    expect(out.map((c) => `${c.symbol}@${c.start}+${c.dur}`)).toEqual(['C@0+8', 'F@8+16', 'G@24+8']);
  });
});
