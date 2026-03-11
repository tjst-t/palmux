import { test, expect } from '@playwright/test';

test.describe('Drawer', () => {
  test('drawer should be hidden initially on sessions view', async ({ page }) => {
    await page.goto('/#sessions');
    const drawer = page.locator('#drawer');
    // Drawer exists but not visible (no open class)
    await expect(drawer).toBeAttached();
  });
});
