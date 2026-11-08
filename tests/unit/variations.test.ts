import { describe, expect, it } from 'vitest';
import { harmonize } from '../../src/music/harmony';
import type { Arrangement, HarmonyOptions } from '../../src/music/types';
import { CORPUS, tuneMelody } from './helpers/corpus';

const tune = (id: string) => {
  const t = CORPUS.find((x) => x.id === id)!;
  const m = tuneMelody(t);
  return { melody: m.notes, key: t.key, timeSig: t.ts, bpm: 100, totalUnits: m.totalUnits };
};
const ode = tune('ode-to-joy');
const base: HarmonyOptions = { style: 'pop', voices: 2, placement: 'around', harmonicRhythm: 'auto', complexity: 0.35, seed: 0 };

describe('separate chord and voicing variations', () => {
  const chords = (a: Arrangement) => a.chords.map((c) => `${c.symbol}@${c.start}`).join(' ');
  const voices = (a: Arrangement) => JSON.stringify(a.harmonies.map((h) => h.notes.map((n) => n.midi)));
  const first = harmonize(ode, { ...base, chordSeed: 0 });

  it('New voicing keeps the chords', () => {
    const vs = [11, 222, 3333, 4242, 55555].map((seed) => harmonize(ode, { ...base, chordSeed: 0, seed }));
    for (const v of vs) expect(chords(v)).toBe(chords(first));
    // not every seed changes the voicing (the store keeps trying until one does), but most do
    expect(vs.filter((v) => voices(v) !== voices(first)).length).toBeGreaterThanOrEqual(3);
  });

  it('New chords keeps the voicing settings and changes the progression', () => {
    const seeds = [11, 222, 3333, 44444];
    const changed = seeds.filter((s) => chords(harmonize(ode, { ...base, chordSeed: s })) !== chords(first));
    expect(changed.length).toBeGreaterThan(0);
  });

  it('without a chord seed, one seed still varies both (older saved settings)', () => {
    expect(chords(harmonize(ode, { ...base, seed: 3333 }))).toBe(chords(harmonize(ode, { ...base, seed: 3333, chordSeed: 3333 })));
  });
});
