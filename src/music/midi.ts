import { Midi } from '@tonejs/midi';
import { QUALITY_INTERVALS } from './chords';
import { pcNameInKey } from './theory';
import { UNITS_PER_BEAT, type Arrangement } from './types';

export function toMidi(arr: Arrangement, includeChordsTrack = false): Uint8Array {
  const midi = new Midi();
  const ppq = midi.header.ppq;
  const tick = (units: number) => Math.round((units / UNITS_PER_BEAT) * ppq);
  midi.header.setTempo(arr.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [arr.timeSig.beats, arr.timeSig.beatType] });
  midi.header.keySignatures.push({
    ticks: 0,
    key: pcNameInKey(arr.key.tonic, arr.key).replace('♯', '#').replace('♭', 'b'),
    scale: arr.key.mode,
  });
  midi.header.name = 'Harmonia';
  midi.header.update();

  const parts = [arr.melody, ...arr.harmonies];
  parts.forEach((p, i) => {
    const track = midi.addTrack();
    track.name = p.name;
    track.channel = i;
    track.instrument.number = i === 0 ? 54 : 53; // Voice Oohs / Choir Aahs
    for (const n of p.notes) {
      track.addNote({
        midi: n.midi,
        ticks: tick(n.start),
        durationTicks: Math.max(1, tick(n.dur) - 2),
        velocity: i === 0 ? 0.85 : 0.7,
      });
    }
  });
  if (includeChordsTrack) {
    const track = midi.addTrack();
    track.name = 'Chords';
    track.channel = parts.length;
    track.instrument.number = 0;
    for (const c of arr.chords) {
      const base = 48 + c.root;
      for (const iv of QUALITY_INTERVALS[c.quality].slice(0, 4)) track.addNote({ midi: base + iv, ticks: tick(c.start), durationTicks: tick(c.dur), velocity: 0.4 });
    }
  }
  return midi.toArray();
}
