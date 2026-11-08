import { expect, test } from '@playwright/test';

test('after harmonizing: play is pointed out, one section is marked, editors open in view, Mix folds', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.getByTestId('sample-ode-to-joy').click();
  await expect(page.getByTestId('harmony-panel')).toBeVisible({ timeout: 60_000 });

  // the header marks one section, not one per column
  await expect(page.locator('.steps [aria-current=location]')).toHaveCount(1);
  await expect(page.locator('.steps .step.active')).toHaveCount(1);

  // a chord's choices open fully in view, even from the bottom of the side column
  await page.locator('[data-testid=chords] button').last().click();
  await expect(page.getByTestId('chord-editor')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.steps .step.active')).toHaveText(/Arrange/);
  await page.keyboard.press('Escape');

  // a selected note's editor stays above the player
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.locator('#sec-score svg g.vf-stavenote').nth(20).click({ force: true });
  const editor = page.getByTestId('note-editor');
  await expect(editor).toBeInViewport({ ratio: 1 });
  const e = (await editor.boundingBox())!;
  const dock = (await page.getByTestId('dock').boundingBox())!;
  expect(e.y + e.height).toBeLessThanOrEqual(dock.y);

  // Mix is a one-line summary until opened
  await expect(page.locator('[data-testid^="strip-"]')).toHaveCount(0);
  await expect(page.locator('#sec-mix')).toContainText('High Harmony');
  await page.getByTestId('mix-toggle').click();
  await expect(page.locator('[data-testid^="strip-"]')).toHaveCount(3);

  // play is pointed out once, until it is pressed
  await expect(page.getByTestId('play-cue')).toBeVisible();
  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('play-cue')).toHaveCount(0);
  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('play-cue')).toHaveCount(0);
  expect(errors).toEqual([]);
});
