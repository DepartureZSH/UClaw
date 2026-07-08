import { closeElectronApp, expect, getRealLafE2EConfig, getStableWindow, test } from './fixtures/electron';

test.describe('Company key page', () => {
  test('saves the company key and retries startup with real Laf', async ({ launchElectronApp }) => {
    const realLaf = getRealLafE2EConfig();
    if (!realLaf) {
      test.skip(true, 'Set UCLAW_E2E_REAL_LAF_ENDPOINT and UCLAW_E2E_REAL_LAF_PACKAGE_ID to run real Laf E2E.');
      return;
    }

    const app = await launchElectronApp({
      realLaf: {
        endpoint: realLaf.endpoint,
        packageId: realLaf.packageId,
        configured: false,
      },
    });

    try {
      const page = await getStableWindow(app);

      const companyKeyInput = page.getByRole('textbox', { name: '公司密钥' });
      await expect(companyKeyInput).toBeVisible({ timeout: 30_000 });
      await companyKeyInput.fill(realLaf.packageId);
      await page.getByRole('button', { name: '保存并同步配置' }).click();

      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
    } finally {
      await closeElectronApp(app);
    }
  });
});
