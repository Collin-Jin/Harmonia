import { readFileSync } from 'node:fs';

/** Read a 16-bit PCM WAV (any chunk layout) to mono floats. */
export function readWav(path: string): { samples: Float32Array; sampleRate: number } {
  const b = readFileSync(path);
  let o = 12;
  let sampleRate = 44100;
  let channels = 1;
  let data: Buffer | null = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') {
      channels = b.readUInt16LE(o + 10);
      sampleRate = b.readUInt32LE(o + 12);
    }
    if (id === 'data') data = b.subarray(o + 8, o + 8 + size);
    o += 8 + size + (size % 2);
  }
  if (!data) throw new Error(`${path}: no data chunk`);
  const frames = Math.floor(data.length / 2 / channels);
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += data.readInt16LE((i * channels + c) * 2) / 32768;
    samples[i] = s / channels;
  }
  return { samples, sampleRate };
}
