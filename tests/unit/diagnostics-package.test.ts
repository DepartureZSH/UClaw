import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.4.0-test',
    isPackaged: false,
  },
}));

vi.mock('@electron/utils/data-root', () => ({
  getConfiguredDataRoot: () => 'F:/windows/data',
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => 'F:/windows/data/workspace/.openclaw',
  getOpenClawStatus: () => ({ available: true, version: 'test-openclaw' }),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    getLogDir: () => 'F:/windows/data/uclaw/logs',
    readLogFile: vi.fn(async () => 'Authorization: Bearer sk-test-production-secret'),
  },
}));

describe('support diagnostics package', () => {
  it('collects startup, storage, gateway, logs, and redacts secrets', async () => {
    const { buildSupportDiagnosticsPackage, formatSupportDiagnosticsText } = await import('@electron/main/diagnostics-package');
    const pkg = await buildSupportDiagnosticsPackage({
      storageDiagnostics: {
        dataRoot: 'F:/windows/data',
        uclawDir: 'F:/windows/data/uclaw',
        openclawDir: 'F:/windows/data/workspace/.openclaw',
        workspaceDir: 'F:/windows/data/workspace',
      },
      startupSnapshot: {
        status: 'error',
        currentStep: 'gateway-start',
        steps: [],
        progress: 80,
        message: 'Gateway timeout',
        actions: [],
        updatedAt: Date.now(),
      },
      gatewayManager: {
        getStatus: () => ({ state: 'running', port: 18789 }),
        getDiagnostics: () => ({ consecutiveRpcFailures: 1 }),
      } as never,
      repairActions: [
        { id: 'restart-gateway', status: 'error', message: 'failed', at: '2026-07-08T00:00:00.000Z' },
      ],
    });

    const text = formatSupportDiagnosticsText(pkg);

    expect(pkg.schema).toBe('uclaw-support-diagnostics');
    expect(pkg.storage.dataRoot).toBe('F:/windows/data');
    expect(JSON.stringify(pkg)).not.toContain('sk-test-production-secret');
    expect(text).toContain('uclaw-support-diagnostics');
    expect(text).toContain('restart-gateway');
    expect(text).not.toContain('sk-test-production-secret');
  });
});
