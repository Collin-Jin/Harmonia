import { liveSteps } from './harmony';
import { SOUND_LABEL, type Arrangement, type HarmonySound, type ScoreNote, type VoicePart, type Vowel } from './types';

function plain(n: ScoreNote): ScoreNote {
  const { lyric: _l, melisma: _m, ...rest } = n;
  return rest;
}

/**
 * Harmony singing the melody's words: each harmony note is re-articulated wherever the
 * melody starts a new syllable, and takes that syllable (or continues it on a melisma).
 */
export function sungWords(notes: ScoreNote[], melody: ScoreNote[]): ScoreNote[] {
  const out: ScoreNote[] = [];
  for (const h of notes) {
    const end = h.start + h.dur;
    const onsets = melody.filter((m) => m.lyric?.text && m.start > h.start && m.start < end).map((m) => m.start);
    const cuts = [h.start, ...onsets, end];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const seg: ScoreNote = { ...plain(h), start: cuts[k], dur: cuts[k + 1] - cuts[k] };
      if (k + 1 < cuts.length - 1) delete seg.tieToNext;
      const at = melody.find((m) => m.start === cuts[k]);
      if (at?.lyric?.text) seg.lyric = { ...at.lyric };
      else if (at?.melisma || k > 0 || melody.some((m) => m.start < cuts[k] && m.start + m.dur > cuts[k] && (m.lyric || m.melisma)))
        seg.melisma = true;
      out.push(seg);
    }
  }
  return out;
}

/** A wordless backing sound: the vowel is written at the start of each phrase, then extended. */
export function vowelText(notes: ScoreNote[], sound: Vowel): ScoreNote[] {
  return notes.map((n, i) => {
    const prev = notes[i - 1];
    const phraseStart = !prev || prev.start + prev.dur < n.start;
    const base = plain(n);
    return phraseStart ? { ...base, lyric: { text: SOUND_LABEL[sound] } } : { ...base, melisma: true };
  });
}

/** Give every harmony part its sound (words or vowel) and the matching lyrics. */
export function applySounds(arr: Arrangement, soundOf: (p: VoicePart) => HarmonySound): Arrangement {
  const melody = arr.melody.notes;
  const hasLyrics = melody.some((n) => n.lyric?.text);
  const harmonies = arr.harmonies.map((p) => {
    const sound = soundOf(p);
    const notes = sound === 'lyrics' ? (hasLyrics ? sungWords(p.notes, melody) : p.notes.map(plain)) : vowelText(p.notes, sound);
    const vowel: Vowel = sound === 'lyrics' ? p.vowel : sound;
    return { ...p, sound, vowel, notes };
  });
  return { ...arr, harmonies, live: liveSteps(melody, harmonies, arr.options.style) };
}
