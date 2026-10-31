import { mod12, type Key } from './theory';

// Krumhansl–Kessler key profiles.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export interface KeyCandidate extends Key {
  score: number;
}

/**
 * Estimate the key of a melody from duration-weighted pitch classes, with
 * extra weight on the final note (melodies very often end on the tonic) and
 * a smaller one on the first note.
 */
export function detectKey(notes: { midi: number; dur: number }[]): KeyCandidate[] {
  const hist = new Array(12).fill(0);
  notes.forEach((n) => (hist[mod12(n.midi)] += Math.sqrt(Math.max(n.dur, 0.01))));
  const results: KeyCandidate[] = [];
  const last = notes.length ? mod12(notes[notes.length - 1].midi) : -1;
  const first = notes.length ? mod12(notes[0].midi) : -1;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const prof = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE;
      const rotated = prof.map((_, i) => prof[mod12(i - tonic)]);
      let score = pearson(hist, rotated);
      if (last === tonic) score += 0.12;
      else if (last === mod12(tonic + 7)) score += 0.02;
      if (first === tonic) score += 0.04;
      else if (first === mod12(tonic + 7)) score += 0.02;
      // Slight prior towards major (more common in sung melodies).
      if (mode === 'major') score += 0.01;
      results.push({ tonic, mode, score });
    }
  }
  results.sort((a, b) => b.score - a.score);
  const top = results[0];
  const second = results[1];
  top.confidence = Math.max(0, Math.min(1, (top.score - second.score) * 4 + top.score * 0.5));
  return results;
}
