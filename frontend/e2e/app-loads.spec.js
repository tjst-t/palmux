import { test, expect } from '@playwright/test';

test.describe('App loads', () => {
  test('should render the app container', async ({ page }) => {
    await page.goto('/');
    const app = page.locator('#app');
    await expect(app).toBeVisible();
  });

  test('should show header', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('#header');
    await expect(header).toBeVisible();
  });

  test('should show session list or loading state on initial load', async ({ page }) => {
    await page.goto('/');
    // Without backend, should show loading or error state
    const sessionList = page.locator('#session-list');
    await expect(sessionList).toBeVisible();
  });
});
