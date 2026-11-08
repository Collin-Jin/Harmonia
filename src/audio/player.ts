import { getAudioContext, getMasterBus, outputLatency, resumeAudio } from './context';
import { MasterBus, VocalVoice } from './synth';
import { TimeMap } from '../music/timemap';
import type { Arrangement, ScoreNote, Transcription, VoicePart } from '../music/types';

export type MelodySource = 'recording' | 'synth' | 'off';
/** How the melody sounds when it is played on its own ("Check your notes"). */
export type MelodyTone = 'recording' | 'piano';

export interface PartMix {
  gain: number;
  mute: boolean;
  solo: boolean;
}
export type MixState = Record<string, PartMix>;

export interface RecordingAudio {
  samples: Float32Array;
  sampleRate: number;
}

export interface PlayOptions {
  fromUnit?: number;
  mix: MixState;
  melodySource: MelodySource;
  recording?: RecordingAudio | null;
  transcription?: Transcription | null;
  /** Harmony parts sung in the singer's voice (recording time); others use the choir synth. */
  voiceParts?: Record<string, RecordingAudio> | null;
  /** Play only the melody, as the take (tuned) or on a piano, timed as it was sung. */
  melodyOnly?: MelodyTone;
}

const PANS = [-0.35, 0.35, -0.6, 0.6, 0];

export function effectiveGain(mix: MixState, id: string): number {
  const anySolo = Object.values(mix).some((m) => m.solo);
  const m = mix[id] ?? { gain: 0.8, mute: false, solo: false };
  if (m.mute) return 0;
  if (anySolo && !m.solo) return 0;
  return m.gain;
}

/** Synth notes start this much early so their attack is perceived on the beat. */
const ATTACK_LEAD = 0.01;

function scheduleNotes(voice: VocalVoice, notes: ScoreNote[], map: TimeMap, fromUnit: number, t0: number, origin: number, velocity = 1) {
  const at = (u: number) => t0 + map.sec(u) - origin - ATTACK_LEAD;
  let prevEnd = -Infinity;
  notes.forEach((n, i) => {
    const end = n.start + n.dur;
    if (end <= fromUnit) return;
    const ts = Math.max(t0, at(n.start));
    const te = at(end);
    const gap = n.start - prevEnd;
    const legato = gap <= 1;
    const samePitch = legato && notes[i - 1]?.midi === n.midi;
    voice.noteOn(ts, n.midi, { velocity, glide: legato, rearticulate: legato && !samePitch });
    const next = notes[i + 1];
    const nextGap = next ? next.start - end : 99;
    if (!next || nextGap > 1) voice.noteOff(Math.max(ts + 0.08, te), 0.22);
    prevEnd = end;
  });
}

/** A plain piano-like tone for each note: a clear reference for checking pitches by ear. */
function schedulePiano(ctx: BaseAudioContext, bus: MasterBus, notes: ScoreNote[], map: TimeMap, fromUnit: number, t0: number, origin: number): OscillatorNode[] {
  const out: OscillatorNode[] = [];
  for (const n of notes) {
    if (n.start + n.dur <= fromUnit) continue;
    const start = Math.max(n.start, fromUnit);
    const ts = t0 + map.sec(start) - origin;
    const te = t0 + map.sec(n.start + n.dur) - origin;
    const f = 440 * Math.pow(2, (n.midi - 69) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ts);
    g.gain.exponentialRampToValueAtTime(0.3, ts + 0.006);
    g.gain.exponentialRampToValueAtTime(0.09, ts + 0.45);
    g.gain.setTargetAtTime(0.0001, Math.max(ts + 0.05, te - 0.02), 0.06);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(7000, f * 4);
    lp.connect(g).connect(bus.input);
    for (const [mult, level, type] of [
      [1, 1, 'triangle'],
      [2, 0.18, 'sine'],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mult;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(lp);
      o.start(ts);
      o.stop(te + 0.4);
      out.push(o);
    }
  }
  return out;
}

/** Builds the voice graph for an arrangement on any (realtime or offline) context. */
function buildGraph(ctx: BaseAudioContext, bus: MasterBus, arr: Arrangement, opts: PlayOptions) {
  const parts: { part: VoicePart; voice: VocalVoice; gain: GainNode }[] = [];
  const sung: { part: VoicePart; src: AudioBufferSourceNode; gain: GainNode }[] = [];
  const list: VoicePart[] = opts.melodyOnly ? [] : [...(opts.melodySource === 'synth' ? [arr.melody] : []), ...arr.harmonies];
  list.forEach((p, i) => {
    const gain = ctx.createGain();
    gain.gain.value = effectiveGain(opts.mix, p.id);
    gain.connect(bus.input);
    const own = opts.voiceParts?.[p.id];
    if (own && p.id !== 'melody') {
      const buf = ctx.createBuffer(1, own.samples.length, own.sampleRate);
      buf.getChannelData(0).set(own.samples);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const pan = ctx.createStereoPanner();
      pan.pan.value = PANS[i % PANS.length];
      src.connect(pan).connect(gain);
      sung.push({ part: p, src, gain });
      return;
    }
    const notes = p.notes.map((n) => n.midi).sort((a, b) => a - b);
    const register = notes.length ? notes[notes.length >> 1] : 60;
    const voice = new VocalVoice(ctx, gain, {
      vowel: p.vowel,
      register,
      pan: p.id === 'melody' ? 0 : PANS[i % PANS.length],
      level: p.id === 'melody' ? 0.55 : 0.42,
    });
    parts.push({ part: p, voice, gain });
  });
  let recGain: GainNode | null = null;
  let recSrc: AudioBufferSourceNode | null = null;
  if ((opts.melodyOnly ? opts.melodyOnly === 'recording' : opts.melodySource === 'recording') && opts.recording) {
    const buf = ctx.createBuffer(1, opts.recording.samples.length, opts.recording.sampleRate);
    buf.getChannelData(0).set(opts.recording.samples);
    recSrc = ctx.createBufferSource();
    recSrc.buffer = buf;
    recGain = ctx.createGain();
    recGain.gain.value = opts.melodyOnly ? 1.1 : effectiveGain(opts.mix, 'melody') * 1.25;
    recSrc.connect(recGain).connect(bus.input);
  }
  return { parts, sung, recGain, recSrc };
}

function timeMapFor(arr: Arrangement, opts: PlayOptions): { map: TimeMap; followsRecording: boolean } {
  const ownVoice = !!opts.voiceParts && Object.keys(opts.voiceParts).length > 0;
  if ((opts.melodySource === 'recording' || ownVoice || opts.melodyOnly) && opts.recording && opts.transcription) {
    const tr = opts.transcription;
    return { map: TimeMap.fromPerformance(tr.notes, tr.bpm, tr.originSec), followsRecording: true };
  }
  return { map: TimeMap.linear(arr.bpm), followsRecording: false };
}

export class ArrangementPlayer {
  private graph: ReturnType<typeof buildGraph> | null = null;
  private startCtx = 0;
  private originSec = 0;
  private map: TimeMap | null = null;
  private endTimer: number | null = null;
  private pianoNotes: OscillatorNode[] = [];
  playing = false;
  onEnded?: () => void;

  async play(arr: Arrangement, opts: PlayOptions) {
    this.stop();
    const ctx = await resumeAudio();
    const bus = getMasterBus();
    const from = opts.fromUnit ?? 0;
    const { map } = timeMapFor(arr, opts);
    this.map = map;
    this.graph = buildGraph(ctx, bus, arr, opts);
    const t0 = ctx.currentTime + 0.12;
    this.startCtx = t0;
    this.originSec = map.sec(from);
    this.graph.parts.forEach(({ part, voice }) => {
      voice.start(t0 - 0.05);
      scheduleNotes(voice, part.notes, map, from, t0, this.originSec, part.id === 'melody' ? 1 : 0.95);
    });
    if (this.graph.recSrc) this.graph.recSrc.start(t0, Math.max(0, this.originSec));
    if (opts.melodyOnly === 'piano') this.pianoNotes = schedulePiano(ctx, bus, arr.melody.notes, map, from, t0, this.originSec);
    this.graph.sung.forEach(({ src }) => src.start(t0, Math.max(0, this.originSec)));
    this.playing = true;
    const endSec = map.sec(arr.totalUnits) - this.originSec + 1.2;
    this.endTimer = window.setTimeout(() => {
      this.stop();
      this.onEnded?.();
    }, endSec * 1000);
  }

  setMix(mix: MixState) {
    if (!this.graph) return;
    const ctx = getAudioContext();
    [...this.graph.parts, ...this.graph.sung].forEach(({ part, gain }) => gain.gain.setTargetAtTime(effectiveGain(mix, part.id), ctx.currentTime, 0.03));
    this.graph.recGain?.gain.setTargetAtTime(effectiveGain(mix, 'melody') * 1.25, ctx.currentTime, 0.03);
  }

  /** Current playback position in score units (compensating output latency). */
  position(): number {
    if (!this.playing || !this.map) return 0;
    const ctx = getAudioContext();
    const elapsed = ctx.currentTime - this.startCtx - outputLatency();
    return this.map.unit(this.originSec + Math.max(0, elapsed));
  }

  stop() {
    if (this.endTimer !== null) window.clearTimeout(this.endTimer);
    this.endTimer = null;
    for (const o of this.pianoNotes)
      try {
        o.stop();
      } catch {
        /* not started */
      }
    this.pianoNotes = [];
    if (this.graph) {
      const ctx = getAudioContext();
      const g = this.graph;
      g.parts.forEach(({ voice }) => voice.stop(ctx.currentTime));
      for (const s of [g.recSrc, ...g.sung.map((x) => x.src)])
        try {
          s?.stop();
        } catch {
          /* not started */
        }
      window.setTimeout(() => {
        g.parts.forEach(({ gain, voice }) => {
          voice.disconnect();
          gain.disconnect();
        });
        g.sung.forEach(({ gain }) => gain.disconnect());
        g.recGain?.disconnect();
      }, 600);
    }
    this.graph = null;
    this.playing = false;
  }
}

/** Offline render of the arrangement to a stereo AudioBuffer (WAV export). */
export async function renderArrangement(arr: Arrangement, opts: PlayOptions): Promise<AudioBuffer> {
  const sr = 44100;
  const { map } = timeMapFor(arr, opts);
  const origin = map.sec(0);
  const duration = map.sec(arr.totalUnits) - origin + 2.5;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sr), sr);
  const bus = new MasterBus(ctx, ctx.destination);
  const g = buildGraph(ctx, bus, arr, opts);
  const t0 = 0.05;
  g.parts.forEach(({ part, voice }) => {
    voice.start(0);
    scheduleNotes(voice, part.notes, map, 0, t0, origin);
  });
  for (const src of [g.recSrc, ...g.sung.map((x) => x.src)]) {
    if (!src) continue;
    if (origin >= 0) src.start(t0, origin);
    else src.start(t0 - origin, 0);
  }
  return ctx.startRendering();
}
