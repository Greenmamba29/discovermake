/**
 * Touch-first and keyboard-only checks (enterprise usability gate).
 *
 * Phones (mobile projects: Pixel 7 / iPhone 14 profiles with touch and a mobile UA):
 *   - every bottom-nav tab is reachable by tap, lands on a page with one h1 and no
 *     horizontal scroll, and its tap target is at least 44 px;
 *   - a buyer can go from the home intake to a binding quote and checkout with taps only,
 *     and the sticky checkout CTA stays inside the viewport.
 * Desktop (default project): the skip link and tab order reach the main intake without a mouse.
 */
import { expect, test, type Page } from '@playwright/test';
import { sampleBracketDxf } from '../../src/lib/sample-dxf';

async function noHorizontalScroll(page: Page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'horizontal overflow (px)').toBeLessThanOrEqual(1);
}

test.describe('phone (touch)', () => {
    test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'touch checks run on the mobile projects'));

    test('the bottom nav is tappable and every tab renders cleanly', async ({ page }) => {
        await page.goto('/');
        const nav = page.getByTestId('bottom-nav');
        await expect(nav).toBeVisible();
        const tabs = [
            { label: 'Discover', url: /\/discover$/ },
            { label: 'Make', url: /\/make$/ },
            { label: 'Live', url: /\/live$/ },
            { label: 'Builds', url: /\/builds$/ },
            { label: 'Me', url: /\/me$/ },
        ];
        for (const tab of tabs) {
            const link = nav.getByRole('link', { name: tab.label });
            const box = await link.boundingBox();
            expect(box!.height, `${tab.label} tap target height`).toBeGreaterThanOrEqual(44);
            expect(box!.width, `${tab.label} tap target width`).toBeGreaterThanOrEqual(44);
            await link.tap();
            await expect(page).toHaveURL(tab.url);
            await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
            await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
            await noHorizontalScroll(page);
        }
    });

    test('upload, configure and reach checkout with taps only', async ({ page }) => {
        await page.goto('/');
        await page.getByTestId('upload-input').setInputFiles({ name: 'touch.dxf', mimeType: 'application/dxf', buffer: Buffer.from(sampleBracketDxf()) });
        await page.waitForURL(/\/parts\/prt_[A-Za-z0-9_-]+$/, { timeout: 30_000 });
        await page.getByTestId('material-option-mat_al_6061').tap();
        const thickness = page.getByTestId('thickness-option-thk_al6061_090');
        if (!(await thickness.getAttribute('data-checked'))) await thickness.tap();
        await expect(page.getByTestId('trust-chip')).toContainText('Binding quote', { timeout: 15_000 });
        await noHorizontalScroll(page);

        // The sticky CTA must be on screen without scrolling, and tappable.
        const cta = page.getByTestId('checkout-cta');
        await expect(cta).toBeInViewport();
        await cta.tap();
        await page.waitForURL(/\/checkout\/qte_/);
        await expect(page.getByTestId('checkout-email')).toBeVisible();
        await noHorizontalScroll(page);
    });
});

test.describe('desktop (keyboard only)', () => {
    test.beforeEach(({ isMobile }) => test.skip(isMobile, 'keyboard checks run on the desktop project'));

    test('the skip link and tab order reach the main intake without a mouse', async ({ page }) => {
        await page.goto('/');
        await page.keyboard.press('Tab');
        const skip = page.getByRole('link', { name: 'Skip to content' });
        await expect(skip).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#main$/);
        // From main, the first few tab stops reach a text field or the upload control.
        let reached = false;
        for (let i = 0; i < 15 && !reached; i++) {
            await page.keyboard.press('Tab');
            reached = await page.evaluate(() => {
                const el = document.activeElement as HTMLElement | null;
                if (!el || !document.getElementById('main')?.contains(el)) return false;
                return el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && ['text', 'search', 'file'].includes((el as HTMLInputElement).type)) || el.getAttribute('role') === 'button' || el.tagName === 'BUTTON';
            });
        }
        expect(reached, 'a main-content control is reachable by keyboard').toBe(true);
        const ring = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle + '|' + getComputedStyle(document.activeElement as Element).boxShadow);
        expect(ring, 'focused control shows a visible focus indicator').not.toBe('none|none');
    });
});
