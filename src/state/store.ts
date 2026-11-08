import { create } from 'zustand';
import { harmonize, liveSteps } from '../music/harmony';
import { fitPitchesToKey, transcribeFromRaw } from '../music/transcribe';
import { alignLyrics, type Lyric, type LyricWord } from '../music/lyrics';
import { applySounds } from '../music/partLyrics';
import type { AutotuneMode } from '../music/autotune';
import type { Key } from '../music/theory';
import type {
  Arrangement,
  Chord,
  HarmonyOptions,
  HarmonySound,
  HarmonySource,
  MelodyNote,
  PitchFrame,
  TimeSignature,
  Transcription,
} from '../music/types';
import type { MelodySource, MixState, RecordingAudio } from '../audio/player';

/** review: the user checks the notes heard before harmonizing (after their own takes). */
export type Phase = 'empty' | 'recording' | 'analyzing' | 'review' | 'ready';

export interface LiveSettings {
  allowTranspose: boolean;
  followIntonation: boolean;
  followDynamics: boolean;
  echoCancellation: boolean;
}

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

export type LyricsStatus = 'off' | 'listening' | 'downloading' | 'done' | 'none' | 'error';

export interface LyricsState {
  status: LyricsStatus;
  /** Model download progress 0..1 while `downloading`. */
  progress: number;
  words: LyricWord[];
  /** The take was hummed (closed mouth): never shows lyrics. */
  hummed: boolean;
  error?: string;
}

/** A user change to one harmony note (pitch and/or syllable). */
export interface HarmonyEdit {
  midi?: number;
  lyric?: Lyric | null;
}

/** One arrangement variation: the seeds behind its chords and its voicing. */
export interface Variation {
  seed: number;
  chordSeed: number;
}

/** The note the user has selected in the score for editing. */
export interface Selection {
  partId: string;
  index: number;
}

interface State {
  phase: Phase;
  title: string;
  // capture settings
  metronome: boolean;
  metronomeBpm: number;
  timeSig: TimeSignature;
  detectLyrics: boolean;
  // data
  recording: RecordingAudio | null;
  /** Autotuned + cleaned voice used for playback/export (null while processing or when absent). */
  voice: RecordingAudio | null;
  voiceBusy: boolean;
  autotune: AutotuneMode;
  frames: PitchFrame[];
  /** The transcription as analysed; `transcription` is it plus the user's pitch edits. */
  baseTranscription: Transcription | null;
  transcription: Transcription | null;
  lyrics: LyricsState;
  /** Melody syllables typed by the user, by performed onset (ms). null = no syllable. */
  lyricEdits: Record<string, Lyric | null>;
  /** Melody pitches changed by the user, by performed onset (ms). */
  pitchEdits: Record<string, number>;
  /** Melody notes the user removed (a breath or noise heard as a note), by performed onset (ms). */
  deletedNotes: Record<string, true>;
  harmonyEdits: Record<string, HarmonyEdit>;
  /** Chords the user picked, each pinned to its span; they survive style and chord-rate changes. */
  chordEdits: Chord[];
  /** The edits the rest of the progression was last re-fitted around (null: not re-fitted). */
  chordRefit: Chord[] | null;
  harmony: HarmonyOptions;
  /** Arrangements visited with New chords / New voicing, so the user can step back and forth. */
  variations: Variation[];
  variationIndex: number;
  harmonySound: HarmonySound;
  soundPrefs: Record<string, HarmonySound>;
  harmonySource: HarmonySource;
  /** Harmony parts rendered in the singer's voice (null while rendering or in choir mode). */
  voiceParts: Record<string, RecordingAudio> | null;
  voicePartsBusy: boolean;
  arrangement: Arrangement | null;
  selection: Selection | null;
  // playback / mix
  mix: MixState;
  melodySource: MelodySource;
  playing: boolean;
  liveActive: boolean;
  live: LiveSettings;
  toasts: Toast[];
  view: 'score' | 'roll';

  set: (p: Partial<State>) => void;
  setHarmony: (p: Partial<HarmonyOptions>) => void;
  /** Compose a different progression (chords) or a different set of lines over the same chords (voicing). */
  newVariation: (kind: 'chords' | 'voicing') => void;
  stepVariation: (dir: -1 | 1) => void;
  /** A new take is in; `review` opens "Check your notes" before showing the arrangement. */
  setAnalysis: (r: { recording: RecordingAudio; frames: PitchFrame[]; transcription: Transcription; title?: string; review?: boolean }) => void;
  setLyrics: (p: Partial<LyricsState>) => void;
  retranscribe: (p: { bpm?: number; timeSig?: TimeSignature; key?: Key }) => void;
  setPartMix: (id: string, p: Partial<MixState[string]>) => void;
  setHarmonySound: (sound: HarmonySound) => void;
  setPartSound: (id: string, sound: HarmonySound | null) => void;
  editNotePitch: (partId: string, index: number, midi: number) => void;
  editNoteLyric: (partId: string, index: number, text: string) => void;
  deleteNote: (index: number) => void;
  /** Bring back a removed melody note, by its key (noteKey). */
  restoreNote: (key: string) => void;
  /** Undo every pitch change and removal on the melody. */
  resetNotes: () => void;
  openReview: () => void;
  finishReview: () => void;
  /** Use `chord` for its span, replacing any edit it overlaps. */
  editChord: (chord: Chord) => void;
  /** Drop the user's chord at `start` and go back to the automatic choice. */
  revertChord: (start: number) => void;
  /** Re-choose every chord the user didn't pick so it fits around the ones they did. */
  refitChords: () => void;
  resetChords: () => void;
  resetEdits: () => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  reset: () => void;
}

const defaultHarmony: HarmonyOptions = {
  style: 'pop',
  voices: 2,
  placement: 'around',
  harmonicRhythm: 'auto',
  complexity: 0.35,
  seed: 0,
  chordSeed: 0,
};

const randomSeed = () => 1 + Math.floor(Math.random() * 1e6);

/** Share of harmony notes that differ between two arrangements of the same melody (0..1). */
function voicingDistance(a: Arrangement, b: Arrangement): number {
  let diff = 0;
  let total = 0;
  a.live.forEach((st, i) =>
    st.pitches.forEach((p, v) => {
      total++;
      if (p !== b.live[i]?.pitches[v]) diff++;
    }),
  );
  return total ? diff / total : 0;
}

/** How many beats of the song sit under a different chord in `b` than in `a`. */
function chordDistance(a: Arrangement, b: Arrangement): number {
  const at = (arr: Arrangement, u: number) => [...arr.chords].reverse().find((c) => c.start <= u)?.symbol;
  let diff = 0;
  for (let u = 0; u < a.totalUnits; u += 4) if (at(a, u) !== at(b, u)) diff++;
  return diff;
}

const noLyrics: LyricsState = { status: 'off', progress: 0, words: [], hummed: false };

/** Stable key for a performed melody note. */
export const noteKey = (n: { time: number }) => String(Math.round(n.time * 1000));

/** Harmony edits belong to one particular arrangement (style, voices, …). */
export function harmonySignature(h: HarmonyOptions): string {
  return [h.style, h.voices, h.placement, h.harmonicRhythm, h.complexity.toFixed(2), h.seed, h.chordSeed ?? ''].join(':');
}

/** "twin-" → begins a word that continues; "" → no syllable. */
export function parseLyric(text: string): Lyric | null {
  const t = text.trim();
  if (!t) return null;
  const hyphen = /-$/.test(t);
  const core = t.replace(/^-+|-+$/g, '').trim();
  return core ? { text: core, hyphen } : null;
}

type Inputs = Pick<
  State,
  'transcription' | 'harmony' | 'lyrics' | 'lyricEdits' | 'harmonySound' | 'soundPrefs' | 'harmonyEdits' | 'chordEdits' | 'chordRefit'
>;

/** Melody notes with their syllables (recognised, then the user's corrections). */
export function melodyWithLyrics(tr: Transcription, lyrics: LyricsState, edits: Record<string, Lyric | null>) {
  const align = lyrics.hummed ? null : alignLyrics(lyrics.words, tr.notes);
  const notes: MelodyNote[] = tr.notes.map((n, i) => {
    const out: MelodyNote = { ...n };
    delete out.lyric;
    delete out.melisma;
    const a = align?.perNote[i];
    if (a?.lyric) out.lyric = a.lyric;
    if (a?.melisma) out.melisma = true;
    const e = edits[noteKey(n)];
    if (e !== undefined) {
      delete out.melisma;
      if (e) out.lyric = e;
      else delete out.lyric;
    }
    return out;
  });
  return { notes, phraseEnds: align?.phraseEnds ?? [] };
}

function buildArrangement(s: Inputs): Arrangement | null {
  const tr = s.transcription;
  if (!tr || !tr.notes.length) return null;
  const { notes, phraseEnds } = melodyWithLyrics(tr, s.lyrics, s.lyricEdits);
  const raw = harmonize(
    {
      melody: notes,
      key: tr.key,
      timeSig: tr.timeSig,
      bpm: tr.bpm,
      totalUnits: tr.totalUnits,
      phraseHints: phraseEnds,
      chordEdits: s.chordEdits,
      refitLocks: s.chordRefit ?? undefined,
    },
    s.harmony,
  );
  const arr = applySounds(raw, (p) => s.soundPrefs[p.id] ?? s.harmonySound);
  const sig = harmonySignature(s.harmony);
  let touched = false;
  const harmonies = arr.harmonies.map((p) => ({
    ...p,
    notes: p.notes.map((n) => {
      const e = s.harmonyEdits[`${sig}|${p.id}|${n.start}`];
      if (!e) return n;
      touched = true;
      const out = { ...n };
      if (e.midi !== undefined) (out.midi = e.midi), (out.edited = true);
      if (e.lyric !== undefined) {
        delete out.melisma;
        if (e.lyric) out.lyric = e.lyric;
        else delete out.lyric;
      }
      return out;
    }),
  }));
  return touched ? { ...arr, harmonies, live: liveSteps(arr.melody.notes, harmonies, arr.options.style) } : arr;
}

/** The transcription as the user corrected it: their pitches, without the notes they removed. */
function applyNoteEdits(tr: Transcription, edits: Record<string, number>, deleted: Record<string, true>): Transcription {
  if (!Object.keys(edits).length && !Object.keys(deleted).length) return tr;
  return {
    ...tr,
    notes: tr.notes
      .filter((n) => !deleted[noteKey(n)])
      .map((n) => {
        const m = edits[noteKey(n)];
        return m === undefined ? n : { ...n, midi: m, edited: true };
      }),
  };
}

function syncMix(mix: MixState, arr: Arrangement | null): MixState {
  if (!arr) return mix;
  const next: MixState = { melody: mix.melody ?? { gain: 0.85, mute: false, solo: false } };
  arr.harmonies.forEach((h) => (next[h.id] = mix[h.id] ?? { gain: 0.8, mute: false, solo: false }));
  return next;
}

let toastId = 0;

export const useStore = create<State>((set, get) => {
  /** Rebuild the arrangement from the current inputs plus `patch`. */
  const rebuild = (patch: Partial<State>) => {
    const next = { ...get(), ...patch };
    const arrangement = buildArrangement(next);
    set({ ...patch, arrangement, mix: syncMix(next.mix, arrangement) } as Partial<State>);
  };

  return {
    phase: 'empty',
    title: 'My Melody',
    metronome: false,
    metronomeBpm: 96,
    timeSig: { beats: 4, beatType: 4 },
    detectLyrics: true,
    recording: null,
    voice: null,
    voiceBusy: false,
    autotune: 'natural',
    frames: [],
    baseTranscription: null,
    transcription: null,
    lyrics: noLyrics,
    lyricEdits: {},
    pitchEdits: {},
    deletedNotes: {},
    harmonyEdits: {},
    chordEdits: [],
    chordRefit: null,
    harmony: defaultHarmony,
    variations: [{ seed: 0, chordSeed: 0 }],
    variationIndex: 0,
    harmonySound: 'lyrics',
    soundPrefs: {},
    harmonySource: 'voice',
    voiceParts: null,
    voicePartsBusy: false,
    arrangement: null,
    selection: null,
    mix: { melody: { gain: 0.85, mute: false, solo: false } },
    melodySource: 'recording',
    playing: false,
    liveActive: false,
    live: { allowTranspose: true, followIntonation: true, followDynamics: true, echoCancellation: false },
    toasts: [],
    view: 'score',

    set: (p) => set(p as any),

    setHarmony: (p) => rebuild({ harmony: { ...get().harmony, ...p }, selection: null }),

    newVariation: (kind) => {
      const s = get();
      const cur = s.arrangement;
      if (!cur) return;
      // Seeds are cheap to try: keep the first that sounds clearly different, else the most different.
      let best: { h: HarmonyOptions; d: number } | null = null;
      for (let k = 0; k < 12; k++) {
        const h = kind === 'chords' ? { ...s.harmony, chordSeed: randomSeed() } : { ...s.harmony, seed: randomSeed() };
        const arr = buildArrangement({ ...s, harmony: h });
        if (!arr) return;
        const d = kind === 'chords' ? chordDistance(cur, arr) : voicingDistance(cur, arr);
        if (!best || d > best.d) best = { h, d };
        if (kind === 'chords' ? d >= 2 : d >= 0.15) break;
      }
      if (!best || best.d === 0) {
        get().toast(kind === 'chords' ? 'Every chord is one you picked, so there is nothing left to vary.' : 'No other voicing fits these settings.');
        return;
      }
      const v: Variation = { seed: best.h.seed, chordSeed: best.h.chordSeed ?? 0 };
      const variations = [...s.variations.slice(0, s.variationIndex + 1), v].slice(-20);
      rebuild({ harmony: best.h, variations, variationIndex: variations.length - 1, selection: null });
    },

    stepVariation: (dir) => {
      const s = get();
      const i = s.variationIndex + dir;
      const v = s.variations[i];
      if (!v) return;
      rebuild({ harmony: { ...s.harmony, ...v }, variationIndex: i, selection: null });
    },

    setAnalysis: ({ recording, frames, transcription, title, review }) => {
      rebuild({
        recording,
        voice: null,
        voiceParts: null,
        frames,
        baseTranscription: transcription,
        transcription,
        lyrics: { ...noLyrics, status: get().detectLyrics ? 'listening' : 'off' },
        lyricEdits: {},
        pitchEdits: {},
        deletedNotes: {},
        harmonyEdits: {},
        chordEdits: [],
        chordRefit: null,
        selection: null,
        phase: review ? 'review' : 'ready',
        title: title ?? get().title,
        timeSig: transcription.timeSig,
      });
    },

    setLyrics: (p) => {
      const lyrics = { ...get().lyrics, ...p };
      if (p.words !== undefined || p.hummed !== undefined) rebuild({ lyrics });
      else set({ lyrics });
    },

    retranscribe: ({ bpm, timeSig, key }) => {
      const tr = get().baseTranscription;
      if (!tr) return;
      const ts = timeSig ?? tr.timeSig;
      let next: Transcription;
      if (bpm === undefined && !timeSig && key) {
        // Same rhythm; re-read borderline (out-of-tune) notes against the chosen key.
        const raw = fitPitchesToKey(tr.rawNotes, key);
        next = { ...tr, key, rawNotes: raw, notes: tr.notes.map((n, i) => ({ ...n, midi: raw[i]?.midi ?? n.midi, cents: raw[i]?.cents ?? n.cents })) };
      } else {
        next = transcribeFromRaw(tr.rawNotes, tr.tuningCents, {
          timeSig: ts,
          bpm: bpm ?? (tr.tempoSource === 'estimated' && !timeSig ? undefined : tr.bpm),
          key: key ?? tr.key,
        });
        if (bpm !== undefined) next.tempoSource = 'manual';
      }
      // New tempo, metre or key re-grids the song, so pinned chords no longer line up with it.
      rebuild({ baseTranscription: next, transcription: applyNoteEdits(next, get().pitchEdits, get().deletedNotes), timeSig: ts, selection: null, chordEdits: [], chordRefit: null });
    },

    setPartMix: (id, p) => {
      const mix = { ...get().mix, [id]: { ...(get().mix[id] ?? { gain: 0.8, mute: false, solo: false }), ...p } };
      set({ mix });
    },

    setHarmonySound: (sound) => rebuild({ harmonySound: sound, soundPrefs: {} }),

    setPartSound: (id, sound) => {
      const soundPrefs = { ...get().soundPrefs };
      if (sound === null) delete soundPrefs[id];
      else soundPrefs[id] = sound;
      rebuild({ soundPrefs });
    },

    editNotePitch: (partId, index, midi) => {
      const s = get();
      const m = Math.max(24, Math.min(96, Math.round(midi)));
      if (partId === 'melody') {
        const base = s.baseTranscription;
        const n = s.transcription?.notes[index];
        if (!base || !n) return;
        const pitchEdits = { ...s.pitchEdits, [noteKey(n)]: m };
        rebuild({ pitchEdits, transcription: applyNoteEdits(base, pitchEdits, s.deletedNotes) });
        return;
      }
      const part = s.arrangement?.harmonies.find((p) => p.id === partId);
      const n = part?.notes[index];
      if (!n) return;
      const key = `${harmonySignature(s.harmony)}|${partId}|${n.start}`;
      rebuild({ harmonyEdits: { ...s.harmonyEdits, [key]: { ...s.harmonyEdits[key], midi: m } } });
    },

    editNoteLyric: (partId, index, text) => {
      const s = get();
      const lyric = parseLyric(text);
      if (partId === 'melody') {
        const n = s.transcription?.notes[index];
        if (!n) return;
        rebuild({ lyricEdits: { ...s.lyricEdits, [noteKey(n)]: lyric } });
        return;
      }
      const part = s.arrangement?.harmonies.find((p) => p.id === partId);
      const n = part?.notes[index];
      if (!n) return;
      const key = `${harmonySignature(s.harmony)}|${partId}|${n.start}`;
      rebuild({ harmonyEdits: { ...s.harmonyEdits, [key]: { ...s.harmonyEdits[key], lyric } } });
    },

    editChord: (chord) => {
      const end = chord.start + chord.dur;
      const { edited: _, ...c } = chord;
      const chordEdits = [...get().chordEdits.filter((e) => e.start + e.dur <= chord.start || e.start >= end), c].sort((a, b) => a.start - b.start);
      rebuild({ chordEdits, selection: null });
    },

    revertChord: (start) => {
      const s = get();
      const refit = s.chordRefit?.filter((e) => e.start !== start) ?? null;
      rebuild({ chordEdits: s.chordEdits.filter((e) => e.start !== start), chordRefit: refit?.length ? refit : null, selection: null });
    },

    refitChords: () => rebuild({ chordRefit: get().chordEdits.length ? [...get().chordEdits] : null, selection: null }),

    resetChords: () => rebuild({ chordEdits: [], chordRefit: null, selection: null }),

    deleteNote: (index) => {
      const s = get();
      const base = s.baseTranscription;
      const n = s.transcription?.notes[index];
      // a melody needs at least two notes to harmonize
      if (!base || !n || s.transcription!.notes.length <= 2) return;
      const deletedNotes = { ...s.deletedNotes, [noteKey(n)]: true as const };
      rebuild({ deletedNotes, transcription: applyNoteEdits(base, s.pitchEdits, deletedNotes), selection: null });
    },

    restoreNote: (key) => {
      const s = get();
      const base = s.baseTranscription;
      if (!base || !s.deletedNotes[key]) return;
      const { [key]: _, ...deletedNotes } = s.deletedNotes;
      rebuild({ deletedNotes, transcription: applyNoteEdits(base, s.pitchEdits, deletedNotes), selection: null });
    },

    resetNotes: () => {
      const base = get().baseTranscription;
      if (!base) return;
      rebuild({ pitchEdits: {}, deletedNotes: {}, transcription: base, selection: null });
    },

    openReview: () => {
      if (get().transcription) set({ phase: 'review', selection: null, playing: false });
    },

    finishReview: () => {
      if (get().phase === 'review') set({ phase: 'ready' });
    },

    resetEdits: () => {
      const base = get().baseTranscription;
      if (!base) return;
      rebuild({ pitchEdits: {}, deletedNotes: {}, lyricEdits: {}, harmonyEdits: {}, transcription: base, selection: null });
    },

    toast: (text, kind = 'info') => {
      const t = { id: ++toastId, kind, text };
      set({ toasts: [...get().toasts, t] });
      setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== t.id) }), kind === 'error' ? 7000 : 3500);
    },

    reset: () =>
      set({
        phase: 'empty',
        recording: null,
        voice: null,
        voiceParts: null,
        frames: [],
        baseTranscription: null,
        transcription: null,
        arrangement: null,
        lyrics: noLyrics,
        selection: null,
        playing: false,
        liveActive: false,
      }),
  };
});

if (typeof window !== 'undefined') (window as any).__harmonia = { store: useStore };
