import { closeElectronApp, expect, test } from './fixtures/electron';

test.describe('UClaw Electron smoke flows', () => {
  test('shows the company key page on an unconfigured public package', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '填写公司密钥' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('textbox', { name: '公司密钥' })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存并同步配置' })).toBeVisible();
    await expect(page.getByRole('button', { name: '联系客服' })).toBeVisible();
    await expect(page.getByTestId('setup-page')).toHaveCount(0);
  });

  test('routes legacy setup links to company key provisioning', async ({ page }) => {
    await page.evaluate(() => {
      window.history.pushState({}, '', '/setup');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: '填写公司密钥' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('setup-page')).toHaveCount(0);
  });

  test('keeps the legacy setup wizard removed across relaunch for the same isolated profile', async ({ electronApp, launchElectronApp }) => {
    const firstWindow = await electronApp.firstWindow();
    await firstWindow.waitForLoadState('domcontentloaded');
    await expect(firstWindow.getByRole('heading', { name: '填写公司密钥' })).toBeVisible({ timeout: 30_000 });
    await expect(firstWindow.getByTestId('setup-page')).toHaveCount(0);

    await closeElectronApp(electronApp);

    const relaunchedApp = await launchElectronApp();
    try {
      const relaunchedWindow = await relaunchedApp.firstWindow();
      await relaunchedWindow.waitForLoadState('domcontentloaded');

      await expect(relaunchedWindow.getByRole('heading', { name: '填写公司密钥' })).toBeVisible({ timeout: 30_000 });
      await expect(relaunchedWindow.getByTestId('setup-page')).toHaveCount(0);
    } finally {
      await closeElectronApp(relaunchedApp);
    }
  });
});
