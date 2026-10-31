import type { AsrChunk } from '../music/lyrics';

export interface LyricsResult {
  chunks: AsrChunk[];
  text: string;
  brightness: number;
  duration: number;
}

let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('../workers/lyrics.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

/** Recognise the words of a take. `onProgress` reports the one-time model download (0..1). */
export function recognizeLyrics(
  samples: Float32Array,
  sampleRate: number,
  hooks: { onProgress?: (fraction: number, loaded: number, total: number) => void; onRunning?: () => void } = {},
): Promise<LyricsResult> {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d.id !== id) return;
      if (d.type === 'progress') hooks.onProgress?.(d.total ? d.loaded / d.total : 0, d.loaded, d.total);
      else if (d.type === 'running') hooks.onRunning?.();
      else {
        w.removeEventListener('message', onMsg);
        if (d.type === 'result') resolve(d as LyricsResult);
        else reject(new Error(d.message));
      }
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, samples: samples.slice(), sampleRate });
  });
}
