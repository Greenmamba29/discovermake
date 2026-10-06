import { expect, test } from '@playwright/test';

test('home page renders the brand and the upload entry point', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'What do you want to make?' })).toBeVisible();
    await expect(page.getByText('Discover. Make. Build.').first()).toBeVisible();
    await expect(page.getByTestId('upload-input')).toBeAttached();
});
