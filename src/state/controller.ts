import { useStore } from './store';
import { getAudioContext, outputLatency, resumeAudio } from '../audio/context';
import { mic } from '../audio/mic';
import { Metronome } from '../audio/metronome';
import { analyzeInWorker, decodeAudioFile, processVoiceInWorker, renderHarmonyVoicesInWorker } from '../audio/analysis';
import { ArrangementPlayer, renderArrangement, type PlayOptions, type RecordingAudio } from '../audio/player';
import { LiveSession } from '../audio/live';
import { recognizeLyrics } from '../audio/lyricsClient';
import { SAMPLES } from '../music/samples';
import { cleanTranscript, HUM_BRIGHTNESS } from '../music/lyrics';
import { TimeMap } from '../music/timemap';
import { formantFor, type VoicePartSpec } from '../music/voiceHarmony';

const MAX_RECORD_SEC = 180;

let metronome: Metronome | null = null;
let gridOriginCtx: number | null = null;
let autoStop: number | null = null;
export const recordingInfo = { startedAt: 0, countInBeat: -1 as number, listeners: new Set<() => void>() };

function micErrorMessage(err: unknown): string {
  const name = (err as DOMException)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Microphone access was blocked. Click the lock/microphone icon in the address bar, allow the microphone for this site, then try again.';
  if (name === 'NotFoundError') return 'No microphone was found. Connect a microphone (or headset) and try again.';
  if (name === 'NotReadableError') return 'The microphone is in use by another application. Close it and try again.';
  return `Could not start the microphone: ${(err as Error)?.message ?? err}`;
}

export async function startRecording() {
  const s = useStore.getState();
  stopPlayback();
  stopLive();
  try {
    await resumeAudio();
    await mic.start({ echoCancellation: false });
  } catch (e) {
    s.toast(micErrorMessage(e), 'error');
    return;
  }
  const ctx = getAudioContext();
  gridOriginCtx = null;
  recordingInfo.countInBeat = -1;
  if (s.metronome) {
    const beat = 60 / s.metronomeBpm;
    const t0 = ctx.currentTime + 0.3;
    metronome = new Metronome(s.metronomeBpm, s.timeSig.beats);
    metronome.onBeat = (i) => {
      recordingInfo.countInBeat = i < s.timeSig.beats ? s.timeSig.beats - i : 0;
      recordingInfo.listeners.forEach((l) => l());
    };
    metronome.start(t0);
    gridOriginCtx = t0 + s.timeSig.beats * beat;
  }
  mic.startRecording();
  recordingInfo.startedAt = performance.now();
  useStore.setState({ phase: 'recording' });
  autoStop = window.setTimeout(() => void stopRecording(), MAX_RECORD_SEC * 1000);
}

export async function stopRecording() {
  if (autoStop !== null) window.clearTimeout(autoStop);
  autoStop = null;
  metronome?.stop();
  metronome = null;
  const s = useStore.getState();
  const rec = await mic.stopRecording();
  useStore.setState({ phase: 'analyzing' });
  let gridOriginSec: number | undefined;
  if (gridOriginCtx !== null) {
    // The singer hears the click after output latency; their voice reaches us after input latency.
    gridOriginSec = gridOriginCtx - rec.startTime + outputLatency() + mic.inputLatency;
  }
  await analyze(rec.samples, rec.sampleRate, {
    bpm: gridOriginSec !== undefined ? s.metronomeBpm : undefined,
    gridOriginSec,
    title: s.title,
  });
}

export async function cancelRecording() {
  if (autoStop !== null) window.clearTimeout(autoStop);
  metronome?.stop();
  metronome = null;
  await mic.stopRecording();
  useStore.setState({ phase: useStore.getState().transcription ? 'ready' : 'empty' });
}

async function analyze(samples: Float32Array, sampleRate: number, o: { bpm?: number; gridOriginSec?: number; title?: string; beats?: number }) {
  const s = useStore.getState();
  const prevPhase = s.transcription ? 'ready' : 'empty';
  if (samples.length < sampleRate * 0.5) {
    s.toast('The recording is too short — sing at least a few notes.', 'error');
    useStore.setState({ phase: prevPhase });
    return;
  }
  useStore.setState({ phase: 'analyzing' });
  try {
    const timeSig = { beats: o.beats ?? s.timeSig.beats, beatType: 4 };
    const result = await analyzeInWorker(samples, sampleRate, { timeSig, bpm: o.bpm, gridOriginSec: o.gridOriginSec });
    if (result.transcription.notes.length < 2) {
      s.toast('No clear singing was detected. Sing a little louder, closer to the mic, on a vowel like “la” or “doo”.', 'error');
      useStore.setState({ phase: prevPhase });
      return;
    }
    s.setAnalysis({ recording: { samples, sampleRate }, frames: result.frames, transcription: result.transcription, title: o.title });
    s.toast(`Transcribed ${result.transcription.notes.length} notes — harmonies ready.`, 'success');
    void detectLyrics();
  } catch (e) {
    s.toast(`Analysis failed: ${(e as Error).message}`, 'error');
    useStore.setState({ phase: prevPhase });
  }
}

export async function loadSample(id: string) {
  const sample = SAMPLES.find((x) => x.id === id);
  if (!sample) return;
  stopPlayback();
  stopLive();
  useStore.setState({ phase: 'analyzing' });
  try {
    const res = await fetch(`/samples/${id}.wav`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { samples, sampleRate } = await decodeAudioFile(await res.blob());
    await analyze(samples, sampleRate, { title: sample.title, beats: sample.beatsPerBar });
  } catch (e) {
    useStore.getState().toast(`Could not load the sample: ${(e as Error).message}`, 'error');
    useStore.setState({ phase: useStore.getState().transcription ? 'ready' : 'empty' });
  }
}

export async function importAudioFile(file: File) {
  stopPlayback();
  stopLive();
  useStore.setState({ phase: 'analyzing' });
  try {
    const { samples, sampleRate } = await decodeAudioFile(file);
    await analyze(samples, sampleRate, { title: file.name.replace(/\.[^.]+$/, '') });
  } catch (e) {
    useStore.getState().toast(`Could not read that audio file: ${(e as Error).message}`, 'error');
    useStore.setState({ phase: useStore.getState().transcription ? 'ready' : 'empty' });
  }
}

/* ---------------- Playback ---------------- */

export const player = new ArrangementPlayer();
player.onEnded = () => useStore.setState({ playing: false });

/* ---------------- Voice processing (autotune + clean-up) ---------------- */

let voiceJob: Promise<RecordingAudio | null> | null = null;
let voiceTimer: number | null = null;
let voiceVersion = 0;

function scheduleVoice() {
  if (voiceTimer !== null) window.clearTimeout(voiceTimer);
  const version = ++voiceVersion;
  const s = useStore.getState();
  if (!s.recording || !s.transcription) {
    voiceJob = null;
    useStore.setState({ voice: null, voiceBusy: false });
    return;
  }
  useStore.setState({ voice: null, voiceBusy: true });
  voiceJob = new Promise((resolve) => {
    voiceTimer = window.setTimeout(async () => {
      voiceTimer = null;
      const st = useStore.getState();
      const rec = st.recording;
      const tr = st.transcription;
      if (!rec || !tr) return resolve(null);
      const offset = tr.tuningCents / 100;
      const frames = st.frames.map((f) => ({ t: f.t, midi: f.midi === null ? null : f.midi + offset }));
      const notes = tr.notes.map((n) => ({ time: n.time, end: n.end, midi: n.midi }));
      try {
        const out = await processVoiceInWorker(rec.samples, rec.sampleRate, frames, notes, st.autotune);
        if (version !== voiceVersion) return resolve(null);
        const voice = { samples: out, sampleRate: rec.sampleRate };
        useStore.setState({ voice, voiceBusy: false });
        resolve(voice);
      } catch {
        if (version === voiceVersion) useStore.setState({ voiceBusy: false });
        resolve(null);
      }
    }, 120);
  });
}

/** The voice to play/export: processed when available (waits for a pending job), else the raw take. */
export async function voiceForPlayback(): Promise<RecordingAudio | null> {
  const s = useStore.getState();
  if (s.voice) return s.voice;
  if (voiceJob) {
    const v = await voiceJob;
    if (v) return v;
  }
  return useStore.getState().voice ?? s.recording;
}

/* ---------------- Lyrics ---------------- */

let lyricsVersion = 0;

/** Recognise the words of the current take (if enabled) so the harmony can sing them. */
export async function detectLyrics() {
  const s = useStore.getState();
  const rec = s.recording;
  const version = ++lyricsVersion;
  if (!rec || !s.detectLyrics) {
    s.setLyrics({ status: 'off', words: [], hummed: false });
    return;
  }
  s.setLyrics({ status: 'listening', progress: 0, error: undefined });
  let shownAt = 0;
  try {
    const r = await recognizeLyrics(rec.samples, rec.sampleRate, {
      onProgress: (f) => {
        const now = performance.now();
        if (version !== lyricsVersion || (now - shownAt < 200 && f < 1)) return;
        shownAt = now;
        useStore.getState().setLyrics({ status: 'downloading', progress: f });
      },
      onRunning: () => version === lyricsVersion && useStore.getState().setLyrics({ status: 'listening' }),
    });
    if (version !== lyricsVersion || useStore.getState().recording !== rec) return;
    const hummed = r.brightness < HUM_BRIGHTNESS;
    const words = cleanTranscript(r.chunks, r.duration, r.brightness);
    useStore.getState().setLyrics({ status: words.length ? 'done' : 'none', words, hummed, progress: 1 });
  } catch (e) {
    if (version !== lyricsVersion) return;
    useStore.getState().setLyrics({ status: 'error', error: (e as Error).message, words: [] });
  }
}

/* ---------------- Harmonies in the singer's voice ---------------- */

const partCache = new Map<string, Float32Array>();
let partsJob: Promise<Record<string, RecordingAudio> | null> | null = null;
let partsTimer: number | null = null;
let partsVersion = 0;

function voicePartSpecs(): { specs: (VoicePartSpec & { sig: string })[]; melody: { time: number; end: number; midi: number }[] } | null {
  const s = useStore.getState();
  const tr = s.transcription;
  const arr = s.arrangement;
  if (!tr || !arr) return null;
  const map = TimeMap.fromPerformance(tr.notes, tr.bpm, tr.originSec);
  const melody = tr.notes.map((n) => ({ time: n.time, end: n.end, midi: n.midi }));
  const melMid = melody.map((n) => n.midi).sort((a, b) => a - b)[melody.length >> 1] ?? 60;
  const melSig = melody.map((n) => `${n.time.toFixed(3)}:${n.midi}`).join(',');
  const specs = arr.harmonies.map((p, i) => {
    const raw = p.notes.map((n) => ({ time: map.sec(n.start), end: map.sec(n.start + n.dur), midi: n.midi }));
    const notes: { time: number; end: number; midi: number }[] = [];
    for (const n of raw) {
      const prev = notes[notes.length - 1];
      if (prev && n.midi === prev.midi && n.time - prev.end < 0.08) prev.end = Math.max(prev.end, n.end);
      else notes.push({ ...n });
    }
    const mean = notes.length ? notes.reduce((a, n) => a + n.midi, 0) / notes.length : melMid;
    const vowel = p.sound === 'lyrics' ? null : p.sound;
    const formant = formantFor(mean - melMid, i);
    const sig = `${melSig}|${p.notes.map((n) => `${n.start}:${n.dur}:${n.midi}`).join(',')}|${vowel}|${formant.toFixed(3)}|${i}`;
    return { id: p.id, notes, vowel, formant, seed: i + 1, sig };
  });
  return { specs, melody };
}

function scheduleVoiceParts() {
  if (partsTimer !== null) window.clearTimeout(partsTimer);
  const version = ++partsVersion;
  const s = useStore.getState();
  if (s.harmonySource !== 'voice' || !s.recording || !s.transcription || !s.arrangement) {
    partsJob = null;
    if (s.voiceParts || s.voicePartsBusy) useStore.setState({ voiceParts: null, voicePartsBusy: false });
    return;
  }
  useStore.setState({ voiceParts: null, voicePartsBusy: true });
  partsJob = new Promise((resolve) => {
    partsTimer = window.setTimeout(async () => {
      partsTimer = null;
      const st = useStore.getState();
      const rec = st.recording;
      const tr = st.transcription;
      const built = voicePartSpecs();
      if (!rec || !tr || !built) return resolve(null);
      const need = built.specs.filter((sp) => !partCache.has(sp.sig));
      try {
        if (need.length) {
          const offset = tr.tuningCents / 100;
          const frames = st.frames.map((f) => ({ t: f.t, midi: f.midi === null ? null : f.midi + offset }));
          const out = await renderHarmonyVoicesInWorker({ samples: rec.samples, sampleRate: rec.sampleRate, frames, melody: built.melody, parts: need });
          need.forEach((sp) => out[sp.id] && partCache.set(sp.sig, out[sp.id]));
          while (partCache.size > 24) partCache.delete(partCache.keys().next().value as string);
        }
        if (version !== partsVersion) return resolve(null);
        const parts: Record<string, RecordingAudio> = {};
        built.specs.forEach((sp) => {
          const buf = partCache.get(sp.sig);
          if (buf) parts[sp.id] = { samples: buf, sampleRate: rec.sampleRate };
        });
        useStore.setState({ voiceParts: parts, voicePartsBusy: false });
        resolve(parts);
      } catch (e) {
        if (version === partsVersion) useStore.setState({ voicePartsBusy: false });
        console.warn('voice harmonies failed', e);
        resolve(null);
      }
    }, 150);
  });
}

/** Harmony parts in the singer's voice (waits for a pending render), or null in choir mode. */
export async function voicePartsForPlayback(): Promise<Record<string, RecordingAudio> | null> {
  const s = useStore.getState();
  if (s.harmonySource !== 'voice') return null;
  if (s.voiceParts) return s.voiceParts;
  if (partsJob) return (await partsJob) ?? useStore.getState().voiceParts;
  return null;
}

/** Everything the player / WAV export needs for the current arrangement. */
export async function playbackOptions(fromUnit = 0): Promise<PlayOptions> {
  const s = useStore.getState();
  const recording = s.melodySource === 'recording' ? await voiceForPlayback() : s.recording;
  const voiceParts = await voicePartsForPlayback();
  const st = useStore.getState();
  return { fromUnit, mix: st.mix, melodySource: st.melodySource, recording, transcription: st.transcription, voiceParts };
}

export async function play(fromUnit = 0) {
  const s = useStore.getState();
  if (!s.arrangement) return;
  stopLive();
  const opts = await playbackOptions(fromUnit);
  const arr = useStore.getState().arrangement;
  if (!arr) return;
  await player.play(arr, opts);
  useStore.setState({ playing: true });
}

export function stopPlayback() {
  player.stop();
  if (useStore.getState().playing) useStore.setState({ playing: false });
}

/* ---------------- Live ---------------- */

let live: LiveSession | null = null;
export const getLive = () => live;

export async function startLive() {
  const s = useStore.getState();
  if (!s.arrangement) return;
  stopPlayback();
  stopLive();
  const session = new LiveSession(s.arrangement, { ...s.live, mix: s.mix });
  try {
    await session.start();
  } catch (e) {
    s.toast(micErrorMessage(e), 'error');
    return;
  }
  live = session;
  useStore.setState({ liveActive: true });
}

export function stopLive() {
  if (live) {
    live.stop();
    live = null;
  }
  if (useStore.getState().liveActive) useStore.setState({ liveActive: false });
}

/** Restart live mode when the arrangement or follower settings change mid-session. */
export async function refreshLive() {
  if (live) await startLive();
}

/** Shared playhead for the score cursor and piano roll (score units) or null. */
export function currentPosition(): number | null {
  if (live) return live.snapshot().currentUnit;
  if (player.playing) return player.position();
  return null;
}

// keep mixer changes flowing to whatever is playing
useStore.subscribe((st, prev) => {
  if (st.mix !== prev.mix) {
    player.setMix(st.mix);
    live?.setMix(st.mix);
  }
  if (st.arrangement !== prev.arrangement) {
    if (player.playing) stopPlayback();
    if (live && st.arrangement && !live.update(st.arrangement)) void refreshLive();
  }
  // Re-tune the voice when the notes it is tuned to (or the mode) change.
  const notesChanged = st.transcription?.notes !== prev.transcription?.notes;
  if (st.recording !== prev.recording || notesChanged || st.autotune !== prev.autotune) {
    if (player.playing && st.autotune !== prev.autotune) stopPlayback();
    scheduleVoice();
  }
  if (st.recording !== prev.recording) partCache.clear();
  if (st.arrangement !== prev.arrangement || st.harmonySource !== prev.harmonySource || st.recording !== prev.recording) {
    if (player.playing && st.harmonySource !== prev.harmonySource) stopPlayback();
    scheduleVoiceParts();
  }
  if (st.detectLyrics !== prev.detectLyrics && st.recording) void detectLyrics();
});

if (typeof window !== 'undefined')
  Object.assign((window as any).__harmonia ?? ((window as any).__harmonia = {}), {
    getLive,
    player,
    renderArrangement,
    voiceForPlayback,
    voicePartsForPlayback,
    playbackOptions,
    importAudioFile,
  });
