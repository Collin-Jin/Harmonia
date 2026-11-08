import { analyzeRecording, type AnalysisResult, type AnalyzeOptions } from '../music/transcribe';
import { processVoice, type AutotuneMode, type TuneFrame, type TuneNote } from '../music/autotune';
import { renderVoiceHarmonies, type VoiceHarmonyInput } from '../music/voiceHarmony';

let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker | null {
  try {
    if (!worker) worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' });
    return worker;
  } catch {
    return null;
  }
}

/** Posts a job to the analysis worker; runs `fallback` on the main thread if workers are unavailable. */
function run<T>(job: Record<string, unknown>, fallback: () => T, transfer: Transferable[] = []): Promise<T> {
  const w = getWorker();
  if (!w) return Promise.resolve(fallback());
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onMsg);
      if (e.data.ok) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    w.addEventListener('message', onMsg);
    w.addEventListener(
      'error',
      () => {
        w.removeEventListener('message', onMsg);
        resolve(fallback());
      },
      { once: true },
    );
    w.postMessage({ ...job, id }, transfer);
  });
}

/** Runs pitch tracking + transcription in a Web Worker (falls back to the main thread). */
export function analyzeInWorker(samples: Float32Array, sampleRate: number, opts: AnalyzeOptions): Promise<AnalysisResult> {
  return run({ type: 'analyze', samples: samples.slice(), sampleRate, opts }, () => analyzeRecording(samples, sampleRate, opts));
}

/** Autotune + clean-up of the recorded voice in the worker. */
export function processVoiceInWorker(
  samples: Float32Array,
  sampleRate: number,
  frames: TuneFrame[],
  notes: TuneNote[],
  mode: AutotuneMode,
  mutes: TuneNote[] = [],
): Promise<Float32Array> {
  const copy = samples.slice();
  return run({ type: 'voice', samples: copy, sampleRate, frames, notes, mode, mutes }, () => processVoice(samples, sampleRate, frames, notes, mode, mutes), [
    copy.buffer,
  ]);
}

/** Harmony parts sung in the singer's own voice (one buffer per part, recording time). */
export function renderHarmonyVoicesInWorker(input: VoiceHarmonyInput): Promise<Record<string, Float32Array>> {
  return run({ type: 'harmonyVoices', input: { ...input, samples: input.samples.slice() } }, () => renderVoiceHarmonies(input));
}

/** Decode any browser-supported audio file to mono samples. */
export async function decodeAudioFile(file: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
  const data = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buf = await ctx.decodeAudioData(data);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return { samples: out, sampleRate: buf.sampleRate };
}
