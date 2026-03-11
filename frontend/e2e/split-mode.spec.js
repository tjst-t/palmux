import { test, expect } from '@playwright/test';

test.describe('Split mode', () => {
  test('split toggle button should exist', async ({ page }) => {
    await page.goto('/');
    const splitBtn = page.locator('#split-toggle-btn');
    await expect(splitBtn).toBeAttached();
  });
});
