export type Mode = 'major' | 'minor';

export interface Key {
  tonic: number; // pitch class 0-11
  mode: Mode;
  confidence?: number;
}

export interface Spelling {
  step: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
  alter: number;
  octave: number;
}

export const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const STEP_PC = [0, 2, 4, 5, 7, 9, 11];
// Order in which sharps / flats are added to a key signature (as letter indices).
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const freqToMidi = (f: number) => 69 + 12 * Math.log2(f / 440);
export const pc = (m: number) => ((Math.round(m) % 12) + 12) % 12;
export const mod12 = (n: number) => ((n % 12) + 12) % 12;

const MAJOR_FIFTHS: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: -6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };

/** Number of sharps (+) or flats (-) in the key signature. */
export function keyFifths(key: Key): number {
  const relMajor = key.mode === 'major' ? key.tonic : mod12(key.tonic + 3);
  return MAJOR_FIFTHS[relMajor];
}

/** Alteration applied by the key signature to each letter (index 0..6 = C..B). */
export function keySignatureAlters(fifths: number): number[] {
  const alters = [0, 0, 0, 0, 0, 0, 0];
  if (fifths > 0) for (let i = 0; i < fifths; i++) alters[SHARP_ORDER[i]] = 1;
  if (fifths < 0) for (let i = 0; i < -fifths; i++) alters[FLAT_ORDER[i]] = -1;
  return alters;
}

export function scaleOf(key: Key): number[] {
  const base = key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  return base.map((s) => mod12(s + key.tonic));
}

/** Spell a MIDI pitch within a key so that notation reads naturally. */
export function spell(midi: number, key: Key): Spelling {
  const m = Math.round(midi);
  const p = mod12(m);
  const fifths = keyFifths(key);
  const keyAlt = keySignatureAlters(fifths);
  const rel = mod12(p - key.tonic);
  let preferRaise: boolean;
  if (key.mode === 'major') {
    preferRaise = rel === 6 ? true : [1, 3, 8, 10].includes(rel) ? false : fifths >= 0;
  } else {
    preferRaise = [9, 11, 4, 6].includes(rel) ? true : rel === 1 ? false : fifths >= 0;
  }
  let best: { cost: number; letter: number; alt: number } | null = null;
  for (let letter = 0; letter < 7; letter++) {
    let alt = mod12(p - STEP_PC[letter]);
    if (alt > 6) alt -= 12;
    if (Math.abs(alt) > 1) continue;
    const diff = alt - keyAlt[letter];
    let cost = Math.abs(diff) * 10 + (alt !== 0 ? 1 : 0);
    const odd = (letter === 2 || letter === 6) && alt === 1 || (letter === 0 || letter === 3) && alt === -1;
    if (odd && keyAlt[letter] !== alt) cost += 3;
    if (diff > 0 && !preferRaise) cost += 0.5;
    if (diff < 0 && preferRaise) cost += 0.5;
    if (!best || cost < best.cost) best = { cost, letter, alt };
  }
  const { letter, alt } = best!;
  const octave = Math.floor((m - alt) / 12) - 1;
  return { step: STEPS[letter], alter: alt, octave };
}

/** Spell `midi` on a given letter (0 = C … 6 = B); null if that needs more than one accidental. */
export function spellOnLetter(midi: number, letter: number): Spelling | null {
  const m = Math.round(midi);
  const l = mod12(letter) % 7;
  let alt = mod12(m - STEP_PC[l]);
  if (alt > 6) alt -= 12;
  if (Math.abs(alt) > 1) return null;
  return { step: STEPS[l], alter: alt, octave: Math.floor((m - alt) / 12) - 1 };
}

export function spellingToString(s: Spelling, withOctave = true): string {
  const acc = s.alter === 1 ? '♯' : s.alter === -1 ? '♭' : s.alter === 2 ? '𝄪' : s.alter === -2 ? '𝄫' : '';
  return `${s.step}${acc}${withOctave ? s.octave : ''}`;
}

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export function midiName(m: number): string {
  const r = Math.round(m);
  return `${SHARP_NAMES[mod12(r)]}${Math.floor(r / 12) - 1}`;
}

export function pcNameInKey(p: number, key: Key): string {
  return spellingToString(spell(60 + mod12(p), key), false);
}

export function keyName(key: Key): string {
  const name = pcNameInKey(key.tonic, key);
  return `${name} ${key.mode}`;
}

export const ALL_KEYS: Key[] = Array.from({ length: 24 }, (_, i) => ({
  tonic: i % 12,
  mode: i < 12 ? 'major' : 'minor',
}));

/** Snap a (possibly chromatic) midi to the nearest scale tone. */
export function snapToScale(m: number, key: Key): number {
  const scale = scaleOf(key);
  const r = Math.round(m);
  for (let d = 0; d < 7; d++) {
    if (scale.includes(mod12(r - d))) return r - d;
    if (scale.includes(mod12(r + d))) return r + d;
  }
  return r;
}

/** Move `steps` diatonic steps from midi m within key (m snapped to scale first). */
export function diatonicStep(m: number, steps: number, key: Key): number {
  const scale = scaleOf(key).slice().sort((a, b) => a - b);
  let cur = snapToScale(m, key);
  const dir = Math.sign(steps);
  for (let i = 0; i < Math.abs(steps); i++) {
    cur += dir;
    while (!scale.includes(mod12(cur))) cur += dir;
  }
  return cur;
}
