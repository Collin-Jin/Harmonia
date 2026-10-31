import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { Midi } from '@tonejs/midi';
import { harmonize, STYLE_INFO } from '../../src/music/harmony';
import { chordPcs, detectChords } from '../../src/music/chords';
import { toMusicXML } from '../../src/music/musicxml';
import { toMidi } from '../../src/music/midi';
import { detectKey } from '../../src/music/key';
import { diatonicStep, mod12, spell } from '../../src/music/theory';
import { AMAZING_GRACE, ODE_TO_JOY, type SampleMelody } from '../../src/music/samples';
import type { Chord, HarmonyOptions, HarmonyStyle, MelodyNote } from '../../src/music/types';
import { CORPUS, tuneMelody } from './helpers/corpus';
import { critique } from './helpers/critic';

function melodyOf(s: SampleMelody): { notes: MelodyNote[]; totalUnits: number; pickup: number } {
  const pickup = s.id === 'amazing-grace' ? 8 : 0;
  let pos = pickup;
  const notes: MelodyNote[] = [];
  for (const [m, b] of s.notes) {
    const dur = Math.round(b * 4);
    if (m) notes.push({ midi: m, start: pos, dur, time: 0, end: 0, cents: 0 });
    pos += dur;
  }
  const bar = s.beatsPerBar * 4;
  return { notes, totalUnits: Math.ceil(pos / bar) * bar, pickup };
}

const ode = melodyOf(ODE_TO_JOY);
const C = { tonic: 0, mode: 'major' as const };
const base: HarmonyOptions = { style: 'pop', voices: 2, placement: 'around', harmonicRhythm: 'auto', complexity: 0.3, seed: 0 };
const input = { melody: ode.notes, key: C, timeSig: { beats: 4, beatType: 4 }, bpm: 100, totalUnits: ode.totalUnits };

describe('theory', () => {
  it('spells notes according to key', () => {
    expect(spell(66, { tonic: 7, mode: 'major' })).toMatchObject({ step: 'F', alter: 1 });
    expect(spell(70, { tonic: 5, mode: 'major' })).toMatchObject({ step: 'B', alter: -1 });
    expect(spell(71, { tonic: 0, mode: 'minor' })).toMatchObject({ step: 'B', alter: 0 }); // leading tone in C minor
    expect(spell(68, { tonic: 9, mode: 'minor' })).toMatchObject({ step: 'G', alter: 1 });
    expect(spell(61, { tonic: 2, mode: 'major' })).toMatchObject({ step: 'C', alter: 1, octave: 4 });
  });

  it('detects minor keys', () => {
    // A natural/harmonic minor phrase ending on A
    const mel = [69, 71, 72, 74, 76, 74, 72, 71, 68, 69].map((m) => ({ midi: m, dur: 4 }));
    expect(detectKey(mel)[0]).toMatchObject({ tonic: 9, mode: 'minor' });
  });
});

describe('chord detection', () => {
  it('finds a sensible progression for Ode to Joy with a cadence', () => {
    const chords = detectChords(ode.notes, { key: C, timeSig: { beats: 4, beatType: 4 }, harmonicRhythm: 'auto', style: 'pop', complexity: 0.2, totalUnits: ode.totalUnits });
    expect(chords[0].root).toBe(0);
    const last = chords[chords.length - 1];
    expect(last.root).toBe(0);
    const penult = chords[chords.length - 2];
    expect([7, 11]).toContain(penult.root); // dominant before the final tonic
    // every downbeat melody note should be a chord tone
    for (const n of ode.notes.filter((x) => x.start % 16 === 0)) {
      const c = [...chords].reverse().find((ch) => ch.start <= n.start)!;
      expect(chordPcs(c)).toContain(mod12(n.midi));
    }
  });
});

function intervalsOk(arr: ReturnType<typeof harmonize>) {
  // Harmony voices never clash a minor second / major seventh against a chord-tone melody note.
  let clashes = 0;
  arr.melody.notes.forEach((n, i) => {
    arr.live[i].pitches.forEach((p) => {
      if (p === null) return;
      const iv = Math.abs(p - n.midi) % 12;
      if (iv === 1 || iv === 11) clashes++;
    });
  });
  return clashes;
}

describe('harmony generation', () => {
  const styles: HarmonyStyle[] = ['pop', 'choral', 'jazz', 'barbershop', 'pad'];
  for (const style of styles) {
    for (const voices of [1, 2, 3, 4]) {
      it(`${style} with ${voices} voice(s) produces complete, consonant parts`, () => {
        const arr = harmonize(input, { ...base, style, voices });
        const expectedVoices = Math.min(voices, STYLE_INFO[style].maxVoices);
        expect(arr.harmonies).toHaveLength(expectedVoices);
        for (const h of arr.harmonies) {
          expect(h.notes.length).toBeGreaterThan(style === 'pad' ? 1 : 20);
          for (const n of h.notes) {
            expect(n.midi).toBeGreaterThanOrEqual(33);
            expect(n.midi).toBeLessThanOrEqual(86);
            expect(n.dur).toBeGreaterThan(0);
          }
          // no overlapping notes in a part
          for (let i = 1; i < h.notes.length; i++) expect(h.notes[i].start).toBeGreaterThanOrEqual(h.notes[i - 1].start + h.notes[i - 1].dur);
        }
        expect(intervalsOk(arr)).toBeLessThanOrEqual(style === 'jazz' ? 4 : 2);
        expect(arr.live).toHaveLength(ode.notes.length);
      });
    }
  }

  it('pop harmonies move as steady parallel lines (3rd above / 3rd below by default)', () => {
    for (const seed of [0, 1]) {
      const arr = harmonize(input, { ...base, seed });
      const [hi, lo] = arr.harmonies;
      const shape = (part: number, steps: number) =>
        arr.melody.notes.filter((n, i) => arr.live[i].pitches[part] === diatonicStep(n.midi, steps, C)).length / arr.melody.notes.length;
      expect(hi.name).toBe('High Harmony');
      expect(shape(0, 2)).toBeGreaterThan(0.9);
      expect(shape(1, seed === 0 ? -2 : -3)).toBeGreaterThan(0.85);
      expect(lo.notes.length).toBeGreaterThan(20);
    }
  });

  it('auto harmonic rhythm changes chords on bar lines for a simple diatonic tune', () => {
    const chords = detectChords(ode.notes, { key: C, timeSig: { beats: 4, beatType: 4 }, harmonicRhythm: 'auto', style: 'pop', complexity: 0.3, totalUnits: ode.totalUnits });
    const sym = chords.map((c) => c.symbol);
    // every chord is diatonic, the phrase in bar 4 ends on a half cadence and the tune on ii–V–I
    for (const s of sym) expect(['C', 'Dm', 'Em', 'F', 'G', 'Am']).toContain(s);
    expect(chords.find((c) => c.start <= 56 && c.start + c.dur > 56)!.symbol).toBe('G');
    expect(sym.slice(-3)).toEqual(['Dm', 'G', 'C']);
    // chords change mid-bar only where the harmonic rhythm speeds up into a cadence (bars 4, 7, 8)
    const midBar = chords.filter((c) => c.start % 16 !== 0).map((c) => Math.floor(c.start / 16) + 1);
    for (const b of midBar) expect([4, 7, 8]).toContain(b);
  });

  it('harmonizes well-known tunes the way an arranger would', () => {
    const chordsOf = (id: string, style: HarmonyStyle = 'choral') => {
      const t = CORPUS.find((x) => x.id === id)!;
      const m = tuneMelody(t);
      return detectChords(m.notes, { key: t.key, timeSig: t.ts, harmonicRhythm: 'auto', style, complexity: 0.35, totalUnits: m.totalUnits });
    };
    const at = (chords: Chord[], bar: number, beats: number, beat = 1) => chords.find((c) => c.start <= (bar - 1) * beats * 4 + (beat - 1) * 4 && c.start + c.dur > (bar - 1) * beats * 4 + (beat - 1) * 4)!.symbol;
    // Twinkle: I | IV I | IV I | V I
    const tw = chordsOf('twinkle');
    expect([at(tw, 1, 4), at(tw, 2, 4), at(tw, 2, 4, 3), at(tw, 4, 4), at(tw, 4, 4, 3)]).toEqual(['C', 'F', 'C', 'G', 'C']);
    // Greensleeves ends on V–i in A minor; Auld Lang Syne opens on I and closes V–I
    const gs = chordsOf('greensleeves');
    expect(gs.slice(-2).map((c) => c.symbol)).toEqual(['E', 'Am']);
    const al = chordsOf('auld-lang-syne');
    expect(at(al, 2, 4)).toBe('F');
    expect(al.slice(-2).map((c) => c.symbol)).toEqual(['C', 'F']);
  });

  it('writes textbook part-writing across a corpus of tunes', () => {
    let total = 0;
    let finals = 0;
    let parallelsChoral = 0;
    let clashes = 0;
    for (const t of CORPUS) {
      const m = tuneMelody(t);
      for (const style of ['pop', 'choral', 'jazz', 'barbershop', 'pad'] as HarmonyStyle[]) {
        const arr = harmonize({ melody: m.notes, key: t.key, timeSig: t.ts, bpm: 100, totalUnits: m.totalUnits }, { ...base, style, voices: 4 });
        const c = critique(arr);
        total++;
        if (c.finalCadence) finals++;
        if (style === 'choral') parallelsChoral += c.parallels;
        clashes += c.clashes;
        expect(c.bigLeaps).toBeLessThanOrEqual(1);
      }
    }
    expect(finals).toBe(total);
    expect(parallelsChoral / CORPUS.length).toBeLessThan(0.5);
    expect(clashes).toBe(0);
  });

  it('choral style keeps voices below the soprano and avoids parallel fifths/octaves', () => {
    const arr = harmonize(input, { ...base, style: 'choral', voices: 3 });
    const parts = [arr.melody, ...arr.harmonies];
    let parallels = 0;
    for (let i = 1; i < arr.live.length; i++) {
      const prev = [arr.melody.notes[i - 1].midi, ...arr.live[i - 1].pitches] as number[];
      const cur = [arr.melody.notes[i].midi, ...arr.live[i].pitches] as number[];
      for (let a = 0; a < prev.length; a++)
        for (let b = a + 1; b < prev.length; b++) {
          const da = cur[a] - prev[a];
          const db = cur[b] - prev[b];
          if (!da || !db || Math.sign(da) !== Math.sign(db)) continue;
          const i1 = mod12(prev[a] - prev[b]);
          const i2 = mod12(cur[a] - cur[b]);
          if (i1 === i2 && (i1 === 0 || i1 === 7)) parallels++;
        }
      cur.slice(1).forEach((p) => expect(p).toBeLessThan(cur[0]));
    }
    expect(parallels).toBeLessThanOrEqual(1);
    expect(parts.map((p) => p.clef)).toContain('bass');
  });

  it('pop thirds mostly move in parallel 3rds/6ths with the melody', () => {
    const arr = harmonize(input, { ...base, style: 'pop', voices: 1, placement: 'above' });
    const ivs = arr.live.map((s, i) => (s.pitches[0] as number) - arr.melody.notes[i].midi);
    const good = ivs.filter((d) => [3, 4, 8, 9].includes(Math.abs(d))).length;
    expect(good / ivs.length).toBeGreaterThan(0.6);
    expect(ivs.every((d) => d > 0)).toBe(true);
  });

  it('seed produces a different but valid variation', () => {
    const a = harmonize(input, { ...base, voices: 3, seed: 0 });
    const b = harmonize(input, { ...base, voices: 3, seed: 1234 });
    expect(JSON.stringify(a.harmonies.map((h) => h.notes))).not.toEqual(JSON.stringify(b.harmonies.map((h) => h.notes)));
    expect(intervalsOk(b)).toBeLessThanOrEqual(2);
  });

  it('is fast enough for interactive use', () => {
    const t = performance.now();
    harmonize(input, { ...base, style: 'jazz', voices: 4 });
    expect(performance.now() - t).toBeLessThan(1500);
  });
});

describe('exports', () => {
  const parseXml = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml');

  it('MusicXML has consistent measures and durations for every part', () => {
    for (const s of [ODE_TO_JOY, AMAZING_GRACE]) {
      const m = melodyOf(s);
      const ts = { beats: s.beatsPerBar, beatType: 4 };
      const key = s.id === 'amazing-grace' ? { tonic: 7, mode: 'major' as const } : C;
      const arr = harmonize({ melody: m.notes, key, timeSig: ts, bpm: s.bpm, totalUnits: m.totalUnits }, { ...base, style: 'choral', voices: 3 });
      const xml = toMusicXML(arr, { title: s.title });
      const doc = parseXml(xml);
      const parts = Array.from(doc.getElementsByTagName('part'));
      expect(parts).toHaveLength(4);
      const bar = s.beatsPerBar * 4;
      const counts = parts.map((p) => p.getElementsByTagName('measure').length);
      expect(new Set(counts).size).toBe(1);
      for (const p of parts) {
        Array.from(p.getElementsByTagName('measure')).forEach((meas, mi) => {
          const total = Array.from(meas.getElementsByTagName('note')).reduce(
            (sum, n) => sum + Number(n.getElementsByTagName('duration')[0].textContent),
            0,
          );
          const implicit = meas.getAttribute('implicit') === 'yes';
          if (implicit) expect(mi).toBe(0);
          expect(total).toBe(implicit ? bar - m.pickup : bar);
        });
      }
      expect(doc.getElementsByTagName('harmony').length).toBeGreaterThan(3);
      if (s.id === 'amazing-grace') {
        expect(doc.getElementsByTagName('fifths')[0].textContent).toBe('1');
        expect(parts[0].getElementsByTagName('measure')[0].getAttribute('implicit')).toBe('yes');
      }
      // ties come in matched pairs
      const starts = xml.match(/<tie type="start"\/>/g)?.length ?? 0;
      const stops = xml.match(/<tie type="stop"\/>/g)?.length ?? 0;
      expect(starts).toBe(stops);
    }
  });

  it('spells chromatic chord tones from the chord root (E7 in C → G♯)', () => {
    const arr = harmonize(input, { ...base, style: 'jazz', voices: 3, harmonicRhythm: 'half' });
    const e7 = arr.chords.find((c) => c.root === 4 && c.quality === 'dom7');
    expect(e7).toBeDefined();
    const sharps = [arr.melody, ...arr.harmonies].flatMap((p) => p.notes).filter((n) => mod12(n.midi) === 8);
    expect(sharps.length).toBeGreaterThan(0);
    const xml = toMusicXML(arr, { title: 'x' });
    expect(xml).not.toMatch(/<step>A<\/step><alter>-1<\/alter>/);
    expect(xml).toMatch(/<step>G<\/step><alter>1<\/alter>/);
  });

  it('starts the chord progression on the first sung note (pickups get no chords over silence)', () => {
    const g = melodyOf(AMAZING_GRACE);
    const G = { tonic: 7, mode: 'major' as const };
    const chords = detectChords(g.notes, { key: G, timeSig: { beats: 3, beatType: 4 }, harmonicRhythm: 'auto', style: 'choral', complexity: 0.35, totalUnits: g.totalUnits });
    expect(chords[0].start).toBe(g.pickup);
    expect(chords[0].symbol).toBe('G');
    for (const c of chords.slice(1)) expect(c.start).toBeGreaterThanOrEqual(12);
  });

  it('MIDI contains one track per part with the right notes and tempo', () => {
    const arr = harmonize(input, { ...base, voices: 2 });
    const bytes = toMidi(arr);
    const midi = new Midi(bytes);
    expect(midi.tracks).toHaveLength(3);
    expect(midi.tracks[0].notes.map((n) => n.midi)).toEqual(ode.notes.map((n) => n.midi));
    expect(Math.round(midi.header.tempos[0].bpm)).toBe(100);
    expect(midi.tracks[1].notes.length).toBe(arr.harmonies[0].notes.length);
    // first note of bar 2 is at 4 beats
    expect(midi.tracks[0].notes[4].ticks).toBe(midi.header.ppq * 4);
  });
});
