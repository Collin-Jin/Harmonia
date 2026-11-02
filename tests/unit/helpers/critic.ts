import { chordAt, chordPcs } from '../../../src/music/chords';
import { mod12 } from '../../../src/music/theory';
import type { Arrangement, ScoreNote } from '../../../src/music/types';

/** Textbook part-writing and progression statistics for an arrangement. */
export interface Critique {
  parallels: number; // consecutive perfect 5ths/8ves between any two parts
  hiddenOuter: number; // direct 5ths/8ves between melody and bass with a melodic leap
  crossings: number; // a harmony voice crossing the melody or a neighbouring voice
  bigLeaps: number; // leaps > a 6th inside one harmony line
  tritoneLeaps: number;
  unrecoveredLeaps: number; // leap ≥ 5 st followed by another leap in the same direction
  clashes: number; // m2/M7/m9 between a harmony voice and a chord-tone melody note
  missingThird: number; // ≥2 harmony voices but no chord 3rd on a downbeat
  pingPong: number; // A B A B chord alternation
  distinctChords: number;
  bassStepOrFifth: number; // fraction of bass moves that are steps or 4ths/5ths
  stepwise: number; // fraction of upper-voice moves that are 0–2 semitones
  finalCadence: boolean; // ends V(7) → I with the tonic in the bass (when there is a bass)
}

function pitchAt(notes: ScoreNote[], u: number): number | null {
  for (const n of notes) if (n.start <= u && n.start + n.dur > u) return n.midi;
  return null;
}

export function critique(arr: Arrangement): Critique {
  const mel = arr.melody.notes;
  const parts = arr.harmonies;
  const times = Array.from(new Set([...mel, ...parts.flatMap((p) => p.notes)].map((n) => n.start))).sort((a, b) => a - b);
  const bassIdx = parts.findIndex((p) => p.name.includes('Bass') || p.name.includes('Root'));
  const c: Critique = {
    parallels: 0,
    hiddenOuter: 0,
    crossings: 0,
    bigLeaps: 0,
    tritoneLeaps: 0,
    unrecoveredLeaps: 0,
    clashes: 0,
    missingThird: 0,
    pingPong: 0,
    distinctChords: new Set(arr.chords.map((x) => x.symbol)).size,
    bassStepOrFifth: 1,
    stepwise: 0,
    finalCadence: false,
  };
  const voicesAt = (u: number) => [pitchAt(mel, u), ...parts.map((p) => pitchAt(p.notes, u))];
  let prev: (number | null)[] | null = null;
  for (const u of times) {
    const cur = voicesAt(u);
    const chord = chordAt(arr.chords, u);
    const pcs = chordPcs(chord);
    const m = cur[0];
    if (m !== null && pcs.includes(mod12(m)))
      for (const h of cur.slice(1)) if (h !== null && [1, 11, 13].includes(Math.abs(m - h))) c.clashes++;
    if (parts.length >= 2 && u % (arr.timeSig.beats * 4) === 0 && chord.start === u) {
      const all = cur.filter((x): x is number => x !== null).map(mod12);
      if (!all.includes(pcs[1])) c.missingThird++;
    }
    // crossings: sorted order of the parts by their average pitch must hold
    const order = [0, ...parts.map((_, i) => i + 1)].sort((a, b) => avg(b) - avg(a));
    for (let k = 0; k + 1 < order.length; k++) {
      const a = cur[order[k]];
      const b = cur[order[k + 1]];
      if (a !== null && b !== null && a < b) c.crossings++;
    }
    if (prev) {
      for (let i = 0; i < cur.length; i++)
        for (let j = i + 1; j < cur.length; j++) {
          const a0 = prev[i], a1 = cur[i], b0 = prev[j], b1 = cur[j];
          if (a0 === null || a1 === null || b0 === null || b1 === null) continue;
          const da = a1 - a0;
          const db = b1 - b0;
          if (!da || !db || Math.sign(da) !== Math.sign(db)) continue;
          const i1 = mod12(Math.abs(a0 - b0)); // a 4th above is not a 5th below
          const i2 = mod12(Math.abs(a1 - b1));
          if (i1 === i2 && (i1 === 0 || i1 === 7)) c.parallels++;
          else if (bassIdx >= 0 && i === 0 && j === bassIdx + 1 && (i2 === 0 || i2 === 7) && Math.abs(da) > 2) c.hiddenOuter++;
        }
    }
    prev = cur;
  }
  function avg(i: number) {
    const ns = i === 0 ? mel : parts[i - 1].notes;
    return ns.reduce((s, n) => s + n.midi, 0) / Math.max(1, ns.length);
  }
  let moves = 0;
  let steps = 0;
  parts.forEach((p, pi) => {
    const isBass = pi === bassIdx;
    let bassMoves = 0;
    let bassGood = 0;
    for (let i = 1; i < p.notes.length; i++) {
      const d = p.notes[i].midi - p.notes[i - 1].midi;
      const a = Math.abs(d);
      if (isBass) {
        if (a) {
          bassMoves++;
          if (a <= 2 || a === 5 || a === 7 || a === 12) bassGood++;
        }
        continue;
      }
      moves++;
      if (a <= 2) steps++;
      if (a > 9) c.bigLeaps++;
      if (a === 6) c.tritoneLeaps++;
      if (i >= 2) {
        const d0 = p.notes[i - 1].midi - p.notes[i - 2].midi;
        if (Math.abs(d0) >= 5 && Math.abs(d) >= 3 && Math.sign(d0) === Math.sign(d)) c.unrecoveredLeaps++;
      }
    }
    if (isBass) c.bassStepOrFifth = bassMoves ? bassGood / bassMoves : 1;
  });
  c.stepwise = moves ? steps / moves : 1;
  const ch = arr.chords;
  for (let i = 3; i < ch.length; i++) if (ch[i].symbol === ch[i - 2].symbol && ch[i - 1].symbol === ch[i - 3].symbol && ch[i].symbol !== ch[i - 1].symbol) c.pingPong++;
  const last = ch[ch.length - 1];
  const pen = ch[ch.length - 2];
  const tonic = arr.key.tonic;
  const bassOk = bassIdx < 0 || mod12(parts[bassIdx].notes[parts[bassIdx].notes.length - 1].midi) === tonic;
  c.finalCadence = !!pen && last.root === tonic && mod12(pen.root - tonic) === 7 && bassOk;
  return c;
}
