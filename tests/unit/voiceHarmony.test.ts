import { describe, expect, it } from 'vitest';
import { analyzeRecording, trackPitch } from '../../src/music/transcribe';
import { harmonize } from '../../src/music/harmony';
import { TimeMap } from '../../src/music/timemap';
import { formantFor, renderVoicePart } from '../../src/music/voiceHarmony';
import type { HarmonyStyle } from '../../src/music/types';
import { readWav } from './helpers/wav';

const { samples, sampleRate: sr } = readWav('tests/fixtures/twinkle-lyrics.wav');
const res = analyzeRecording(samples, sr, { timeSig: { beats: 4, beatType: 4 } });
const tr = res.transcription;
const frames = res.frames.map((f) => ({ t: f.t, midi: f.midi === null ? null : f.midi + tr.tuningCents / 100 }));
const melody = tr.notes.map((n) => ({ time: n.time, end: n.end, midi: n.midi }));
const map = TimeMap.fromPerformance(tr.notes, tr.bpm, tr.originSec);

function render(style: HarmonyStyle, voices: number, vowel: 'oo' | null = null) {
  const arr = harmonize({ melody: tr.notes, key: tr.key, timeSig: tr.timeSig, bpm: tr.bpm, totalUnits: tr.totalUnits }, {
    style,
    voices,
    placement: 'around',
    harmonicRhythm: 'auto',
    complexity: 0.35,
    seed: 0,
  });
  return arr.harmonies.map((p, i) => {
    const notes = p.notes.map((n) => ({ time: map.sec(n.start), end: map.sec(n.start + n.dur), midi: n.midi }));
    const mean = notes.reduce((s, n) => s + n.midi, 0) / notes.length - 64;
    const out = renderVoicePart({ samples, sampleRate: sr, frames, melody, parts: [] }, { id: p.id, notes, vowel, formant: formantFor(mean, i), seed: i + 1 });
    return { notes, out };
  });
}

/** Median pitch error (cents) of each rendered harmony note that has enough voiced frames. */
function accuracy(notes: { time: number; end: number; midi: number }[], out: Float32Array) {
  const fr = trackPitch(out, sr);
  const errs: number[] = [];
  for (const n of notes) {
    const d = n.end - n.time;
    const vals = fr
      .filter((f) => f.midi !== null && f.clarity > 0.75 && f.t > n.time + Math.min(0.08, d * 0.3) && f.t < n.end - Math.min(0.05, d * 0.2))
      .map((f) => ((f.midi as number) + tr.tuningCents / 100 - n.midi) * 100)
      .sort((a, b) => a - b);
    if (vals.length < 4) continue;
    errs.push(Math.abs(vals[vals.length >> 1]));
  }
  return errs;
}

describe('harmony in the singer’s own voice', () => {
  it('lands every harmony note on its written pitch (pop, choral with bass)', () => {
    for (const [style, voices] of [['pop', 2], ['choral', 3]] as const) {
      for (const { notes, out } of render(style, voices)) {
        const errs = accuracy(notes, out);
        expect(errs.length).toBeGreaterThanOrEqual(Math.min(notes.length, 6));
        const good = errs.filter((e) => e < 35).length / errs.length;
        expect(good, `${style}: ${errs.map((e) => e.toFixed(0)).join(' ')}`).toBeGreaterThan(0.85);
      }
    }
  });

  it('starts each harmony note with the melody (no lag)', () => {
    const [{ notes, out }] = render('pop', 1);
    const env = (t: number) => {
      let s = 0;
      const a = Math.floor(t * sr);
      for (let i = a; i < a + Math.floor(0.01 * sr); i++) s += out[i] * out[i];
      return Math.sqrt(s / (0.01 * sr));
    };
    // the part is audible within 30 ms of each melody-aligned harmony onset
    let checked = 0;
    for (const n of notes) {
      const m = melody.find((x) => Math.abs(x.time - n.time) < 0.005);
      if (!m) continue;
      const peak = Math.max(...[0, 0.02, 0.04, 0.06, 0.08].map((d) => env(n.time + d)));
      expect(env(n.time + 0.03), `onset at ${n.time.toFixed(2)}`).toBeGreaterThan(peak * 0.3);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('can sing a wordless "ooh" with the singer’s source and the right pitch', () => {
    const [{ notes, out }] = render('pop', 1, 'oo');
    const errs = accuracy(notes, out);
    expect(errs.filter((e) => e < 40).length / errs.length).toBeGreaterThan(0.8);
    // "ooh" has much less energy above 1.5 kHz than the sung words
    const hiShare = (x: Float32Array) => {
      let lo = 0;
      let hi = 0;
      let prev = 0;
      for (let i = 0; i < x.length; i++) {
        const d = x[i] - prev;
        prev = x[i];
        hi += d * d;
        lo += x[i] * x[i];
      }
      return hi / Math.max(1e-9, lo);
    };
    const [{ out: words }] = render('pop', 1, null);
    expect(hiShare(out)).toBeLessThan(hiShare(words) * 0.7);
  });

  it('sustains a lyrics harmony smoothly through the sung phrase', () => {
    const [{ notes, out }] = render('pop', 1, null);
    const level = (t0: number, t1: number) => {
      let s = 0;
      const a = Math.floor(t0 * sr);
      const b = Math.floor(t1 * sr);
      for (let i = a; i < b; i++) s += out[i] * out[i];
      return Math.sqrt(s / Math.max(1, b - a));
    };
    const first = notes[0].time;
    const last = notes[notes.length - 1].end;
    const body: number[] = [];
    for (let t = first + 0.08; t < last - 0.08; t += 0.02) body.push(level(t, t + 0.015));
    const median = [...body].sort((a, b) => a - b)[body.length >> 1];
    expect(median).toBeGreaterThan(0.015);
    // lyrics still have consonants, so a few dips are expected; they must not dominate
    expect(body.filter((v) => v < median * 0.18).length / body.length).toBeLessThan(0.16);
  });

  it('sustains a wordless part smoothly through every note of the take', () => {
    const [{ notes, out }] = render('pop', 1, 'oo');
    const level = (t0: number, t1: number) => {
      let s = 0;
      const a = Math.floor(t0 * sr);
      const b = Math.floor(t1 * sr);
      for (let i = a; i < b; i++) s += out[i] * out[i];
      return Math.sqrt(s / Math.max(1, b - a));
    };
    const body = notes.map((n) => {
      const d = n.end - n.time;
      return level(n.time + d * 0.2, n.end - d * 0.2);
    });
    const median = [...body].sort((a, b) => a - b)[body.length >> 1];
    expect(median).toBeGreaterThan(0.02);
    // no note fades out or drops away (the whole part stays at a singing level)
    expect(Math.min(...body), body.map((b) => b.toFixed(3)).join(' ')).toBeGreaterThan(median * 0.35);
    // and within notes, no 10 ms holes
    let holes = 0;
    let frames = 0;
    for (const n of notes) {
      for (let t = n.time + 0.05; t < n.end - 0.05; t += 0.01) {
        frames++;
        if (level(t, t + 0.01) < median * 0.2) holes++;
      }
    }
    expect(holes / frames).toBeLessThan(0.04);
  });
});
