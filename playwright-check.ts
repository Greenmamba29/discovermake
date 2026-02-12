import { test } from '@playwright/test';

test('Check for console errors on dashboard', async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    
    await page.goto('http://localhost:3000/dashboard');
    await page.waitForTimeout(5000);
    console.log('Final URL:', page.url());
});
