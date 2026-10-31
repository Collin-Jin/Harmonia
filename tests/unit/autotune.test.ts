import { describe, expect, it } from 'vitest';
import { analyzeRecording, trackPitch } from '../../src/music/transcribe';
import { cleanVoice, processVoice, psolaShift } from '../../src/music/autotune';
import { ODE_TO_JOY } from '../../src/music/samples';
import { sloppyTake } from './helpers/sloppy';

const take = sloppyTake(ODE_TO_JOY, { seed: 23 });
const sr = take.sampleRate;
const res = analyzeRecording(take.samples, sr, { timeSig: { beats: 4, beatType: 4 } });
const tr = res.transcription;
const frames = res.frames.map((f) => ({ t: f.t, midi: f.midi === null ? null : f.midi + tr.tuningCents / 100 }));
const notes = tr.notes.map((n) => ({ time: n.time, end: n.end, midi: n.midi }));

/** Per-note median deviation (cents) from the written pitch, and mean vibrato span. */
function measure(samples: Float32Array) {
  const fr = trackPitch(samples, sr);
  const devs: number[] = [];
  const spans: number[] = [];
  for (const n of notes) {
    const d = n.end - n.time;
    const vals = fr
      .filter((f) => f.midi !== null && f.clarity > 0.8 && f.t > n.time + d * 0.25 && f.t < n.time + d * 0.85)
      .map((f) => ((f.midi as number) - n.midi) * 100)
      .sort((a, b) => a - b);
    if (vals.length < 3) continue;
    devs.push(Math.abs(vals[vals.length >> 1]));
    spans.push(vals[Math.floor(vals.length * 0.9)] - vals[Math.floor(vals.length * 0.1)]);
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return { mean: mean(devs), max: Math.max(...devs), vibrato: mean(spans) };
}

const rms = (x: Float32Array, a: number, b: number) => {
  let s = 0;
  const i0 = Math.floor(a * sr);
  const i1 = Math.min(x.length, Math.floor(b * sr));
  for (let i = i0; i < i1; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, i1 - i0));
};

describe('autotune', () => {
  const before = measure(take.samples);

  it('the test take really is out of tune', () => {
    expect(tr.notes.map((n) => n.midi)).toEqual(ODE_TO_JOY.notes.filter(([m]) => m > 0).map(([m]) => m));
    expect(before.mean).toBeGreaterThan(15);
    expect(before.max).toBeGreaterThan(40);
  });

  it('natural mode puts every note on pitch and keeps some vibrato', () => {
    const after = measure(processVoice(take.samples, sr, frames, notes, 'natural'));
    expect(after.mean).toBeLessThan(4);
    expect(after.max).toBeLessThan(10);
    expect(after.vibrato).toBeGreaterThan(before.vibrato * 0.4);
  });

  it('hard mode snaps to pitch and flattens vibrato', () => {
    const after = measure(processVoice(take.samples, sr, frames, notes, 'hard'));
    expect(after.mean).toBeLessThan(3);
    expect(after.max).toBeLessThan(6);
    expect(after.vibrato).toBeLessThan(before.vibrato * 0.3);
  });

  it('is transparent when no correction is needed', () => {
    const out = psolaShift(take.samples, sr, frames, new Float32Array(frames.length));
    let e = 0;
    let s = 0;
    for (let i = 0; i < out.length; i++) (e += (out[i] - take.samples[i]) ** 2), (s += take.samples[i] ** 2);
    expect(10 * Math.log10(s / e)).toBeGreaterThan(40);
  });

  it('keeps a sung phrase continuous (no 10 ms holes between notes)', () => {
    const out = processVoice(take.samples, sr, frames, notes, 'natural');
    const level = (t0: number, t1: number) => {
      let s = 0;
      const a = Math.max(0, Math.floor(t0 * sr));
      const b = Math.min(out.length, Math.floor(t1 * sr));
      for (let i = a; i < b; i++) s += out[i] * out[i];
      return Math.sqrt(s / Math.max(1, b - a));
    };
    const first = notes[0].time;
    const last = notes[notes.length - 1].end;
    const body: number[] = [];
    for (let t = first + 0.08; t < last - 0.08; t += 0.04) body.push(level(t, t + 0.02));
    const median = [...body].sort((a, b) => a - b)[body.length >> 1];
    expect(median).toBeGreaterThan(0.02);
    const holes = body.filter((v) => v < median * 0.18).length;
    expect(holes / body.length).toBeLessThan(0.08);
  });

  it('gates noise outside the sung notes', () => {
    const lastEnd = notes[notes.length - 1].end;
    const out = cleanVoice(take.samples, sr, notes);
    const sung = rms(out, notes[2].time, notes[2].end);
    // squeak, throat noise and breath all live in the tail after the last note
    const tailBefore = rms(take.samples, lastEnd + 0.4, lastEnd + 1.5) / rms(take.samples, notes[2].time, notes[2].end);
    const tailAfter = rms(out, lastEnd + 0.4, lastEnd + 1.5) / sung;
    expect(tailAfter).toBeLessThan(tailBefore * 0.15);
  });
});
