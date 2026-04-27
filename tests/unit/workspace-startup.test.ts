import { describe, expect, it, vi } from 'vitest';
import { resolveStartupWorkspaceState } from '@electron/main/workspace-startup';
import type { AppSettings } from '@electron/utils/store';

describe('resolveStartupWorkspaceState', () => {
  function createSettings(initial: Partial<AppSettings>) {
    const settings: Partial<AppSettings> = { ...initial };
    return {
      getSetting: vi.fn(async <K extends keyof AppSettings>(key: K) => settings[key] as AppSettings[K]),
      setSetting: vi.fn(async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        settings[key] = value;
      }),
      settings,
    };
  }

  it('keeps a completed setup when the persisted workspace still exists', async () => {
    const store = createSettings({
      setupComplete: true,
      workspaceDir: 'E:/Desktop/test/workspace6',
    });

    const result = await resolveStartupWorkspaceState({
      getSetting: store.getSetting,
      setSetting: store.setSetting,
      pathExists: () => true,
    });

    expect(result).toEqual({
      setupComplete: true,
      workspaceDir: 'E:/Desktop/test/workspace6',
    });
    expect(store.setSetting).not.toHaveBeenCalled();
  });

  it('resets setup state when the persisted workspace was deleted', async () => {
    const store = createSettings({
      setupComplete: true,
      workspaceDir: 'E:/Desktop/test/workspace6',
    });

    const result = await resolveStartupWorkspaceState({
      getSetting: store.getSetting,
      setSetting: store.setSetting,
      pathExists: () => false,
    });

    expect(result).toEqual({
      setupComplete: false,
      workspaceDir: '',
      resetReason: 'missing-workspace',
      resetWorkspaceDir: 'E:/Desktop/test/workspace6',
    });
    expect(store.settings.setupComplete).toBe(false);
    expect(store.settings.workspaceDir).toBe('');
  });

  it('resets setup state when setup is complete but no workspace is stored', async () => {
    const store = createSettings({
      setupComplete: true,
      workspaceDir: '',
    });

    const result = await resolveStartupWorkspaceState({
      getSetting: store.getSetting,
      setSetting: store.setSetting,
      pathExists: () => true,
    });

    expect(result).toEqual({
      setupComplete: false,
      workspaceDir: '',
      resetReason: 'empty-workspace',
      resetWorkspaceDir: undefined,
    });
    expect(store.settings.setupComplete).toBe(false);
  });
});
