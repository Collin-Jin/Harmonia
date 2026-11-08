import { analyzeRecording, type AnalyzeOptions } from '../music/transcribe';
import { processVoice, type AutotuneMode, type TuneFrame, type TuneNote } from '../music/autotune';
import { renderVoicePart, type VoiceHarmonyInput } from '../music/voiceHarmony';

type Job =
  | { id: number; type: 'analyze'; samples: Float32Array; sampleRate: number; opts: AnalyzeOptions }
  | { id: number; type: 'voice'; samples: Float32Array; sampleRate: number; frames: TuneFrame[]; notes: TuneNote[]; mode: AutotuneMode; mutes: TuneNote[] }
  | { id: number; type: 'harmonyVoices'; input: VoiceHarmonyInput };

self.onmessage = (e: MessageEvent<Job>) => {
  const job = e.data;
  try {
    if (job.type === 'voice') {
      const out = processVoice(job.samples, job.sampleRate, job.frames, job.notes, job.mode, job.mutes);
      (self as any).postMessage({ id: job.id, ok: true, result: out }, [out.buffer]);
    } else if (job.type === 'harmonyVoices') {
      const result: Record<string, Float32Array> = {};
      for (const p of job.input.parts) result[p.id] = renderVoicePart(job.input, p);
      (self as any).postMessage({ id: job.id, ok: true, result }, Object.values(result).map((b) => b.buffer));
    } else {
      const result = analyzeRecording(job.samples, job.sampleRate, job.opts);
      (self as any).postMessage({ id: job.id, ok: true, result });
    }
  } catch (err) {
    (self as any).postMessage({ id: job.id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
