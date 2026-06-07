import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saveProviderMock = vi.fn();
const setDefaultProviderMock = vi.fn();
const storeApiKeyMock = vi.fn();
const applyInitialPluginConfigMock = vi.fn();
const loggerWarnMock = vi.fn();
const getSettingMock = vi.fn();
const syncSavedProviderToRuntimeMock = vi.fn();
const syncDefaultProviderToRuntimeMock = vi.fn();

let dataRoot = '';
let portableConfig: unknown = null;

vi.mock('@electron/utils/secure-storage', () => ({
  saveProvider: (...args: unknown[]) => saveProviderMock(...args),
  setDefaultProvider: (...args: unknown[]) => setDefaultProviderMock(...args),
  storeApiKey: (...args: unknown[]) => storeApiKeyMock(...args),
}));

vi.mock('@electron/utils/skill-config', () => ({
  applyInitialPluginConfig: (...args: unknown[]) => applyInitialPluginConfigMock(...args),
}));

vi.mock('@electron/utils/data-root', () => ({
  getConfiguredDataRoot: () => dataRoot,
  getConfiguredPortableDataRootConfig: () => portableConfig,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: (...args: unknown[]) => loggerWarnMock(...args),
  },
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));

vi.mock('@electron/services/providers/provider-runtime-sync', () => ({
  syncSavedProviderToRuntime: (...args: unknown[]) => syncSavedProviderToRuntimeMock(...args),
  syncDefaultProviderToRuntime: (...args: unknown[]) => syncDefaultProviderToRuntimeMock(...args),
}));

function makeConfig(version: string, apiKey = 'sk-test') {
  return {
    success: true,
    configVersion: version,
    provider: {
      id: 'new-api',
      baseUrl: 'https://new-api.example.test/v1',
      apiKey,
      defaultModel: 'deepseek-ai/DeepSeek-V3.2',
    },
    webSearch: {
      enabled: true,
      model: 'kimi-k2.5',
    },
  };
}

describe('remote config sync', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    dataRoot = await mkdtemp(join(tmpdir(), 'uclaw-remote-config-'));
    portableConfig = {
      schema: 'uclaw-portable-data-root',
      version: 2,
      dataRoot: 'data',
      workspaceMode: 'portable-workbench',
      workspaceDir: 'workspace',
      provisioning: {
        endpoint: 'https://laf.example.test/uclaw/provision',
        packageId: 'usb-001',
      },
    };
    delete process.env.UCLAW_REMOTE_CONFIG_ENDPOINT;
    delete process.env.UCLAW_REMOTE_CONFIG_PACKAGE_ID;
    getSettingMock.mockResolvedValue('');
    syncSavedProviderToRuntimeMock.mockResolvedValue(undefined);
    syncDefaultProviderToRuntimeMock.mockResolvedValue(undefined);
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('fetches remote config and applies New API plus web-search settings', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeConfig('v1'),
    } as Response);

    const { syncRemoteConfig } = await import('@electron/main/remote-config-sync');
    const result = await syncRemoteConfig({ appVersion: '0.2.0', platform: 'win32' });

    expect(result).toMatchObject({ status: 'success', configVersion: 'v1', source: 'remote' });
    expect(fetch).toHaveBeenCalledWith('https://laf.example.test/uclaw/provision', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"packageId":"usb-001"'),
    }));
    expect(saveProviderMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'new-api',
      type: 'new-api',
      baseUrl: 'https://new-api.example.test/v1',
      model: 'deepseek-ai/DeepSeek-V3.2',
    }));
    expect(storeApiKeyMock).toHaveBeenCalledWith('new-api', 'sk-test');
    expect(setDefaultProviderMock).toHaveBeenCalledWith('new-api');
    expect(syncSavedProviderToRuntimeMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'new-api',
      type: 'new-api',
      baseUrl: 'https://new-api.example.test/v1',
      model: 'deepseek-ai/DeepSeek-V3.2',
    }), 'sk-test');
    expect(syncDefaultProviderToRuntimeMock).toHaveBeenCalledWith('new-api');
    expect(applyInitialPluginConfigMock).toHaveBeenCalledWith(
      'sk-test',
      'https://new-api.example.test/v1',
      'kimi-k2.5',
    );
  });

  it('uses persisted company key before the bundled package id', async () => {
    getSettingMock.mockImplementation(async (key: string) => key === 'companyKey' ? 'company-key-001' : '');
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeConfig('v2'),
    } as Response);

    const { syncRemoteConfig } = await import('@electron/main/remote-config-sync');
    await syncRemoteConfig({ appVersion: '0.3.2', platform: 'win32' });

    expect(fetch).toHaveBeenCalledWith('https://laf.example.test/uclaw/provision', expect.objectContaining({
      body: expect.stringContaining('"packageId":"company-key-001"'),
    }));
  });

  it('applies cached config when remote fetch fails', async () => {
    const cacheDir = join(dataRoot, 'uclaw');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, 'remote-config-cache.json'), `${JSON.stringify(makeConfig('cached', 'sk-cached'))}\n`, 'utf8');
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    const { syncRemoteConfig } = await import('@electron/main/remote-config-sync');
    const result = await syncRemoteConfig({ appVersion: '0.2.0', platform: 'win32' });

    expect(result).toMatchObject({ status: 'warning', configVersion: 'cached', source: 'cache' });
    expect(storeApiKeyMock).toHaveBeenCalledWith('new-api', 'sk-cached');
  });

  it('throws when remote config is unavailable and no cache exists', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    const { syncRemoteConfig } = await import('@electron/main/remote-config-sync');
    await expect(syncRemoteConfig({ appVersion: '0.2.0', platform: 'win32' }))
      .rejects.toThrow('remote config unavailable');
  });
});
