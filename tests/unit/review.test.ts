import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeRecording } from '../../src/music/transcribe';
import { cleanVoice } from '../../src/music/autotune';
import { noteKey, useStore } from '../../src/state/store';
import { readWav } from './helpers/wav';

const { samples, sampleRate } = readWav('tests/fixtures/ode-to-joy.wav');
const res = analyzeRecording(samples, sampleRate, { timeSig: { beats: 4, beatType: 4 } });
const take = (review: boolean) =>
  useStore.getState().setAnalysis({ recording: { samples, sampleRate }, frames: res.frames, transcription: res.transcription, title: 'Ode', review });
const st = () => useStore.getState();

describe('checking the notes before harmonizing', () => {
  beforeEach(() => take(true));

  it("the singer's own take opens for checking; samples go straight to the arrangement", () => {
    expect(st().phase).toBe('review');
    expect(st().arrangement).not.toBeNull(); // already harmonized in the background
    st().finishReview();
    expect(st().phase).toBe('ready');
    st().openReview();
    expect(st().phase).toBe('review');
    take(false);
    expect(st().phase).toBe('ready');
  });

  it('a dragged note changes the melody the harmony is written for', () => {
    const n = st().transcription!.notes[2];
    st().editNotePitch('melody', 2, n.midi + 2);
    expect(st().transcription!.notes[2]).toMatchObject({ midi: n.midi + 2, edited: true });
    expect(st().arrangement!.melody.notes[2].midi).toBe(n.midi + 2);
  });

  it('removes a note, keeps it removed through a tempo change, and brings it back', () => {
    const before = st().transcription!.notes.length;
    const gone = st().transcription!.notes[4];
    st().deleteNote(4);
    expect(st().transcription!.notes).toHaveLength(before - 1);
    expect(st().transcription!.notes.some((n) => noteKey(n) === noteKey(gone))).toBe(false);
    expect(st().arrangement!.melody.notes).toHaveLength(before - 1);
    st().retranscribe({ bpm: 96 });
    expect(st().transcription!.notes).toHaveLength(before - 1);
    st().restoreNote(noteKey(gone));
    expect(st().transcription!.notes).toHaveLength(before);
  });

  it('Reset notes undoes pitch changes and removals, and a melody keeps at least two notes', () => {
    st().editNotePitch('melody', 0, 70);
    st().deleteNote(3);
    st().resetNotes();
    expect(st().transcription!.notes.map((n) => n.midi)).toEqual(res.transcription.notes.map((n) => n.midi));
    expect(st().deletedNotes).toEqual({});
    while (st().transcription!.notes.length > 2) st().deleteNote(0);
    st().deleteNote(0);
    expect(st().transcription!.notes).toHaveLength(2);
  });
});

describe('a removed note is silenced in the tuned voice', () => {
  it('even in the middle of a phrase', () => {
    const notes = res.transcription.notes.map((n) => ({ time: n.time, end: n.end, midi: n.midi }));
    const mid = notes[5];
    const rms = (y: Float32Array) => {
      let s = 0;
      const a = Math.floor((mid.time + 0.05) * sampleRate);
      const b = Math.floor((mid.end - 0.05) * sampleRate);
      for (let i = a; i < b; i++) s += y[i] * y[i];
      return Math.sqrt(s / (b - a));
    };
    const kept = rms(cleanVoice(samples, sampleRate, notes));
    const muted = rms(cleanVoice(samples, sampleRate, notes.filter((n) => n !== mid), [mid]));
    expect(kept).toBeGreaterThan(0.01);
    expect(muted).toBeLessThan(kept * 0.1);
  });
});
