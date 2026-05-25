import { expect, test } from '@playwright/test';

test.describe('Myco Quest title scene', () => {
  test('renders the cinematic neon mushroom forest intro', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    await page.goto('/game/myco-quest', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#titleScreen.active', { timeout: 12_000 });
    await page.waitForTimeout(700);

    const titleScene = await page.evaluate(() => {
      const canvas = document.getElementById('titlePixelCanvas') as HTMLCanvasElement | null;
      if (!canvas) return null;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      const sample = ctx.getImageData(
        Math.floor(canvas.width * 0.5),
        Math.floor(canvas.height * 0.5),
        1,
        1,
      ).data;
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let litPixels = 0;
      for (let i = 0; i < frame.length; i += 4) {
        const brightness = frame[i] + frame[i + 1] + frame[i + 2];
        if (brightness > 140) litPixels += 1;
      }
      return {
        width: canvas.width,
        height: canvas.height,
        centerSample: [sample[0], sample[1], sample[2], sample[3]],
        litRatio: litPixels / (canvas.width * canvas.height),
      };
    });

    expect(titleScene).not.toBeNull();
    if (!titleScene) {
      throw new Error('titlePixelCanvas is missing or unreadable');
    }

    expect(titleScene.width).toBeGreaterThan(800);
    expect(titleScene.height).toBeGreaterThan(450);
    expect(titleScene.litRatio).toBeGreaterThan(0.015);
    expect(titleScene.centerSample[3]).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);

    const screenshotPath = testInfo.outputPath('title-screen-cinematic.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('title-screen-cinematic', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });
});
