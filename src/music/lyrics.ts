/**
 * Lyrics: cleaning speech-recognition output, telling singing from humming,
 * splitting words into syllables and laying the syllables onto melody notes.
 */

/** A recognised word with its time span in the recording (seconds). */
export interface LyricWord {
  text: string;
  start: number;
  end: number;
  /** The word closes a lyric line (sentence punctuation). */
  phraseEnd: boolean;
}

/** One syllable printed under a note. `hyphen`: the word continues on the next syllable. */
export interface Lyric {
  text: string;
  hyphen?: boolean;
}

export interface AsrChunk {
  text: string;
  timestamp: [number | null, number | null];
}

/** Below this share of energy above 1 kHz the voice is a closed-mouth hum. */
export const HUM_BRIGHTNESS = 0.02;

const INTERJECTION = /^(a+h*|o+h*|o+|u+h*|u+m+|m+|h+m+|m+h+m*|h+m+m*|e+h*|hu+m+|ha+|la+)$/i;
const NON_SPEECH = /[[\]()♪♫*#<>{}]/;

/**
 * Turn word-level recogniser output into lyric words, or [] when the take has no lyrics
 * (humming, wordless vowels, or the recogniser hallucinating over a melody).
 */
export function cleanTranscript(chunks: AsrChunk[], durationSec: number, brightness: number): LyricWord[] {
  if (brightness < HUM_BRIGHTNESS) return [];
  const words: LyricWord[] = [];
  let bad = 0;
  let total = 0;
  for (const c of chunks) {
    const raw = c.text.trim();
    if (!raw) continue;
    if (NON_SPEECH.test(raw)) continue;
    const text = raw.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
    if (!text) continue;
    total++;
    const start = c.timestamp[0] ?? 0;
    const end = c.timestamp[1] ?? start + 0.3;
    // Hallucinated text has impossible timing: past the end of the take or stretched over seconds.
    if (start > durationSec + 0.3 || end - start > 4.5 || end < start) {
      bad++;
      continue;
    }
    words.push({ text, start, end: Math.min(end, durationSec), phraseEnd: /[.!?;]\s*$/.test(raw) });
  }
  if (!words.length || bad / Math.max(1, total) > 0.34) return [];
  if (words.every((w) => INTERJECTION.test(w.text))) return [];
  words[words.length - 1].phraseEnd = true;
  return words;
}

/**
 * Share of the voice's energy above 1 kHz on its loudest frames. Open vowels and
 * consonants put a lot of energy there; a hummed "mmm" almost none.
 */
export function voiceBrightness(x: Float32Array, sampleRate: number): number {
  const hp = highpass(highpass(x, sampleRate, 1000), sampleRate, 1000);
  const frame = Math.round(sampleRate * 0.03);
  const energies: { e: number; h: number }[] = [];
  for (let i = 0; i + frame <= x.length; i += frame) {
    let e = 0;
    let h = 0;
    for (let k = i; k < i + frame; k++) {
      e += x[k] * x[k];
      h += hp[k] * hp[k];
    }
    energies.push({ e, h });
  }
  if (!energies.length) return 0;
  const sorted = energies.map((f) => f.e).sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)] * 0.2;
  let e = 0;
  let h = 0;
  for (const f of energies)
    if (f.e >= loud && f.e > 0) {
      e += f.e;
      h += f.h;
    }
  return e > 0 ? h / e : 0;
}

/** Band-limited resampling (box pre-filter + linear interpolation), e.g. to 16 kHz for speech models. */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x.slice();
  let src = x;
  const taps = Math.floor(from / to);
  if (taps >= 2) {
    src = new Float32Array(x.length);
    let acc = 0;
    for (let i = 0; i < x.length; i++) {
      acc += x[i];
      if (i >= taps) acc -= x[i - taps];
      src[Math.max(0, i - (taps >> 1))] = acc / taps;
    }
  }
  const ratio = from / to;
  const out = new Float32Array(Math.floor(x.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const p = i * ratio;
    const k = Math.floor(p);
    const a = src[k];
    const b = src[Math.min(src.length - 1, k + 1)];
    out[i] = a + (b - a) * (p - k);
  }
  return out;
}

function highpass(x: Float32Array, sr: number, fc: number): Float32Array {
  const w = (2 * Math.PI * fc) / sr;
  const alpha = Math.sin(w) / Math.SQRT2;
  const cw = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (1 + cw) / 2 / a0;
  const b1 = -(1 + cw) / a0;
  const a1 = (-2 * cw) / a0;
  const a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

const ONSETS = new Set([
  'b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'q', 'r', 's', 't', 'v', 'w', 'x', 'z',
  'bl', 'br', 'ch', 'cl', 'cr', 'dr', 'dw', 'fl', 'fr', 'gl', 'gr', 'kn', 'ph', 'pl', 'pr', 'qu', 'sc', 'sh',
  'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'th', 'tr', 'tw', 'wh', 'wr',
  'chr', 'sch', 'scr', 'shr', 'spl', 'spr', 'squ', 'str', 'thr',
]);
const DIGRAPHS = new Set(['ch', 'ph', 'sh', 'th', 'wh', 'qu']);

/** Split an English word into sung syllables ("twinkle" → twin·kle, "wonder" → won·der). */
export function syllabify(word: string): string[] {
  const w = word.toLowerCase();
  const letters = w.replace(/[^a-z]/g, '');
  if (letters.length <= 3) return [word];
  const isVowel = (i: number) => {
    const c = w[i];
    if ('aeiou'.includes(c)) return !(c === 'u' && w[i - 1] === 'q');
    return c === 'y' && i > 0 && !'aeiou'.includes(w[i - 1]);
  };
  const groups: [number, number][] = [];
  for (let i = 0; i < w.length; i++) {
    if (!isVowel(i)) continue;
    if (groups.length && groups[groups.length - 1][1] === i) groups[groups.length - 1][1] = i + 1;
    else groups.push([i, i + 1]);
  }
  if (groups.length <= 1) return [word];
  const last = groups[groups.length - 1];
  const tail = w.slice(last[0]);
  const before = w[last[0] - 1] ?? '';
  const cons = (c: string) => !!c && /[a-z]/.test(c) && !'aeiouy'.includes(c);
  // silent endings: final -e (but consonant + "le" is its own syllable), -es, -ed
  const silentE = tail === 'e' && !(before === 'l' && cons(w[last[0] - 2]) && w[last[0] - 2] !== 'l');
  const silentEs = tail === 'es' && !/(s|x|z|ch|sh|ce|ge)$/.test(w.slice(0, last[0]) + 'e');
  const silentEd = tail === 'ed' && !/[td]$/.test(w.slice(0, last[0]));
  if (silentE || silentEs || silentEd) groups.pop();
  if (groups.length <= 1) return [word];
  const cuts: number[] = [];
  for (let g = 0; g + 1 < groups.length; g++) {
    const a = groups[g][1];
    const b = groups[g + 1][0];
    const c = w.slice(a, b);
    if (c.length === 0) continue;
    // "-ing" is its own syllable and the stem keeps its consonants (mak·ing, walk·ing, but run·ning)
    if (g + 1 === groups.length - 1 && w.slice(b) === 'ing' && !(c.length === 2 && c[0] === c[1])) {
      cuts.push(b);
      continue;
    }
    if (c.length === 1) {
      cuts.push(c === 'x' ? b : a);
      continue;
    }
    if (c.startsWith('ng') || c.startsWith('ck')) {
      cuts.push(a + 2);
      continue;
    }
    if (DIGRAPHS.has(c)) {
      cuts.push(a);
      continue;
    }
    // consonant + "le" ending: the consonant starts the last syllable (lit·tle, ta·ble)
    if (g + 1 === groups.length - 1 && w.slice(b) === 'e' && c.endsWith('l')) {
      cuts.push(b - 2);
      continue;
    }
    let cut = b - 1;
    for (let k = 1; k < c.length; k++) if (ONSETS.has(c.slice(k))) {
      cut = a + k;
      break;
    }
    cuts.push(cut);
  }
  const out: string[] = [];
  let p = 0;
  for (const c of cuts) {
    if (c <= p || c >= word.length) continue;
    out.push(word.slice(p, c));
    p = c;
  }
  out.push(word.slice(p));
  return out;
}

export interface NoteLyric {
  lyric?: Lyric;
  /** The note continues the previous syllable (no new text). */
  melisma?: boolean;
}

export interface LyricAlignment {
  perNote: NoteLyric[];
  /** Melody note indices that close a lyric line. */
  phraseEnds: number[];
}

interface Syl {
  text: string;
  hyphen: boolean;
  t: number;
  phraseEnd: boolean;
  wordEnd: number;
}

/**
 * Lay the syllables onto the notes, monotonically. Each note takes the next syllable,
 * continues the previous one (melisma), takes two syllables at once, or carries none;
 * recogniser words with no note can be dropped. Timestamps from the recogniser are
 * only a soft guide: they are often a few hundred milliseconds late.
 */
export function alignLyrics(words: LyricWord[], notes: { time: number; end: number; midi: number }[]): LyricAlignment {
  const N = notes.length;
  const empty: LyricAlignment = { perNote: notes.map(() => ({})), phraseEnds: [] };
  if (!N || !words.length) return empty;
  const syl: Syl[] = [];
  for (const wd of words) {
    const parts = syllabify(wd.text);
    const weight = parts.map((p) => Math.max(1, p.replace(/[^aeiouy]/gi, '').length));
    const sum = weight.reduce((a, b) => a + b, 0);
    let acc = 0;
    parts.forEach((p, k) => {
      syl.push({
        text: p,
        hyphen: k < parts.length - 1,
        t: wd.start + ((wd.end - wd.start) * acc) / sum,
        phraseEnd: wd.phraseEnd && k === parts.length - 1,
        wordEnd: wd.end,
      });
      acc += weight[k];
    });
  }
  const S = syl.length;
  const first = syl[0].t;
  const lastEnd = syl[S - 1].wordEnd;
  const timeCost = (i: number, j: number) => 0.6 * Math.min(2, Math.abs(syl[i].t - notes[j].time));
  const melismaCost = (j: number) => 1.3 + (notes[j].midi === notes[j - 1].midi ? 1.2 : 0);
  const noneCost = (i: number, j: number) =>
    (i === 0 && notes[j].end < first - 0.1) || (i === S && notes[j].time > lastEnd + 0.4) ? 0.4 : 2.0;
  const SKIP = 2.2;
  const MERGE = 2.5;
  // dp over (syllables used i, notes done j, previous note carries text f)
  const INF = 1e18;
  const idx = (i: number, j: number, f: number) => (i * (N + 1) + j) * 2 + f;
  const cost = new Float64Array((S + 1) * (N + 1) * 2).fill(INF);
  const back = new Int32Array(cost.length).fill(-1);
  const op = new Int8Array(cost.length);
  cost[idx(0, 0, 0)] = 0;
  const relax = (from: number, to: number, c: number, o: number) => {
    if (c < cost[to]) {
      cost[to] = c;
      back[to] = from;
      op[to] = o;
    }
  };
  for (let i = 0; i <= S; i++)
    for (let j = 0; j <= N; j++)
      for (let f = 0; f < 2; f++) {
        const k = idx(i, j, f);
        const c = cost[k];
        if (c >= INF) continue;
        if (i < S) relax(k, idx(i + 1, j, f), c + SKIP, 0);
        if (j === N) continue;
        if (i < S) relax(k, idx(i + 1, j + 1, 1), c + timeCost(i, j), 1);
        if (i + 1 < S) relax(k, idx(i + 2, j + 1, 1), c + MERGE + timeCost(i, j), 2);
        if (f === 1 && i > 0 && j > 0 && notes[j].time - notes[j - 1].end < 0.3) relax(k, idx(i, j + 1, 1), c + melismaCost(j), 3);
        relax(k, idx(i, j + 1, 0), c + noneCost(i, j), 4);
      }
  let k = cost[idx(S, N, 0)] <= cost[idx(S, N, 1)] ? idx(S, N, 0) : idx(S, N, 1);
  if (cost[k] >= INF) return empty;
  const perNote: NoteLyric[] = notes.map(() => ({}));
  const sylEnds: number[] = [];
  while (back[k] >= 0) {
    const from = back[k];
    const j = Math.floor(from / 2) % (N + 1);
    const i = Math.floor(from / 2 / (N + 1));
    switch (op[k]) {
      case 1:
        perNote[j].lyric = { text: syl[i].text, hyphen: syl[i].hyphen };
        if (syl[i].phraseEnd) sylEnds.push(j);
        break;
      case 2:
        perNote[j].lyric = {
          text: syl[i].hyphen ? syl[i].text + syl[i + 1].text : `${syl[i].text} ${syl[i + 1].text}`,
          hyphen: syl[i + 1].hyphen,
        };
        if (syl[i].phraseEnd || syl[i + 1].phraseEnd) sylEnds.push(j);
        break;
      case 3:
        perNote[j].melisma = true;
        break;
    }
    k = from;
  }
  // a line ends on the last note of its final syllable (including any melisma)
  const phraseEnds = sylEnds.map((j) => {
    let e = j;
    while (e + 1 < N && perNote[e + 1].melisma) e++;
    return e;
  });
  return { perNote, phraseEnds: phraseEnds.sort((a, b) => a - b) };
}

/** Plain-text lyrics for display ("Twin-kle twin-kle lit-tle star"). */
export function lyricsText(lyrics: (Lyric | undefined)[]): string {
  let s = '';
  for (const l of lyrics) {
    if (!l?.text) continue;
    s += l.text + (l.hyphen ? '-' : ' ');
  }
  return s.trim();
}
