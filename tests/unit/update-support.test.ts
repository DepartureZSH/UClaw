import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { resolveUpdateSupportState } from '@electron/main/update-support';

describe('resolveUpdateSupportState', () => {
  it('disables in-app updates in dev mode', () => {
    const checkedPaths: string[] = [];

    const result = resolveUpdateSupportState({
      isPackaged: false,
      resourcesPath: 'E:\\UClaw\\resources',
      appUpdateYmlExists: (path) => {
        checkedPaths.push(path);
        return true;
      },
    });

    expect(result.supported).toBe(false);
    expect(result.reason).toContain('开发模式');
    expect(checkedPaths).toEqual([]);
  });

  it('disables in-app updates for zip builds without app-update.yml', () => {
    const resourcesPath = 'E:\\UClaw\\resources';

    const result = resolveUpdateSupportState({
      isPackaged: true,
      resourcesPath,
      appUpdateYmlExists: (path) => path !== join(resourcesPath, 'app-update.yml'),
    });

    expect(result.supported).toBe(false);
    expect(result.reason).toContain('ZIP');
  });

  it('enables in-app updates when app-update.yml is present', () => {
    const resourcesPath = 'E:\\UClaw\\resources';

    const result = resolveUpdateSupportState({
      isPackaged: true,
      resourcesPath,
      appUpdateYmlExists: (path) => path === join(resourcesPath, 'app-update.yml'),
    });

    expect(result).toEqual({ supported: true });
  });
});
