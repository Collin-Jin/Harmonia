import { midiToFreq } from '../music/theory';
import type { Vowel } from '../music/types';

/**
 * Formant vocal synthesis:
 *   glottal-like source (band-limited, -11 dB/oct) ×2 detuned "singers"
 *   + breath noise → parallel formant band-pass bank → amplitude envelope → pan
 * with delayed natural vibrato, onset scoops, legato glides and syllable re-articulation.
 */

const VOWELS: Record<Vowel, { f: [number, number, number, number]; g: [number, number, number, number]; bw: [number, number, number, number] }> = {
  ah: { f: [730, 1090, 2440, 3400], g: [1, 0.55, 0.28, 0.12], bw: [90, 110, 150, 200] },
  oh: { f: [570, 840, 2410, 3300], g: [1, 0.45, 0.14, 0.07], bw: [80, 100, 140, 200] },
  oo: { f: [320, 870, 2240, 3200], g: [1, 0.3, 0.07, 0.04], bw: [70, 100, 140, 200] },
  ee: { f: [280, 2250, 2900, 3500], g: [1, 0.28, 0.22, 0.1], bw: [70, 120, 150, 200] },
  mm: { f: [260, 1200, 2500, 3400], g: [1, 0.04, 0.015, 0.01], bw: [60, 120, 160, 200] },
};

const waveCache = new WeakMap<BaseAudioContext, PeriodicWave>();
function glottalWave(ctx: BaseAudioContext): PeriodicWave {
  let w = waveCache.get(ctx);
  if (w) return w;
  const n = 64;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let h = 1; h < n; h++) {
    imag[h] = 1 / Math.pow(h, 1.25);
    real[h] = h % 2 ? 0.08 / h : 0; // slight asymmetry
  }
  w = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  waveCache.set(ctx, w);
  return w;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (b) return b;
  b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, b);
  return b;
}

export interface VoiceOptions {
  vowel: Vowel;
  register: number; // typical MIDI pitch (for formant scaling)
  pan?: number;
  level?: number;
  vibratoCents?: number;
  ensemble?: boolean;
}

export class VocalVoice {
  readonly output: GainNode;
  private oscs: OscillatorNode[] = [];
  private noise: AudioBufferSourceNode;
  private amp: GainNode;
  private breath: GainNode;
  private vib: OscillatorNode;
  private vibDepth: GainNode;
  private formants: BiquadFilterNode[] = [];
  private formantGains: GainNode[] = [];
  private sounding = false;
  private currentMidi = 60;
  private baseDetune = 0;
  private level: number;
  private vibCents: number;
  private started = false;

  constructor(readonly ctx: BaseAudioContext, dest: AudioNode, private opts: VoiceOptions) {
    this.level = opts.level ?? 0.5;
    this.vibCents = opts.vibratoCents ?? 22;
    this.output = ctx.createGain();
    this.output.gain.value = 1;
    const pan = ctx.createStereoPanner();
    pan.pan.value = opts.pan ?? 0;
    this.output.connect(pan).connect(dest);

    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 90;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    hp.connect(lp).connect(this.amp).connect(this.output);

    const src = ctx.createGain();
    src.gain.value = 0.9;
    const wave = glottalWave(ctx);
    const detunes = opts.ensemble === false ? [0] : [-5, 6];
    for (const d of detunes) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      o.detune.value = d;
      const g = ctx.createGain();
      g.gain.value = 1 / detunes.length;
      o.connect(g).connect(src);
      this.oscs.push(o);
    }
    // vibrato LFO → detune of all oscillators
    this.vib = ctx.createOscillator();
    this.vib.frequency.value = 5.1 + Math.random() * 0.5;
    this.vibDepth = ctx.createGain();
    this.vibDepth.gain.value = 0;
    this.vib.connect(this.vibDepth);
    this.oscs.forEach((o) => this.vibDepth.connect(o.detune));

    // breath noise
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuffer(ctx);
    this.noise.loop = true;
    this.noise.playbackRate.value = 0.8 + Math.random() * 0.4;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 2500;
    nf.Q.value = 0.7;
    this.breath = ctx.createGain();
    this.breath.gain.value = 0.035;
    this.noise.connect(nf).connect(this.breath).connect(src);

    // formant bank
    this.setupFormants(src, hp);
  }

  private formantScale() {
    const r = this.opts.register;
    return 1 + Math.max(0, Math.min(1, (r - 50) / 26)) * 0.2;
  }

  private setupFormants(src: AudioNode, out: AudioNode) {
    const v = VOWELS[this.opts.vowel];
    const k = this.formantScale();
    for (let i = 0; i < 4; i++) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = v.f[i] * k;
      f.Q.value = (v.f[i] * k) / v.bw[i];
      const g = this.ctx.createGain();
      g.gain.value = v.g[i] * 3.2;
      src.connect(f).connect(g).connect(out);
      this.formants.push(f);
      this.formantGains.push(g);
    }
    // a little direct source for presence
    const direct = this.ctx.createGain();
    direct.gain.value = 0.05;
    src.connect(direct).connect(out);
  }

  setVowel(vowel: Vowel, time = this.ctx.currentTime) {
    this.opts.vowel = vowel;
    const v = VOWELS[vowel];
    const k = this.formantScale();
    this.formants.forEach((f, i) => {
      f.frequency.setTargetAtTime(v.f[i] * k, time, 0.05);
      f.Q.setTargetAtTime((v.f[i] * k) / v.bw[i], time, 0.05);
      this.formantGains[i].gain.setTargetAtTime(v.g[i] * 3.2, time, 0.05);
    });
  }

  start(time = this.ctx.currentTime) {
    if (this.started) return;
    this.started = true;
    this.oscs.forEach((o) => o.start(time));
    this.vib.start(time);
    this.noise.start(time, Math.random());
  }

  stop(time = this.ctx.currentTime) {
    if (!this.started) return;
    this.amp.gain.cancelScheduledValues(time);
    this.amp.gain.setTargetAtTime(0, time, 0.05);
    const end = time + 0.4;
    this.oscs.forEach((o) => o.stop(end));
    this.vib.stop(end);
    this.noise.stop(end);
    this.started = false;
  }

  private hold(param: AudioParam, time: number, live: boolean) {
    if (live && 'cancelAndHoldAtTime' in param) {
      (param as any).cancelAndHoldAtTime(time);
    } else if (live) {
      const v = param.value;
      param.cancelScheduledValues(time);
      param.setValueAtTime(v, time);
    }
  }

  /**
   * Start or change a note. `live` = called in real time (cancel any automation in flight);
   * playback scheduling passes live=false and schedules strictly in order.
   */
  noteOn(time: number, midi: number, opts: { velocity?: number; glide?: boolean; rearticulate?: boolean; live?: boolean } = {}) {
    const vel = opts.velocity ?? 1;
    const level = this.level * vel;
    const f = midiToFreq(midi);
    const live = !!opts.live;
    const legato = this.sounding && (opts.glide || opts.rearticulate);
    for (const o of this.oscs) {
      this.hold(o.frequency, time, live);
      if (legato) {
        o.frequency.setTargetAtTime(f, time, 0.014);
      } else {
        o.frequency.setValueAtTime(f * Math.pow(2, -22 / 1200), time);
        o.frequency.setTargetAtTime(f, time, 0.016);
      }
    }
    // The dip of a re-articulated syllable happens just before the beat so the new
    // syllable peaks on it; fresh notes rise in ~10 ms (no audible lag behind the lead).
    const dipAt = live ? time : Math.max(this.ctx.currentTime, time - 0.035);
    this.hold(this.amp.gain, dipAt, live);
    if (legato && opts.rearticulate) {
      // a breath of a consonant, never a gap — the line keeps singing
      this.amp.gain.setTargetAtTime(level * 0.88, dipAt, 0.02);
      this.amp.gain.setTargetAtTime(level, time, 0.028);
    } else if (legato) {
      this.amp.gain.setTargetAtTime(level, time, 0.03);
    } else {
      // fade out whatever is left of a release instead of jumping to silence (no click)
      if (!live) this.amp.gain.setTargetAtTime(0.0001, Math.max(this.ctx.currentTime, time - 0.02), 0.008);
      this.amp.gain.setTargetAtTime(level, time, 0.018);
    }
    this.hold(this.vibDepth.gain, time, live);
    if (!legato || Math.abs(midi - this.currentMidi) > 0) {
      this.vibDepth.gain.setTargetAtTime(0, time, 0.02);
      this.vibDepth.gain.setTargetAtTime(this.vibCents, time + 0.28, 0.18);
    }
    this.hold(this.breath.gain, time, live);
    this.breath.gain.setTargetAtTime(0.05, time, 0.01);
    this.breath.gain.setTargetAtTime(0.022, time + 0.08, 0.1);
    this.sounding = true;
    this.currentMidi = midi;
  }

  noteOff(time: number, release = 0.12, live = false) {
    this.hold(this.amp.gain, time, live);
    this.amp.gain.setTargetAtTime(0, time, release / 3);
    this.sounding = false;
  }

  /** Fine pitch offset (intonation following), in cents. */
  setDetune(cents: number, time = this.ctx.currentTime) {
    if (Math.abs(cents - this.baseDetune) < 0.5) return;
    this.baseDetune = cents;
    const offs = this.oscs.length === 1 ? [0] : [-5, 6];
    this.oscs.forEach((o, i) => o.detune.setTargetAtTime(cents + offs[i], time, 0.04));
  }

  /** Live dynamics following (0..1.5 multiplier). */
  setExpression(mult: number, time = this.ctx.currentTime) {
    this.output.gain.setTargetAtTime(Math.max(0, Math.min(1.6, mult)), time, 0.05);
  }

  get isSounding() {
    return this.sounding;
  }

  disconnect() {
    try {
      this.output.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

/** Master bus: dry + algorithmic-IR convolution reverb → gentle compressor → destination. */
export class MasterBus {
  readonly input: GainNode;
  readonly wet: GainNode;
  private comp: DynamicsCompressorNode;

  constructor(readonly ctx: BaseAudioContext, dest: AudioNode, reverb = 0.38) {
    this.input = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.2;
    const dry = ctx.createGain();
    dry.gain.value = 0.9;
    this.wet = ctx.createGain();
    this.wet.gain.value = reverb;
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 2.6, 2.8);
    this.input.connect(dry).connect(this.comp);
    this.input.connect(conv).connect(this.wet).connect(this.comp);
    this.comp.connect(dest);
  }

  setReverb(amount: number) {
    this.wet.gain.setTargetAtTime(amount, this.ctx.currentTime, 0.1);
  }
}

function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const pre = Math.floor(ctx.sampleRate * 0.018);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / len;
      const n = Math.random() * 2 - 1;
      // darken the tail progressively
      const a = 0.25 + 0.7 * t;
      lp = lp * a + n * (1 - a);
      d[i] = lp * Math.pow(1 - t, decay) * 0.9;
    }
  }
  return buf;
}
