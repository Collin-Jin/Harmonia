import { expect, test, type Page } from '@playwright/test';

const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as any).__harmonia.store.getState();
    return {
      chords: s.arrangement.chords.map((c: any) => `${c.symbol}@${c.start}`).join(' '),
      voices: JSON.stringify(s.arrangement.harmonies.map((h: any) => h.notes.map((n: any) => n.midi))),
    };
  });

test('folded sections, header links, and stepping through chord and voicing variations', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.getByTestId('sample-ode-to-joy').click();
  await expect(page.getByTestId('harmony-panel')).toBeVisible({ timeout: 60_000 });

  // A and B fold to one line once the take is in, and every section is one click away
  await expect(page.getByTestId('capture-compact')).toContainText('Ode to Joy');
  await expect(page.getByTestId('analysis-summary')).toContainText('C major');
  for (const label of ['Sing', 'Check', 'Arrange', 'Score', 'Mix', 'Perform live']) await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: label })).toBeEnabled();
  // on a wide screen Arrange sits beside the score, not below it
  const arrange = await page.getByTestId('harmony-panel').boundingBox();
  expect(arrange!.y).toBeLessThan(600);

  const first = await state(page);

  // New voicing: same chords, different lines
  await page.getByTestId('variation-voicing').click();
  const v2 = await state(page);
  expect(v2.chords).toBe(first.chords);
  expect(v2.voices).not.toBe(first.voices);
  await expect(page.getByTestId('variation-count')).toHaveText('2 / 2');

  // New chords: a different progression
  await page.getByTestId('variation-chords').click();
  const v3 = await state(page);
  expect(v3.chords).not.toBe(v2.chords);
  await expect(page.getByTestId('variation-count')).toHaveText('3 / 3');

  // and back again, exactly
  await page.getByTestId('variation-prev').click();
  await page.getByTestId('variation-prev').click();
  await expect(page.getByTestId('variation-count')).toHaveText('1 / 3');
  expect(await state(page)).toEqual(first);
  await page.getByTestId('variation-next').click();
  expect((await state(page)).voices).toBe(v2.voices);
  expect(errors).toEqual([]);
});
