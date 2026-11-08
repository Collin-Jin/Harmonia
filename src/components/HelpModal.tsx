import { useEffect } from 'react';
import { X } from 'lucide-react';

export function HelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Help">
        <div className="modal-head">
          <div className="grow">
            <div className="eyebrow">Programme notes</div>
            <h3>How to use Harmonia</h3>
          </div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close help">
            <X size={18} />
          </button>
        </div>

        <section>
          <h4>
            <span className="mark">A</span> Sing
          </h4>
          <ul>
            <li>
              Press the red <b>rec</b> button and choose <b>Allow</b> when the browser asks for the microphone. Sing one melody line for 5–40
              seconds, then press it again.
            </li>
            <li>Sing the words, sing on “la”, or just hum. If you sing words, the harmony can sing them too. The score itself stays wordless.</li>
            <li>
              The <b>metronome</b> gives a one-bar count-in and keeps the rhythm tidy. Wear headphones so the click isn’t recorded.
            </li>
            <li>
              Microphone blocked? Click the icon left of the address bar, set <b>Microphone → Allow</b> and reload. In Safari: <i>Settings →
              Websites → Microphone</i>. The page must run on <code>localhost</code> or HTTPS.
            </li>
            <li>No mic handy? Use an example melody or import a recording from your computer.</li>
          </ul>
        </section>

        <section>
          <h4>
            <span className="mark">B</span> What I heard
          </h4>
          <p>
            After you record or import a take, <b>Check your notes</b> shows the melody as heard on a piano roll. Drag a note up or down to fix
            its pitch, or select it and press Delete to remove a breath or noise heard as a note; play it back in your voice or on a piano, then
            press <b>Harmonize</b>. The key, tempo and metre can be corrected here too, and <b>Fix</b> brings you back later. The first time you sing words,
            a small speech model (about 77 MB) downloads once so the harmony can sing them. After that it runs offline on your computer.
          </p>
        </section>

        <section>
          <h4>
            <span className="mark">C</span> Arrange
          </h4>
          <ul>
            <li><b>Style</b> and <b>harmony parts</b> set the character and size of your choir. <b>New voicing</b> writes fresh lines over the same chords and <b>New chords</b> a fresh progression; the arrows step back through what you tried.</li>
            <li><b>Click a chord</b> to swap it for another that fits the melody there. Only that chord changes; <b>Re-fit the rest</b> re-chooses the others around your picks.</li>
            <li>
              <b>Who sings them</b>: <i>Your voice</i> re-pitches your own recording onto each harmony line. <i>Choir synth</i> uses a built-in
              vocal sound.
            </li>
            <li>
              <b>What they sing</b>: the same lyrics as you, or one sound such as “Ooh” or “Mmm”. You can give a single part its own sound in the
              mix (E).
            </li>
          </ul>
        </section>

        <section>
          <h4>
            <span className="mark">D</span> Edit the score
          </h4>
          <ul>
            <li>
              Click any note. The editor bar under the score lets you change its pitch. You can still type a syllable if you want a harmony note to
              sing a particular sound.
            </li>
            <li>
              Keys: <kbd>↑</kbd> <kbd>↓</kbd> semitone, <kbd>⇧</kbd> + arrow octave, <kbd>←</kbd> <kbd>→</kbd> next note, <kbd>Enter</kbd> edit
              syllable, <kbd>Esc</kbd> done.
            </li>
            <li>Changing a melody note re-tunes your voice and re-writes the harmony. <b>Undo my edits</b> puts everything back.</li>
            <li>
              <b>Save as</b>: MIDI for a DAW, MusicXML for MuseScore, Sibelius, Finale or Dorico, a printable PDF, or a WAV of the mix.
            </li>
          </ul>
        </section>

        <section>
          <h4>
            <span className="mark">E</span> Mix &amp; play
          </h4>
          <p>
            The player at the bottom plays the arrangement. Click its progress bar to jump to any bar, and use <b>Melody</b> to hear your voice, the
            synth, or harmony only so you can sing along. In the mix, <b>M</b> mutes a part and <b>S</b> solos it.
          </p>
        </section>

        <section>
          <h4>
            <span className="mark">F</span> Sing live
          </h4>
          <ul>
            <li>
              <b>Wear headphones</b>, otherwise the harmony leaks into the microphone. On speakers, turn on <i>Echo cancellation</i>.
            </li>
            <li>
              Press <b>Sing live</b> and sing the melody again, from the top or anywhere. The voices follow your place, tempo, key and tuning. If you
              wander off the tune, they improvise in your key until they find you again.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
