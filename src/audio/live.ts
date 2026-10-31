import { getAudioContext, getMasterBus, outputLatency, resumeAudio } from './context';
import { mic, type PitchMessage } from './mic';
import { VocalVoice } from './synth';
import { effectiveGain, type MixState } from './player';
import { LiveHarmonyController, LiveNoteSegmenter, type ControllerStatus, type VoiceCommand } from '../music/follower';
import { freqToMidi } from '../music/theory';
import type { Arrangement } from '../music/types';

export interface LiveOptions {
  allowTranspose: boolean;
  followIntonation: boolean;
  followDynamics: boolean;
  echoCancellation: boolean;
  mix: MixState;
}

export interface LiveLogEntry {
  t: number;
  index: number;
  midi: number;
  confidence: number;
  mode: ControllerStatus['mode'];
  transpose: number;
  tempoRatio: number;
  detectMs: number;
  commands: number;
}

export interface LiveSnapshot {
  status: ControllerStatus;
  level: number; // 0..1 input level
  pitch: number | null; // live sung pitch (fractional MIDI)
  detectMs: number; // median onset → voice-command latency
  totalMs: number; // + device input/output latency estimate
  onsets: number;
  currentUnit: number | null;
  running: boolean;
}

export class LiveSession {
  private seg: LiveNoteSegmenter | null = null;
  private ctl: LiveHarmonyController;
  private voices: VocalVoice[] = [];
  private gains: GainNode[] = [];
  private unsub: (() => void) | null = null;
  private detectHistory: number[] = [];
  private levelSmooth = 0;
  private lastPitch: number | null = null;
  readonly log: LiveLogEntry[] = [];
  running = false;

  constructor(public arr: Arrangement, readonly opts: LiveOptions) {
    this.ctl = new LiveHarmonyController(arr, {
      allowTranspose: opts.allowTranspose,
      followIntonation: opts.followIntonation,
    });
  }

  async start() {
    const ctx = await resumeAudio();
    await mic.start({ echoCancellation: this.opts.echoCancellation });
    const bus = getMasterBus();
    this.arr.harmonies.forEach((h, i) => {
      const g = ctx.createGain();
      g.gain.value = effectiveGain(this.opts.mix, h.id);
      g.connect(bus.input);
      const sorted = h.notes.map((n) => n.midi).sort((a, b) => a - b);
      const v = new VocalVoice(ctx, g, {
        vowel: h.vowel,
        register: sorted.length ? sorted[sorted.length >> 1] : 60,
        pan: [-0.35, 0.35, -0.6, 0.6][i % 4],
        level: 0.42,
      });
      v.start();
      this.voices.push(v);
      this.gains.push(g);
    });
    this.seg = new LiveNoteSegmenter({ hopSec: 256 / ctx.sampleRate });
    this.unsub = mic.onPitch((m) => this.onFrame(m));
    this.running = true;
    (window as any).__harmoniaLive = this;
  }

  /** Take a new arrangement of the same melody while singing; false if a restart is needed. */
  update(arr: Arrangement): boolean {
    if (!this.ctl.retarget(arr)) return false;
    this.arr = arr;
    return true;
  }

  setMix(mix: MixState) {
    const ctx = getAudioContext();
    this.arr.harmonies.forEach((h, i) => this.gains[i]?.gain.setTargetAtTime(effectiveGain(mix, h.id), ctx.currentTime, 0.03));
  }

  private exec(cmds: VoiceCommand[], now: number) {
    for (const c of cmds) {
      const v = this.voices[c.voice];
      if (!v) continue;
      if (c.action === 'on') v.noteOn(now, c.midi, { glide: c.rearticulate, rearticulate: c.rearticulate, live: true });
      else v.noteOff(now, 0.15, true);
    }
  }

  private onFrame(m: PitchMessage) {
    if (!this.seg) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const midi = m.f0 > 0 ? freqToMidi(m.f0) : null;
    this.levelSmooth = this.levelSmooth * 0.8 + Math.min(1, m.rms * 6) * 0.2;
    const events = this.seg.process({ t: m.t, midi: midi !== null && isFinite(midi) ? midi : null, clarity: m.clarity, rms: m.rms });
    for (const ev of events) {
      if (ev.type === 'onset') {
        const cmds = this.ctl.onset(ev.midi, ev.t, ev.revision, ev.rearticulation);
        this.exec(cmds, now);
        const detectMs = Math.max(0, (now - ev.t) * 1000);
        if (!ev.revision) {
          this.detectHistory.push(detectMs);
          if (this.detectHistory.length > 40) this.detectHistory.shift();
        }
        const s = this.ctl.status;
        this.log.push({
          t: ev.t,
          index: s.index,
          midi: ev.midi,
          confidence: s.confidence,
          mode: s.mode,
          transpose: s.transpose,
          tempoRatio: s.tempoRatio,
          detectMs,
          commands: cmds.length,
        });
        this.lastPitch = ev.midi;
      } else if (ev.type === 'pitch') {
        this.lastPitch = ev.midi;
        const cents = this.ctl.pitch(ev.midi);
        this.voices.forEach((v) => v.setDetune(cents, now));
        if (this.opts.followDynamics) {
          const db = 20 * Math.log10(Math.max(1e-5, ev.rms));
          const expr = 0.35 + Math.max(0, Math.min(1, (db + 45) / 33)) * 0.95;
          this.voices.forEach((v) => v.setExpression(expr, now));
        }
      } else {
        this.exec(this.ctl.offset(), now);
        this.lastPitch = null;
      }
    }
  }

  snapshot(): LiveSnapshot {
    const sorted = this.detectHistory.slice().sort((a, b) => a - b);
    const detect = sorted.length ? sorted[sorted.length >> 1] : 0;
    const device = (outputLatency() + mic.inputLatency) * 1000;
    const s = this.ctl.status;
    return {
      status: { ...s, voicePitches: s.voicePitches.slice() },
      level: this.levelSmooth,
      pitch: this.lastPitch,
      detectMs: detect,
      totalMs: detect + device,
      onsets: this.detectHistory.length,
      currentUnit: s.index >= 0 && s.mode === 'following' ? this.arr.melody.notes[s.index].start : null,
      running: this.running,
    };
  }

  stop() {
    this.unsub?.();
    this.unsub = null;
    const ctx = getAudioContext();
    this.voices.forEach((v) => v.stop(ctx.currentTime));
    const gains = this.gains;
    const voices = this.voices;
    window.setTimeout(() => {
      voices.forEach((v) => v.disconnect());
      gains.forEach((g) => g.disconnect());
    }, 600);
    this.voices = [];
    this.gains = [];
    this.seg = null;
    this.running = false;
  }
}
