import type { Key } from '../music/theory';
export { MELODY_COLOR } from '../music/types';
export type { Arrangement } from '../music/types';

export interface SampleMelodyLike {
  notes: [number, number][];
  beatsPerBar: number;
  bpm: number;
  key: Key;
  pickupBeats: number;
  syllables?: string[];
}
