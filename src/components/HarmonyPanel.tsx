import { ChevronLeft, ChevronRight, Church, Dices, Music4, Sparkles, Users, Waves } from 'lucide-react';
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

/** A titled group of controls inside a panel. */
function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="group">
      <div className="group-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function HarmonyPanel() {
  const h = useStore((s) => s.harmony);
  const setHarmony = useStore((s) => s.setHarmony);
  const newVariation = useStore((s) => s.newVariation);
  const stepVariation = useStore((s) => s.stepVariation);
  const variations = useStore((s) => s.variations);
  const variationIndex = useStore((s) => s.variationIndex);
  const sound = useStore((s) => s.harmonySound);
  const setHarmonySound = useStore((s) => s.setHarmonySound);
  const lyrics = useStore((s) => s.lyrics);
  const info = STYLE_INFO[h.style];
  const wordless = lyrics.hummed || lyrics.status === 'none' || lyrics.status === 'off';
  let soundHint = '';
  if (sound === 'lyrics' && wordless) soundHint = lyrics.hummed ? 'you hummed, so they hum along' : 'no words found, so they sing like you';

  return (
    <div className="panel" data-testid="harmony-panel" id="sec-harmony">
      <PanelHead
        mark="C"
        title="Arrange"
        sub="shape the harmony"
        right={
          variations.length > 1 && (
            <div className="variation-nav" data-testid="variation-nav">
              <button
                className="btn sm ghost icon"
                onClick={() => stepVariation(-1)}
                disabled={variationIndex === 0}
                aria-label="Previous arrangement"
                title="Previous arrangement"
                data-testid="variation-prev"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="count" title="Arrangements you have tried" data-testid="variation-count">
                {variationIndex + 1} / {variations.length}
              </span>
              <button
                className="btn sm ghost icon"
                onClick={() => stepVariation(1)}
                disabled={variationIndex === variations.length - 1}
                aria-label="Next arrangement"
                title="Next arrangement"
                data-testid="variation-next"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )
        }
      />

      <Group
        title="Harmony"
        action={
          <button className="btn sm" onClick={() => newVariation('voicing')} data-testid="variation-voicing" title="Write different harmony lines over the same chords">
            <Dices size={13} /> New voicing
          </button>
        }
      >
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
      </Group>

      <Group
        title="Chords"
        action={
          <button className="btn sm" onClick={() => newVariation('chords')} data-testid="variation-chords" title="Choose a different chord progression (your own chord choices stay)">
            <Dices size={13} /> New chords
          </button>
        }
      >
        <div className="field">
          <div className="label">
            <span>Chord progression</span>
            <span className="hint">click a chord to change it</span>
          </div>
          <ChordEditor />
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
      </Group>

      <Group title="Sound">
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
      </Group>
    </div>
  );
}
