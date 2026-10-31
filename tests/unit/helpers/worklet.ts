import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import type { LiveFrame } from '../../../src/music/follower';
import { freqToMidi } from '../../../src/music/theory';

/** Runs the real AudioWorklet processor source in a VM sandbox and collects its pitch frames. */
export function runWorklet(samples: Float32Array, sampleRate: number): { frames: LiveFrame[]; hopSec: number } {
  const src = readFileSync(join(__dirname, '../../../public/worklets/capture-processor.js'), 'utf8');
  const messages: any[] = [];
  let Processor: any = null;
  const sandbox: any = {
    sampleRate,
    currentTime: 0,
    Math,
    Float32Array,
    AudioWorkletProcessor: class {
      port = { postMessage: (m: any) => messages.push(m), onmessage: null as any };
    },
    registerProcessor: (_name: string, cls: any) => (Processor = cls),
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const proc = new Processor({ processorOptions: {} });
  const out = [[new Float32Array(128)]];
  for (let i = 0; i + 128 <= samples.length; i += 128) {
    sandbox.currentTime = i / sampleRate;
    proc.process([[samples.subarray(i, i + 128)]], out);
  }
  const frames = messages
    .filter((m) => m.type === 'pitch')
    .map((m) => ({ t: m.t, midi: m.f0 > 0 ? freqToMidi(m.f0) : null, clarity: m.clarity, rms: m.rms }));
  return { frames, hopSec: 256 / sampleRate };
}
