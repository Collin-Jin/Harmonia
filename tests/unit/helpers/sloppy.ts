import { renderSungMelody } from '../../../src/music/vocalRender';
import { sampleToTimed, type SampleMelody } from '../../../src/music/samples';

/**
 * A realistic amateur take: per-note intonation errors, gradual pitch drift,
 * plus breaths, a click, a squeaky pitched blip, mains hum and hiss.
 */
export function sloppyTake(s: SampleMelody, o: { noteErr?: number; drift?: number; seed?: number; junk?: boolean; transpose?: number } = {}) {
  let seed = o.seed ?? 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  const leadIn = 1.3;
  const timed = sampleToTimed(s, { leadIn, jitter: 0.03, seed: 5, transpose: o.transpose });
  const noteErr = o.noteErr ?? 40;
  const errs = timed.map(() => rnd() * 2 * noteErr);
  const { samples, sampleRate: sr } = renderSungMelody(timed, {
    sampleRate: 44100,
    tail: 1.6,
    noteDetuneCents: errs,
    driftCents: o.drift ?? -40,
    noise: 0.004,
    seed: 3,
  });
  const lastEnd = Math.max(...timed.map((n) => n.start + n.dur));
  if (o.junk !== false) {
    const add = (t0: number, dur: number, f: (t: number) => number) => {
      const a = Math.floor(t0 * sr);
      for (let i = 0; i < dur * sr && a + i < samples.length; i++) samples[a + i] += f(i / sr);
    };
    // breath before singing: band-limited noise swell
    let lp = 0;
    add(0.15, 0.4, (t) => {
      lp += 0.25 * ((rnd() * 2) - lp);
      return lp * 0.18 * Math.sin((Math.PI * t) / 0.4);
    });
    // mouth click / mic bump
    add(0.75, 0.004, (t) => 0.6 * Math.exp(-t * 2000) * (rnd() > 0 ? 1 : -1));
    // chair squeak after the take: short pitched blip with harmonics (~1.2 kHz)
    add(lastEnd + 0.45, 0.09, (t) => 0.25 * Math.sin(2 * Math.PI * 1180 * t) * Math.sin((Math.PI * t) / 0.09) + 0.1 * Math.sin(2 * Math.PI * 2360 * t));
    // low hummed "mm" fragment / throat noise: brief unstable pitch
    add(lastEnd + 0.9, 0.07, (t) => 0.2 * Math.sin(2 * Math.PI * (150 + 900 * t) * t) * Math.sin((Math.PI * t) / 0.07));
    // breath after the take
    lp = 0;
    add(lastEnd + 1.1, 0.35, (t) => {
      lp += 0.25 * ((rnd() * 2) - lp);
      return lp * 0.15 * Math.sin((Math.PI * t) / 0.35);
    });
  }
  // mains hum (60 Hz + harmonics) throughout
  for (let i = 0; i < samples.length; i++) {
    const t = i / sr;
    samples[i] += 0.006 * Math.sin(2 * Math.PI * 60 * t) + 0.003 * Math.sin(2 * Math.PI * 180 * t);
  }
  return { samples, sampleRate: sr, timed, errs };
}
