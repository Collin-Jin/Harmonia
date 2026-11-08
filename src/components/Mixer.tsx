import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Mic2, Volume2 } from 'lucide-react';
import { PanelHead } from './ui';
import { useStore } from '../state/store';
import { midiName } from '../music/theory';
import type { AutotuneMode } from '../music/autotune';
import { SOUND_LABEL, type HarmonySound, type VoicePart } from '../music/types';

const SOUND_OPTIONS: HarmonySound[] = ['lyrics', 'oo', 'ah', 'oh', 'ee', 'mm'];

function Strip({ part, isMelody }: { part: VoicePart; isMelody?: boolean }) {
  const mix = useStore((s) => s.mix[part.id]) ?? { gain: 0.8, mute: false, solo: false };
  const setPartMix = useStore((s) => s.setPartMix);
  const setPartSound = useStore((s) => s.setPartSound);
  const override = useStore((s) => s.soundPrefs[part.id]);
  const defaultSound = useStore((s) => s.harmonySound);
  const melodySource = useStore((s) => s.melodySource);
  const harmonySource = useStore((s) => s.harmonySource);
  const hasRecording = useStore((s) => !!s.recording);
  const autotune = useStore((s) => s.autotune);
  const voiceBusy = useStore((s) => s.voiceBusy);
  const partsBusy = useStore((s) => s.voicePartsBusy);
  const set = useStore((s) => s.set);
  const ps = part.notes.map((n) => n.midi);
  const range = ps.length ? `${midiName(Math.min(...ps))}–${midiName(Math.max(...ps))}` : '—';
  const clef = part.clef === 'bass' ? 'bass clef' : part.clef === 'treble8' ? 'tenor clef' : 'treble';
  const usesVoice = isMelody ? melodySource === 'recording' && hasRecording : harmonySource === 'voice' && hasRecording;
  return (
    <div className="strip" data-testid={`strip-${part.id}`} style={{ ['--c' as string]: part.color }}>
      <div className="top">
        <span className="avatar">{part.short.slice(0, 3)}</span>
        <div className="nm grow">
          {part.name}
          <small>
            {range} · {clef}
          </small>
        </div>
        <div className="ms">
          <button className={`m ${mix.mute ? 'on' : ''}`} onClick={() => setPartMix(part.id, { mute: !mix.mute })} title={mix.mute ? 'Unmute' : 'Mute'} aria-label={`Mute ${part.name}`} aria-pressed={mix.mute}>
            M
          </button>
          <button className={`s ${mix.solo ? 'on' : ''}`} onClick={() => setPartMix(part.id, { solo: !mix.solo })} title={mix.solo ? 'Un-solo' : 'Solo (hear only this)'} aria-label={`Solo ${part.name}`} aria-pressed={mix.solo}>
            S
          </button>
        </div>
      </div>
      {isMelody ? (
        usesVoice ? (
          <label className="sings">
            <span>Tuning</span>
            <select
              className="select"
              value={autotune}
              onChange={(e) => set({ autotune: e.target.value as AutotuneMode })}
              aria-label="Autotune for your voice"
              title="Pitch-correct your recorded voice onto the written notes and clean up background noise"
              data-testid="autotune"
            >
              <option value="natural">Natural autotune</option>
              <option value="hard">Hard autotune (robotic)</option>
              <option value="off">Off (raw take)</option>
            </select>
          </label>
        ) : (
          <div className="hint sings-hint">{melodySource === 'synth' ? 'Played by the synth (change under “Melody” in the player)' : 'Off in playback (change under “Melody” in the player)'}</div>
        )
      ) : (
        <label className="sings">
          <span>Sings</span>
          <select
            className="select"
            value={override ?? ''}
            onChange={(e) => setPartSound(part.id, e.target.value ? (e.target.value as HarmonySound) : null)}
            aria-label={`${part.name} sound`}
            title="Give this part its own sound, or follow the choice in Arrange"
            data-testid={`part-sound-${part.id}`}
          >
            <option value="">Default ({defaultSound === 'lyrics' ? 'Lyrics' : SOUND_LABEL[defaultSound]})</option>
            {SOUND_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v === 'lyrics' ? 'Lyrics' : SOUND_LABEL[v]}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="vol">
        <Volume2 size={14} color="var(--faint)" />
        <input
          type="range"
          min={0}
          max={1.2}
          step={0.01}
          value={mix.gain}
          style={{ ['--fill' as string]: `${(mix.gain / 1.2) * 100}%` }}
          onChange={(e) => setPartMix(part.id, { gain: Number(e.target.value) })}
          aria-label={`${part.name} volume`}
        />
      </div>
      <div className="status">
        {usesVoice ? <Mic2 size={12} /> : null}
        {isMelody
          ? usesVoice
            ? voiceBusy
              ? 'Tuning your voice…'
              : 'Your voice'
            : `${part.notes.length} notes`
          : usesVoice
            ? partsBusy
              ? 'Singing it in your voice…'
              : 'Your voice, re-pitched'
            : 'Choir synth'}
        {((isMelody && voiceBusy) || (!isMelody && usesVoice && partsBusy)) && <Loader2 size={12} className="spin" />}
      </div>
    </div>
  );
}

/** The mixer stays folded to a line of the singers until you want to balance them. */
export function Mixer() {
  const arr = useStore((s) => s.arrangement)!;
  const mix = useStore((s) => s.mix);
  const [open, setOpen] = useState(false);
  const parts = [arr.melody, ...arr.harmonies];
  const soloed = parts.some((p) => mix[p.id]?.solo);
  return (
    <div className={`panel ${open ? '' : 'compact quiet'}`} id="sec-mix">
      <PanelHead
        mark="E"
        title="Mix"
        sub={open ? 'balance the singers · M mutes, S solos' : 'balance the singers'}
        right={
          <button className="btn sm ghost" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="mix-toggle">
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {open ? 'Done' : 'Adjust'}
          </button>
        }
      />
      {open ? (
        <div className="mixer">
          <Strip part={arr.melody} isMelody />
          {arr.harmonies.map((h) => (
            <Strip key={h.id} part={h} />
          ))}
        </div>
      ) : (
        <div className="legend mix-summary">
          {parts.map((p) => {
            const m = mix[p.id];
            const silent = m?.mute || (soloed && !m?.solo);
            return (
              <span key={p.id} className={silent ? 'silent' : ''}>
                <i style={{ background: p.color }} />
                {p.name}
                {m?.solo ? ' · solo' : silent ? ' · muted' : ''}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
