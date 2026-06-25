import { expect, test, type Page } from '@playwright/test';

import { buildCoolThingsPreviewHtml } from '../../apps/interface/src/features/CreationLaunchpad/lib/cool-things-preview';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, expectedColumns: 5 },
  { name: 'tablet', width: 768, height: 1024, expectedColumns: 2 },
  { name: 'phone', width: 390, height: 844, expectedColumns: 1 },
] as const;

async function loadPreview(page: Page) {
  await page.setContent(
    buildCoolThingsPreviewHtml({
      title: 'Flippable image card for each of the 5 things that are cool',
      content: 'Tap any card to flip it and see why it is cool.',
    }),
    { waitUntil: 'load' },
  );
}

async function columnCount(page: Page) {
  return page.locator('.flip-card').evaluateAll((cards) => {
    const firstRowTop = cards[0].getBoundingClientRect().top;
    return cards.filter((card) => Math.abs(card.getBoundingClientRect().top - firstRowTop) < 2).length;
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`cool things flippable cards - ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loadPreview(page);
    });

    test('renders five image cards in the expected responsive grid', async ({ page }) => {
      const cards = page.locator('.flip-card');
      await expect(cards).toHaveCount(5);
      await expect(page.locator('.count')).toHaveText('5 flippable cards');
      await expect(page.locator('h1')).toContainText('Flippable image card');

      await expect.poll(() => columnCount(page)).toBe(viewport.expectedColumns);

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasHorizontalOverflow).toBe(false);

      const brokenImages = await page.locator('.front img').evaluateAll((images: HTMLImageElement[]) =>
        images.filter((image) => !image.complete || image.naturalWidth === 0 || !image.alt.trim()).length,
      );
      expect(brokenImages).toBe(0);
    });

    test('flips every card on tap or click and keeps independent state', async ({ page }) => {
      const cards = page.locator('.flip-card');

      for (let index = 0; index < 5; index += 1) {
        const card = cards.nth(index);
        await expect(card).toHaveAttribute('aria-pressed', 'false');
        await card.click();
        await expect(card).toHaveAttribute('aria-pressed', 'true');
        await expect(card).toHaveClass(/is-flipped/);

        const transform = await card.locator('.flip-inner').evaluate((inner) =>
          getComputedStyle(inner).transform,
        );
        expect(transform).not.toBe('none');
      }

      await expect(cards.filter({ hasText: 'Why it is cool' })).toHaveCount(5);

      await cards.nth(2).click();
      await expect(cards.nth(2)).toHaveAttribute('aria-pressed', 'false');
      await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'true');
      await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expect(cards.nth(3)).toHaveAttribute('aria-pressed', 'true');
      await expect(cards.nth(4)).toHaveAttribute('aria-pressed', 'true');
    });
  });
}
