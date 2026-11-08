import { expect, test, type Page } from '@playwright/test';
import { fixture } from './helpers';

const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__harmonia.store.getState();
    return {
      phase: s.phase,
      notes: s.transcription.notes.map((n: any) => n.midi),
      melody: s.arrangement.melody.notes.map((n: any) => n.midi),
      removed: Object.keys(s.deletedNotes).length,
    };
  });

/** Centre of melody note `i` on the review roll (row height 15, 4 spare rows above the highest note, 24 px bar strip). */
const noteAt = (page: Page, i: number) =>
  page.evaluate((i) => {
    const s = (window as any).__harmonia.store.getState();
    const r = document.querySelector('[data-testid=review-roll]')!.getBoundingClientRect();
    const ms = s.transcription.notes.map((n: any) => n.midi);
    const ghosts = s.baseTranscription.notes.filter((n: any) => s.deletedNotes[String(Math.round(n.time * 1000))]).map((n: any) => n.midi);
    const hi = Math.max(...ms, ...ghosts) + 4;
    const n = s.transcription.notes[i];
    const ppu = r.width / s.transcription.totalUnits;
    return { x: r.left + (n.start + n.dur / 2) * ppu, y: r.top + 24 + (hi - n.midi) * 15 + 7 };
  }, i);

test('check your notes: drag a pitch, remove and restore a note, then harmonize', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  // an imported (own) take opens for checking; arrangement controls wait
  await page.locator('input[type=file]').setInputFiles(fixture('ode-to-joy.wav'));
  await expect(page.getByTestId('review-stage')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('harmony-panel')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Arrange' })).toBeDisabled();
  const first = await state(page);
  expect(first.phase).toBe('review');

  // drag note 3 up two semitones
  const p = await noteAt(page, 2);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y - 30, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).notes[2]).toBe(first.notes[2] + 2);
  expect((await state(page)).melody[2]).toBe(first.notes[2] + 2);
  await expect(page.getByTestId('review-counts')).toHaveText('1 changed');

  // select note 5, remove it, then click its outline to bring it back
  const q = await noteAt(page, 4);
  await page.mouse.click(q.x, q.y);
  await expect(page.getByTestId('review-selected')).toBeVisible();
  await page.getByTestId('review-delete').click();
  await expect.poll(async () => (await state(page)).notes.length).toBe(first.notes.length - 1);
  await expect(page.getByTestId('review-counts')).toHaveText('1 changed · 1 removed');
  await page.mouse.click(q.x, q.y);
  await expect.poll(async () => (await state(page)).removed).toBe(0);

  // both ways of listening play
  await page.getByRole('button', { name: 'Piano' }).click();
  await page.getByTestId('review-play').click();
  await expect.poll(async () => page.evaluate(() => (window as any).__harmonia.store.getState().playing)).toBe(true);
  await page.getByTestId('review-play').click();

  // click the bar numbers halfway along: Play starts there, not at the top
  const roll = (await page.getByTestId('review-roll').boundingBox())!;
  await page.mouse.click(roll.x + roll.width / 2, roll.y + 10);
  await expect(page.getByTestId('review-from')).toBeVisible();
  const half = await page.evaluate(() => (window as any).__harmonia.store.getState().transcription.totalUnits / 2);
  await page.getByTestId('review-play').click();
  await expect.poll(async () => page.evaluate(() => (window as any).__harmonia.player.playing)).toBe(true);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).__harmonia.player.position())).toBeGreaterThanOrEqual(half - 4);
  await page.getByTestId('review-play').click();
  await page.getByTestId('review-from-reset').click();
  await expect(page.getByTestId('review-from')).toHaveCount(0);

  // harmonize keeps the fix; Fix comes back here
  await page.getByTestId('review-continue').click();
  await expect(page.getByTestId('harmony-panel')).toBeVisible();
  expect((await state(page)).melody[2]).toBe(first.notes[2] + 2);
  await page.getByTestId('analysis-toggle').click();
  await expect(page.getByTestId('review-stage')).toBeVisible();
  expect(errors).toEqual([]);
});
