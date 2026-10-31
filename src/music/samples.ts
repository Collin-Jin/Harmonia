// Sample melodies (public domain). Kept dependency-free so Node scripts can import it directly.

export interface SampleMelody {
  id: string;
  title: string;
  composer: string;
  bpm: number;
  beatsPerBar: number;
  keyLabel: string;
  /** [midi, beats] pairs; midi 0 = rest */
  notes: [number, number][];
  lyric: string;
  /** Sung syllables, one per note ("twin-" continues the word). */
  syllables?: string[];
}

export const ODE_TO_JOY: SampleMelody = {
  id: 'ode-to-joy',
  title: 'Ode to Joy',
  composer: 'L. van Beethoven',
  bpm: 100,
  beatsPerBar: 4,
  keyLabel: 'C major',
  lyric: 'E E F G | G F E D | C C D E | E. D D — (×2, ending D. C C)',
  notes: [
    [64, 1], [64, 1], [65, 1], [67, 1],
    [67, 1], [65, 1], [64, 1], [62, 1],
    [60, 1], [60, 1], [62, 1], [64, 1],
    [64, 1.5], [62, 0.5], [62, 2],
    [64, 1], [64, 1], [65, 1], [67, 1],
    [67, 1], [65, 1], [64, 1], [62, 1],
    [60, 1], [60, 1], [62, 1], [64, 1],
    [62, 1.5], [60, 0.5], [60, 2],
  ],
};

export const AMAZING_GRACE: SampleMelody = {
  id: 'amazing-grace',
  title: 'Amazing Grace',
  composer: 'Traditional',
  bpm: 84,
  beatsPerBar: 3,
  keyLabel: 'G major',
  lyric: 'A-ma-zing grace, how sweet the sound…',
  notes: [
    [62, 1],
    [67, 2], [71, 0.5], [67, 0.5],
    [71, 2], [69, 1],
    [67, 2], [64, 1],
    [62, 2], [62, 1],
    [67, 2], [71, 0.5], [67, 0.5],
    [71, 2], [69, 1],
    [74, 3],
    [74, 2], [71, 0.5], [74, 0.5],
    [71, 2], [67, 1],
    [64, 2], [62, 1],
    [67, 2], [71, 0.5], [67, 0.5],
    [71, 2], [69, 1],
    [67, 2],
  ],
};

export const TWINKLE: SampleMelody = {
  id: 'twinkle-lyrics',
  title: 'Twinkle, Twinkle (sung)',
  composer: 'Traditional',
  bpm: 92,
  beatsPerBar: 4,
  keyLabel: 'C major',
  lyric: 'Twin-kle twin-kle lit-tle star, how I won-der what you are',
  syllables: ['Twin-', 'kle', 'twin-', 'kle', 'lit-', 'tle', 'star,', 'how', 'I', 'won-', 'der', 'what', 'you', 'are.'],
  notes: [
    [60, 1], [60, 1], [67, 1], [67, 1],
    [69, 1], [69, 1], [67, 2],
    [65, 1], [65, 1], [64, 1], [64, 1],
    [62, 1], [62, 1], [60, 2],
  ],
};

export const SAMPLES: SampleMelody[] = [TWINKLE, ODE_TO_JOY, AMAZING_GRACE];

export interface TimedNote {
  midi: number;
  start: number; // seconds
  dur: number; // seconds
}

/** Lay out a sample melody in seconds with optional tempo scaling, transposition and timing jitter. */
export function sampleToTimed(
  s: SampleMelody,
  opts: { leadIn?: number; tempoScale?: number; transpose?: number; jitter?: number; seed?: number } = {},
): TimedNote[] {
  const beat = 60 / s.bpm / (opts.tempoScale ?? 1);
  let t = opts.leadIn ?? 0;
  let seed = opts.seed ?? 1;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  const out: TimedNote[] = [];
  for (const [m, b] of s.notes) {
    const d = b * beat;
    if (m > 0) out.push({ midi: m + (opts.transpose ?? 0), start: t + (opts.jitter ? rnd() * opts.jitter : 0), dur: d });
    t += d;
  }
  return out;
}
