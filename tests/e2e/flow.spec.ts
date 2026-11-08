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

  // Chords and Sound fold to one line each; a chord's choices open fully in view
  await expect(page.getByTestId('sound-fold')).toContainText('Lyrics');
  await page.getByTestId('chords-fold').click();
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

  // play is pointed out once, inside the player, until it is pressed
  await expect(page.getByTestId('play-cue')).toBeVisible();
  const cue = (await page.getByTestId('play-cue').boundingBox())!;
  const bar = (await page.getByTestId('dock').boundingBox())!;
  expect(cue.y).toBeGreaterThanOrEqual(bar.y);
  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('play-cue')).toHaveCount(0);
  await page.getByTestId('play-button').click();
  await expect(page.getByTestId('play-cue')).toHaveCount(0);
  // the pinned side column never slides under the header, even at the end of the page
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const header = (await page.locator('.header').boundingBox())!;
  const side = (await page.locator('.sidebar').boundingBox())!;
  expect(side.y).toBeGreaterThanOrEqual(header.y + header.height);
  expect(errors).toEqual([]);
});
