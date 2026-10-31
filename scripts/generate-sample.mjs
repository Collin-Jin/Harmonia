// Generates realistic "sung" sample melodies as WAV files (public/samples and tests/fixtures).
// Usage: node scripts/generate-sample.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLES, sampleToTimed } from '../src/music/samples.ts';
import { renderSungMelody, encodeWav } from '../src/music/vocalRender.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDirs = [join(root, 'public', 'samples'), join(root, 'tests', 'fixtures')];
outDirs.forEach((d) => mkdirSync(d, { recursive: true }));

for (const s of SAMPLES) {
  const notes = sampleToTimed(s, { leadIn: 0.8, jitter: 0.02, seed: 3 });
  const { samples, sampleRate } = renderSungMelody(notes, { sampleRate: 48000, tail: 1.2 });
  const wav = encodeWav(samples, sampleRate);
  for (const d of outDirs) writeFileSync(join(d, `${s.id}.wav`), wav);
  console.log(`wrote ${s.id}.wav (${(samples.length / sampleRate).toFixed(1)} s)`);
}

// A faster, transposed take of Ode to Joy for live-following tests (+2 semitones, 15% faster).
{
  const s = SAMPLES[0];
  const notes = sampleToTimed(s, { leadIn: 0.6, tempoScale: 1.15, transpose: 2, jitter: 0.03, seed: 11 });
  const { samples, sampleRate } = renderSungMelody(notes, { sampleRate: 48000, tail: 1.5, detuneCents: 15, seed: 21 });
  writeFileSync(join(root, 'tests', 'fixtures', 'ode-to-joy-live-variant.wav'), encodeWav(samples, sampleRate));
  console.log('wrote ode-to-joy-live-variant.wav');
}
