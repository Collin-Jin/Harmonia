import { describe, expect, it } from 'vitest';
import { LiveHarmonyController, LiveNoteSegmenter, ScoreFollower } from '../../src/music/follower';
import { harmonize } from '../../src/music/harmony';
import { renderSungMelody, type RenderNote } from '../../src/music/vocalRender';
import { ODE_TO_JOY, sampleToTimed } from '../../src/music/samples';
import type { MelodyNote } from '../../src/music/types';
import { runWorklet } from './helpers/worklet';

function odeArrangement(voices = 2) {
  let pos = 0;
  const notes: MelodyNote[] = [];
  for (const [m, b] of ODE_TO_JOY.notes) {
    notes.push({ midi: m, start: pos, dur: b * 4, time: 0, end: 0, cents: 0 });
    pos += b * 4;
  }
  return harmonize(
    { melody: notes, key: { tonic: 0, mode: 'major' }, timeSig: { beats: 4, beatType: 4 }, bpm: 100, totalUnits: 128 },
    { style: 'pop', voices, placement: 'around', harmonicRhythm: 'auto', complexity: 0.3, seed: 0 },
  );
}

interface Trace {
  onsetTimes: number[];
  indices: number[];
  confidences: number[];
  transposes: number[];
  tempo: number[];
  commands: number;
  latencies: number[];
}

/** Feed a performance through worklet -> segmenter -> controller, as the live engine does. */
function perform(notes: RenderNote[], render: Parameters<typeof renderSungMelody>[1] = {}, voices = 2): Trace {
  const arr = odeArrangement(voices);
  const { samples, sampleRate } = renderSungMelody(notes, { sampleRate: 48000, ...render });
  const { frames, hopSec } = runWorklet(samples, sampleRate);
  const seg = new LiveNoteSegmenter({ hopSec });
  const ctl = new LiveHarmonyController(arr, { allowTranspose: true, followIntonation: true });
  const tr: Trace = { onsetTimes: [], indices: [], confidences: [], transposes: [], tempo: [], commands: 0, latencies: [] };
  // frame "arrival" time = window centre + half window (the moment the worklet posts it)
  for (const f of frames) {
    for (const ev of seg.process(f)) {
      if (ev.type === 'onset') {
        const cmds = ctl.onset(ev.midi, ev.t, ev.revision, ev.rearticulation);
        tr.commands += cmds.length;
        const s = ctl.status;
        if (ev.revision) {
          tr.indices[tr.indices.length - 1] = s.index;
          tr.confidences[tr.confidences.length - 1] = s.confidence;
          continue;
        }
        tr.onsetTimes.push(ev.t);
        tr.indices.push(s.index);
        tr.confidences.push(s.confidence);
        tr.transposes.push(s.transpose);
        tr.tempo.push(s.tempoRatio);
        // detection latency vs. the true onset closest before this event
        const truth = notes.filter((n) => n.start <= f.t + 0.01).pop();
        if (truth) tr.latencies.push(f.t + 0.0235 - truth.start);
      } else if (ev.type === 'pitch') ctl.pitch(ev.midi);
      else ctl.offset();
    }
  }
  return tr;
}

/**
 * Fraction of sung notes for which the follower reported the right score position.
 * Each detected onset is matched to the performed note sounding at that moment.
 */
function correctFraction(tr: Trace, expected: number[], perf: RenderNote[], skipFirst = 0) {
  let ok = 0;
  const seen = new Set<number>();
  tr.onsetTimes.forEach((t, k) => {
    let i = -1;
    perf.forEach((n, j) => {
      if (n.start <= t + 0.06) i = j;
    });
    if (i < skipFirst || seen.has(i)) return;
    seen.add(i);
    if (tr.indices[k] === expected[i]) ok++;
  });
  return ok / (expected.length - skipFirst);
}

describe('live score following (worklet → segmenter → follower)', () => {
  const N = ODE_TO_JOY.notes.length;
  const all = Array.from({ length: N }, (_, i) => i);

  it('follows a faithful performance note by note', () => {
    const perf = sampleToTimed(ODE_TO_JOY, { leadIn: 0.5, jitter: 0.02, seed: 2 });
    const tr = perform(perf);
    expect(tr.indices.length).toBeGreaterThanOrEqual(N - 1);
    expect(tr.indices.length).toBeLessThanOrEqual(N + 1);
    expect(correctFraction(tr, all, perf)).toBeGreaterThan(0.93);
    expect(tr.commands).toBeGreaterThan(N);
  });

  it('adapts to a faster tempo and a transposed key (+3 semitones, 25% faster)', () => {
    const perf = sampleToTimed(ODE_TO_JOY, { leadIn: 0.5, tempoScale: 1.25, transpose: 3, jitter: 0.02, seed: 4 });
    const tr = perform(perf);
    expect(correctFraction(tr, all, perf, 2)).toBeGreaterThan(0.9);
    expect(tr.transposes[tr.transposes.length - 1]).toBe(3);
    const finalTempo = tr.tempo[tr.tempo.length - 1];
    expect(finalTempo).toBeGreaterThan(1.12);
    expect(finalTempo).toBeLessThan(1.4);
  });

  it('adapts to slowing down mid-phrase (ritardando)', () => {
    const notes = sampleToTimed(ODE_TO_JOY, { leadIn: 0.5, jitter: 0.01, seed: 6 });
    // progressively stretch time: 1.0x -> 1.6x slower by the end
    const T = notes[notes.length - 1].start;
    const warp = (t: number) => 0.5 + (t - 0.5) * (1 + 0.3 * ((t - 0.5) / T));
    const warped = notes.map((n) => ({ ...n, start: warp(n.start), dur: warp(n.start + n.dur) - warp(n.start) }));
    const tr = perform(warped);
    expect(correctFraction(tr, all, warped)).toBeGreaterThan(0.9);
    expect(tr.tempo[tr.tempo.length - 1]).toBeLessThan(0.9);
  });

  it('recovers after skipped notes and starts mid-song', () => {
    const notes = sampleToTimed(ODE_TO_JOY, { leadIn: 0.5, jitter: 0.01, seed: 8 });
    // start at note 8 (bar 3), skip notes 12-13
    const perf = notes.slice(8).filter((_, i) => i !== 4 && i !== 5);
    const shift = perf[0].start - 0.5;
    const shifted = perf.map((n) => ({ ...n, start: n.start - shift }));
    const expected = all.slice(8).filter((_, i) => i !== 4 && i !== 5);
    const tr = perform(shifted);
    // allow a few notes to lock on
    expect(correctFraction(tr, expected, shifted, 3)).toBeGreaterThan(0.85);
  });

  it('tolerates wrong notes without losing its place', () => {
    const notes = sampleToTimed(ODE_TO_JOY, { leadIn: 0.5, jitter: 0.01, seed: 10 });
    const sung = notes.map((n, i) => (i === 6 || i === 18 ? { ...n, midi: n.midi + 2 } : n));
    const tr = perform(sung);
    expect(correctFraction(tr, all, sung)).toBeGreaterThan(0.88);
    expect(tr.indices[N - 1]).toBe(N - 1);
  });

  it('detects onsets with low latency', () => {
    const tr = perform(sampleToTimed(ODE_TO_JOY, { leadIn: 0.5, seed: 12 }));
    const sorted = tr.latencies.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    // includes the analysis window (≈36 ms) + stability confirmation
    expect(median).toBeLessThan(0.09);
  });
});

describe('ScoreFollower (symbolic)', () => {
  it('disambiguates repeated pitches using timing', () => {
    const notes = [60, 60, 60, 62, 64, 64, 64, 65].map((m, i) => ({ midi: m, time: i * 0.5 }));
    const f = new ScoreFollower(notes, { allowTranspose: false });
    const idx = notes.map((n) => f.onset(n.midi, 1 + n.time).index);
    expect(idx).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('wraps around when the melody is sung again', () => {
    const notes = [60, 62, 64, 65, 67].map((m, i) => ({ midi: m, time: i * 0.5 }));
    const f = new ScoreFollower(notes, { allowTranspose: false });
    const idx: number[] = [];
    for (let rep = 0; rep < 2; rep++) notes.forEach((n) => idx.push(f.onset(n.midi, rep * 3 + n.time).index));
    expect(idx).toEqual([0, 1, 2, 3, 4, 0, 1, 2, 3, 4]);
  });
});
