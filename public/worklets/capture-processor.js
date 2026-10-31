/* Harmonia capture processor.
 * Runs on the audio rendering thread:
 *  - streams raw microphone audio to the main thread while recording
 *  - decimates to ~16 kHz and runs YIN pitch detection every 256 input samples
 *    (≈5.3 ms at 48 kHz), posting {t, f0, clarity, rms} frames for live tracking.
 * The YIN implementation mirrors src/music/pitch.ts.
 */

class YinDetector {
  constructor(sr, windowSize, minFreq, maxFreq, threshold) {
    this.sr = sr;
    this.W = windowSize;
    this.tauMin = Math.max(2, Math.floor(sr / maxFreq));
    this.tauMax = Math.ceil(sr / minFreq);
    this.threshold = threshold;
    this.d = new Float32Array(this.tauMax + 2);
  }
  get frameLength() {
    return this.W + this.tauMax + 1;
  }
  detect(buf) {
    const W = this.W;
    const d = this.d;
    const tauMax = this.tauMax;
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const delta = buf[j] - buf[j + tau];
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
      const den = a + c - 2 * b;
      if (Math.abs(den) > 1e-12) refined = tau + (a - c) / (2 * den);
    }
    return { freq: this.sr / refined, clarity };
  }
}

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.factor = Math.max(1, Math.round(sampleRate / 16000));
    this.sr2 = sampleRate / this.factor;
    this.W = Math.round((o.windowSec || 0.022) * this.sr2);
    this.yin = new YinDetector(this.sr2, this.W, o.minFreq || 70, o.maxFreq || 1100, 0.15);
    this.len = this.yin.frameLength;
    this.ring = new Float32Array(this.len);
    this.lin = new Float32Array(this.len);
    this.write = 0;
    this.filled = 0;
    this.acc = 0;
    this.accN = 0;
    this.hop = o.hop || 256;
    this.sinceHop = 0;
    this.detect = o.detect !== false;
    this.recording = false;
    this.recBuf = new Float32Array(4096);
    this.recN = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'record') {
        if (!m.on && this.recN > 0) this.flushRec();
        this.recording = !!m.on;
        this.recStartPending = !!m.on;
        if (!m.on) this.port.postMessage({ type: 'recstop' });
      } else if (m.type === 'detect') {
        this.detect = !!m.on;
      }
    };
  }

  flushRec() {
    const chunk = this.recBuf.slice(0, this.recN);
    this.port.postMessage({ type: 'audio', samples: chunk, t: currentTime }, [chunk.buffer]);
    this.recN = 0;
  }

  analyse(endTime) {
    // unroll ring buffer into linear buffer (oldest first)
    const n = this.len;
    let k = this.write;
    for (let i = 0; i < n; i++) {
      this.lin[i] = this.ring[k];
      k = k + 1 === n ? 0 : k + 1;
    }
    // rms over the most recent window
    let e = 0;
    for (let i = n - this.W; i < n; i++) e += this.lin[i] * this.lin[i];
    const rms = Math.sqrt(e / this.W);
    let f0 = 0;
    let clarity = 0;
    if (rms > 2e-4) {
      const r = this.yin.detect(this.lin);
      f0 = r.freq;
      clarity = r.clarity;
    }
    // time stamp = centre of the analysed window
    const t = endTime - n / this.sr2 / 2;
    this.port.postMessage({ type: 'pitch', t, f0, clarity, rms });
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (outputs[0] && outputs[0][0]) outputs[0][0].fill(0);
    if (!ch) return true;
    if (this.recording) {
      if (this.recStartPending) {
        this.recStartPending = false;
        this.port.postMessage({ type: 'recstart', t: currentTime });
      }
      for (let i = 0; i < ch.length; i++) {
        this.recBuf[this.recN++] = ch[i];
        if (this.recN === this.recBuf.length) this.flushRec();
      }
    }
    if (!this.detect) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      if (++this.accN === this.factor) {
        this.ring[this.write] = this.acc / this.factor;
        this.write = this.write + 1 === this.len ? 0 : this.write + 1;
        if (this.filled < this.len) this.filled++;
        this.acc = 0;
        this.accN = 0;
      }
    }
    if (this.filled < this.len) return true;
    this.sinceHop += ch.length;
    if (this.sinceHop >= this.hop) {
      this.sinceHop -= this.hop;
      this.analyse(currentTime + ch.length / sampleRate);
    }
    return true;
  }
}

registerProcessor('harmonia-capture', CaptureProcessor);
