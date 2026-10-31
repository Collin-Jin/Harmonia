import type { Key } from '../../../src/music/theory';
import type { MelodyNote, TimeSignature } from '../../../src/music/types';
import { AMAZING_GRACE, ODE_TO_JOY, type SampleMelody } from '../../../src/music/samples';

export interface Tune {
  id: string;
  key: Key;
  ts: TimeSignature;
  pickupBeats: number;
  notes: [number, number][]; // [midi, beats], midi 0 = rest
}

const T = (id: string, tonic: number, mode: Key['mode'], beats: number, pickupBeats: number, notes: [number, number][]): Tune => ({
  id,
  key: { tonic, mode },
  ts: { beats, beatType: 4 },
  pickupBeats,
  notes,
});

const fromSample = (s: SampleMelody, tonic: number, pickup: number) => T(s.id, tonic, 'major', s.beatsPerBar, pickup, s.notes);

export const CORPUS: Tune[] = [
  fromSample(ODE_TO_JOY, 0, 0),
  fromSample(AMAZING_GRACE, 7, 1),
  T('twinkle', 0, 'major', 4, 0, [
    [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
    [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
    [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
    [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
    [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
    [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
  ]),
  T('happy-birthday', 0, 'major', 3, 1, [
    [67, 0.75], [67, 0.25],
    [69, 1], [67, 1], [72, 1], [71, 2], [67, 0.75], [67, 0.25],
    [69, 1], [67, 1], [74, 1], [72, 2], [67, 0.75], [67, 0.25],
    [79, 1], [76, 1], [72, 1], [71, 1], [69, 1], [77, 0.75], [77, 0.25],
    [76, 1], [72, 1], [74, 1], [72, 3],
  ]),
  T('greensleeves', 9, 'minor', 3, 1, [
    [69, 1],
    [72, 2], [74, 1], [76, 1.5], [77, 0.5], [76, 1], [74, 2], [71, 1], [67, 1.5], [69, 0.5], [71, 1],
    [72, 2], [69, 1], [69, 1.5], [68, 0.5], [69, 1], [71, 2], [68, 1], [64, 2], [69, 1],
    [72, 2], [74, 1], [76, 1.5], [77, 0.5], [76, 1], [74, 2], [71, 1], [67, 1.5], [69, 0.5], [71, 1],
    [72, 1.5], [71, 0.5], [69, 1], [68, 1.5], [66, 0.5], [68, 1], [69, 3],
  ]),
  T('auld-lang-syne', 5, 'major', 4, 1, [
    [60, 1],
    [65, 1.5], [65, 0.5], [65, 1], [69, 1], [67, 1.5], [65, 0.5], [67, 1], [69, 0.5], [67, 0.5],
    [65, 1.5], [65, 0.5], [69, 1], [72, 1], [74, 3], [74, 1],
    [72, 1.5], [69, 0.5], [69, 1], [65, 1], [67, 1.5], [65, 0.5], [67, 1], [69, 0.5], [67, 0.5],
    [65, 1.5], [62, 0.5], [62, 1], [60, 1], [65, 3],
  ]),
  T('silent-night', 0, 'major', 3, 0, [
    [67, 1.5], [69, 0.5], [67, 1], [64, 3], [67, 1.5], [69, 0.5], [67, 1], [64, 3],
    [74, 2], [74, 1], [71, 3], [72, 2], [72, 1], [67, 3],
    [69, 2], [69, 1], [72, 1.5], [71, 0.5], [69, 1], [67, 1.5], [69, 0.5], [67, 1], [64, 3],
    [69, 2], [69, 1], [72, 1.5], [71, 0.5], [69, 1], [67, 1.5], [69, 0.5], [67, 1], [64, 3],
    [74, 2], [74, 1], [77, 1.5], [74, 0.5], [71, 1], [72, 3], [76, 3],
    [72, 1.5], [67, 0.5], [64, 1], [67, 1.5], [65, 0.5], [62, 1], [60, 3],
  ]),
];

export function tuneMelody(t: Tune): { notes: MelodyNote[]; totalUnits: number } {
  let pos = t.pickupBeats ? (t.ts.beats - t.pickupBeats) * 4 : 0;
  const notes: MelodyNote[] = [];
  for (const [m, b] of t.notes) {
    const dur = Math.round(b * 4);
    if (m) notes.push({ midi: m, start: pos, dur, time: 0, end: 0, cents: 0 });
    pos += dur;
  }
  const bar = t.ts.beats * 4;
  return { notes, totalUnits: Math.ceil(pos / bar) * bar };
}
