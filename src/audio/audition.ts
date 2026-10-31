import { getAudioContext, getMasterBus, resumeAudio } from './context';

/** A short, soft sung-like tone so a pitch edit can be heard immediately. */
export async function audition(midi: number) {
  await resumeAudio();
  const ctx = getAudioContext();
  const t = ctx.currentTime + 0.01;
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = f;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(6000, f * 5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.28, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  osc.connect(lp).connect(g).connect(getMasterBus().input);
  osc.start(t);
  osc.stop(t + 0.5);
}
