import { describe, expect, it } from 'vitest';
import { harmonize } from '../../src/music/harmony';
import { chordAt, chordPcs } from '../../src/music/chords';
import { mod12 } from '../../src/music/theory';
import type { Arrangement, HarmonyOptions, MelodyNote } from '../../src/music/types';
import { CORPUS, tuneMelody } from './helpers/corpus';

const pop3: HarmonyOptions = { style: 'pop', voices: 3, placement: 'around', harmonicRhythm: 'auto', complexity: 0.35, seed: 0 };
const at = (arr: Arrangement, name: string, u: number) => arr.harmonies.find((h) => h.name === name)!.notes.find((n) => n.start <= u && n.start + n.dur > u)?.midi;

describe('a note sung just before the chord changes', () => {
  // Ode to Joy with every note on a bar line pushed a 16th early, the way singers anticipate
  const ode = CORPUS.find((t) => t.id === 'ode-to-joy')!;
  const m = tuneMelody(ode);
  const bar = ode.ts.beats * 4;
  const pushed: MelodyNote[] = m.notes.map((n, i) => {
    const next = m.notes[i + 1];
    if (next && next.start % bar === 0 && n.dur > 1) return { ...n, dur: n.dur - 1 };
    if (n.start % bar === 0 && i > 0) return { ...n, start: n.start - 1, dur: n.dur + 1 };
    return n;
  });

  it('is harmonized with the chord it mostly sounds under', () => {
    const input = { melody: pushed, key: ode.key, timeSig: ode.ts, bpm: 100, totalUnits: m.totalUnits };
    const arr = harmonize(input, { ...pop3, voices: 2 });
    let checked = 0;
    for (const n of pushed) {
      const c = chordAt(arr.chords, n.start + 1);
      if (c.start !== n.start + 1 || !chordPcs(c).includes(mod12(n.midi))) continue;
      for (const h of arr.harmonies) expect(chordPcs(c), `${h.name} at ${n.start}`).toContain(mod12(at(arr, h.name, n.start)!));
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });
});

describe('the top part in a pop stack', () => {
  it('may double the melody an octave up for a phrase', () => {
    const ode = CORPUS.find((t) => t.id === 'ode-to-joy')!;
    const m = tuneMelody(ode);
    const arr = harmonize({ melody: m.notes, key: ode.key, timeSig: ode.ts, bpm: 100, totalUnits: m.totalUnits }, pop3);
    // the opening phrase: the tune, an octave up
    for (const n of m.notes.filter((n) => n.start < 32)) expect(at(arr, 'Top Harmony', n.start)).toBe(n.midi + 12);
  });

  it('stays above the high harmony and never rubs a semitone against the melody', () => {
    for (const t of CORPUS) {
      const m = tuneMelody(t);
      for (const seed of [0, 3, 7]) {
        const arr = harmonize({ melody: m.notes, key: t.key, timeSig: t.ts, bpm: 100, totalUnits: m.totalUnits }, { ...pop3, seed });
        for (const n of m.notes) {
          const top = at(arr, 'Top Harmony', n.start)!;
          expect(top, `${t.id}/${seed} at ${n.start}`).toBeGreaterThan(at(arr, 'High Harmony', n.start)!);
          expect([1, 11], `${t.id}/${seed} at ${n.start}`).not.toContain(mod12(top - n.midi));
        }
      }
    }
  });
});
