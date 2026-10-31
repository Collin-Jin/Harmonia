import { MasterBus } from './synth';

let ctx: AudioContext | null = null;
let bus: MasterBus | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
  }
  return ctx;
}

export async function resumeAudio(): Promise<AudioContext> {
  const c = getAudioContext();
  if (c.state !== 'running') await c.resume();
  return c;
}

export function getMasterBus(): MasterBus {
  const c = getAudioContext();
  if (!bus) bus = new MasterBus(c, c.destination);
  return bus;
}

/** Estimated output latency in seconds (base + device). */
export function outputLatency(): number {
  const c = getAudioContext();
  return (c.baseLatency || 0) + ((c as any).outputLatency || 0);
}
