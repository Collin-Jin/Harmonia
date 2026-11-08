import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Headphones, MicVocal, Square } from 'lucide-react';
import { useStore } from '../state/store';
import { getLive, refreshLive, startLive, stopLive } from '../state/controller';
import type { LiveSnapshot } from '../audio/live';
import { midiName } from '../music/theory';
import { UNITS_PER_BEAT } from '../music/types';
import { PanelHead, Toggle } from './ui';

function useLiveSnapshot(active: boolean): LiveSnapshot | null {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  useEffect(() => {
    if (!active) {
      setSnap(null);
      return;
    }
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 33) return;
      last = t;
      const l = getLive();
      if (l) setSnap(l.snapshot());
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return snap;
}

export function LivePanel() {
  const active = useStore((s) => s.liveActive);
  const arr = useStore((s) => s.arrangement)!;
  const live = useStore((s) => s.live);
  const set = useStore((s) => s.set);
  const snap = useLiveSnapshot(active);
  const [options, setOptions] = useState(false);
  const st = snap?.status;
  const bar = arr.timeSig.beats * UNITS_PER_BEAT;
  const firstStart = arr.melody.notes[0]?.start ?? 0;
  const pickup = firstStart > 0 && firstStart < bar;

  const setLive = (p: Partial<typeof live>) => {
    set({ live: { ...live, ...p } });
    if (active) setTimeout(() => void refreshLive(), 0);
  };

  let position = '—';
  if (st && st.index >= 0 && st.mode === 'following') {
    const u = arr.melody.notes[st.index].start;
    const m = Math.floor(u / bar) + (pickup ? 0 : 1);
    const beat = Math.floor((u % bar) / UNITS_PER_BEAT) + 1;
    position = `Bar ${m} · beat ${beat}`;
  }
  const cents = st?.centsOff ?? 0;
  const needle = 50 + Math.max(-50, Math.min(50, cents));

  return (
    <div className={`panel live-panel ${active ? 'active' : 'quiet'}`} data-testid="live-panel" id="sec-live">
      <PanelHead
        mark="F"
        title="Sing live"
        sub="the harmony follows you in real time"
        right={
          <span className={`onair-lamp ${active ? 'lit' : ''}`} aria-hidden>
            On air
          </span>
        }
      />
      <div className="live-top">
        <p className="live-cta grow">
          {active
            ? 'Sing the melody again, from the top or from anywhere. The voices find your place and follow your tempo, key and pitch.'
            : 'Press Sing live and sing your melody again. The harmony voices join in and follow where you are, how fast you go, and what key you sing in.'}
        </p>
        {active ? (
          <button className="live-btn stop" onClick={() => stopLive()} data-testid="live-stop">
            <Square size={15} fill="currentColor" /> Stop
          </button>
        ) : (
          <button className="live-btn" onClick={() => startLive()} data-testid="live-start">
            <MicVocal size={18} /> Sing live
          </button>
        )}
      </div>

      {!active && (
        <div className="notice" style={{ marginTop: 14 }}>
          <Headphones size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Use headphones for live mode so the harmony voices don’t leak into your microphone. On speakers, turn on echo cancellation under “How the voices follow you”.
          </span>
        </div>
      )}

      {active && (
        <div className="live-grid">
          <div className="tuner">
            <div className="row">
              <span className={`mode-badge mode-${st?.mode ?? 'waiting'}`} data-testid="live-mode">
                {st?.mode === 'following' ? 'Following you' : st?.mode === 'free' ? 'Finding your place…' : 'Waiting for you to sing'}
              </span>
              <div className="grow" />
              <span className="hint" data-testid="live-position">
                {position}
              </span>
            </div>
            <div className="notes">
              <div className="sung">
                <small>You’re singing</small>
                {snap?.pitch != null ? midiName(snap.pitch) : '—'}
              </div>
              <div className="exp">
                expected
                <br />
                <b>{st?.expectedMidi != null ? midiName(st.expectedMidi) : '—'}</b>
              </div>
              <div className="exp">
                intonation
                <br />
                <b>
                  {cents > 0 ? '+' : ''}
                  {cents}¢
                </b>
              </div>
            </div>
            <div className="cents-bar">
              <div className="needle" style={{ left: `${needle}%` }} />
            </div>
            <div className="orbs">
              {arr.harmonies.map((h, i) => {
                const p = st?.voicePitches[i] ?? null;
                return (
                  <div key={h.id} className={`orb ${p !== null ? 'on' : ''}`} style={{ ['--c' as any]: h.color }}>
                    <div className="vn">{h.name}</div>
                    <div className="pn">{p !== null ? midiName(p) : '·'}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="live-stats">
              <div className="stat">
                <div className="k">Tempo</div>
                <div className="v" data-testid="live-tempo">
                  {Math.round(arr.bpm * (st?.tempoRatio ?? 1))} <small>bpm</small>
                </div>
              </div>
              <div className="stat">
                <div className="k">Transpose</div>
                <div className="v">
                  {(st?.transpose ?? 0) > 0 ? '+' : ''}
                  {st?.transpose ?? 0} <small>st</small>
                </div>
              </div>
              <div className="stat">
                <div className="k">Latency</div>
                <div className="v" data-testid="live-latency">
                  {snap && snap.onsets ? Math.round(snap.totalMs) : '—'} <small>ms</small>
                </div>
              </div>
            </div>
            <div className="stat">
              <div className="k">
                Confidence · note {st && st.index >= 0 ? st.index + 1 : '–'} / {arr.melody.notes.length}
              </div>
              <div className="conf">
                <div style={{ width: `${Math.round((st?.confidence ?? 0) * 100)}%` }} />
              </div>
            </div>
            <div className="stat">
              <div className="k">Input level</div>
              <div className="conf">
                <div style={{ width: `${Math.round((snap?.level ?? 0) * 100)}%` }} />
              </div>
            </div>
            <div className="hint">
              Delay = note detection ({snap ? Math.round(snap.detectMs) : '–'} ms) plus your audio hardware.
            </div>
          </div>
        </div>
      )}

      <button className="btn sm ghost live-options-toggle" onClick={() => setOptions(!options)} aria-expanded={options} data-testid="live-options">
        {options ? <ChevronUp size={14} /> : <ChevronDown size={14} />} How the voices follow you
      </button>
      {options && (
        <div className="live-opts">
          <Toggle on={live.allowTranspose} onChange={(v) => setLive({ allowTranspose: v })} label="Follow key changes" sub="Sing in any key" />
          <Toggle on={live.followIntonation} onChange={(v) => setLive({ followIntonation: v })} label="Follow intonation" sub="Voices bend with you" />
          <Toggle on={live.followDynamics} onChange={(v) => setLive({ followDynamics: v })} label="Follow dynamics" sub="Louder you, louder choir" />
          <Toggle on={live.echoCancellation} onChange={(v) => setLive({ echoCancellation: v })} label="Echo cancellation" sub="For speakers (adds latency)" />
        </div>
      )}
    </div>
  );
}
