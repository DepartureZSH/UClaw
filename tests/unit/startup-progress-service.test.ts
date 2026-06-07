import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAllSettingsMock = vi.fn();
const getSettingMock = vi.fn();
const setSettingMock = vi.fn();
const resolveStartupWorkspaceStateMock = vi.fn();
const syncAllProviderAuthToRuntimeMock = vi.fn();
const syncDefaultProviderToRuntimeMock = vi.fn();
const getOpenClawProvidersConfigMock = vi.fn();
const getOpenClawRuntimeApiKeyMock = vi.fn();
const getOpenClawRuntimeCredentialProvidersMock = vi.fn();
const listProviderAccountsMock = vi.fn();
const getProviderSecretMock = vi.fn();
const syncRemoteConfigMock = vi.fn();

vi.mock('electron', () => ({
  app: { getVersion: () => '0.2.0', quit: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn() },
}));

vi.mock('@electron/utils/store', () => ({
  getAllSettings: (...args: unknown[]) => getAllSettingsMock(...args),
  getSetting: (...args: unknown[]) => getSettingMock(...args),
  setSetting: (...args: unknown[]) => setSettingMock(...args),
}));

vi.mock('@electron/main/workspace-startup', () => ({
  resolveStartupWorkspaceState: (...args: unknown[]) => resolveStartupWorkspaceStateMock(...args),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncAllProviderAuthToRuntime: (...args: unknown[]) => syncAllProviderAuthToRuntimeMock(...args),
  syncDefaultProviderToRuntime: (...args: unknown[]) => syncDefaultProviderToRuntimeMock(...args),
}));

vi.mock('@electron/services/providers/provider-service', () => ({
  getProviderService: () => ({ setDefaultAccount: vi.fn() }),
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  getDefaultProviderAccountId: vi.fn().mockResolvedValue(undefined),
  getProviderAccount: vi.fn().mockResolvedValue(null),
  listProviderAccounts: (...args: unknown[]) => listProviderAccountsMock(...args),
}));

vi.mock('@electron/services/secrets/secret-store', () => ({
  getProviderSecret: (...args: unknown[]) => getProviderSecretMock(...args),
}));

vi.mock('@electron/utils/openclaw-auth', () => ({
  getOpenClawProvidersConfig: (...args: unknown[]) => getOpenClawProvidersConfigMock(...args),
  getOpenClawRuntimeApiKey: (...args: unknown[]) => getOpenClawRuntimeApiKeyMock(...args),
  getOpenClawRuntimeCredentialProviders: (...args: unknown[]) => getOpenClawRuntimeCredentialProvidersMock(...args),
}));

vi.mock('@electron/main/remote-config-sync', () => ({
  syncRemoteConfig: (...args: unknown[]) => syncRemoteConfigMock(...args),
}));

vi.mock('@electron/utils/provider-keys', () => ({
  getOpenClawProviderKeyForType: (vendorId: string, accountId: string) => vendorId === 'custom' ? accountId : vendorId,
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => '/tmp/.openclaw',
}));

vi.mock('@electron/utils/data-root', () => ({
  DATA_ROOT_SOURCE_ENV: 'UCLAW_DATA_ROOT_SOURCE',
  getConfiguredDataRoot: () => '/tmp/uclaw-data',
  getConfiguredPortableDataRootConfig: () => null,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    getLogDir: () => '/tmp/logs',
  },
}));

class FakeGatewayManager extends EventEmitter {
  start = vi.fn();
  stop = vi.fn();
  restart = vi.fn();
  getStatus = vi.fn().mockReturnValue({ state: 'stopped', port: 18789 });
}

describe('StartupProgressService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllSettingsMock.mockResolvedValue({ setupComplete: true, gatewayAutoStart: false });
    getSettingMock.mockImplementation(async (key: string) => {
      if (key === 'setupComplete') return true;
      if (key === 'gatewayAutoStart') return false;
      if (key === 'workspaceDir') return '';
      return undefined;
    });
    resolveStartupWorkspaceStateMock.mockResolvedValue({ setupComplete: true, workspaceDir: '' });
    syncAllProviderAuthToRuntimeMock.mockResolvedValue(undefined);
    getOpenClawProvidersConfigMock.mockResolvedValue({ providers: {}, defaultModel: undefined });
    getOpenClawRuntimeApiKeyMock.mockResolvedValue(null);
    getOpenClawRuntimeCredentialProvidersMock.mockResolvedValue(new Set());
    listProviderAccountsMock.mockResolvedValue([]);
    getProviderSecretMock.mockResolvedValue(null);
    syncRemoteConfigMock.mockResolvedValue({ status: 'skipped', message: '未配置远程配置下发，跳过' });
  });

  it('advances through startup steps and skips provider/gateway when auto-start is disabled', async () => {
    const { StartupProgressService } = await import('@electron/main/startup-progress-service');
    const gatewayManager = new FakeGatewayManager();
    const service = new StartupProgressService({
      gatewayManager: gatewayManager as never,
      getMainWindow: () => null,
    });

    const snapshot = await service.runInitialStartup({
      isE2EMode: false,
      storageDiagnostics: { isAppTranslocated: false },
    });

    expect(snapshot.status).toBe('ready');
    expect(snapshot.steps.map((step) => [step.id, step.status])).toEqual([
      ['app-init', 'success'],
      ['settings-load', 'success'],
      ['workspace-resolve', 'success'],
      ['setup-check', 'success'],
      ['config-sync', 'success'],
      ['remote-config-sync', 'skipped'],
      ['provider-key-sync', 'skipped'],
      ['gateway-start', 'skipped'],
    ]);
    expect(gatewayManager.start).not.toHaveBeenCalled();
  });

  it('skips legacy setup state without starting gateway when auto-start is disabled', async () => {
    getSettingMock.mockImplementation(async (key: string) => {
      if (key === 'setupComplete') return false;
      if (key === 'gatewayAutoStart') return false;
      return '';
    });
    resolveStartupWorkspaceStateMock.mockResolvedValue({ setupComplete: false, workspaceDir: '' });
    const { StartupProgressService } = await import('@electron/main/startup-progress-service');
    const gatewayManager = new FakeGatewayManager();
    const service = new StartupProgressService({
      gatewayManager: gatewayManager as never,
      getMainWindow: () => null,
    });

    const snapshot = await service.runInitialStartup({
      isE2EMode: false,
      storageDiagnostics: { isAppTranslocated: false },
    });

    expect(snapshot.status).toBe('ready');
    expect(setSettingMock).toHaveBeenCalledWith('setupComplete', true);
    expect(snapshot.steps.find((step) => step.id === 'setup-check')?.status).toBe('success');
    expect(snapshot.steps.find((step) => step.id === 'gateway-start')?.status).toBe('skipped');
    expect(snapshot.steps.find((step) => step.id === 'remote-config-sync')?.status).toBe('skipped');
    expect(gatewayManager.start).not.toHaveBeenCalled();
  });

  it('runs remote config sync before provider key sync', async () => {
    getSettingMock.mockImplementation(async (key: string) => {
      if (key === 'setupComplete') return true;
      if (key === 'gatewayAutoStart') return false;
      return '';
    });
    syncRemoteConfigMock.mockResolvedValue({ status: 'success', message: '远程配置已同步：v1' });
    const { StartupProgressService } = await import('@electron/main/startup-progress-service');
    const gatewayManager = new FakeGatewayManager();
    const service = new StartupProgressService({
      gatewayManager: gatewayManager as never,
      getMainWindow: () => null,
    });

    const snapshot = await service.runInitialStartup({
      isE2EMode: false,
      storageDiagnostics: { isAppTranslocated: false },
    });

    expect(snapshot.steps.find((step) => step.id === 'remote-config-sync')?.status).toBe('success');
    expect(syncRemoteConfigMock).toHaveBeenCalled();
  });

  it('surfaces early data-root startup failures before other steps run', async () => {
    const { StartupProgressService } = await import('@electron/main/startup-progress-service');
    const gatewayManager = new FakeGatewayManager();
    const service = new StartupProgressService({
      gatewayManager: gatewayManager as never,
      getMainWindow: () => null,
    });

    const snapshot = await service.runInitialStartup({
      isE2EMode: false,
      storageDiagnostics: { isAppTranslocated: false, dataRoot: 'E:/locked-data' },
      startupError: new Error('data root already locked: E:/locked-data'),
    });

    expect(snapshot.status).toBe('error');
    expect(snapshot.issue).toMatchObject({ type: 'external', severity: 'S0', code: 'DATA_ROOT_LOCKED' });
    expect(snapshot.currentStep).toBe('app-init');
    expect(snapshot.steps.find((step) => step.id === 'app-init')?.status).toBe('error');
    expect(gatewayManager.start).not.toHaveBeenCalled();
  });


  it('surfaces provider key mismatch as a warning with switch action', async () => {
    getSettingMock.mockImplementation(async (key: string) => {
      if (key === 'setupComplete') return true;
      if (key === 'gatewayAutoStart') return true;
      if (key === 'workspaceDir') return '';
      return undefined;
    });
    getOpenClawProvidersConfigMock.mockResolvedValue({ providers: {}, defaultModel: 'openai/gpt-5.4' });
    listProviderAccountsMock.mockResolvedValue([
      {
        id: 'new-api-account',
        vendorId: 'new-api',
        label: 'New API',
        enabled: true,
      },
    ]);
    getProviderSecretMock.mockResolvedValue({ type: 'api_key', accountId: 'new-api-account', apiKey: 'sk-test' });
    const { StartupProgressService } = await import('@electron/main/startup-progress-service');
    const gatewayManager = new FakeGatewayManager();
    gatewayManager.getStatus.mockReturnValue({ state: 'running', port: 18789, gatewayReady: true });
    const service = new StartupProgressService({
      gatewayManager: gatewayManager as never,
      getMainWindow: () => null,
    });

    const snapshot = await service.runInitialStartup({
      isE2EMode: false,
      storageDiagnostics: { isAppTranslocated: false },
    });

    expect(snapshot.status).toBe('warning');
    expect(snapshot.issue).toMatchObject({ type: 'internal', severity: 'S2', code: 'PROVIDER_KEY_MISSING' });
    expect(snapshot.steps.find((step) => step.id === 'provider-key-sync')?.status).toBe('warning');
    expect(snapshot.actions.some((action) => action.id === 'switch-provider')).toBe(true);
  });
});

describe('classifyStartupError', () => {
  it('maps gateway auth and port errors to repair actions', async () => {
    const { classifyStartupError } = await import('@electron/main/startup-progress-service');

    expect(classifyStartupError(new Error('Unauthorized')).actions[0].id).toBe('resync-token');
    expect(classifyStartupError(new Error('Unauthorized')).issue).toMatchObject({
      type: 'internal',
      severity: 'S2',
      code: 'GATEWAY_TOKEN_MISMATCH',
    });
    expect(classifyStartupError(new Error('Port 18789 still occupied after 30000ms')).actions[0].id)
      .toBe('stop-old-gateway-and-retry');
    expect(classifyStartupError(new Error('Port 18789 still occupied after 30000ms')).issue).toMatchObject({
      type: 'external',
      severity: 'S2',
      code: 'GATEWAY_PORT_OCCUPIED',
    });
  });

  it('classifies data-root, JSON, timeout, plugin, and unknown startup errors', async () => {
    const { classifyStartupError } = await import('@electron/main/startup-progress-service');

    expect(classifyStartupError(new Error('data root writable check failed: E:\\data')).issue)
      .toMatchObject({ type: 'external', severity: 'S0', code: 'DATA_ROOT_NOT_WRITABLE' });
    expect(classifyStartupError(new Error('data root already locked: E:\\data')).issue)
      .toMatchObject({ type: 'external', severity: 'S0', code: 'DATA_ROOT_LOCKED' });
    expect(classifyStartupError(new SyntaxError('Unexpected token in JSON')).issue)
      .toMatchObject({ type: 'external', severity: 'S0', code: 'CONFIG_JSON_CORRUPTED' });
    expect(classifyStartupError(new Error('Gateway RPC ready timeout')).issue)
      .toMatchObject({ type: 'internal', severity: 'S1', code: 'GATEWAY_RPC_READY_TIMEOUT' });
    expect(classifyStartupError(new Error('Gateway connect handshake timeout')).issue)
      .toMatchObject({ type: 'internal', severity: 'S1', code: 'GATEWAY_WS_HANDSHAKE_TIMEOUT' });
    expect(classifyStartupError(new Error('Gateway wait port release timeout')).issue)
      .toMatchObject({ type: 'external', severity: 'S2', code: 'GATEWAY_PORT_WAIT_TIMEOUT' });
    expect(classifyStartupError(new Error('Gateway start failed')).issue)
      .toMatchObject({ type: 'internal', severity: 'S1', code: 'GATEWAY_PROCESS_START_FAILED' });
    expect(classifyStartupError(new Error('remote config unavailable: HTTP 500')).issue)
      .toMatchObject({ type: 'external', severity: 'S1', code: 'REMOTE_CONFIG_UNAVAILABLE' });
    expect(classifyStartupError(new Error('remote config unauthorized: HTTP 403')).issue)
      .toMatchObject({ type: 'external', severity: 'S1', code: 'REMOTE_CONFIG_UNAUTHORIZED' });
    expect(classifyStartupError(new Error('portable workspace repair failed: F:/data/workspace')).issue)
      .toMatchObject({ type: 'external', severity: 'S1', code: 'PORTABLE_WORKSPACE_REPAIR_FAILED' });
    expect(classifyStartupError(new Error('plugin not found: moonshot')).issue)
      .toMatchObject({ type: 'internal', severity: 'S2', code: 'GATEWAY_PLUGIN_CONFIG_ERROR' });
    expect(classifyStartupError(new Error('boom')).issue)
      .toMatchObject({ type: 'internal', severity: 'S1', code: 'STARTUP_UNKNOWN_ERROR' });
  });
});
