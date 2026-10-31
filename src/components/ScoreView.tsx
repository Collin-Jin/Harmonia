import { useCallback, useEffect, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, X } from 'lucide-react';
import { useStore } from '../state/store';
import { toMusicXML } from '../music/musicxml';
import { currentPosition } from '../state/controller';
import { audition } from '../audio/audition';
import { midiName } from '../music/theory';
import { UNITS_PER_BEAT, type Arrangement, type VoicePart } from '../music/types';

type NoteEls = Map<string, SVGGElement[]>;

/** Tag every engraved note with its part and index so it can be clicked and coloured. */
function tagNotes(osmd: OpenSheetMusicDisplay, arr: Arrangement): NoteEls {
  const map: NoteEls = new Map();
  const parts: VoicePart[] = [arr.melody, ...arr.harmonies];
  const bar = arr.timeSig.beats * UNITS_PER_BEAT;
  const first = arr.melody.notes[0]?.start ?? 0;
  const pickupStart = first > 0 && first < bar ? first : 0;
  const sheet: any = (osmd as any).GraphicSheet;
  for (const row of sheet?.MeasureList ?? []) {
    for (const gm of row ?? []) {
      if (!gm) continue;
      for (const se of gm.staffEntries ?? []) {
        for (const gve of se.graphicalVoiceEntries ?? []) {
          for (const gn of gve.notes ?? []) {
            const note = gn.sourceNote;
            if (!note || note.isRest?.()) continue;
            const part = parts[note.ParentStaff?.idInMusicSheet ?? -1];
            if (!part) continue;
            const unit = Math.round(note.ParentStaffEntry.AbsoluteTimestamp.RealValue * 4 * UNITS_PER_BEAT) + pickupStart;
            const index = part.notes.findIndex((n) => n.start <= unit && n.start + n.dur > unit);
            if (index < 0) continue;
            const el: SVGGElement | undefined = gn.getSVGGElement?.();
            if (!el) continue;
            el.classList.add('hn-note');
            el.dataset.part = part.id;
            el.dataset.idx = String(index);
            el.style.setProperty('--c', part.color);
            if (part.notes[index].edited) el.classList.add('edited');
            const key = `${part.id}:${index}`;
            map.set(key, [...(map.get(key) ?? []), el]);
          }
        }
      }
    }
  }
  return map;
}

export function ScoreView() {
  const arr = useStore((s) => s.arrangement);
  const title = useStore((s) => s.title);
  const selection = useStore((s) => s.selection);
  const set = useStore((s) => s.set);
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const elsRef = useRef<NoteEls>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debouncedTitle, setDebouncedTitle] = useState(title);
  const [renderTick, setRenderTick] = useState(0);
  const renderedRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedTitle(title), 500);
    return () => clearTimeout(t);
  }, [title]);

  useEffect(() => {
    if (!hostRef.current) return;
    osmdRef.current = new OpenSheetMusicDisplay(hostRef.current, {
      backend: 'svg',
      autoResize: false,
      drawTitle: true,
      drawComposer: true,
      drawPartNames: true,
      drawPartAbbreviations: true,
      drawMeasureNumbers: true,
      autoBeam: true,
      followCursor: false,
      cursorsOptions: [{ type: 0, color: '#c8402a', alpha: 0.28, follow: false } as any],
    } as any);
    const osmd = osmdRef.current;
    // Re-engrave at the new width; the fresh SVG has to be tagged again.
    let timer: number | undefined;
    let width = hostRef.current.clientWidth;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const a = useStore.getState().arrangement;
        const w = hostRef.current?.clientWidth ?? 0;
        if (!renderedRef.current || !a || w === width) return;
        width = w;
        osmd.render();
        elsRef.current = tagNotes(osmd, a);
        setRenderTick((t) => t + 1);
      }, 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
      osmdRef.current = null;
    };
  }, []);

  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || !arr) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    renderedRef.current = false;
    const xml = toMusicXML(arr, { title: debouncedTitle });
    osmd
      .load(xml)
      .then(() => {
        if (cancelled) return;
        osmd.render();
        elsRef.current = tagNotes(osmd, arr);
        renderedRef.current = true;
        setLoading(false);
        setRenderTick((t) => t + 1);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e?.message ?? e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [arr, debouncedTitle]);

  // selection highlight
  useEffect(() => {
    elsRef.current.forEach((els) => els.forEach((el) => el.classList.remove('sel')));
    if (!selection) return;
    const els = elsRef.current.get(`${selection.partId}:${selection.index}`);
    els?.forEach((el) => el.classList.add('sel'));
    const sc = scrollRef.current;
    const el = els?.[0];
    if (sc && el) {
      const r = el.getBoundingClientRect();
      const c = sc.getBoundingClientRect();
      if (r.top < c.top + 16 || r.bottom > c.bottom - 16) sc.scrollBy({ top: r.top - c.top - c.height / 3, behavior: 'smooth' });
    }
  }, [selection, renderTick]);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const g = (e.target as Element).closest?.('.hn-note') as SVGGElement | null;
      if (!g) {
        set({ selection: null });
        return;
      }
      const partId = g.dataset.part!;
      const index = Number(g.dataset.idx);
      set({ selection: { partId, index } });
      const a = useStore.getState().arrangement;
      const part = a && [a.melody, ...a.harmonies].find((p) => p.id === partId);
      const n = part?.notes[index];
      if (n) void audition(n.midi);
    },
    [set],
  );

  // Cursor follows playback / live singing.
  useEffect(() => {
    let raf = 0;
    let shown = false;
    let lastTarget = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const osmd = osmdRef.current;
      const a = useStore.getState().arrangement;
      if (!osmd || !a || !renderedRef.current) return;
      const pos = currentPosition();
      const cursor = osmd.cursor;
      if (!cursor) return;
      if (pos === null) {
        if (shown) {
          cursor.hide();
          shown = false;
          lastTarget = -1;
        }
        return;
      }
      const bar = a.timeSig.beats * UNITS_PER_BEAT;
      const first = a.melody.notes[0]?.start ?? 0;
      const pickupStart = first > 0 && first < bar ? first : 0;
      const target = Math.max(0, (pos - pickupStart) / (UNITS_PER_BEAT * 4));
      if (Math.abs(target - lastTarget) < 1e-4 && shown) return;
      if (!shown) {
        cursor.show();
        cursor.reset();
        shown = true;
      }
      if (target < cursor.iterator.currentTimeStamp.RealValue - 1e-6) cursor.reset();
      for (let guard = 0; guard < 2000; guard++) {
        const next = cursor.iterator.clone();
        next.moveToNext();
        if (next.EndReached || next.currentTimeStamp.RealValue > target + 1e-6) break;
        cursor.next();
      }
      lastTarget = target;
      const el = (cursor as any).cursorElement as HTMLElement | undefined;
      const sc = scrollRef.current;
      if (el && sc) {
        const top = el.offsetTop;
        if (top < sc.scrollTop + 20 || top + el.offsetHeight > sc.scrollTop + sc.clientHeight - 20) {
          sc.scrollTo({ top: Math.max(0, top - 40), behavior: 'smooth' });
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="paper-wrap">
      <div className="paper" ref={scrollRef} data-testid="score" onClick={onClick}>
        <div ref={hostRef} />
        {loading && (
          <div className="loading">
            <span className="quill" /> Engraving your score…
          </div>
        )}
        {error && <div className="loading">Could not draw the score: {error}</div>}
      </div>
      {selection && !loading ? (
        <NoteEditor key={`${selection.partId}:${selection.index}`} />
      ) : (
        <div className="inspector idle" data-testid="note-hint">
          <span className="ins-mark">✎</span>
          <span>
            <b>Click any note</b> to change its pitch. Melody and harmony notes can both be edited.
          </span>
        </div>
      )}
    </div>
  );
}

function NoteEditor() {
  const selection = useStore((s) => s.selection)!;
  const arr = useStore((s) => s.arrangement)!;
  const editNotePitch = useStore((s) => s.editNotePitch);
  const editNoteLyric = useStore((s) => s.editNoteLyric);
  const set = useStore((s) => s.set);
  const parts = [arr.melody, ...arr.harmonies];
  const part = parts.find((p) => p.id === selection.partId);
  const note = part?.notes[selection.index];
  const lyricText = note?.lyric ? note.lyric.text + (note.lyric.hyphen ? '-' : '') : note?.melisma ? '_' : '';
  const [text, setText] = useState(lyricText);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setText(lyricText), [lyricText]);

  const current = useCallback(() => {
    const s = useStore.getState();
    const a = s.arrangement;
    if (!a || !s.selection) return null;
    const p = [a.melody, ...a.harmonies].find((x) => x.id === s.selection!.partId);
    return p ? { part: p, index: s.selection.index } : null;
  }, []);
  const shift = useCallback(
    (d: number) => {
      const cur = current();
      const n = cur?.part.notes[cur.index];
      if (!cur || !n) return;
      editNotePitch(cur.part.id, cur.index, n.midi + d);
      void audition(n.midi + d);
    },
    [current, editNotePitch],
  );
  const move = useCallback(
    (d: number) => {
      const cur = current();
      if (!cur) return;
      const i = Math.max(0, Math.min(cur.part.notes.length - 1, cur.index + d));
      set({ selection: { partId: cur.part.id, index: i } });
      void audition(cur.part.notes[i].midi);
    },
    [current, set],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT';
      if (e.key === 'Escape') {
        set({ selection: null });
        return;
      }
      if (typing) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        shift((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        move(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shift, move, set]);

  if (!part || !note) return null;
  const commit = () => {
    if (text !== lyricText) editNoteLyric(part.id, selection.index, text === '_' ? '' : text);
  };
  return (
    <div className="inspector" data-testid="note-editor" style={{ ['--c' as string]: part.color }}>
      <div className="ins-note">
        <span className="ne-dot" />
        <div>
          <div className="ne-name" data-testid="note-editor-pitch">
            {midiName(note.midi)}
          </div>
          <div className="ne-part">
            {part.name} · note {selection.index + 1}/{part.notes.length}
            {note.edited ? ' · edited' : ''}
          </div>
        </div>
      </div>
      <div className="ins-group">
        <span className="ins-label">Pitch</span>
        <div className="ne-pitch">
          <button className="btn sm icon" onClick={() => shift(-12)} title="Octave down (Shift+↓)" aria-label="Octave down" data-testid="note-octave-down">
            <ChevronsDown size={15} />
          </button>
          <button className="btn sm icon" onClick={() => shift(-1)} title="Semitone down (↓)" aria-label="Semitone down" data-testid="note-down">
            <ChevronDown size={15} />
          </button>
          <button className="btn sm icon" onClick={() => shift(1)} title="Semitone up (↑)" aria-label="Semitone up" data-testid="note-up">
            <ChevronUp size={15} />
          </button>
          <button className="btn sm icon" onClick={() => shift(12)} title="Octave up (Shift+↑)" aria-label="Octave up" data-testid="note-octave-up">
            <ChevronsUp size={15} />
          </button>
        </div>
      </div>
      <label className="ins-group grow">
        <span className="ins-label">Syllable</span>
        <input
          ref={inputRef}
          value={text}
          placeholder={part.id === 'melody' ? 'e.g. twin-   (“-” joins the next note)' : 'e.g. ooh'}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              (e.target as HTMLInputElement).blur();
              move(1);
            }
          }}
          aria-label="Syllable"
          data-testid="note-lyric"
        />
      </label>
      <div className="keys hide-sm">
        <span><kbd>↑</kbd><kbd>↓</kbd> pitch</span>
        <span><kbd>⇧</kbd> octave</span>
        <span><kbd>←</kbd><kbd>→</kbd> next</span>
        <span><kbd>↵</kbd> syllable</span>
      </div>
      <button className="btn ghost sm icon" onClick={() => set({ selection: null })} aria-label="Close editor" title="Done (Esc)">
        <X size={15} />
      </button>
      {part.id === 'melody' && <div className="ins-note-foot">Changing a melody note re-tunes your voice and re-writes the harmony to fit.</div>}
    </div>
  );
}
