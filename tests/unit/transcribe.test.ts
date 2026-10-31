import { describe, expect, it } from 'vitest';
import { Yin } from '../../src/music/pitch';
import { analyzeRecording, fitPitchesToKey } from '../../src/music/transcribe';
import { sloppyTake } from './helpers/sloppy';
import { renderSungMelody } from '../../src/music/vocalRender';
import { AMAZING_GRACE, ODE_TO_JOY, sampleToTimed, type SampleMelody } from '../../src/music/samples';
import { freqToMidi } from '../../src/music/theory';
import { UNITS_PER_BEAT } from '../../src/music/types';

function expectedUnits(s: SampleMelody) {
  return s.notes.filter(([m]) => m > 0).map(([m, b]) => ({ midi: m, dur: Math.round(b * UNITS_PER_BEAT) }));
}

describe('YIN pitch detector', () => {
  it('detects pure and harmonic tones within 5 cents', () => {
    const sr = 16000;
    for (const f of [98, 196, 261.63, 440, 659.25, 880]) {
      const yin = new Yin(sr, 400, 65, 1100);
      const buf = new Float32Array(yin.frameLength);
      for (let i = 0; i < buf.length; i++) {
        const t = i / sr;
        buf[i] = Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.3 * Math.sin(6 * Math.PI * f * t);
      }
      const r = yin.detect(buf);
      expect(r.clarity).toBeGreaterThan(0.9);
      expect(Math.abs(freqToMidi(r.freq) - freqToMidi(f)) * 100).toBeLessThan(5);
    }
  });

  it('reports low clarity for noise', () => {
    const yin = new Yin(16000, 400);
    const buf = new Float32Array(yin.frameLength).map(() => Math.random() - 0.5);
    expect(yin.detect(buf).clarity).toBeLessThan(0.7);
  });
});

describe('transcription of sung audio', () => {
  const run = (s: SampleMelody, extra: Parameters<typeof sampleToTimed>[1] = {}, render: Parameters<typeof renderSungMelody>[1] = {}) => {
    const timed = sampleToTimed(s, { leadIn: 0.7, jitter: 0.02, seed: 5, ...extra });
    const { samples, sampleRate } = renderSungMelody(timed, { sampleRate: 44100, ...render });
    return analyzeRecording(samples, sampleRate, { timeSig: { beats: s.beatsPerBar, beatType: 4 } }).transcription;
  };

  it('recovers Ode to Joy pitches, rhythm, tempo and key', () => {
    const tr = run(ODE_TO_JOY);
    const exp = expectedUnits(ODE_TO_JOY);
    expect(tr.notes.map((n) => n.midi)).toEqual(exp.map((n) => n.midi));
    // Durations: all but the final note must match exactly
    expect(tr.notes.slice(0, -1).map((n) => n.dur)).toEqual(exp.slice(0, -1).map((n) => n.dur));
    expect(Math.abs(tr.bpm - 100)).toBeLessThan(4);
    expect(tr.key).toMatchObject({ tonic: 0, mode: 'major' });
    expect(tr.notes[0].start % 16).toBe(0); // starts on a downbeat
  });

  it('handles an anacrusis in 3/4 (Amazing Grace)', () => {
    const tr = run(AMAZING_GRACE);
    const exp = expectedUnits(AMAZING_GRACE);
    expect(tr.notes.map((n) => n.midi)).toEqual(exp.map((n) => n.midi));
    expect(tr.key).toMatchObject({ tonic: 7, mode: 'major' });
    expect(Math.abs(tr.bpm - 84)).toBeLessThan(4);
    // pickup: first note on beat 3 of a 3/4 bar
    expect(tr.notes[0].start).toBe(8);
    expect(tr.notes[1].start).toBe(12);
  });

  it('compensates a consistently flat singer and transposed key', () => {
    const tr = run(ODE_TO_JOY, { transpose: -5, tempoScale: 0.85 }, { detuneCents: -35 });
    expect(tr.notes.map((n) => n.midi)).toEqual(expectedUnits(ODE_TO_JOY).map((n) => n.midi - 5));
    expect(tr.tuningCents).toBeLessThan(-20);
    expect(tr.key).toMatchObject({ tonic: 7, mode: 'major' });
    expect(Math.abs(tr.bpm - 85)).toBeLessThan(4);
  });

  it('ignores breaths, clicks, squeaks and hum, and reads out-of-tune drifting notes correctly', () => {
    const editDistance = (a: number[], b: number[]) => {
      const D = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
      for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++) D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      return D[a.length][b.length];
    };
    for (const s of [ODE_TO_JOY, AMAZING_GRACE]) {
      const exp = expectedUnits(s).map((n) => n.midi);
      let exact = 0;
      for (const seed of [11, 23, 37]) {
        // per-note errors up to ±40 cents, 40 cents of drift, plus noise events
        const take = sloppyTake(s, { seed });
        const tr = analyzeRecording(take.samples, take.sampleRate, { timeSig: { beats: s.beatsPerBar, beatType: 4 } }).transcription;
        const got = tr.notes.map((n) => n.midi);
        expect(Math.max(...got)).toBeLessThanOrEqual(Math.max(...exp)); // no squeak notes
        expect(Math.min(...got)).toBeGreaterThanOrEqual(Math.min(...exp)); // no throat-noise notes
        expect(editDistance(got, exp)).toBeLessThanOrEqual(1);
        if (editDistance(got, exp) === 0) exact++;
      }
      expect(exact).toBeGreaterThanOrEqual(2);
    }
  });

  it('re-reads borderline notes when the user picks a different key', () => {
    const take = sloppyTake(ODE_TO_JOY, { seed: 23 });
    const tr = analyzeRecording(take.samples, take.sampleRate, { timeSig: { beats: 4, beatType: 4 } }).transcription;
    const refit = fitPitchesToKey(tr.rawNotes, { tonic: 0, mode: 'major' });
    expect(refit.map((n) => n.midi)).toEqual(tr.notes.map((n) => n.midi));
    expect(refit.every((n) => Math.abs(n.cents) <= 50)).toBe(true);
  });

  it('uses the metronome grid when provided', () => {
    const timed = sampleToTimed(ODE_TO_JOY, { leadIn: 1.2, jitter: 0.02, seed: 9 });
    const { samples, sampleRate } = renderSungMelody(timed, { sampleRate: 48000 });
    const tr = analyzeRecording(samples, sampleRate, { timeSig: { beats: 4, beatType: 4 }, bpm: 100, gridOriginSec: 1.2 }).transcription;
    expect(tr.tempoSource).toBe('metronome');
    expect(tr.bpm).toBe(100);
    expect(tr.notes.map((n) => n.start).slice(0, 8)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });
});
