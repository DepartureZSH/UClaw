import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'path';
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
      mode: 'legacy',
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
      mode: 'legacy',
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
      mode: 'legacy',
      resetReason: 'empty-workspace',
      resetWorkspaceDir: undefined,
    });
    expect(store.settings.setupComplete).toBe(false);
  });

  it('uses the portable workbench workspace and stores a relative path', async () => {
    const store = createSettings({
      setupComplete: true,
      workspaceDir: 'E:/old-drive/workspace',
    });

    const result = await resolveStartupWorkspaceState({
      getSetting: store.getSetting,
      setSetting: store.setSetting,
      dataRoot: 'F:/windows/data',
      ensureWorkspace: vi.fn(),
      portableConfig: {
        schema: 'uclaw-portable-data-root',
        version: 2,
        dataRoot: 'data',
        workspaceMode: 'portable-workbench',
        workspaceDir: 'workspace',
      },
    });

    expect(result).toMatchObject({
      setupComplete: true,
      workspaceDir: resolve('F:/windows/data', 'workspace'),
      storedWorkspaceDir: 'workspace',
    });
    expect(store.settings.workspaceDir).toBe('workspace');
    expect(store.settings.setupComplete).toBe(true);
  });

  it('repairs empty completed workspace state in portable workbench mode', async () => {
    const store = createSettings({
      setupComplete: true,
      workspaceDir: '',
    });

    const result = await resolveStartupWorkspaceState({
      getSetting: store.getSetting,
      setSetting: store.setSetting,
      dataRoot: 'F:/windows/data',
      ensureWorkspace: vi.fn(),
      portableConfig: {
        schema: 'uclaw-portable-data-root',
        version: 2,
        dataRoot: 'data',
        workspaceMode: 'portable-workbench',
        workspaceDir: 'workspace',
      },
    });

    expect(result.setupComplete).toBe(true);
    expect(result.storedWorkspaceDir).toBe('workspace');
    expect(store.settings.workspaceDir).toBe('workspace');
  });

  it('auto-completes setup for a fresh portable workbench data root', async () => {
    const store = createSettings({
      setupComplete: false,
      workspaceDir: '',
    });

    const result = await resolveStartupWorkspaceState({
      getSetting: store.getSetting,
      setSetting: store.setSetting,
      dataRoot: 'F:/windows/data',
      ensureWorkspace: vi.fn(),
      portableConfig: {
        schema: 'uclaw-portable-data-root',
        version: 2,
        dataRoot: 'data',
        workspaceMode: 'portable-workbench',
        workspaceDir: 'workspace',
      },
    });

    expect(result.setupComplete).toBe(true);
    expect(result.workspaceDir).toBe(resolve('F:/windows/data', 'workspace'));
    expect(result.storedWorkspaceDir).toBe('workspace');
    expect(store.settings.setupComplete).toBe(true);
    expect(store.settings.workspaceDir).toBe('workspace');
  });

  it('reports portable workspace repair when it creates the workbench directory', async () => {
    const store = createSettings({
      setupComplete: false,
      workspaceDir: 'E:/old/workspace',
    });
    const ensureWorkspace = vi.fn();

    const result = await resolveStartupWorkspaceState({
      getSetting: store.getSetting,
      setSetting: store.setSetting,
      dataRoot: 'F:/windows/data',
      ensureWorkspace,
      portableConfig: {
        schema: 'uclaw-portable-data-root',
        version: 2,
        dataRoot: 'data',
        workspaceMode: 'portable-workbench',
        workspaceDir: 'workspace',
      },
    });

    expect(result).toMatchObject({
      setupComplete: true,
      workspaceDir: resolve('F:/windows/data', 'workspace'),
      storedWorkspaceDir: 'workspace',
      mode: 'portable-workbench',
      repaired: true,
    });
    expect(ensureWorkspace).toHaveBeenCalledWith(resolve('F:/windows/data', 'workspace'));
    expect(store.settings.workspaceDir).toBe('workspace');
    expect(store.settings.setupComplete).toBe(true);
  });

  it('throws a portable repair error without resetting setup when the workbench cannot be created', async () => {
    const store = createSettings({
      setupComplete: true,
      workspaceDir: 'E:/old/workspace',
    });

    await expect(resolveStartupWorkspaceState({
      getSetting: store.getSetting,
      setSetting: store.setSetting,
      dataRoot: 'F:/windows/data',
      ensureWorkspace: () => {
        throw new Error('portable workspace repair failed: F:/windows/data/workspace');
      },
      portableConfig: {
        schema: 'uclaw-portable-data-root',
        version: 2,
        dataRoot: 'data',
        workspaceMode: 'portable-workbench',
        workspaceDir: 'workspace',
      },
    })).rejects.toThrow('portable workspace repair failed');

    expect(store.settings.setupComplete).toBe(true);
    expect(store.settings.workspaceDir).toBe('E:/old/workspace');
  });
});
