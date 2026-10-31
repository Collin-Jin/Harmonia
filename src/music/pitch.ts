/**
 * YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002) with
 * cumulative-mean-normalised difference, absolute threshold and parabolic
 * interpolation. The same algorithm runs inside the live AudioWorklet
 * (public/worklets/capture-processor.js).
 */
export interface YinResult {
  freq: number; // Hz, 0 when no pitch found
  clarity: number; // 1 - normalised difference at the chosen lag (0..1)
}

export class Yin {
  private diff: Float32Array;
  readonly tauMin: number;
  readonly tauMax: number;

  constructor(
    readonly sampleRate: number,
    readonly windowSize: number,
    minFreq = 65,
    maxFreq = 1100,
    readonly threshold = 0.15,
  ) {
    this.tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
    this.tauMax = Math.ceil(sampleRate / minFreq);
    this.diff = new Float32Array(this.tauMax + 2);
  }

  /** Number of samples required by `detect` (window + max lag). */
  get frameLength() {
    return this.windowSize + this.tauMax + 1;
  }

  detect(buf: Float32Array, offset = 0): YinResult {
    const W = this.windowSize;
    const d = this.diff;
    const tauMax = this.tauMax;
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const delta = buf[offset + j] - buf[offset + j + tau];
        sum += delta * delta;
      }
      running += sum;
      d[tau] = running > 0 ? (sum * tau) / running : 1;
    }
    let tau = -1;
    for (let t = this.tauMin; t <= tauMax; t++) {
      if (d[t] < this.threshold) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau === -1) {
      // No dip under threshold: take the global minimum but report low clarity.
      let best = this.tauMin;
      for (let t = this.tauMin + 1; t <= tauMax; t++) if (d[t] < d[best]) best = t;
      tau = best;
    }
    const clarity = Math.max(0, Math.min(1, 1 - d[tau]));
    let refined = tau;
    if (tau > 1 && tau < tauMax) {
      const a = d[tau - 1];
      const b = d[tau];
      const c = d[tau + 1];
      const denom = a + c - 2 * b;
      if (Math.abs(denom) > 1e-12) refined = tau + (a - c) / (2 * denom);
    }
    return { freq: this.sampleRate / refined, clarity };
  }
}

/** Box-filter decimation by an integer factor (adequate anti-aliasing for voice F0 analysis). */
export function decimate(samples: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return samples;
  const n = Math.floor(samples.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const base = i * factor;
    for (let k = 0; k < factor; k++) s += samples[base + k];
    out[i] = s / factor;
  }
  return out;
}

export function decimationFactor(sampleRate: number): number {
  return Math.max(1, Math.round(sampleRate / 16000));
}
