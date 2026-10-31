// Builds test material for lyric detection:
//   twinkle-lyrics.wav — "Twinkle twinkle little star, how I wonder what you are" sung on the melody
//                        (macOS speech per word, PSOLA time-stretched and tuned onto the notes, with vibrato)
//   ode-hummed.wav     — Ode to Joy hummed with a closed mouth ("mmm"): must produce no lyrics
// Usage: npx tsx scripts/generate-lyrics-fixture.ts   (macOS only: uses `say`)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { trackPitch } from '../src/music/transcribe';
import { encodeWav, renderSungMelody } from '../src/music/vocalRender';
import { ODE_TO_JOY, sampleToTimed } from '../src/music/samples';

const root = join(import.meta.dirname, '..');
const tmp = join(root, 'tests', 'fixtures', '.tmp');
mkdirSync(tmp, { recursive: true });
const SR = 48000;

function readWav(path: string): Float32Array {
  const b = readFileSync(path);
  let o = 12;
  let data: Buffer | null = null;
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'data') data = b.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size % 2);
  }
  if (!data) throw new Error('no data chunk');
  const out = new Float32Array(data.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = data.readInt16LE(i * 2) / 32768;
  return out;
}

function speak(word: string): Float32Array {
  const f = join(tmp, 'w.wav');
  execFileSync('say', ['-v', 'Samantha', '-r', '150', '-o', f, '--file-format=WAVE', `--data-format=LEI16@${SR}`, word]);
  const x = readWav(f);
  // trim silence
  let a = 0;
  let b = x.length - 1;
  while (a < b && Math.abs(x[a]) < 0.01) a++;
  while (b > a && Math.abs(x[b]) < 0.01) b--;
  return x.slice(Math.max(0, a - 200), Math.min(x.length, b + 400));
}

/**
 * TD-PSOLA: stretch the voiced part of a spoken word to `dur` seconds and put it
 * on the target pitch curve (consonants keep their natural speed).
 */
function singWord(x: Float32Array, dur: number, noteStarts: number[], pitchAt: (t: number) => number): Float32Array {
  const frames = trackPitch(x, SR);
  const hop = frames.length > 1 ? frames[1].t - frames[0].t : 0.008;
  const voicedAt = (t: number) => {
    const f = frames[Math.min(frames.length - 1, Math.max(0, Math.round((t - frames[0].t) / hop)))];
    return f && f.midi !== null && f.clarity > 0.75 && f.rms > 0.01 ? f.midi : null;
  };
  const len = x.length / SR;
  // voiced runs; the n longest (one per note, in time order) are the sung vowels
  const runs: [number, number][] = [];
  let r0 = -1;
  for (let t = 0; t <= len; t += 0.005) {
    const on = t < len && voicedAt(t) !== null;
    if (on && r0 < 0) r0 = t;
    if (!on && r0 >= 0) (runs.push([r0, t]), (r0 = -1));
  }
  if (!runs.length) runs.push([0, len]);
  const n = Math.min(noteStarts.length, runs.length);
  const vowels = [...runs].sort((a, b) => b[1] - b[0] - (a[1] - a[0])).slice(0, n).sort((a, b) => a[0] - b[0]);
  // piecewise-linear time map (output knot -> input knot); consonants keep natural speed
  const kin: number[] = [0];
  const kout: number[] = [0];
  vowels.forEach(([a, b], k) => {
    const gap = a - kin[kin.length - 1];
    const start = k === 0 ? a : Math.max(kout[kout.length - 1] + gap * 0.5, noteStarts[k] - gap * 0.6);
    kin.push(a);
    kout.push(start);
    const end = k + 1 < n ? noteStarts[k + 1] - (vowels[k + 1][0] - b) * 0.6 : dur - (len - b);
    kin.push(b);
    kout.push(Math.max(start + (b - a), end));
  });
  kin.push(len);
  kout.push(kout[kout.length - 1] + len - kin[kin.length - 2]);
  const outLen = Math.round(dur * SR);
  const inTime = (to: number) => {
    let i = 0;
    while (i + 2 < kout.length && kout[i + 1] <= to) i++;
    const span = kout[i + 1] - kout[i];
    return kin[i] + (span > 0 ? ((to - kout[i]) / span) * (kin[i + 1] - kin[i]) : 0);
  };
  const out = new Float32Array(outLen + SR);
  const w = new Float32Array(outLen + SR);
  // pitch-synchronous analysis marks (one per period) so successive grains stay in phase
  const marks: number[] = [];
  const periods: number[] = [];
  for (let pos = 0; pos < x.length; ) {
    const m = voicedAt(pos / SR);
    let P = m !== null ? SR / (440 * 2 ** ((m - 69) / 12)) : SR * 0.005;
    if (m !== null) {
      // refine the period by maximising correlation with the previous cycle
      const p0 = Math.round(pos);
      const n = Math.round(P);
      let best = -Infinity;
      let bestLag = n;
      for (let lag = Math.round(n * 0.85); lag <= Math.round(n * 1.15); lag++) {
        let s = 0;
        let e = 1e-9;
        for (let j = 0; j < n && p0 + lag + j < x.length; j++) {
          s += x[p0 + j] * x[p0 + lag + j];
          e += x[p0 + lag + j] ** 2;
        }
        const r = s / Math.sqrt(e);
        if (r > best) (best = r), (bestLag = lag);
      }
      P = bestLag;
    }
    marks.push(pos);
    periods.push(P);
    pos += P;
  }
  let k = 0;
  for (let ts = 0; ts < outLen; ) {
    const ti = inTime(ts / SR) * SR;
    while (k + 1 < marks.length && Math.abs(marks[k + 1] - ti) <= Math.abs(marks[k] - ti)) k++;
    while (k > 0 && Math.abs(marks[k - 1] - ti) < Math.abs(marks[k] - ti)) k--;
    const m = voicedAt(marks[k] / SR);
    const Pa = periods[k];
    const target = pitchAt(ts / SR);
    const Ps = m !== null ? SR / (440 * 2 ** ((target - 69) / 12)) : Pa;
    const c = Math.round(marks[k]);
    const L = Math.round(Pa);
    for (let j = -L; j <= L; j++) {
      const si = ts + j;
      const ai = c + j;
      if (si < 0 || ai < 0 || ai >= x.length) continue;
      const win = 0.5 * (1 + Math.cos((Math.PI * j) / L));
      out[si] += x[ai] * win;
      w[si] += win;
    }
    ts += Math.max(16, Math.round(Ps));
  }
  for (let i = 0; i < out.length; i++) out[i] = w[i] > 0.05 ? out[i] / w[i] : 0;
  return out.subarray(0, outLen);
}

// Twinkle: [word, [midi, beats][]]
const BPM = 92;
const beat = 60 / BPM;
// one entry per sung syllable (spelled for the TTS voice)
const words: [string, [number, number][]][] = [
  ['twin', [[60, 1]]],
  ['kul', [[60, 1]]],
  ['twin', [[67, 1]]],
  ['kul', [[67, 1]]],
  ['lit', [[69, 1]]],
  ['tull', [[69, 1]]],
  ['star', [[67, 2]]],
  ['how', [[65, 1]]],
  ['eye', [[65, 1]]],
  ['won', [[64, 1]]],
  ['der', [[64, 1]]],
  ['what', [[62, 1]]],
  ['you', [[62, 1]]],
  ['are', [[60, 2]]],
];
const lead = 0.9;
let t = lead;
const totalBeats = words.reduce((s, [, ns]) => s + ns.reduce((a, [, b]) => a + b, 0), 0);
const song = new Float32Array(Math.ceil((lead + totalBeats * beat + 1.2) * SR));
for (const [word, notes] of words) {
  const x = speak(word);
  const dur = notes.reduce((a, [, b]) => a + b * beat, 0);
  const bounds: { t: number; midi: number }[] = [];
  let acc = 0;
  for (const [m, b] of notes) {
    bounds.push({ t: acc, midi: m });
    acc += b * beat;
  }
  const pitchAt = (tt: number) => {
    let i = 0;
    while (i + 1 < bounds.length && bounds[i + 1].t <= tt) i++;
    const local = tt - bounds[i].t;
    const scoop = local < 0.05 ? -0.4 * (1 - local / 0.05) ** 2 : 0;
    const vib = 0.18 * Math.min(1, Math.max(0, (local - 0.25) / 0.2)) * Math.sin(2 * Math.PI * 5.4 * local);
    return bounds[i].midi + scoop + vib;
  };
  const sung = singWord(x, dur - 0.04, bounds.map((b) => b.t), pitchAt);
  const off = Math.round(t * SR);
  for (let i = 0; i < sung.length && off + i < song.length; i++) song[off + i] += sung[i];
  t += dur;
}
let peak = 0;
for (const v of song) peak = Math.max(peak, Math.abs(v));
for (let i = 0; i < song.length; i++) song[i] = (song[i] / peak) * 0.7 + (Math.random() - 0.5) * 0.002;
const lyricsWav = encodeWav(song, SR);
writeFileSync(join(root, 'tests', 'fixtures', 'twinkle-lyrics.wav'), lyricsWav);
writeFileSync(join(root, 'public', 'samples', 'twinkle-lyrics.wav'), lyricsWav);
console.log(`wrote twinkle-lyrics.wav (${(song.length / SR).toFixed(1)} s)`);

// Closed-mouth hum: nasal murmur — strong first formant, almost nothing above it.
const hum = renderSungMelody(sampleToTimed(ODE_TO_JOY, { leadIn: 0.8, jitter: 0.02, seed: 5 }), {
  sampleRate: SR,
  tail: 1.2,
  formants: [250, 1000, 2300],
  formantGains: [1, 0.03, 0.008],
  direct: 0.002,
  scoopCents: 40,
});
writeFileSync(join(root, 'tests', 'fixtures', 'ode-hummed.wav'), encodeWav(hum.samples, hum.sampleRate));
console.log('wrote ode-hummed.wav');
rmSync(tmp, { recursive: true, force: true });
