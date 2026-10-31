import { UNITS_PER_BEAT, type MelodyNote } from './types';

/** Piecewise-linear mapping between score units and seconds. */
export class TimeMap {
  private units: number[];
  private secs: number[];
  constructor(anchors: { unit: number; sec: number }[], readonly unitSec: number) {
    const sorted = anchors.slice().sort((a, b) => a.unit - b.unit);
    const u: number[] = [];
    const s: number[] = [];
    for (const a of sorted) {
      if (u.length && (a.unit <= u[u.length - 1] || a.sec <= s[s.length - 1])) continue;
      u.push(a.unit);
      s.push(a.sec);
    }
    if (!u.length) {
      u.push(0);
      s.push(0);
    }
    this.units = u;
    this.secs = s;
  }

  static linear(bpm: number): TimeMap {
    const unitSec = 60 / bpm / UNITS_PER_BEAT;
    return new TimeMap([{ unit: 0, sec: 0 }], unitSec);
  }

  /** Follows the performed timing of the recording (seconds are recording time). */
  static fromPerformance(notes: MelodyNote[], bpm: number, originSec: number): TimeMap {
    const unitSec = 60 / bpm / UNITS_PER_BEAT;
    const anchors = [{ unit: 0, sec: originSec }, ...notes.map((n) => ({ unit: n.start, sec: n.time }))];
    if (notes.length) {
      const last = notes[notes.length - 1];
      anchors.push({ unit: last.start + last.dur, sec: Math.max(last.end, last.time + last.dur * unitSec * 0.5) });
    }
    return new TimeMap(anchors, unitSec);
  }

  sec(unit: number): number {
    const { units: u, secs: s } = this;
    if (u.length === 1 || unit <= u[0]) return s[0] + (unit - u[0]) * this.unitSec;
    if (unit >= u[u.length - 1]) return s[s.length - 1] + (unit - u[u.length - 1]) * this.unitSec;
    let lo = 0;
    let hi = u.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (u[mid] <= unit) lo = mid;
      else hi = mid;
    }
    return s[lo] + ((unit - u[lo]) / (u[hi] - u[lo])) * (s[hi] - s[lo]);
  }

  unit(sec: number): number {
    const { units: u, secs: s } = this;
    if (s.length === 1 || sec <= s[0]) return u[0] + (sec - s[0]) / this.unitSec;
    if (sec >= s[s.length - 1]) return u[u.length - 1] + (sec - s[s.length - 1]) / this.unitSec;
    let lo = 0;
    let hi = s.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid] <= sec) lo = mid;
      else hi = mid;
    }
    return u[lo] + ((sec - s[lo]) / (s[hi] - s[lo])) * (u[hi] - u[lo]);
  }
}
