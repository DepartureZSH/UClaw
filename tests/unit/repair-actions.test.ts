import { describe, expect, it, vi } from 'vitest';

describe('repair actions', () => {
  it('executes main-owned repair actions through injected dependencies', async () => {
    const { executeRepairAction } = await import('@electron/main/repair-actions');
    const { clearMainRepairActionRecords, getMainRepairActionRecords } = await import('@electron/main/diagnostics-context');
    clearMainRepairActionRecords();
    const gatewayManager = { restart: vi.fn().mockResolvedValue(undefined) };
    const openPath = vi.fn().mockResolvedValue('');
    const relaunch = vi.fn();
    const quit = vi.fn();
    const collectDiagnosticsText = vi.fn().mockResolvedValue('uclaw-support-diagnostics');
    const context = {
      gatewayManager,
      getDataRoot: () => 'F:/windows/data',
      getLogDir: () => 'F:/windows/data/uclaw/logs',
      openPath,
      relaunch,
      quit,
      collectDiagnosticsText,
    };

    await executeRepairAction({ id: 'restart-gateway' }, context);
    await executeRepairAction({ id: 'open-log-folder' }, context);
    await executeRepairAction({ id: 'open-data-root' }, context);
    const copyResult = await executeRepairAction({ id: 'copy-diagnostics' }, context);
    await executeRepairAction({ id: 'relaunch-app' }, context);
    await executeRepairAction({ id: 'quit-app' }, context);

    expect(gatewayManager.restart).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith('F:/windows/data/uclaw/logs');
    expect(openPath).toHaveBeenCalledWith('F:/windows/data');
    expect(copyResult).toEqual({ success: true, copyText: 'uclaw-support-diagnostics' });
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(getMainRepairActionRecords()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'restart-gateway', status: 'started' }),
        expect.objectContaining({ id: 'restart-gateway', status: 'success' }),
        expect.objectContaining({ id: 'copy-diagnostics', status: 'success' }),
      ]),
    );
  });

  it('rejects unsupported repair actions', async () => {
    const { executeRepairAction } = await import('@electron/main/repair-actions');
    const { clearMainRepairActionRecords, getMainRepairActionRecords } = await import('@electron/main/diagnostics-context');
    clearMainRepairActionRecords();

    await expect(
      executeRepairAction({ id: 'unknown-action' }, {
        gatewayManager: { restart: vi.fn() },
        getDataRoot: () => '',
        getLogDir: () => null,
        openPath: vi.fn(),
        relaunch: vi.fn(),
        quit: vi.fn(),
        collectDiagnosticsText: vi.fn(),
      }),
    ).rejects.toThrow('Unsupported repair action');
    expect(getMainRepairActionRecords()).toEqual([
      expect.objectContaining({ id: 'unknown-action', status: 'started' }),
      expect.objectContaining({ id: 'unknown-action', status: 'error' }),
    ]);
  });
});
