import { test, expect } from '@playwright/test';

test.describe('Header', () => {
  test('should show header with title', async ({ page }) => {
    await page.goto('/');
    const headerTitle = page.locator('#header-title');
    await expect(headerTitle).toBeVisible();
    await expect(headerTitle).toHaveText('Palmux');
  });

  test('toolbar toggle should be hidden on sessions view', async ({ page }) => {
    await page.goto('/#sessions');
    const toolbarBtn = page.locator('#toolbar-toggle-btn');
    await expect(toolbarBtn).toHaveClass(/hidden/);
  });
});
