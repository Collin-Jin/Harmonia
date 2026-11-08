import type { Key } from './theory';
import type { Lyric } from './lyrics';

/** Grid resolution: 4 units per quarter note (sixteenth-note grid). */
export const UNITS_PER_BEAT = 4;

export interface TimeSignature {
  beats: number; // numerator
  beatType: number; // denominator (always 4 in Harmonia)
}

export interface PitchFrame {
  t: number; // seconds
  midi: number | null; // fractional MIDI pitch, null when unvoiced
  clarity: number; // 0..1 periodicity confidence
  rms: number;
}

/** A note detected in the raw performance (seconds, before quantization). */
export interface RawNote {
  midi: number; // rounded MIDI pitch
  cents: number; // average deviation from the rounded pitch (after tuning compensation)
  time: number; // onset seconds
  end: number; // offset seconds
  pitch?: number; // continuous sung pitch (after global tuning compensation)
  level?: number; // median RMS while sounding
  spread?: number; // inter-quartile pitch range in semitones (unstable = noise)
}

/** A quantized note on the score grid. */
export interface ScoreNote {
  midi: number;
  start: number; // units
  dur: number; // units
  tieToNext?: boolean; // continues into the next note of the same pitch without re-articulation
  lyric?: Lyric; // syllable sung on this note
  melisma?: boolean; // continues the previous note's syllable
  edited?: boolean; // pitch set by the user
}

export interface MelodyNote extends ScoreNote {
  time: number; // performed onset (s) in the recording
  end: number; // performed offset (s)
  cents: number;
}

export interface Transcription {
  notes: MelodyNote[];
  bpm: number;
  timeSig: TimeSignature;
  key: Key;
  tuningCents: number;
  /** Seconds in the recording that correspond to unit 0 of the score. */
  originSec: number;
  totalUnits: number;
  rawNotes: RawNote[];
  tempoSource: 'metronome' | 'estimated' | 'manual';
}

export type ChordQuality =
  | 'maj'
  | 'min'
  | 'dim'
  | 'aug'
  | 'sus4'
  | 'dom7'
  | 'maj7'
  | 'min7'
  | 'hdim7'
  | 'dim7'
  | 'dom9'
  | 'maj9'
  | 'min9';

export interface Chord {
  root: number; // absolute pitch class
  quality: ChordQuality;
  start: number; // units
  dur: number; // units
  symbol: string;
  roman: string;
  fn: 'T' | 'S' | 'D' | 'X';
  edited?: boolean; // chosen by the user
}

export type HarmonyStyle = 'pop' | 'choral' | 'jazz' | 'barbershop' | 'pad';
export type Placement = 'above' | 'around' | 'below';
export type HarmonicRhythm = 'auto' | 'bar' | 'half' | 'beat';
export type Vowel = 'oo' | 'ah' | 'oh' | 'ee' | 'mm';
/** What a harmony part sings: the melody's words, or a wordless vowel. */
export type HarmonySound = 'lyrics' | Vowel;
/** How harmonies are voiced: the singer's own (pitch-shifted) voice, or the built-in choir synth. */
export type HarmonySource = 'voice' | 'choir';

export const SOUND_LABEL: Record<HarmonySound, string> = {
  lyrics: 'Lyrics',
  oo: 'Ooh',
  ah: 'Aah',
  oh: 'Oh',
  ee: 'Ee',
  mm: 'Mmm',
};

export interface HarmonyOptions {
  style: HarmonyStyle;
  voices: number; // 1..4 harmony voices
  placement: Placement;
  harmonicRhythm: HarmonicRhythm;
  complexity: number; // 0..1
  seed: number;
}

export type ClefKind = 'treble' | 'treble8' | 'bass';

export interface VoicePart {
  id: string;
  name: string;
  short: string;
  clef: ClefKind;
  notes: ScoreNote[];
  color: string;
  vowel: Vowel; // vowel for the choir synth
  sound: HarmonySound;
}

/** For each melody note index: what each harmony voice sings when that note begins. */
export interface LiveStep {
  pitches: (number | null)[];
  retrigger: boolean[];
}

export interface Arrangement {
  melody: VoicePart;
  harmonies: VoicePart[];
  chords: Chord[];
  key: Key;
  timeSig: TimeSignature;
  bpm: number;
  totalUnits: number;
  live: LiveStep[];
  options: HarmonyOptions;
}

/** Ink colours, one per voice, chosen to read on cream manuscript paper. */
export const VOICE_COLORS = ['#2f5d9e', '#b5761b', '#2b7a6b', '#8c3d73', '#5c6e2c'];
export const MELODY_COLOR = '#c8402a';
