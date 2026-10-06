import { expect, test } from '@playwright/test';

// Foundation smoke test. The UI agent owns tests/e2e/** and adds the full
// upload -> quote -> checkout -> shop -> delivered -> passport journey.
test('home page renders the brand', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'DiscoverMake' })).toBeVisible();
    await expect(page.getByText('Discover. Make. Build.')).toBeVisible();
});
