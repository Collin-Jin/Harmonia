import { useState } from 'react';
import { ArrowRight, Loader2, Mic2, Piano, Play, RotateCcw, Square, Trash2, X } from 'lucide-react';
import { noteKey, useStore } from '../state/store';
import { currentPosition, playMelody, startRecording, stopPlayback } from '../state/controller';
import { midiName } from '../music/theory';
import { UNITS_PER_BEAT } from '../music/types';
import type { MelodyTone } from '../audio/player';
import { ReviewRoll } from './ReviewRoll';
import { PanelHead, Seg } from './ui';

/** Between recording and harmonizing: the notes as heard, to fix before the harmony is written. */
export function ReviewStage() {
  const tr = useStore((s) => s.transcription)!;
  const pitchEdits = useStore((s) => s.pitchEdits);
  const deleted = useStore((s) => s.deletedNotes);
  const playing = useStore((s) => s.playing);
  const voiceBusy = useStore((s) => s.voiceBusy);
  const deleteNote = useStore((s) => s.deleteNote);
  const resetNotes = useStore((s) => s.resetNotes);
  const finishReview = useStore((s) => s.finishReview);
  const [tone, setTone] = useState<MelodyTone>('recording');
  const [selected, setSelected] = useState<string | null>(null);
  const [from, setFrom] = useState(0); // where Play starts, in score units

  const changed = Object.keys(pitchEdits).filter((k) => !deleted[k]).length;
  const removed = Object.keys(deleted).length;
  const index = selected ? tr.notes.findIndex((n) => noteKey(n) === selected) : -1;
  const sel = index >= 0 ? tr.notes[index] : null;
  const bar = tr.timeSig.beats * UNITS_PER_BEAT;
  const pickup = (tr.notes[0]?.start ?? 0) % bar !== 0;
  const where = (u: number) => `bar ${Math.floor(u / bar) + (pickup ? 0 : 1)}, beat ${Math.floor((u % bar) / UNITS_PER_BEAT) + 1}`;
  const seek = (u: number) => {
    setFrom(u);
    if (playing) void playMelody(tone, u);
  };

  return (
    <div className="panel review-panel" data-testid="review-stage" id="sec-review">
      <PanelHead
        mark="B"
        title="Check your notes"
        sub="drag a note up or down to fix it, then harmonize"
      />

      <div className="review-bar">
        <button
          className="btn sm"
          onClick={() => (playing ? stopPlayback() : void playMelody(tone, from))}
          data-testid="review-play"
          aria-label={playing ? 'Stop' : 'Play the melody'}
        >
          {playing ? <Square size={13} /> : <Play size={13} />} {playing ? 'Stop' : 'Play'}
        </button>
        {from > 0 && (
          <span className="review-from" data-testid="review-from">
            from {where(from)}
            <button className="btn sm ghost icon" onClick={() => seek(0)} data-testid="review-from-reset" aria-label="Play from the beginning" title="Play from the beginning">
              <X size={12} />
            </button>
          </span>
        )}
        <Seg
          value={tone}
          options={[
            { value: 'recording', label: <><Mic2 size={13} /> Your voice</>, title: 'Your take, tuned to the notes as they stand' },
            { value: 'piano', label: <><Piano size={13} /> Piano</>, title: 'The notes on a piano, timed as you sang them' },
          ]}
          onChange={(v) => {
            setTone(v);
            if (playing) void playMelody(v, Math.floor(currentPosition() ?? from));
          }}
        />
        {tone === 'recording' && voiceBusy && (
          <span className="hint review-busy">
            <Loader2 size={12} className="spin" /> tuning your voice to the new notes…
          </span>
        )}
        <span className="grow" />
        {(changed > 0 || removed > 0) && (
          <>
            <span className="hint" data-testid="review-counts">
              {changed > 0 && `${changed} changed`}
              {changed > 0 && removed > 0 && ' · '}
              {removed > 0 && `${removed} removed`}
            </span>
            <button className="btn sm ghost" onClick={() => (setSelected(null), resetNotes())} data-testid="review-reset" title="Put every note back as it was heard">
              <RotateCcw size={13} /> Reset notes
            </button>
          </>
        )}
        <button className="btn primary" onClick={() => (stopPlayback(), finishReview())} data-testid="review-continue">
          Harmonize <ArrowRight size={15} />
        </button>
      </div>

      <ReviewRoll selected={selected} onSelect={setSelected} from={from} onSeek={seek} />

      <div className="review-foot">
        {sel ? (
          <span className="review-selected" data-testid="review-selected">
            <b>{midiName(sel.midi)}</b> · {where(sel.start)}
            <span className="hint"> · ↑/↓ to nudge</span>
            <button
              className="btn sm ghost"
              onClick={() => (deleteNote(index), setSelected(null))}
              disabled={tr.notes.length <= 2}
              data-testid="review-delete"
              title="Remove a note that isn't really there (a breath or a noise)"
            >
              <Trash2 size={13} /> Remove note
            </button>
          </span>
        ) : (
          <span className="hint">
            Click a note to select it · click the bar numbers or an empty spot to play from there · the faint line is what you actually sang · shaded rows are outside the key{removed > 0 ? ' · click a dashed outline to bring a note back' : ''}
          </span>
        )}
        <span className="grow" />
        <button className="btn sm ghost" onClick={() => (stopPlayback(), void startRecording())} data-testid="review-record">
          <Mic2 size={13} /> Record again
        </button>
      </div>
    </div>
  );
}
