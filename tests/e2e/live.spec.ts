import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { artifacts, fakeMicArgs, fixture } from './helpers';

// The microphone now sings a *different* take: 2 semitones higher, 15% faster, 15 cents sharp.
test.use({ launchOptions: { args: fakeMicArgs(fixture('ode-to-joy-live-variant.wav')) } });

test('live mode follows a transposed, faster performance and drives the harmony voices', async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  // Build the arrangement from the reference sample (no microphone involved).
  await page.getByTestId('sample-ode-to-joy').click();
  await expect(page.getByTestId('analysis-panel')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('style-pop').click();

  // Start live harmonization; the fake mic begins "singing" when capture starts.
  await page.getByTestId('live-start').click();
  await expect(page.getByTestId('live-mode')).toBeVisible();
  await expect(page.getByTestId('live-mode')).toHaveText(/Following you/, { timeout: 15_000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(artifacts, '07-live.png'), fullPage: true });
  await page.waitForTimeout(12000);

  const result = await page.evaluate(() => {
    const live = (window as any).__harmoniaLive;
    const log = live.log as any[];
    const snap = live.snapshot();
    return { log, snap };
  });
  const onsets = result.log.filter((e) => e.index >= 0);
  // eslint-disable-next-line no-console
  console.log(
    'live log:',
    result.log.map((e) => `${e.index}:${e.mode[0]}:${e.midi.toFixed(1)}:${Math.round(e.detectMs)}ms`).join(' '),
  );
  expect(onsets.length).toBeGreaterThanOrEqual(26);
  const following = onsets.filter((e) => e.mode === 'following');
  expect(following.length / onsets.length).toBeGreaterThan(0.85);
  // Position advances through the whole melody in order.
  const idx = following.map((e) => e.index);
  let ordered = 0;
  for (let i = 1; i < idx.length; i++) if (idx[i] >= idx[i - 1]) ordered++;
  expect(ordered / (idx.length - 1)).toBeGreaterThan(0.9);
  expect(Math.max(...idx)).toBeGreaterThanOrEqual(28);
  // Adapted to the transposition and the faster tempo.
  expect(result.snap.status.transpose).toBe(2);
  expect(result.snap.status.tempoRatio).toBeGreaterThan(1.05);
  // Voices were actually driven.
  expect(onsets.reduce((s, e) => s + e.commands, 0)).toBeGreaterThan(30);
  // Detection latency (onset → voice command), median.
  const lat = onsets.map((e) => e.detectMs).sort((a, b) => a - b);
  const median = lat[lat.length >> 1];
  // eslint-disable-next-line no-console
  console.log(`median onset→voice latency: ${median.toFixed(1)} ms, total incl. device: ${result.snap.totalMs.toFixed(1)} ms`);
  expect(median).toBeLessThan(120);

  await page.getByTestId('live-stop').click();
  expect(errors).toEqual([]);
});
