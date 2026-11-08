import { expect, test, type Page } from '@playwright/test';

const chordSymbols = (page: Page) => page.evaluate(() => (window as any).__harmonia.store.getState().arrangement.chords.map((c: any) => `${c.symbol}@${c.start}`));

test('change one chord, keep it through a style change, re-fit around it, reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.getByTestId('sample-ode-to-joy').click();
  await expect(page.getByTestId('chords').locator('.chord').first()).toBeVisible({ timeout: 60_000 });
  const before: string[] = await chordSymbols(page);
  expect(before).toContain('Am@48');

  // Bar 4: the choices are ranked, the current chord is marked, and C is offered
  await page.getByTestId('chord-48').click();
  const editor = page.getByTestId('chord-editor');
  await expect(editor).toContainText('Bar 4, beats 1–2');
  await expect(page.getByTestId('chord-option-Am')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('chord-option-C').click();

  // only that chord changed, and it is marked as the user's
  const after: string[] = await chordSymbols(page);
  expect(after).toEqual(before.map((c) => (c === 'Am@48' ? 'C@48' : c)));
  await expect(page.getByTestId('chord-48')).toHaveClass(/edited/);
  await expect(editor).toContainText('your choice');

  // pinned through a style change
  await page.getByTestId('style-choral').click();
  expect(await chordSymbols(page)).toContain('C@48');
  await expect(page.getByTestId('chord-48')).toHaveClass(/edited/);

  // re-fit keeps it and then has nothing left to do
  await page.getByTestId('chord-refit').click();
  expect(await chordSymbols(page)).toContain('C@48');
  await expect(page.getByTestId('chord-refit')).toBeDisabled();

  // reset: no chords chosen by the user any more
  await page.getByTestId('chord-reset').click();
  await expect(page.locator('.chord.edited')).toHaveCount(0);
  await expect(page.getByTestId('chord-reset')).toHaveCount(0);
  expect(errors).toEqual([]);
});
