import { useMemo } from 'react';
import { AudioLines, Mic } from 'lucide-react';
import { SAMPLES } from '../music/samples';
import { loadSample, startRecording } from '../state/controller';
import { MELODY_COLOR, VOICE_COLORS } from '../music/types';
import { MiniScore } from './MiniScore';
import { PanelHead } from './ui';
import type { SampleMelodyLike } from './miniScoreTypes';

const KEYS: Record<string, SampleMelodyLike['key']> = {
  'twinkle-lyrics': { tonic: 0, mode: 'major' },
  'ode-to-joy': { tonic: 0, mode: 'major' },
  'amazing-grace': { tonic: 7, mode: 'major' },
};

// Staff positions (in half line-spaces from the bottom line) for a little I–IV–V–I progression.
const CHORDS = [
  [7, 5, 2, 0],
  [8, 5, 3, 1],
  [9, 6, 4, 1],
  [9, 7, 4, 2],
  [10, 7, 5, 0],
];

function HeroStaff() {
  const top = 40;
  const gap = 18;
  const y = (pos: number) => top + 4 * gap - (pos * gap) / 2;
  const colors = [MELODY_COLOR, ...VOICE_COLORS];
  return (
    <svg className="hero-staff" viewBox="0 0 460 190" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <path
          key={i}
          className="line"
          d={`M8 ${top + i * gap} q 110 ${i % 2 ? -2 : 2} 220 0 t 224 ${i % 2 ? 1 : -1}`}
          style={{ animationDelay: `${i * 0.08}s` }}
        />
      ))}
      <path className="bar" d={`M452 ${top - 1} V ${top + 4 * gap + 1}`} />
      <text x="14" y={top + 3.2 * gap} className="clef">
        𝄞
      </text>
      {CHORDS.map((ch, c) => (
        <g key={c} transform={`translate(${96 + c * 74} 0)`}>
          {ch.map((p, v) => {
            const cx = v > 0 && ch[v - 1] - p === 1 ? 19 : 0;
            return (
              <ellipse
                key={v}
                className="nh"
                cx={cx}
                cy={y(p)}
                rx="10"
                ry="7.2"
                transform={`rotate(-22 ${cx} ${y(p)})`}
                fill={colors[v]}
                style={{ animationDelay: `${0.5 + c * 0.32 + v * 0.07}s` }}
              />
            );
          })}
        </g>
      ))}
    </svg>
  );
}

const MOVEMENTS = [
  { n: 'I', t: 'Sing', d: 'Words, “la”, or a hum. I write down the notes, rhythm and key. If you sang words, the harmony sings them too.' },
  { n: 'II', t: 'Arrange', d: 'Pick a style and up to four parts. Harmonies are voiced like a real arranger would.' },
  { n: 'III', t: 'Edit', d: 'Click any note on the score to change its pitch or syllable, melody or harmony.' },
  { n: 'IV', t: 'Perform', d: 'Sing again live and the harmony follows your tempo, key and tuning.' },
];

export function Welcome({ onHelp }: { onHelp: () => void }) {
  const minis = useMemo(
    () =>
      SAMPLES.map((s) => ({
        s,
        m: {
          notes: s.notes,
          beatsPerBar: s.beatsPerBar,
          bpm: s.bpm,
          key: KEYS[s.id],
          pickupBeats: s.id === 'amazing-grace' ? 2 : 0,
          syllables: s.syllables,
        } as SampleMelodyLike,
      })),
    [],
  );
  return (
    <>
      <div className="hero">
        <HeroStaff />
        <div className="eyebrow">Op. 1 · for one voice &amp; a choir of you</div>
        <h2>
          Sing it once.
          <br />
          Hear it{' '}
          <em className="squiggle">
            in harmony.
            <svg viewBox="0 0 300 18" preserveAspectRatio="none" aria-hidden>
              <path d="M4 11 C 40 3, 70 16, 105 9 S 170 4, 205 10 S 265 15, 296 6" />
            </svg>
          </em>
        </h2>
        <p className="lead">
          Harmonia writes down what you sing, notes and words, then arranges harmony parts around it and sings them back in your own voice. Edit
          the score, export it, or perform live with a choir that follows you.
        </p>
        <div className="row wrap hero-actions">
          <button className="btn primary big" onClick={() => startRecording()}>
            <span className="rec-dot-sm" /> Start singing
          </button>
          <button className="btn big" onClick={() => loadSample('twinkle-lyrics')} data-testid="hero-sample">
            <AudioLines size={16} /> Try a sung example
          </button>
          <button className="btn ghost" onClick={onHelp}>
            <Mic size={15} /> Microphone help
          </button>
        </div>
        <ol className="how">
          {MOVEMENTS.map((m) => (
            <li className="card" key={m.n}>
              <span className="mv">{m.n}</span>
              <h4>{m.t}</h4>
              <p>{m.d}</p>
            </li>
          ))}
        </ol>
      </div>
      <div className="panel">
        <PanelHead mark="✦" title="Example melodies" sub="listen first, then press Use to arrange one" />
        <div className="samples">
          {minis.map(({ s, m }) => (
            <div className="sample-card" key={s.id}>
              <div className="row">
                <div className="grow">
                  <h4>{s.title}</h4>
                  <div className="meta">
                    {s.composer} · {s.keyLabel} · {s.beatsPerBar}/4 · {s.bpm} bpm
                  </div>
                </div>
                <button className="btn sm primary" onClick={() => loadSample(s.id)}>
                  Use
                </button>
              </div>
              <MiniScore melody={m} />
              <audio controls preload="metadata" src={`/samples/${s.id}.wav`} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
