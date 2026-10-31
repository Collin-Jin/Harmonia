// Speech recognition for sung lyrics: Whisper running locally in the browser
// (transformers.js, ONNX Runtime WebAssembly). The model (~77 MB, quantized) is
// downloaded once and cached by the browser.
import { pipeline, env } from '@huggingface/transformers';
import { HUM_BRIGHTNESS, resample, voiceBrightness, type AsrChunk } from '../music/lyrics';

export const LYRICS_MODEL = 'onnx-community/whisper-base.en_timestamped';

env.allowLocalModels = false;

type Job = { id: number; samples: Float32Array; sampleRate: number };

let asr: Promise<any> | null = null;
const files = new Map<string, { loaded: number; total: number }>();

function load(id: number) {
  asr ??= pipeline('automatic-speech-recognition', LYRICS_MODEL, {
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } as any,
    device: 'wasm',
    progress_callback: (p: any) => {
      if (p.status === 'progress' && p.file && p.total) {
        files.set(p.file, { loaded: p.loaded, total: p.total });
        let loaded = 0;
        let total = 0;
        files.forEach((f) => ((loaded += f.loaded), (total += f.total)));
        self.postMessage({ id, type: 'progress', loaded, total });
      }
    },
  });
  return asr;
}

self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, samples, sampleRate } = e.data;
  try {
    const x = resample(samples, sampleRate, 16000);
    const brightness = voiceBrightness(x, 16000);
    if (brightness < HUM_BRIGHTNESS) {
      self.postMessage({ id, type: 'result', chunks: [], text: '', brightness, duration: x.length / 16000 });
      return;
    }
    const model = await load(id);
    self.postMessage({ id, type: 'running' });
    const out = await model(x, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
    const chunks: AsrChunk[] = (out.chunks ?? []).map((c: any) => ({ text: String(c.text), timestamp: [c.timestamp?.[0] ?? null, c.timestamp?.[1] ?? null] }));
    self.postMessage({ id, type: 'result', chunks, text: String(out.text ?? ''), brightness, duration: x.length / 16000 });
  } catch (err) {
    asr = null;
    self.postMessage({ id, type: 'error', message: String((err as Error)?.message ?? err) });
  }
};
