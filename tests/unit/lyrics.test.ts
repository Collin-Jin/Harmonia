import { describe, expect, it } from 'vitest';
import { analyzeRecording } from '../../src/music/transcribe';
import { harmonize } from '../../src/music/harmony';
import { toMusicXML } from '../../src/music/musicxml';
import { applySounds, sungWords, vowelText } from '../../src/music/partLyrics';
import { alignLyrics, cleanTranscript, HUM_BRIGHTNESS, lyricsText, syllabify, voiceBrightness, type AsrChunk } from '../../src/music/lyrics';
import { parseLyric } from '../../src/state/store';
import type { ScoreNote } from '../../src/music/types';
import { readWav } from './helpers/wav';

const sung = readWav('tests/fixtures/twinkle-lyrics.wav');
const hummed = readWav('tests/fixtures/ode-hummed.wav');

/** Word timestamps as whisper-base.en produces them for the sung fixture. */
const TWINKLE_ASR: AsrChunk[] = [
  ['Twinkle', 1.02, 2.22],
  ['twinkle', 2.36, 4.28],
  ['little', 4.28, 5.84],
  ['star,', 5.84, 6.2],
  ['how', 6.54, 7.26],
  ['I', 7.26, 7.98],
  ['wonder', 7.98, 9.04],
  ['what', 9.04, 9.74],
  ['you', 9.74, 11.1],
  ['are.', 11.1, 11.36],
].map(([text, a, b]) => ({ text: ` ${text}`, timestamp: [a as number, b as number] }));

describe('lyrics', () => {
  it('splits words into sung syllables', () => {
    const cases: Record<string, string> = {
      twinkle: 'twin-kle',
      little: 'lit-tle',
      wonder: 'won-der',
      singing: 'sing-ing',
      beautiful: 'beau-ti-ful',
      hallelujah: 'hal-le-lu-jah',
      star: 'star',
      amazing: 'a-maz-ing',
      making: 'mak-ing',
      walking: 'walk-ing',
      running: 'run-ning',
    };
    for (const [w, want] of Object.entries(cases)) expect(syllabify(w).join('-').toLowerCase()).toBe(want);
  });

  it('tells a sung take from a hummed one by its brightness', () => {
    const b1 = voiceBrightness(sung.samples, sung.sampleRate);
    const b2 = voiceBrightness(hummed.samples, hummed.sampleRate);
    expect(b1).toBeGreaterThan(HUM_BRIGHTNESS * 3);
    expect(b2).toBeLessThan(HUM_BRIGHTNESS);
  });

  it('keeps real words and rejects humming, vowels and hallucinations', () => {
    const words = cleanTranscript(TWINKLE_ASR, 12, 0.1);
    expect(words.map((w) => w.text).join(' ')).toBe('Twinkle twinkle little star how I wonder what you are');
    expect(words.at(-1)!.phraseEnd).toBe(true);
    // Same words, but the voice is a closed-mouth hum.
    expect(cleanTranscript(TWINKLE_ASR, 12, 0.005)).toEqual([]);
    // Wordless "ooh"/"la" singing.
    const vowels = ['Ooh', 'la', 'la', 'Ahh'].map((t, i) => ({ text: t, timestamp: [i, i + 0.5] as [number, number] }));
    expect(cleanTranscript(vowels, 5, 0.1)).toEqual([]);
    // Text the recogniser invented past the end of the take.
    const ghost = ['Thank', 'you', 'for', 'watching'].map((t, i) => ({ text: t, timestamp: [20 + i, 20.5 + i] as [number, number] }));
    expect(cleanTranscript(ghost, 10, 0.1)).toEqual([]);
    expect(cleanTranscript([{ text: ' [Music]', timestamp: [0, 9] }], 10, 0.1)).toEqual([]);
  });

  it('lays one syllable on each note of the sung fixture', () => {
    const tr = analyzeRecording(sung.samples, sung.sampleRate, { timeSig: { beats: 4, beatType: 4 } }).transcription;
    const words = cleanTranscript(TWINKLE_ASR, sung.samples.length / sung.sampleRate, 0.1);
    const al = alignLyrics(words, tr.notes);
    expect(lyricsText(al.perNote.map((p) => p.lyric))).toBe('Twin-kle twin-kle lit-tle star how I won-der what you are');
    expect(al.perNote.every((p) => p.lyric)).toBe(true);
    expect(al.phraseEnds).toContain(tr.notes.length - 1);
  });

  it('uses melismas when there are more notes than syllables', () => {
    const notes = [0, 0.5, 1, 1.25, 1.5, 2].map((t, i) => ({ time: t, end: t + 0.24, midi: 60 + i }));
    const words = [
      { text: 'oh', start: 0, end: 0.4, phraseEnd: false },
      { text: 'say', start: 0.5, end: 1.7, phraseEnd: false },
      { text: 'can', start: 2, end: 2.3, phraseEnd: true },
    ];
    const al = alignLyrics(words, notes);
    expect(al.perNote.map((p) => p.lyric?.text ?? (p.melisma ? '_' : '·')).join(' ')).toBe('oh say _ _ _ can');
  });

  it('parses edited syllables', () => {
    expect(parseLyric('twin-')).toEqual({ text: 'twin', hyphen: true });
    expect(parseLyric(' star ')).toMatchObject({ text: 'star' });
    expect(parseLyric(' star ')?.hyphen).toBeFalsy();
    expect(parseLyric('')).toBeNull();
  });
});

describe('harmony lyrics', () => {
  const melody: ScoreNote[] = [
    { midi: 60, start: 0, dur: 4, lyric: { text: 'Twin', hyphen: true } },
    { midi: 60, start: 4, dur: 4, lyric: { text: 'kle' } },
    { midi: 67, start: 8, dur: 4, lyric: { text: 'star' } },
    { midi: 69, start: 12, dur: 4, melisma: true },
  ];

  it('re-articulates held harmony notes on each melody syllable', () => {
    const held: ScoreNote[] = [{ midi: 64, start: 0, dur: 8 }, { midi: 64, start: 8, dur: 8 }];
    const out = sungWords(held, melody);
    expect(out.map((n) => [n.start, n.dur, n.lyric?.text ?? (n.melisma ? '_' : '·')])).toEqual([
      [0, 4, 'Twin'],
      [4, 4, 'kle'],
      [8, 8, 'star'],
    ]);
    expect(out[0].lyric?.hyphen).toBe(true);
  });

  it('writes a vowel at each phrase start and extends it', () => {
    const notes: ScoreNote[] = [
      { midi: 64, start: 0, dur: 4 },
      { midi: 65, start: 4, dur: 4 },
      { midi: 67, start: 12, dur: 4 },
    ];
    expect(vowelText(notes, 'oo').map((n) => n.lyric?.text ?? (n.melisma ? '_' : '·'))).toEqual(['Ooh', '_', 'Ooh']);
  });

  it('keeps lyrics on the parts for singing, but never engraves them', () => {
    const input = {
      melody: melody.map((n) => ({ ...n, time: 0, end: 0, cents: 0 })),
      key: { tonic: 0, mode: 'major' as const },
      timeSig: { beats: 4, beatType: 4 },
      bpm: 90,
      totalUnits: 16,
    };
    const opts = { style: 'pop' as const, voices: 2, placement: 'around' as const, harmonicRhythm: 'auto' as const, complexity: 0.35, seed: 0 };
    const arr = applySounds(harmonize(input, opts), () => 'lyrics');
    expect(arr.melody.notes[0].lyric?.text).toBe('Twin');
    for (const h of arr.harmonies) expect(h.notes.filter((n) => n.lyric).map((n) => n.lyric!.text)).toEqual(['Twin', 'kle', 'star']);
    const xml = toMusicXML(arr, { title: 't' });
    expect(xml).not.toContain('<lyric');
    expect(xml).not.toContain('<text>Twin</text>');

    const plainInput = { ...input, melody: input.melody.map(({ lyric: _l, melisma: _m, ...n }) => n) };
    const wordless = applySounds(harmonize(plainInput, opts), () => 'lyrics');
    expect(toMusicXML(wordless, { title: 't' })).not.toContain('<lyric');
  });
});
