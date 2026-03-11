import { test, expect } from '@playwright/test';

test.describe('Hash navigation', () => {
  test('should navigate to sessions view', async ({ page }) => {
    await page.goto('/#sessions');
    const sessionList = page.locator('#session-list');
    await expect(sessionList).toBeVisible();
  });

  test('should handle terminal hash gracefully without backend', async ({ page }) => {
    await page.goto('/#terminal/test-session/0');
    // App should not crash, should show panel container or fallback
    const app = page.locator('#app');
    await expect(app).toBeVisible();
  });

  test('should handle files hash gracefully without backend', async ({ page }) => {
    await page.goto('/#files/test-session/0');
    const app = page.locator('#app');
    await expect(app).toBeVisible();
  });

  test('should handle git hash gracefully without backend', async ({ page }) => {
    await page.goto('/#git/test-session/0');
    const app = page.locator('#app');
    await expect(app).toBeVisible();
  });
});
