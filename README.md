# Harmonia

Sing a melody once and Harmonia transcribes the notes and the words, composes vocal harmonies, sings them back in your own voice, and engraves everything as editable sheet music with lyrics. It can then sing along with you live, following your position, tempo, key and intonation.

Everything runs locally in the browser. Audio analysis, harmony generation, speech recognition and voice processing are real signal processing and music theory, not mock-ups. Your audio is never sent to a server. The only network request is a one-time download of the speech model (about 77 MB) from Hugging Face the first time a take with words is analysed.

## Quick start

```bash
npm install
npm run dev          # → http://127.0.0.1:5173/
```

Open **http://127.0.0.1:5173/** in Chrome or Edge (desktop).

### Microphone permission

1. Click **Start singing** (or the red record button). The browser will ask to use your microphone; choose **Allow**.
2. If you dismissed the prompt, click the camera/mic icon at the right of the address bar (Chrome: the tune icon left of the URL → *Site settings* → *Microphone* → *Allow*) and reload.
3. macOS: *System Settings → Privacy & Security → Microphone* must allow your browser.
4. `http://127.0.0.1` and `http://localhost` count as secure origins, so the microphone works without HTTPS. If you open the app from another device on your network, you need HTTPS.
5. **Use headphones for live mode.** Otherwise the harmony voices leak into the microphone. On speakers, turn on *Echo cancellation* in the live panel; it adds a little latency.

The in-app **Help** button repeats these steps.

### Sample melody

* **Twinkle, Twinkle (sung)** (C major, 4/4, 92 bpm) is sung with words. Use it to see lyric detection, lyrics in the score, and harmonies singing the words.
* **Ode to Joy** (C major, 4/4, 100 bpm) and **Amazing Grace** (G major, 3/4, 84 bpm, with a pickup) are sung on "la". Click a sample to load and analyze it, or press ▶ on its card to hear it and sing along.
* The WAV files are in `public/samples/`. Regenerate them with `npm run gen:sample`; the sung Twinkle take comes from `npx tsx scripts/generate-lyrics-fixture.ts`, which also writes a hummed Ode to Joy test take.
* Ode to Joy as notes: `E E F G | G F E D | C C D E | E. D D₂ | E E F G | G F E D | C C D E | D. C C₂`.

## Using the app

The sections carry rehearsal letters A–F, like a score. The buttons in the header jump to them and show where you are. Once a take is in, A and B fold to one line, and on wide screens the left column stays beside the score so Arrange is always in reach.

1. **A · Sing**: record with an optional metronome and count-in, import an audio file, or load an example. Sing with words, on "la", or hum. With **Harmony sings the words** on, the words are recognized so the backing voices can sing them. The engraved score stays wordless. A hummed take is recognized as humming and the harmony stays wordless too.
2. **B · What I heard**: after you record or import a take, **Check your notes** shows the melody as heard on a piano roll, with the line you actually sang behind it. Drag a note up or down to fix its pitch, or select it and press Delete (or **Remove note**) to drop a breath or noise heard as a note; click its outline to bring it back. **Play** it in your own voice, tuned to the notes as they stand, or on a piano, then press **Harmonize**. The key, tempo and metre can be corrected alongside. Afterwards the section folds to a summary, and **Fix** brings you back. The built-in samples skip this step.
3. **C · Arrange**, in three groups:
   * **Harmony**: a style (Pop stack, Choral SATB, Jazz close, Barbershop, Ambient pad), 1–4 harmony parts, and, in Ambient pad, where they sit (above, around or below the melody). Pop stack has up to three parts, added in this order: a 3rd above, a 3rd or 4th below, then a top part; it has no bass, because your voice re-pitched that far down buzzes. **New voicing** writes different lines over the same chords.
   * **Chords**: the progression and harmonic colour; the chords change as often as the melody needs. **Click a chord** to choose another; the choices are ranked by how well they fit the melody and the chords either side. Only that chord changes, and it stays pinned to its place through other changes; **Re-fit the rest** re-chooses the other chords around yours. **New chords** writes a different progression. The ‹ › arrows step back and forth through the arrangements you've tried.
   * **Sound**: the harmony parts are your own recording, re-pitched onto every line. **What they sing** picks the lyrics, or "Ooh", "Aah", "Oh", "Ee" or "Mmm".
4. **D · Score**: engraved sheet music (no lyrics) with a playback cursor, or a piano roll. **Click any note**, in the melody or a harmony, and edit it in the bar under the score: ↑/↓ moves it a semitone (Shift for an octave), ←/→ selects the next note, Esc closes. Editing a melody note re-tunes your voice and re-harmonizes around it. **Undo my edits** reverts your note and lyric changes (chords reset from Arrange). **Save as** MIDI, MusicXML, PDF or WAV.
5. **E · Mix**: per-part level, mute/solo, and what each part sings (folded to a summary of the parts until you press **Adjust**). The player at the bottom plays the arrangement; click its progress bar to start from any beat, and use **Melody** to hear your voice, the synth, or harmony only. Your recorded voice goes through **Autotune** (Natural keeps some vibrato and the natural slides between notes, Hard snaps instantly, Off leaves the pitch alone) plus clean-up (rumble filter, noise gate between notes, gentle compression). This applies to playback and to WAV export.
6. **F · Sing live**: press **Sing live** and sing the melody again, from the top or from anywhere. The voices find your place and follow your tempo, transposition and pitch bends. If you leave the melody, they improvise diatonic harmony around whatever you sing.

## Tests

```bash
npm test             # unit tests (Vitest): transcription, chords, harmony, lyrics, voice harmony, exports, live follower
npm run test:e2e     # browser E2E (Playwright + Chromium, fake microphone)
npm run typecheck
npm run build
```

The E2E tests start Chromium with `--use-file-for-fake-audio-capture`, so a WAV file stands in for the microphone, and run against the production build (`vite build && vite preview` on port 5174):

* `record-harmonize-export.spec.ts` records Ode to Joy through the real `getUserMedia` → AudioWorklet path, then checks the exact 30-note transcription, tempo and key. It renders the score, switches to choral SATB, plays back, and downloads MIDI/MusicXML/PDF/WAV, parsing each file to check its contents.
* `live.spec.ts` builds the arrangement from the reference recording. The "microphone" then sings a different take: 2 semitones higher, 15% faster and 15 cents sharp. The test checks that the follower locks on, tracks every note in order, detects the +2 transposition and the faster tempo, and drives the voices. Typical result: 30/30 notes followed, with a median of about 40 ms from detecting a note to the voices responding.
* `chord-edit.spec.ts` swaps one chord for a ranked suggestion, checks that no other chord moved, that the choice survives a style change and re-fit, and that Reset clears it.
* `review.spec.ts` imports a take, which opens Check your notes; drags a note up two semitones, removes another and brings it back, plays it on the piano, then harmonizes and checks the arrangement keeps the fix.
* `arrange.spec.ts` checks the folded A/B summaries and header links, then steps through New voicing, New chords and back again.
* `flow.spec.ts` checks the moment after harmonizing: the play button is pointed out until pressed, the header marks one section, the chord choices and the note editor open fully in view (not under the player), and Mix stays folded until opened.
* `lyrics-edit.spec.ts` loads the sung Twinkle take. It checks the recognized lyrics ("Twin-kle twin-kle lit-tle star…") on every staff and in the MusicXML. It then clicks notes to change a melody pitch and syllable and a harmony pitch and syllable, resets the edits, and switches the harmony sound per part. Finally it checks that the harmonies are rendered in the singer's own voice, sample-aligned with the take, and exports WAV. A second test imports a hummed take and checks that it gets no lyrics but can still have the harmony sing "Mmm". The speech model is downloaded on the first run, so this test needs network access.

Screenshots and the exported files are written to `tests/e2e/artifacts/`.

## How it works

| Stage | Implementation |
| --- | --- |
| Capture | AudioWorklet (`public/worklets/capture-processor.js`) records raw audio and runs YIN pitch detection every 256 samples (~5 ms) |
| Transcription | YIN with octave repair and median smoothing; energy- and pitch-based note segmentation; noise rejection (breaths, clicks, squeaks and hum are dropped by duration, level, pitch stability and range); pitch fitting with a Viterbi model of the singer's drifting tuning, tried in all 12 keys, so out-of-tune notes snap to the intended scale degree; tempo search (50–190 bpm), 16th-note quantization, downbeat and pickup selection |
| Autotune | Per-note correction curve (retune speed and kept vibrato per mode), TD-PSOLA pitch shifting, then high-pass, noise gate and compressor, all in a Web Worker |
| Key | Krumhansl–Kessler profiles, weighted by duration |
| Chords | Viterbi HMM over a functional-harmony vocabulary (diatonic, 7ths, secondary dominants, borrowed chords), with metrically weighted melody emission and cadence priors |
| Voices | Beam-search voice leading: chord coverage, doubling, spacing, parallel 5ths/octaves, tendency tones, smoothness and per-style rules |
| Lyrics | Whisper (`whisper-base.en`, word timestamps) via transformers.js in a Web Worker. A brightness test (energy above 1 kHz) recognizes humming before the model runs. Hallucinated or wordless output ("ooh", "la", text after the take ends) is discarded. Words are split into syllables and aligned to notes by dynamic programming (syllable / melisma / two syllables on one note / no text). Line ends feed the cadence planner |
| Voice harmonies | Your take is pitch-shifted onto each harmony line with TD-PSOLA (interval plus the autotune correction, with smoothed glides), with a slight formant shift per part so the voices sound like different singers. "Ooh"/"Aah"/… parts use LPC cross-synthesis of your voice onto the chosen vowel. The parts are rendered in recording time, so they line up with the melody sample-for-sample |
| Synthesis | Formant "choir" voices (glottal wavetable, detuned pair, breath noise, 4 vowel formants, delayed vibrato, scoops), convolution reverb and bus compressor; WAV export via OfflineAudioContext |
| Live following | Online note segmenter, then an HMM score follower over (note position × transposition) with tempo and tuning tracking, then a controller that schedules voices and bends them with your intonation |
| Notation | MusicXML generated in-app, rendered by OpenSheetMusicDisplay; PDF via jsPDF + svg2pdf; MIDI via @tonejs/midi |

## Known limitations

* The harmony "AI" is probabilistic music-theory search (HMM + beam search), not a trained neural network. It's deterministic per variation seed.
* The harmonies are your own recording re-pitched. Shifts larger than about an octave (low bass parts) start to sound processed, and every part carries your vibrato and timing, so it sounds like an overdubbed you rather than different singers.
* Live mode uses the choir synth. Re-pitching your voice live would need the harmony audio before you have sung it.
* Lyric recognition is English only (`whisper-base.en`) and sung words are harder than speech. Expect occasional wrong words, which you can fix in the score. The first take with words needs internet access to download the model (about 77 MB, cached afterwards); without it, lyric detection shows an error and everything else still works.
* Lyric timing from the recognizer is coarse (often a few hundred ms late), so alignment relies mostly on word order and syllable counts. Unusual words can get the wrong syllable split; edit them in the score.
* Note edits are stored per note. Changing the tempo, metre or key re-quantizes the take, and harmony edits made before that may no longer apply.
* Transcription assumes one monophonic line. Fast melismas, heavy vibrato under ~100 ms notes, and very breathy singing can be mis-segmented; correct the tempo, key or metre in the panel if needed.
* Autotune applies to your recorded take (playback and WAV export). In live mode your own voice isn't played back, so there is nothing to tune.
* A take sung consistently about a quarter-tone off can still be read a semitone away, either on single notes or for the whole take. Picking the right key in "What you sang" re-reads borderline notes against that key.
* Automated tests drive the full pipeline with synthesized singing through Chromium's fake microphone. A real human voice through a real microphone, real speaker/headphone latency, and echo-cancellation quality can't be verified automatically, so test them yourself.
* Tested in Chromium. Safari and Firefox should work (standard Web Audio, AudioWorklet and getUserMedia), but were not tested.
