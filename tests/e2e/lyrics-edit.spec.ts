import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artifacts, fixture } from './helpers';

const state = (page: Page) => page.evaluate(() => (window as any).__harmonia.store.getState());
const partLyrics = (page: Page, id: string) =>
  page.evaluate((id) => {
    const a = (window as any).__harmonia.store.getState().arrangement;
    const p = [a.melody, ...a.harmonies].find((x: any) => x.id === id);
    return p.notes.map((n: any) => n.lyric?.text ?? (n.melisma ? '_' : '·')).join(' ');
  }, id);

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

test('sung take: lyrics for singing (not on the score), edit notes, harmony sounds, voice harmonies', async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByTestId('sample-twinkle-lyrics').click();
  await expect(page.getByTestId('analysis-panel')).toBeVisible({ timeout: 60_000 });

  // ---- Lyrics: recognised so the harmony can sing them, but never engraved ----
  await expect(page.getByTestId('lyrics-status')).toHaveAttribute('data-status', 'done', { timeout: 150_000 });
  await expect(page.getByTestId('lyric-line')).toHaveCount(0);
  expect(await partLyrics(page, 'melody')).toBe('Twin kle twin kle lit tle star how I won der what you are');
  expect(await partLyrics(page, 'h1')).toContain('Twin kle twin kle lit tle star');
  const score = page.getByTestId('score');
  await expect.poll(async () => score.locator('.vf-lyrics, .lyric, text.lyrics').count()).toBe(0);
  await page.screenshot({ path: join(artifacts, '08-lyrics-score.png'), fullPage: true });

  // ---- Edit a melody note: pitch with the keyboard, syllable in the inspector ----
  await expect.poll(async () => score.locator('.hn-note[data-part="melody"]').count()).toBeGreaterThanOrEqual(14);
  await expect(page.getByTestId('note-hint')).toBeVisible();
  await score.locator('.hn-note[data-part="melody"] .vf-notehead').first().click();
  const editor = page.getByTestId('note-editor');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('note-editor-pitch')).toHaveText('C4');
  const harmonyBefore = (await state(page)).arrangement.harmonies.map((h: any) => h.notes[0].midi);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('note-editor-pitch')).toHaveText('D4');
  await expect.poll(async () => (await state(page)).transcription.notes[0].midi).toBe(62);
  const s1 = await state(page);
  expect(s1.arrangement.melody.notes[0]).toMatchObject({ midi: 62, edited: true });
  // the harmony is re-composed around the new note and stays consonant with it
  for (const h of s1.arrangement.harmonies) expect([3, 4, 5, 7, 8, 9, 12].includes(Math.abs(h.notes[0].midi - 62) % 12 || 12)).toBe(true);
  expect(s1.arrangement.harmonies.map((h: any) => h.notes[0].midi)).not.toEqual(harmonyBefore);
  await expect(score.locator('.hn-note.edited')).toHaveCount(1);

  await page.getByTestId('note-lyric').fill('Shine-');
  await page.getByTestId('note-lyric').press('Enter');
  await expect.poll(async () => (await partLyrics(page, 'melody')).startsWith('Shine')).toBe(true);
  expect((await partLyrics(page, 'h1')).startsWith('Shine')).toBe(true);
  await page.screenshot({ path: join(artifacts, '09-note-editor.png') });
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(page.getByTestId('note-hint')).toBeVisible();

  // ---- Edit a harmony note ----
  await score.locator('.hn-note[data-part="h1"] .vf-notehead').nth(2).click();
  await expect(editor).toContainText('High Harmony');
  const hBefore = (await state(page)).arrangement.harmonies[0].notes[2].midi;
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await state(page)).arrangement.harmonies[0].notes[2].midi).toBe(hBefore - 1);
  await page.getByTestId('note-lyric').fill('ooh');
  await page.getByTestId('note-lyric').press('Enter');
  await expect.poll(async () => (await state(page)).arrangement.harmonies[0].notes[2].lyric?.text).toBe('ooh');
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();

  // ---- Reset all edits ----
  await page.getByTestId('reset-edits').click();
  await expect.poll(async () => (await state(page)).arrangement.melody.notes[0].midi).toBe(60);
  expect(await partLyrics(page, 'melody')).toBe('Twin kle twin kle lit tle star how I won der what you are');

  // ---- Harmony sound: everyone on "ooh", then one part back on the words ----
  await page.getByTestId('sound-oo').click();
  await expect.poll(async () => (await partLyrics(page, 'h1')).split(' ')[0]).toBe('Ooh');
  expect(await partLyrics(page, 'melody')).toContain('Twin kle');
  await page.getByTestId('part-sound-h2').selectOption('lyrics');
  await expect.poll(async () => partLyrics(page, 'h2')).toContain('Twin kle');
  expect((await partLyrics(page, 'h1')).startsWith('Ooh')).toBe(true);
  await page.screenshot({ path: join(artifacts, '10-sounds.png'), fullPage: true });

  // ---- Harmonies sung in the singer's own voice, aligned sample-for-sample with the take ----
  await expect.poll(async () => page.evaluate(() => {
    const s = (window as any).__harmonia.store.getState();
    return !!s.voiceParts && !s.voicePartsBusy;
  }), { timeout: 30_000 }).toBe(true);
  const parts = await page.evaluate(async () => {
    const h = (window as any).__harmonia;
    const o = await h.playbackOptions(0);
    return Object.entries(o.voiceParts ?? {}).map(([id, v]: [string, any]) => [id, v.samples.length === o.recording.samples.length]);
  });
  expect(parts).toEqual([['h1', true], ['h2', true]]);
  await page.getByTestId('play-button').click();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).__harmonia.player.playing)).toBe(true);
  await page.getByTestId('play-button').click();

  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByTestId('export-wav').click()]);
  const wavPath = join(artifacts, 'lyrics-export.wav');
  await dl.saveAs(wavPath);
  const wav = readFileSync(wavPath);
  let peak = 0;
  for (let i = 44; i < wav.length; i += 200) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
  expect(peak).toBeGreaterThan(3000);

  const [xml] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-musicxml').click()]);
  const text = readFileSync(await xml.path(), 'utf8');
  expect(text).not.toContain('<lyric');
  expect(text).not.toContain('<text>Twin</text>');
  expect(text).not.toContain('<text>Ooh</text>');

  expect(errors.filter((e) => !/favicon|DevTools/.test(e))).toEqual([]);
});

test('hummed take: no lyrics in the score, harmony can sing a vowel', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles(fixture('ode-hummed.wav'));
  await expect(page.getByTestId('review-stage')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('review-continue').click();
  await expect(page.getByTestId('lyrics-status')).toHaveAttribute('data-status', 'hummed', { timeout: 30_000 });
  await expect(page.getByTestId('lyric-line')).toHaveCount(0);
  const s = await state(page);
  const anyLyric = [s.arrangement.melody, ...s.arrangement.harmonies].some((p: any) => p.notes.some((n: any) => n.lyric));
  expect(anyLyric).toBe(false);

  await page.getByTestId('sound-mm').click();
  await expect.poll(async () => (await partLyrics(page, 'h1')).split(' ')[0]).toBe('Mmm');
  expect((await partLyrics(page, 'melody')).replace(/[· ]/g, '')).toBe('');
  await expect.poll(async () => (await page.getByTestId('score').locator('svg').first().textContent()) ?? '').not.toContain('Mmm');
  await page.screenshot({ path: join(artifacts, '11-hummed.png'), fullPage: true });
  expect(errors.filter((e) => !/favicon|DevTools/.test(e))).toEqual([]);
});
