import { AudioLines, Church, Dices, Mic2, Music4, RotateCcw, Sparkles, Users, Waves } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from '../state/store';
import { STYLE_INFO } from '../music/harmony';
import { SOUND_LABEL, type HarmonySound, type HarmonyStyle } from '../music/types';
import { ChordEditor } from './ChordEditor';
import { PanelHead, Seg } from './ui';

const ICONS: Record<HarmonyStyle, ReactNode> = {
  pop: <Sparkles size={15} />,
  choral: <Church size={15} />,
  jazz: <Music4 size={15} />,
  barbershop: <Users size={15} />,
  pad: <Waves size={15} />,
};

const SOUNDS: { v: HarmonySound; sub: string }[] = [
  { v: 'lyrics', sub: 'the words' },
  { v: 'oo', sub: 'soft, round' },
  { v: 'ah', sub: 'open, bright' },
  { v: 'oh', sub: 'warm' },
  { v: 'ee', sub: 'clear' },
  { v: 'mm', sub: 'hummed' },
];

export function HarmonyPanel() {
  const h = useStore((s) => s.harmony);
  const setHarmony = useStore((s) => s.setHarmony);
  const sound = useStore((s) => s.harmonySound);
  const setHarmonySound = useStore((s) => s.setHarmonySound);
  const source = useStore((s) => s.harmonySource);
  const hasRecording = useStore((s) => !!s.recording);
  const lyrics = useStore((s) => s.lyrics);
  const set = useStore((s) => s.set);
  const info = STYLE_INFO[h.style];
  const wordless = lyrics.hummed || lyrics.status === 'none' || lyrics.status === 'off';
  let soundHint = '';
  if (sound === 'lyrics' && wordless) soundHint = lyrics.hummed ? 'you hummed, so they hum along' : 'no words found, so they sing like you';
  else if (sound === 'lyrics' && source === 'choir') soundHint = 'the synth sings the words on a vowel';

  return (
    <div className="panel" data-testid="harmony-panel" id="sec-harmony">
      <PanelHead
        mark="C"
        title="Arrange"
        sub="shape the harmony"
        right={
          <>
            {h.seed !== 0 && (
              <button className="btn sm ghost icon" onClick={() => setHarmony({ seed: 0 })} title="Back to the first arrangement" aria-label="Back to the first arrangement">
                <RotateCcw size={13} />
              </button>
            )}
            <button
              className="btn sm"
              data-testid="variation"
              onClick={() => setHarmony({ seed: 1 + Math.floor(Math.random() * 1e6) })}
              title="Compose a different arrangement in the same style"
            >
              <Dices size={14} /> Try another
            </button>
          </>
        }
      />

      <div className="field">
        <div className="label">Style</div>
        <div className="styles">
          {(Object.keys(STYLE_INFO) as HarmonyStyle[]).map((s) => (
            <button
              key={s}
              className={`style-card ${h.style === s ? 'on' : ''}`}
              onClick={() => setHarmony({ style: s })}
              data-testid={`style-${s}`}
              title={STYLE_INFO[s].blurb}
            >
              {ICONS[s]} {STYLE_INFO[s].label}
            </button>
          ))}
        </div>
        <p className="style-blurb">{info.blurb}</p>
      </div>

      <div className="field">
        <div className="label">
          <span>Harmony parts</span>
          {info.maxVoices < 4 && <span className="hint">up to {info.maxVoices} in this style</span>}
        </div>
        <Seg
          value={Math.min(h.voices, info.maxVoices)}
          options={[1, 2, 3, 4].map((n) => ({ value: n, label: n, disabled: n > info.maxVoices }))}
          onChange={(v) => setHarmony({ voices: v })}
        />
      </div>
      {info.placement && (
        <div className="field">
          <div className="label">
            <span>Where they sit</span>
            <span className="hint">relative to your melody</span>
          </div>
          <Seg
            value={h.placement}
            options={[
              { value: 'above', label: 'Above' },
              { value: 'around', label: 'Around' },
              { value: 'below', label: 'Below' },
            ]}
            onChange={(v) => setHarmony({ placement: v })}
          />
        </div>
      )}

      <div className="field">
        <div className="label">
          <span>Who sings them</span>
          {!hasRecording && <span className="hint">needs a recording</span>}
        </div>
        <Seg
          value={source}
          options={[
            { value: 'voice', label: <><Mic2 size={13} /> Your voice</>, disabled: !hasRecording, title: 'Your own recording, re-pitched onto every harmony line' },
            { value: 'choir', label: <><AudioLines size={13} /> Choir synth</>, title: 'The built-in vocal synthesizer' },
          ]}
          onChange={(v) => set({ harmonySource: v })}
        />
      </div>
      <div className="field">
        <div className="label">
          <span>What they sing</span>
          <span className="hint">{soundHint}</span>
        </div>
        <div className="sound-picker" data-testid="sound-picker">
          {SOUNDS.map((o) => (
            <button
              key={o.v}
              className={`sound ${sound === o.v ? 'on' : ''}`}
              onClick={() => setHarmonySound(o.v)}
              data-testid={`sound-${o.v}`}
              title={o.v === 'lyrics' ? 'The harmony sings the same words as the melody' : `The harmony sings “${SOUND_LABEL[o.v]}”`}
            >
              <b>{o.v === 'lyrics' ? 'Lyrics' : SOUND_LABEL[o.v]}</b>
              <span>{o.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="label">
          <span>Chord changes</span>
          <span className="hint">how often the harmony moves</span>
        </div>
        <Seg
          value={h.harmonicRhythm}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'bar', label: 'Per bar' },
            { value: 'half', label: 'Half bar' },
            { value: 'beat', label: 'Per beat' },
          ]}
          onChange={(v) => setHarmony({ harmonicRhythm: v })}
        />
      </div>
      <div className="field">
        <div className="label">
          <span>Harmonic colour</span>
          <span className="hint">{h.complexity < 0.34 ? 'plain triads' : h.complexity < 0.67 ? 'with sevenths' : 'rich & chromatic'}</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          style={{ ['--fill' as string]: `${h.complexity * 100}%` }}
          value={h.complexity}
          onChange={(e) => setHarmony({ complexity: Number(e.target.value) })}
          aria-label="Harmonic colour"
        />
        <div className="range-ends">
          <span>simple</span>
          <span>colourful</span>
        </div>
      </div>
      <div className="field">
        <div className="label">
          <span>Chord progression</span>
          <span className="hint">click a chord to change it</span>
        </div>
        <ChordEditor />
      </div>
    </div>
  );
}
