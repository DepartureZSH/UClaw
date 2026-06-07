import { expect, test } from './fixtures/electron';

test.describe('Company key page', () => {
  test('saves the company key and retries startup', async ({ page }) => {
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });

    await page.evaluate(() => {
      window.location.hash = '#/company-key';
    });

    await page.getByRole('textbox', { name: '公司密钥' }).fill('company-key-e2e');
    await page.getByRole('button', { name: '保存并同步配置' }).click();

    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });
  });
});
