import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import tonejsMidi from '@tonejs/midi';
import { DOMParser } from '@xmldom/xmldom';
import { artifacts, fakeMicArgs, fixture } from './helpers';

const { Midi } = tonejsMidi;

// The fake microphone "sings" Ode to Joy (21 s, formant-synthesised voice with vibrato).
test.use({ launchOptions: { args: fakeMicArgs(fixture('ode-to-joy.wav')) } });

test('record from microphone → transcribe → harmonize → play → export MIDI/MusicXML/PDF/WAV', async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Sing it once/ })).toBeVisible();
  await page.screenshot({ path: join(artifacts, '01-welcome.png'), fullPage: true });
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible();
  await page.screenshot({ path: join(artifacts, '01b-help.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeHidden();

  // ---- Record through the (fake) microphone ----
  await page.getByTestId('record-button').click();
  await expect(page.getByTestId('recording-stage')).toBeVisible();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(artifacts, '02-recording.png') });
  await page.waitForTimeout(16500);
  await page.getByTestId('stop-button').click();

  // ---- Transcription ----
  await expect(page.getByTestId('analysis-panel')).toBeVisible({ timeout: 30_000 });
  const tr = await page.evaluate(() => {
    const s = (window as any).__harmonia.store.getState();
    return { notes: s.transcription.notes.map((n: any) => n.midi), durs: s.transcription.notes.map((n: any) => n.dur), bpm: s.transcription.bpm, key: s.transcription.key };
  });
  const expected = [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62, 64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60];
  expect(tr.notes).toEqual(expected);
  expect(Math.abs(tr.bpm - 100)).toBeLessThan(5);
  expect(tr.key).toMatchObject({ tonic: 0, mode: 'major' });
  // a recorded take opens "Check your notes" (with What I heard) before the arrangement
  await expect(page.getByTestId('review-stage')).toBeVisible();
  await expect(page.getByTestId('key-select')).toHaveValue('0');
  await page.getByTestId('review-continue').click();
  await expect(page.getByTestId('analysis-summary')).toContainText('C major');
  await expect(page.getByTestId('chords').locator('.chord').first()).toBeVisible();

  // ---- Sheet music rendered by OSMD ----
  const score = page.getByTestId('score');
  await expect(score.locator('svg').first()).toBeVisible();
  await expect.poll(async () => score.locator('svg path').count()).toBeGreaterThan(200);
  await page.screenshot({ path: join(artifacts, '03-arranged-pop.png'), fullPage: true });

  // ---- Change style / voices: choral SATB ----
  await page.getByTestId('style-choral').click();
  await page.locator('.seg button', { hasText: /^3$/ }).first().click();
  await expect(page.locator('[data-testid^="strip-"]')).toHaveCount(4);
  const parts = await page.evaluate(() => (window as any).__harmonia.store.getState().arrangement.harmonies.map((h: any) => h.name));
  expect(parts).toEqual(['Alto', 'Tenor', 'Bass']);
  await expect.poll(async () => score.locator('svg path').count()).toBeGreaterThan(400);
  await page.screenshot({ path: join(artifacts, '04-choral-score.png'), fullPage: true });

  // ---- Piano roll ----
  await page.getByTestId('tab-roll').click();
  await expect(page.getByTestId('piano-roll')).toBeVisible();
  await page.screenshot({ path: join(artifacts, '05-piano-roll.png'), fullPage: true });
  await page.getByTestId('tab-score').click();

  // ---- Autotuned voice (processed in the worker, used for playback/export) ----
  await expect(page.getByTestId('autotune')).toHaveValue('natural');
  await expect.poll(async () => page.evaluate(() => !!(window as any).__harmonia.store.getState().voice), { timeout: 20_000 }).toBe(true);
  await page.getByTestId('autotune').selectOption('hard');
  await expect.poll(async () => page.evaluate(() => {
    const s = (window as any).__harmonia.store.getState();
    return !!s.voice && s.voice.samples.length === s.recording.samples.length && !s.voiceBusy;
  }), { timeout: 20_000 }).toBe(true);

  // ---- Playback (autotuned recording + synthesized harmonies) ----
  await page.getByTestId('play-button').click();
  await page.waitForTimeout(2500);
  const playback = await page.evaluate(() => {
    const h = (window as any).__harmonia;
    return { playing: h.player.playing, pos: h.player.position() };
  });
  expect(playback.playing).toBe(true);
  expect(playback.pos).toBeGreaterThan(2);
  await page.screenshot({ path: join(artifacts, '06-playing.png') });
  await page.getByTestId('play-button').click();
  await expect.poll(() => page.evaluate(() => (window as any).__harmonia.player.playing)).toBe(false);

  // ---- Seek from the transport: clicking near the end starts playback there ----
  const bar = page.getByTestId('dock').locator('.progress');
  const box = (await bar.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  await expect
    .poll(() => page.evaluate(() => { const h = (window as any).__harmonia; return h.player.playing ? h.player.position() / h.store.getState().arrangement.totalUnits : 0; }))
    .toBeGreaterThan(0.6);
  await page.getByTestId('play-button').click();

  // ---- Header section buttons scroll to their panels ----
  await page.getByRole('button', { name: 'Perform live' }).click();
  await expect(page.getByTestId('live-panel')).toBeInViewport();

  // ---- Exports ----
  const save = async (testId: string, name: string) => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByTestId(testId).click()]);
    const p = join(artifacts, name);
    await dl.saveAs(p);
    return p;
  };
  const midiPath = await save('export-midi', 'export.mid');
  const midi = new Midi(readFileSync(midiPath));
  expect(midi.tracks).toHaveLength(4);
  expect(midi.tracks[0].notes.map((n) => n.midi)).toEqual(expected);
  expect(midi.tracks.slice(1).every((t) => t.notes.length > 10)).toBe(true);

  const xmlPath = await save('export-musicxml', 'export.musicxml');
  const doc = new DOMParser().parseFromString(readFileSync(xmlPath, 'utf8'), 'text/xml');
  expect(doc.getElementsByTagName('part')).toHaveLength(4);
  expect(doc.getElementsByTagName('harmony').length).toBeGreaterThan(4);
  expect(doc.getElementsByTagName('part-name')[1].textContent).toBe('Alto');

  const pdfPath = await save('export-pdf', 'export.pdf');
  const pdf = readFileSync(pdfPath);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(statSync(pdfPath).size).toBeGreaterThan(8000);

  const wavPath = await save('export-wav', 'export.wav');
  const wav = readFileSync(wavPath);
  expect(wav.subarray(0, 4).toString()).toBe('RIFF');
  const channels = wav.readUInt16LE(22);
  const rate = wav.readUInt32LE(24);
  const seconds = (wav.length - 44) / (rate * channels * 2);
  expect(seconds).toBeGreaterThan(15);
  // the mix is not silent
  let peak = 0;
  for (let i = 44; i < wav.length; i += 200) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
  expect(peak).toBeGreaterThan(3000);

  expect(errors.filter((e) => !/favicon|DevTools/.test(e))).toEqual([]);
});
