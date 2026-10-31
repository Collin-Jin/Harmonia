import { getAudioContext, resumeAudio } from './context';

export interface PitchMessage {
  t: number;
  f0: number;
  clarity: number;
  rms: number;
}

type PitchListener = (m: PitchMessage) => void;

let workletLoaded: Promise<void> | null = null;

/**
 * Microphone input through the capture AudioWorklet. One shared instance:
 * recording and live mode both subscribe to pitch frames.
 */
export class MicInput {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private listeners = new Set<PitchListener>();
  private chunks: Float32Array[] = [];
  private recStartT: number | null = null;
  private recStopResolve: (() => void) | null = null;
  private echoCancellation = false;
  inputLatency = 0;

  get active() {
    return !!this.stream;
  }

  async start(opts: { echoCancellation?: boolean } = {}) {
    const ec = !!opts.echoCancellation;
    if (this.stream && ec === this.echoCancellation) return;
    if (this.stream) this.stop();
    this.echoCancellation = ec;
    const ctx = await resumeAudio();
    if (!workletLoaded) workletLoaded = ctx.audioWorklet.addModule('/worklets/capture-processor.js');
    await workletLoaded;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support microphone capture (getUserMedia).');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: ec,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    const track = this.stream.getAudioTracks()[0];
    const settings = track.getSettings() as MediaTrackSettings & { latency?: number };
    this.inputLatency = typeof settings.latency === 'number' ? settings.latency : 0.01;
    this.source = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, 'harmonia-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {},
    });
    this.node.port.onmessage = (e) => this.onMessage(e.data);
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node).connect(this.sink).connect(ctx.destination);
  }

  private onMessage(m: any) {
    if (m.type === 'pitch') this.listeners.forEach((l) => l(m));
    else if (m.type === 'audio') this.chunks.push(m.samples);
    else if (m.type === 'recstart') this.recStartT = m.t;
    else if (m.type === 'recstop') {
      this.recStopResolve?.();
      this.recStopResolve = null;
    }
  }

  onPitch(l: PitchListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  startRecording() {
    this.chunks = [];
    this.recStartT = null;
    this.node?.port.postMessage({ type: 'record', on: true });
  }

  /** Stop recording and return the captured audio plus the AudioContext time of its first sample. */
  async stopRecording(): Promise<{ samples: Float32Array; sampleRate: number; startTime: number }> {
    const done = new Promise<void>((res) => (this.recStopResolve = res));
    this.node?.port.postMessage({ type: 'record', on: false });
    await Promise.race([done, new Promise((r) => setTimeout(r, 500))]);
    const total = this.chunks.reduce((s, c) => s + c.length, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    this.chunks = [];
    return { samples: out, sampleRate: getAudioContext().sampleRate, startTime: this.recStartT ?? 0 };
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    try {
      this.source?.disconnect();
      this.node?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* ignore */
    }
    this.stream = null;
    this.source = null;
    this.node = null;
    this.sink = null;
  }
}

export const mic = new MicInput();
