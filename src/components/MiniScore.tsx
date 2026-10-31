import { useEffect, useRef } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { toMusicXML } from '../music/musicxml';
import { MELODY_COLOR, type Arrangement, type SampleMelodyLike } from './miniScoreTypes';

/** Renders a single-line melody (e.g. a sample to sing along to) as notation. */
export function MiniScore({ melody }: { melody: SampleMelodyLike }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const pickup = melody.pickupBeats * 4;
    let pos = pickup;
    const notes = melody.notes
      .map(([m, b]) => {
        const n = { midi: m, start: pos, dur: Math.round(b * 4) };
        pos += n.dur;
        return n;
      })
      .filter((n) => n.midi > 0);
    const bar = melody.beatsPerBar * 4;
    const arr: Arrangement = {
      melody: { id: 'melody', name: 'Melody', short: 'Mel', clef: 'treble', notes, color: MELODY_COLOR, vowel: 'ah', sound: 'lyrics' },
      harmonies: [],
      chords: [],
      key: melody.key,
      timeSig: { beats: melody.beatsPerBar, beatType: 4 },
      bpm: melody.bpm,
      totalUnits: Math.ceil(pos / bar) * bar,
      live: [],
      options: { style: 'pop', voices: 0, placement: 'around', harmonicRhythm: 'auto', complexity: 0, seed: 0 },
    };
    const osmd = new OpenSheetMusicDisplay(el, {
      backend: 'svg',
      autoResize: true,
      drawTitle: false,
      drawPartNames: false,
      drawMeasureNumbers: false,
      autoBeam: true,
    });
    osmd
      .load(toMusicXML(arr, { includeChords: false }))
      .then(() => {
        if (cancelled) return;
        osmd.zoom = 0.62;
        osmd.render();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      el.innerHTML = '';
    };
  }, [melody]);
  return <div className="mini-score" ref={ref} />;
}
