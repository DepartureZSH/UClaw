import { expect, test } from './fixtures/electron';

test.describe('Legacy setup route', () => {
  test('opens the company key page instead of the removed setup wizard', async ({ page }) => {
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });

    await page.evaluate(() => {
      window.location.hash = '#/setup';
    });

    await expect(page.getByRole('heading', { name: '填写公司密钥' })).toBeVisible();
    await expect(page.getByText(/普通用户不需要选择工作目录/)).toBeVisible();
  });
});
