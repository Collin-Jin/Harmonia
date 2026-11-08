import { useRef, useState } from 'react';
import { useStore } from './state/store';
import { Header } from './components/Header';
import { CapturePanel } from './components/CapturePanel';
import { AnalysisPanel } from './components/AnalysisPanel';
import { HarmonyPanel } from './components/HarmonyPanel';
import { Welcome } from './components/Welcome';
import { RecordingStage } from './components/RecordingStage';
import { ScorePanel } from './components/ScorePanel';
import { ReviewStage } from './components/ReviewStage';
import { LivePanel } from './components/LivePanel';
import { Mixer } from './components/Mixer';
import { Dock } from './components/Dock';
import { HelpModal } from './components/HelpModal';
import { Toasts } from './components/Toasts';
import { useScrollEdges } from './components/useScrollEdges';

export default function App() {
  const phase = useStore((s) => s.phase);
  const hasArrangement = useStore((s) => !!s.arrangement);
  const [help, setHelp] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  useScrollEdges(sidebar);

  return (
    <div className="app">
      <Header onHelp={() => setHelp(true)} />
      <main className={`workspace ${phase === 'ready' || phase === 'review' ? 'ready' : ''}`}>
        <aside className="sidebar" ref={sidebar}>
          <CapturePanel />
          {hasArrangement && <AnalysisPanel />}
          {hasArrangement && phase === 'ready' && <HarmonyPanel />}
        </aside>
        <section className="stage">
          {phase === 'empty' && <Welcome onHelp={() => setHelp(true)} />}
          {phase === 'recording' && <RecordingStage />}
          {phase === 'analyzing' && (
            <div className="panel analyzing" data-testid="analyzing">
              <svg className="writing" viewBox="0 0 200 70" aria-hidden>
                {[0, 1, 2, 3, 4].map((i) => (
                  <line key={i} x1="4" x2="196" y1={12 + i * 11} y2={12 + i * 11} />
                ))}
                {[34, 23, 28, 17, 23, 39].map((y, i) => (
                  <ellipse key={i} cx={30 + i * 28} cy={y} rx="6" ry="4.4" transform={`rotate(-22 ${30 + i * 28} ${y})`} style={{ animationDelay: `${i * 0.22}s` }} />
                ))}
              </svg>
              <div className="title">Listening closely…</div>
              <div>Writing down your notes, finding the beat and key, then arranging the harmony.</div>
            </div>
          )}
          {phase === 'review' && hasArrangement && <ReviewStage />}
          {phase === 'ready' && hasArrangement && (
            <>
              <ScorePanel />
              <Mixer />
              <LivePanel />
            </>
          )}
        </section>
      </main>
      {phase === 'ready' && hasArrangement && <Dock />}
      {help && <HelpModal onClose={() => setHelp(false)} />}
      <Toasts />
    </div>
  );
}
