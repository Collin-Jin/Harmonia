import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Undo2, WandSparkles, X } from 'lucide-react';
import { useStore } from '../state/store';
import { suggestChords } from '../music/chords';
import { UNITS_PER_BEAT, type Arrangement, type Chord } from '../music/types';

const SHOWN = 8;

/** "Bar 4, beats 1–2", "Bar 3", "Bars 7–8" for a span of the song. */
function spanLabel(arr: Arrangement, c: Chord): string {
  const bar = arr.timeSig.beats * UNITS_PER_BEAT;
  const first = arr.melody.notes[0]?.start ?? 0;
  const offset = first % bar !== 0 ? 0 : 1; // a pickup bar is bar 0
  const b0 = Math.floor(c.start / bar);
  const b1 = Math.floor((c.start + c.dur - 1) / bar);
  if (b0 !== b1) return `Bars ${b0 + offset}–${b1 + offset}`;
  const beat0 = (c.start % bar) / UNITS_PER_BEAT + 1;
  const beat1 = ((c.start + c.dur - 1) % bar) / UNITS_PER_BEAT + 1;
  if (c.dur === bar) return `Bar ${b0 + offset}`;
  const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  return Math.floor(beat0) === Math.floor(beat1) ? `Bar ${b0 + offset}, beat ${fmt(beat0)}` : `Bar ${b0 + offset}, beats ${fmt(beat0)}–${Math.floor(beat1)}`;
}

const sameChord = (a: Chord, b: Chord) => a.root === b.root && a.quality === b.quality;

/** The chord progression: click a chord to swap it for another that fits the melody there. */
export function ChordEditor() {
  const arr = useStore((s) => s.arrangement);
  const edits = useStore((s) => s.chordEdits);
  const refit = useStore((s) => s.chordRefit);
  const editChord = useStore((s) => s.editChord);
  const revertChord = useStore((s) => s.revertChord);
  const refitChords = useStore((s) => s.refitChords);
  const resetChords = useStore((s) => s.resetChords);
  const [open, setOpen] = useState<number | null>(null); // start unit of the chord being changed
  const [more, setMore] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const chords = arr?.chords ?? [];
  const i = open === null ? -1 : chords.findIndex((c) => c.start === open);
  const cur = i >= 0 ? chords[i] : null;

  const suggestions = useMemo(() => {
    if (!arr || !cur) return [];
    const o = arr.options;
    return suggestChords(
      arr.melody.notes,
      { key: arr.key, timeSig: arr.timeSig, harmonicRhythm: o.harmonicRhythm, style: o.style, complexity: o.complexity, totalUnits: arr.totalUnits },
      cur,
      chords[i - 1],
      chords[i + 1],
    );
  }, [arr, cur, chords, i]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // the choices open below the progression, often past the bottom of the side column
  useEffect(() => {
    if (open === null) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    editorRef.current?.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
  }, [open, more]);

  if (!arr) return null;
  const top = suggestions[0]?.score ?? 0;
  const low = suggestions[suggestions.length - 1]?.score ?? 0;
  const list = more ? suggestions : suggestions.slice(0, SHOWN);
  const refitDone = !!refit && refit.length === edits.length && refit.every((r, k) => r.start === edits[k].start && sameChord(r, edits[k]));

  return (
    <>
      <div className="chords" data-testid="chords">
        {chords.map((c) => (
          <button
            key={c.start}
            className={`chord fn-${c.fn}${c.edited ? ' edited' : ''}${c.start === open ? ' on' : ''}`}
            onClick={() => {
              setOpen(c.start === open ? null : c.start);
              setMore(false);
            }}
            title={`${c.roman} · ${c.dur / 4} beat${c.dur === 4 ? '' : 's'}${c.edited ? ' · your choice' : ''} — click to change`}
            aria-pressed={c.start === open}
            data-testid={`chord-${c.start}`}
          >
            <b>{c.symbol}</b>
            <span>{c.roman}</span>
          </button>
        ))}
      </div>

      {cur && (
        <div className="chord-editor" data-testid="chord-editor" ref={editorRef}>
          <div className="chord-editor-head">
            <span>
              {spanLabel(arr, cur)} · <b>{cur.symbol}</b> {cur.edited && <em>your choice</em>}
            </span>
            <button className="btn sm ghost icon" onClick={() => setOpen(null)} aria-label="Close chord choices" title="Close (Esc)">
              <X size={13} />
            </button>
          </div>
          <div className="chord-options">
            {list.map((s, k) => {
              const now = sameChord(s.chord, cur);
              const fit = top > low ? (s.score - low) / (top - low) : 1;
              return (
                <button
                  key={`${s.chord.root}-${s.chord.quality}`}
                  className={`chord-option fn-${s.chord.fn}${now ? ' now' : ''}`}
                  onClick={() => !now && editChord(s.chord)}
                  aria-pressed={now}
                  title={now ? 'The chord here now' : `Use ${s.chord.symbol} (${s.chord.roman}) here`}
                  data-testid={`chord-option-${s.chord.symbol}`}
                >
                  <b>{s.chord.symbol}</b>
                  <span>{s.chord.roman}</span>
                  <i className="fit" style={{ ['--fit' as string]: `${Math.round(Math.max(0.06, fit) * 100)}%` }} aria-hidden />
                  {now ? <small>now</small> : k === 0 ? <small>best fit</small> : null}
                </button>
              );
            })}
          </div>
          <div className="chord-editor-foot">
            {suggestions.length > SHOWN && (
              <button className="btn sm ghost" onClick={() => setMore(!more)}>
                {more ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {more ? 'Fewer chords' : `All ${suggestions.length} chords`}
              </button>
            )}
            {cur.edited && (
              <button className="btn sm ghost" onClick={() => revertChord(cur.start)} data-testid="chord-revert" title="Go back to the chord Harmonia chose">
                <Undo2 size={13} /> Undo this change
              </button>
            )}
          </div>
        </div>
      )}

      {edits.length > 0 && (
        <div className="chord-edits-bar">
          <span>
            {edits.length} chord{edits.length === 1 ? '' : 's'} chosen by you{refitDone ? ' · the rest fitted around them' : ''}
          </span>
          <button
            className="btn sm"
            onClick={refitChords}
            disabled={refitDone}
            data-testid="chord-refit"
            title="Re-choose the chords you didn't pick so they lead into and out of yours"
          >
            <WandSparkles size={13} /> Re-fit the rest
          </button>
          <button className="btn sm ghost" onClick={resetChords} data-testid="chord-reset" title="Back to Harmonia's chords everywhere">
            <Undo2 size={13} /> Reset chords
          </button>
        </div>
      )}
    </>
  );
}
