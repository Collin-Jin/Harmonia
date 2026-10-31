import { diatonicStep, mod12, type Key } from './theory';
import { UNITS_PER_BEAT, type Arrangement } from './types';

/* ================================================================== */
/* Online note segmentation from a stream of pitch frames              */
/* ================================================================== */

export interface LiveFrame {
  t: number; // seconds (AudioContext time of the analysed window's centre)
  midi: number | null;
  clarity: number;
  rms: number;
}

export type LiveEvent =
  | { type: 'onset'; t: number; midi: number; revision: boolean; rearticulation: boolean }
  | { type: 'pitch'; t: number; midi: number; rms: number }
  | { type: 'offset'; t: number };

const med = (a: number[]) => {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface SegmenterOptions {
  hopSec: number;
  onFrames?: number; // stable frames needed to declare an onset
  changeFrames?: number; // stable frames needed to declare a pitch change
  offSec?: number; // silence needed to declare an offset
  clarityMin?: number;
}

export class LiveNoteSegmenter {
  private active = false;
  private pending: { t: number; m: number }[] = [];
  private changeBuf: { t: number; m: number }[] = [];
  private recent: number[] = [];
  private silentFor = 0;
  private noiseFloor = 0.0015;
  private envPeak = 0;
  private hist: { t: number; rms: number }[] = [];
  private inRange = 0;
  private onsetT = 0;
  private revised = false;
  readonly o: Required<SegmenterOptions>;

  constructor(opts: SegmenterOptions) {
    this.o = { onFrames: 3, changeFrames: 4, offSec: 0.08, clarityMin: 0.8, ...opts };
  }

  get isActive() {
    return this.active;
  }

  process(f: LiveFrame): LiveEvent[] {
    const out: LiveEvent[] = [];
    const thr = Math.max(this.noiseFloor * 3.5, 0.004);
    const voiced = f.midi !== null && f.clarity >= this.o.clarityMin && f.rms >= thr && f.midi >= 34 && f.midi <= 98;
    if (!voiced) {
      if (f.rms < this.noiseFloor) this.noiseFloor = 0.9 * this.noiseFloor + 0.1 * Math.max(f.rms, 1e-5);
      else this.noiseFloor = Math.min(0.03, this.noiseFloor * 1.0008);
    }
    if (!this.active) {
      if (voiced) {
        this.pending.push({ t: f.t, m: f.midi as number });
        if (this.pending.length > this.o.onFrames) this.pending.shift();
        const ms = this.pending.map((p) => p.m);
        if (this.pending.length >= this.o.onFrames && Math.max(...ms) - Math.min(...ms) < 0.8) {
          this.startNote(this.pending[0].t, med(ms), f.rms, out, false);
        }
      } else this.pending = [];
      return out;
    }
    // Active note
    this.hist.push({ t: f.t, rms: f.rms });
    if (this.hist.length > 48) this.hist.shift();
    if (!voiced) {
      this.silentFor += this.o.hopSec;
      if (this.silentFor >= this.o.offSec) {
        this.active = false;
        this.pending = [];
        this.hist = [];
        out.push({ type: 'offset', t: f.t - this.silentFor });
      }
      return out;
    }
    const m = f.midi as number;
    this.silentFor = 0;
    // Re-articulation: an energy dip followed by a re-attack (new syllable on the same pitch).
    const H = this.hist;
    const hop = this.o.hopSec;
    const nRecent = Math.max(3, Math.round(0.045 / hop));
    const nPre = Math.round(0.13 / hop);
    if (H.length >= nPre && f.t - this.onsetT > 0.12) {
      let pre = 0;
      for (let k = H.length - nPre; k < H.length - nRecent; k++) pre = Math.max(pre, H[k].rms);
      let dip = Infinity;
      let dipT = f.t;
      for (let k = H.length - nRecent; k < H.length; k++)
        if (H[k].rms < dip) {
          dip = H[k].rms;
          dipT = H[k].t;
        }
      if (dip < 0.62 * pre && f.rms > 0.78 * pre && f.rms > H[H.length - 2].rms && dipT > this.onsetT + 0.08) {
        this.startNote(dipT, m, f.rms, out, true);
        return out;
      }
    }
    if (f.rms > this.envPeak) this.envPeak = f.rms;
    else this.envPeak *= 0.997;
    const ref = med(this.recent);
    if (Math.abs(m - ref) > 0.55) {
      this.changeBuf.push({ t: f.t, m });
      this.inRange = 0;
      const ms = this.changeBuf.map((p) => p.m).slice(-this.o.changeFrames);
      if (Math.max(...ms) - Math.min(...ms) > 1.0) {
        this.changeBuf = this.changeBuf.slice(-1);
      } else if (this.changeBuf.length >= this.o.changeFrames && Math.abs(med(ms) - ref) > 0.6) {
        const newM = med(ms);
        const age = this.changeBuf[0].t - this.onsetT;
        if (age < 0.07 && !this.revised) {
          // The onset was a scoop / attack transient: revise its pitch instead of advancing.
          this.revised = true;
          this.recent = ms.slice();
          this.changeBuf = [];
          out.push({ type: 'onset', t: this.onsetT, midi: newM, revision: true, rearticulation: false });
        } else {
          this.startNote(this.changeBuf[0].t, newM, f.rms, out, false);
          this.recent = ms.slice();
        }
      }
      return out;
    }
    // Tolerate a single in-range frame (vibrato swing) before abandoning a pending change.
    if (this.changeBuf.length && ++this.inRange <= 1) return out;
    this.changeBuf = [];
    this.recent.push(m);
    if (this.recent.length > 24) this.recent.shift();
    out.push({ type: 'pitch', t: f.t, midi: med(this.recent.slice(-6)), rms: f.rms });
    return out;
  }

  private startNote(t: number, m: number, rms: number, out: LiveEvent[], rearticulation: boolean) {
    this.active = true;
    this.onsetT = t;
    this.revised = false;
    this.recent = [m];
    this.changeBuf = [];
    this.pending = [];
    this.envPeak = rms;
    this.silentFor = 0;
    out.push({ type: 'onset', t, midi: m, revision: false, rearticulation });
  }
}

/* ================================================================== */
/* Probabilistic score follower                                        */
/* ================================================================== */

export interface FollowerNote {
  midi: number;
  time: number; // reference onset time (s) at the arrangement tempo
}

export interface FollowState {
  index: number; // most likely melody note
  confidence: number; // posterior mass of that position (0..1)
  transpose: number; // semitones the singer is transposed relative to the score
  tuningCents: number; // fine intonation offset
  tempoRatio: number; // >1 means faster than the score
  advanced: boolean; // moved to index+1 since the previous onset
}

export interface FollowerOptions {
  allowTranspose: boolean;
  pitchSigma?: number;
}

export class ScoreFollower {
  private readonly T: number[];
  private belief: Float64Array[]; // [transposeIdx][noteIdx]
  private snapshot: { belief: Float64Array[]; lastT: number | null; lastIdx: number; tempo: number; tuning: number; started: boolean } | null = null;
  private lastT: number | null = null;
  private lastIdx = -1;
  private tempo = 1;
  private tuning = 0; // semitones
  private started = false;
  private readonly sigma: number;

  constructor(readonly notes: FollowerNote[], readonly opts: FollowerOptions) {
    this.T = opts.allowTranspose ? Array.from({ length: 15 }, (_, i) => i - 7) : [0];
    this.sigma = opts.pitchSigma ?? 0.55;
    this.belief = this.T.map(() => new Float64Array(notes.length));
    this.reset();
  }

  reset() {
    const N = this.notes.length;
    const tw = this.T.map((t) => (t === 0 ? 3 : Math.exp(-Math.abs(t) / 3)));
    const tSum = tw.reduce((s, v) => s + v, 0);
    this.T.forEach((_, ti) => {
      const b = this.belief[ti];
      for (let j = 0; j < N; j++) b[j] = (tw[ti] / tSum) * ((j === 0 ? 0.45 : 0) + 0.55 / N);
    });
    this.lastT = null;
    this.lastIdx = -1;
    this.tempo = 1;
    this.tuning = 0;
    this.started = false;
    this.snapshot = null;
  }

  get state(): FollowState {
    return this.computeState(false);
  }

  private computeState(advanced: boolean): FollowState {
    const N = this.notes.length;
    let bestJ = 0;
    let bestP = -1;
    for (let j = 0; j < N; j++) {
      let p = 0;
      for (let ti = 0; ti < this.T.length; ti++) p += this.belief[ti][j];
      if (p > bestP) {
        bestP = p;
        bestJ = j;
      }
    }
    let bestT = 0;
    let bestTP = -1;
    for (let ti = 0; ti < this.T.length; ti++) {
      let p = 0;
      for (let j = 0; j < N; j++) p += this.belief[ti][j];
      if (p > bestTP) {
        bestTP = p;
        bestT = ti;
      }
    }
    return {
      index: this.started ? bestJ : -1,
      confidence: this.started ? bestP : 0,
      transpose: this.T[bestT],
      tuningCents: Math.round(this.tuning * 100),
      tempoRatio: this.tempo,
      advanced,
    };
  }

  /** Feed a detected note onset. `revision` replaces the previous onset's pitch (scoop correction). */
  onset(midi: number, t: number, revision = false): FollowState {
    const N = this.notes.length;
    if (!N) return this.state;
    if (revision && this.snapshot) {
      this.belief = this.snapshot.belief.map((b) => Float64Array.from(b));
      this.lastT = this.snapshot.lastT;
      this.lastIdx = this.snapshot.lastIdx;
      this.tempo = this.snapshot.tempo;
      this.tuning = this.snapshot.tuning;
      this.started = this.snapshot.started;
    } else {
      this.snapshot = {
        belief: this.belief.map((b) => Float64Array.from(b)),
        lastT: this.lastT,
        lastIdx: this.lastIdx,
        tempo: this.tempo,
        tuning: this.tuning,
        started: this.started,
      };
    }
    const dt = this.lastT === null ? null : t - this.lastT;
    const timingInformative = dt !== null && dt > 0.04 && dt < 4;
    const timingFactor = (i: number, j: number) => {
      if (!timingInformative || j <= i) return 1;
      const exp = (this.notes[j].time - this.notes[i].time) / this.tempo;
      if (exp <= 0.02) return 1;
      const z = Math.log((dt as number) / exp) / 0.45;
      return Math.max(0.04, Math.exp(-0.5 * z * z));
    };

    const prior = this.T.map(() => new Float64Array(N));
    const JUMP = this.started ? 0.04 : 0;
    for (let ti = 0; ti < this.T.length; ti++) {
      const b = this.belief[ti];
      const p = prior[ti];
      let mass = 0;
      for (let i = 0; i < N; i++) mass += b[i];
      if (!this.started) {
        // First onset: the belief is already a prior over starting positions.
        for (let j = 0; j < N; j++) p[j] = b[j];
        continue;
      }
      for (let i = 0; i < N; i++) {
        const bi = b[i];
        if (bi < 1e-9) continue;
        const add = (j: number, w: number) => {
          if (j < 0) return;
          if (j >= N) {
            p[j - N] += bi * w; // wrap: singing the melody again from the top
            return;
          }
          p[j] += bi * w * timingFactor(i, j);
        };
        add(i + 1, 0.8);
        add(i + 2, 0.06);
        add(i + 3, 0.015);
        p[i] += bi * 0.05; // spurious re-attack of the same note
        add(i - 1, 0.01);
        add(i - 2, 0.006);
      }
      const jump = (mass * JUMP) / N;
      for (let j = 0; j < N; j++) p[j] += jump;
    }
    // Emission
    const s2 = 2 * this.sigma * this.sigma;
    let total = 0;
    for (let ti = 0; ti < this.T.length; ti++) {
      const p = prior[ti];
      const tr = this.T[ti];
      for (let j = 0; j < N; j++) {
        if (p[j] === 0) continue;
        const d = midi - (this.notes[j].midi + tr + this.tuning);
        const dOct = Math.min(Math.abs(d - 12), Math.abs(d + 12));
        const e = 0.88 * Math.exp((-d * d) / s2) + 0.06 * Math.exp((-dOct * dOct) / s2) + 0.012;
        p[j] *= e;
        total += p[j];
      }
    }
    if (total <= 0) {
      this.reset();
      return this.state;
    }
    for (let ti = 0; ti < this.T.length; ti++) for (let j = 0; j < N; j++) prior[ti][j] /= total;
    this.belief = prior;
    const wasStarted = this.started;
    this.started = true;
    const st = this.computeState(false);
    const advanced = wasStarted && (st.index === this.lastIdx + 1 || (this.lastIdx === N - 1 && st.index === 0));
    if (st.confidence > 0.45) {
      const dev = midi - (this.notes[st.index].midi + st.transpose);
      if (Math.abs(dev) < 0.6) this.tuning += 0.25 * (dev - this.tuning);
      this.tuning = Math.max(-0.5, Math.min(0.5, this.tuning));
      if (advanced && dt !== null && st.index > 0) {
        const ref = this.notes[st.index].time - this.notes[st.index - 1].time;
        if (ref > 0.06 && dt > 0.04) {
          const sample = Math.max(0.4, Math.min(2.5, ref / dt));
          this.tempo = Math.exp(0.7 * Math.log(this.tempo) + 0.3 * Math.log(sample));
          this.tempo = Math.max(0.5, Math.min(2, this.tempo));
        }
      }
    }
    this.lastT = t;
    this.lastIdx = st.index;
    return { ...st, advanced };
  }
}

/* ================================================================== */
/* Harmony controller: follower state -> voice commands               */
/* ================================================================== */

export type VoiceCommand =
  | { voice: number; action: 'on'; midi: number; rearticulate: boolean }
  | { voice: number; action: 'off' };

export interface ControllerOptions {
  allowTranspose: boolean;
  followIntonation: boolean;
  minConfidence?: number;
}

export interface ControllerStatus {
  mode: 'waiting' | 'following' | 'free';
  index: number;
  expectedMidi: number | null;
  sungMidi: number | null;
  confidence: number;
  transpose: number;
  tempoRatio: number;
  centsOff: number;
  voicePitches: (number | null)[];
}

export class LiveHarmonyController {
  readonly follower: ScoreFollower;
  private sounding: (number | null)[];
  private freeSteps: number[];
  private refMidi: number | null = null;
  status: ControllerStatus;

  constructor(public arr: Arrangement, readonly opts: ControllerOptions) {
    const unitSec = 60 / arr.bpm / UNITS_PER_BEAT;
    const notes = arr.melody.notes.map((n) => ({ midi: n.midi, time: n.start * unitSec }));
    this.follower = new ScoreFollower(notes, { allowTranspose: opts.allowTranspose });
    this.sounding = arr.harmonies.map(() => null);
    this.freeSteps = LiveHarmonyController.freeSteps(arr);
    this.status = {
      mode: 'waiting',
      index: -1,
      expectedMidi: null,
      sungMidi: null,
      confidence: 0,
      transpose: 0,
      tempoRatio: 1,
      centsOff: 0,
      voicePitches: this.sounding.slice(),
    };
  }

  /** Typical diatonic distance of each voice from the melody (used when improvising off-score). */
  private static freeSteps(arr: Arrangement): number[] {
    return arr.harmonies.map((_, v) => {
      const diffs = arr.live.map((s, i) => (s.pitches[v] === null ? null : (s.pitches[v] as number) - arr.melody.notes[i].midi)).filter((x): x is number => x !== null);
      const d = diffs.length ? med(diffs) : v % 2 ? -4 : 4;
      return Math.round((d / 12) * 7) || (d >= 0 ? 2 : -2);
    });
  }

  /**
   * Switch to a re-harmonized arrangement of the same melody without losing the place in
   * the song. Returns false when the melody, tempo or voice count changed (restart needed).
   */
  retarget(arr: Arrangement): boolean {
    const a = this.arr.melody.notes;
    const b = arr.melody.notes;
    if (arr.bpm !== this.arr.bpm || arr.harmonies.length !== this.arr.harmonies.length || a.length !== b.length) return false;
    if (a.some((n, i) => n.midi !== b[i].midi || n.start !== b[i].start)) return false;
    this.arr = arr;
    this.freeSteps = LiveHarmonyController.freeSteps(arr);
    return true;
  }

  private transposedKey(t: number): Key {
    return { tonic: mod12(this.arr.key.tonic + t), mode: this.arr.key.mode };
  }

  onset(midi: number, t: number, revision: boolean, rearticulation: boolean): VoiceCommand[] {
    const st = this.follower.onset(midi, t, revision);
    const minConf = this.opts.minConfidence ?? 0.3;
    const cmds: VoiceCommand[] = [];
    const targets: (number | null)[] = [];
    let retrig: boolean[];
    if (st.index >= 0 && st.confidence >= minConf) {
      const step = this.arr.live[st.index];
      step.pitches.forEach((p) => targets.push(p === null ? null : p + st.transpose));
      retrig = step.retrigger.map((r) => r || rearticulation);
      this.refMidi = this.arr.melody.notes[st.index].midi + st.transpose;
      this.status.mode = 'following';
      this.status.expectedMidi = this.refMidi;
    } else {
      const key = this.transposedKey(st.transpose);
      const base = Math.round(midi - st.tuningCents / 100);
      this.freeSteps.forEach((s) => targets.push(diatonicStep(base, s, key)));
      retrig = targets.map(() => true);
      this.refMidi = base;
      this.status.mode = 'free';
      this.status.expectedMidi = null;
    }
    targets.forEach((p, v) => {
      if (p === null) {
        if (this.sounding[v] !== null) cmds.push({ voice: v, action: 'off' });
        this.sounding[v] = null;
        return;
      }
      if (this.sounding[v] === p && !retrig[v]) return;
      cmds.push({ voice: v, action: 'on', midi: p, rearticulate: this.sounding[v] !== null });
      this.sounding[v] = p;
    });
    Object.assign(this.status, {
      index: st.index,
      sungMidi: midi,
      confidence: st.confidence,
      transpose: st.transpose,
      tempoRatio: st.tempoRatio,
      voicePitches: this.sounding.slice(),
    });
    return cmds;
  }

  /** Continuous pitch while a note is held: returns detune (cents) to apply to all voices. */
  pitch(midi: number): number {
    this.status.sungMidi = midi;
    if (this.refMidi === null) return 0;
    const dev = (midi - this.refMidi) * 100;
    this.status.centsOff = Math.round(dev);
    if (!this.opts.followIntonation || Math.abs(dev) > 80) return 0;
    return Math.max(-50, Math.min(50, dev));
  }

  offset(): VoiceCommand[] {
    const cmds: VoiceCommand[] = [];
    this.sounding.forEach((p, v) => {
      if (p !== null) cmds.push({ voice: v, action: 'off' });
      this.sounding[v] = null;
    });
    this.status.voicePitches = this.sounding.slice();
    this.status.sungMidi = null;
    return cmds;
  }
}
