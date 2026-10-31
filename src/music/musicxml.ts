import { chordAt, MUSICXML_KIND, QUALITY_INTERVALS } from './chords';
import { keyFifths, mod12, scaleOf, spell, spellOnLetter, type Key, type Spelling } from './theory';
import { UNITS_PER_BEAT, type Arrangement, type Chord, type ClefKind, type ScoreNote, type VoicePart } from './types';

const LETTERS = 'CDEFGAB';
// Letter distance above the root for each chord-interval slot (root, 3rd, 5th, 7th, 9th).
const SLOT_LETTER = [0, 2, 4, 6, 1];

/** Chromatic chord tones are spelled relative to the chord root (E7 → G♯, not A♭). */
function spellInContext(midi: number, key: Key, chord: Chord | undefined): Spelling {
  const p = mod12(Math.round(midi));
  if (!chord || scaleOf(key).includes(p)) return spell(midi, key);
  const slot = QUALITY_INTERVALS[chord.quality].findIndex((iv) => mod12(chord.root + iv) === p);
  if (slot < 0) return spell(midi, key);
  const rootLetter = LETTERS.indexOf(spell(60 + chord.root, key).step);
  return spellOnLetter(midi, rootLetter + SLOT_LETTER[slot]) ?? spell(midi, key);
}

const TYPE_NAMES: Record<number, [string, boolean]> = {
  16: ['whole', false],
  12: ['half', true],
  8: ['half', false],
  6: ['quarter', true],
  4: ['quarter', false],
  3: ['eighth', true],
  2: ['eighth', false],
  1: ['16th', false],
};

/** Split a duration that starts at `pos` within a bar into notatable values. */
export function decompose(pos: number, dur: number, barUnits: number): number[] {
  const out: number[] = [];
  const fits = (p: number, v: number) => {
    if (p + v > barUnits) return false;
    switch (v) {
      case 16:
        return p === 0;
      case 12:
        return p === 0;
      case 8:
        return p % 8 === 0 || (barUnits === 12 && p % 4 === 0);
      case 6:
        return p % 4 === 0;
      case 4:
        return p % 2 === 0;
      case 3:
        return p % 4 === 0;
      case 2:
        return p % 2 === 0;
      default:
        return true;
    }
  };
  let p = pos;
  let d = dur;
  while (d > 0) {
    const v = [16, 12, 8, 6, 4, 3, 2, 1].find((x) => x <= d && fits(p, x)) ?? 1;
    out.push(v);
    p += v;
    d -= v;
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function clefXml(c: ClefKind) {
  if (c === 'bass') return '<clef><sign>F</sign><line>4</line></clef>';
  if (c === 'treble8') return '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>';
  return '<clef><sign>G</sign><line>2</line></clef>';
}

interface Item {
  start: number; // absolute units
  dur: number;
  midi: number | null;
  tieStart: boolean;
  tieStop: boolean;
  src?: ScoreNote;
}

/** Lyrics stay in the arrangement (harmony singing) but are never engraved. */

function measureItems(notes: ScoreNote[], a: number, b: number): Item[] {
  const items: Item[] = [];
  let cursor = a;
  const sorted = notes.filter((n) => n.start < b && n.start + n.dur > a).sort((x, y) => x.start - y.start);
  for (const n of sorted) {
    const s = Math.max(a, n.start, cursor);
    const e = Math.min(b, n.start + n.dur);
    if (e <= s) continue;
    if (s > cursor) items.push({ start: cursor, dur: s - cursor, midi: null, tieStart: false, tieStop: false });
    items.push({ start: s, dur: e - s, midi: n.midi, tieStart: e < n.start + n.dur || (!!n.tieToNext && e === n.start + n.dur), tieStop: s > n.start, src: n });
    cursor = e;
  }
  if (cursor < b) items.push({ start: cursor, dur: b - cursor, midi: null, tieStart: false, tieStop: false });
  return items;
}

export interface MusicXmlOptions {
  title?: string;
  includeChords?: boolean;
}

export function toMusicXML(arr: Arrangement, opts: MusicXmlOptions = {}): string {
  const title = opts.title ?? 'Harmonia Arrangement';
  const bar = arr.timeSig.beats * UNITS_PER_BEAT;
  const parts: VoicePart[] = [arr.melody, ...arr.harmonies];
  const firstStart = arr.melody.notes.length ? arr.melody.notes[0].start : 0;
  const pickup = firstStart > 0 && firstStart < bar ? firstStart : 0;
  const total = Math.max(arr.totalUnits, bar);
  const ranges: [number, number][] = [];
  if (pickup) ranges.push([pickup, bar]);
  for (let s = pickup ? bar : 0; s < total; s += bar) ranges.push([s, s + bar]);
  const fifths = keyFifths(arr.key);

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  out.push('<score-partwise version="4.0">');
  out.push(`<work><work-title>${esc(title)}</work-title></work>`);
  out.push('<identification><creator type="composer">Harmonia</creator><encoding><software>Harmonia</software>');
  out.push(`<encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date></encoding></identification>`);
  out.push('<part-list>');
  parts.forEach((p, i) => {
    out.push(`<score-part id="P${i + 1}"><part-name>${esc(p.name)}</part-name><part-abbreviation>${esc(p.short)}</part-abbreviation>`);
    out.push(`<score-instrument id="P${i + 1}-I1"><instrument-name>${i === 0 ? 'Voice' : 'Choir'}</instrument-name></score-instrument>`);
    out.push(`<midi-instrument id="P${i + 1}-I1"><midi-channel>${i + 1}</midi-channel><midi-program>${i === 0 ? 54 : 53}</midi-program></midi-instrument>`);
    out.push('</score-part>');
  });
  out.push('</part-list>');

  parts.forEach((part, pi) => {
    out.push(`<part id="P${pi + 1}">`);
    ranges.forEach(([a, b], mi) => {
      const number = pickup ? mi : mi + 1;
      out.push(`<measure number="${number}"${pickup && mi === 0 ? ' implicit="yes"' : ''}>`);
      if (mi === 0) {
        out.push('<attributes>');
        out.push(`<divisions>${UNITS_PER_BEAT}</divisions>`);
        out.push(`<key><fifths>${fifths}</fifths><mode>${arr.key.mode}</mode></key>`);
        out.push(`<time><beats>${arr.timeSig.beats}</beats><beat-type>${arr.timeSig.beatType}</beat-type></time>`);
        out.push(clefXml(part.clef));
        out.push('</attributes>');
        if (pi === 0) {
          const bpm = Math.round(arr.bpm);
          out.push(
            `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`,
          );
        }
      }
      const items = measureItems(part.notes, a, b);
      const chordsHere: Chord[] =
        pi === 0 && opts.includeChords !== false
          ? arr.chords.filter((c) => {
              const s = Math.max(c.start, pickup);
              return s >= a && s < b;
            })
          : [];
      const whole = items.length === 1 && items[0].midi === null && b - a === bar;
      for (const it of items) {
        for (const c of chordsHere) {
          const cs = Math.max(c.start, pickup);
          if (cs >= it.start && cs < it.start + it.dur) {
            const rs = spell(60 + c.root, arr.key);
            const offset = cs - it.start;
            out.push(
              `<harmony print-frame="no"><root><root-step>${rs.step}</root-step>${rs.alter ? `<root-alter>${rs.alter}</root-alter>` : ''}</root><kind text="${esc(c.symbol.replace(/^[A-G][♯♭]?/, ''))}">${MUSICXML_KIND[c.quality]}</kind>${offset ? `<offset>${offset}</offset>` : ''}</harmony>`,
            );
          }
        }
        if (whole) {
          out.push(`<note><rest measure="yes"/><duration>${bar}</duration><voice>1</voice></note>`);
          continue;
        }
        const pieces = decompose(((it.start % bar) + bar) % bar, it.dur, bar);
        pieces.forEach((v, k) => {
          const [type, dotted] = TYPE_NAMES[v];
          const tStop = k > 0 || it.tieStop;
          const tStart = k < pieces.length - 1 || it.tieStart;
          if (it.midi === null) {
            out.push(`<note><rest/><duration>${v}</duration><voice>1</voice><type>${type}</type>${dotted ? '<dot/>' : ''}</note>`);
          } else {
            const sp = spellInContext(it.midi, arr.key, chordAt(arr.chords, it.start));
            const ties = `${tStop ? '<tie type="stop"/>' : ''}${tStart ? '<tie type="start"/>' : ''}`;
            const tied = `${tStop ? '<tied type="stop"/>' : ''}${tStart ? '<tied type="start"/>' : ''}`;
            out.push(
              `<note><pitch><step>${sp.step}</step>${sp.alter ? `<alter>${sp.alter}</alter>` : ''}<octave>${sp.octave}</octave></pitch><duration>${v}</duration>${ties}<voice>1</voice><type>${type}</type>${dotted ? '<dot/>' : ''}${tied ? `<notations>${tied}</notations>` : ''}</note>`,
            );
          }
        });
      }
      if (mi === ranges.length - 1) out.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
      out.push('</measure>');
    });
    out.push('</part>');
  });
  out.push('</score-partwise>');
  return out.join('\n');
}
