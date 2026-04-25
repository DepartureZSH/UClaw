import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, test } from './fixtures/electron';

test.describe('Setup existing workspace flow', () => {
  test('skips AI config when selected workspace already has openclaw.json', async ({
    homeDir,
    page,
    electronApp,
  }) => {
    const workspaceDir = join(homeDir, 'existing-workspace');
    await mkdir(join(workspaceDir, '.openclaw'), { recursive: true });
    await writeFile(join(workspaceDir, '.openclaw', 'openclaw.json'), JSON.stringify({
      models: { providers: { 'new-api': { type: 'openai', baseUrl: 'https://example.test/v1' } } },
      agents: { defaults: { model: 'new-api/deepseek-chat' } },
    }), 'utf-8');

    await electronApp.evaluate(async ({ app: _app }, selectedWorkspaceDir) => {
      const { BrowserWindow, ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      const runningGatewayStatus = {
        state: 'running',
        port: 18789,
        gatewayReady: true,
      };

      ipcMain.removeHandler('app:selectWorkspaceDir');
      ipcMain.handle('app:selectWorkspaceDir', async () => selectedWorkspaceDir);

      ipcMain.removeHandler('openclaw:status');
      ipcMain.handle('openclaw:status', async () => ({
        packageExists: true,
        isBuilt: true,
        dir: selectedWorkspaceDir,
        version: 'test',
      }));

      ipcMain.removeHandler('gateway:status');
      ipcMain.handle('gateway:status', async () => runningGatewayStatus);

      ipcMain.removeHandler('uv:install-all');
      ipcMain.handle('uv:install-all', async () => ({ success: true }));

      BrowserWindow.getAllWindows()[0]?.webContents.send('gateway:status-changed', runningGatewayStatus);
    }, workspaceDir);

    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-next-button').click();
    await expect(page.getByRole('heading', { name: '工作目录' })).toBeVisible();

    await page.getByTestId('setup-workspace-select-button').click();
    await expect(page.getByTestId('setup-workspace-existing-config')).toBeVisible();

    await page.getByTestId('setup-next-button').click();
    await expect(page.getByText(/Environment Check|环境检查/)).toBeVisible();

    await page.getByTestId('setup-next-button').click();
    await expect(page.getByText('AI 配置')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Setting Up|设置中/ })).toBeVisible();

    await expect(page.getByRole('heading', { name: /Setup Complete!|设置完成！/ })).toBeVisible({ timeout: 10_000 });

    await closeElectronApp(electronApp);
  });
});
