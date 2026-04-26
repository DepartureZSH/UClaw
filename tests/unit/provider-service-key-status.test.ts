import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAccount, ProviderConfig } from '@electron/shared/providers/types';

const mocks = vi.hoisted(() => ({
  ensureProviderStoreMigrated: vi.fn(),
  listProviderAccounts: vi.fn(),
  providerAccountToConfig: vi.fn(),
  getActiveOpenClawProviders: vi.fn(),
  getOpenClawProvidersConfig: vi.fn(),
  getOpenClawRuntimeApiKey: vi.fn(),
  getOpenClawRuntimeCredentialProviders: vi.fn(),
  getOpenClawProviderKeyForType: vi.fn(),
  getAliasSourceTypes: vi.fn(),
  getApiKey: vi.fn(),
  storeApiKey: vi.fn(),
}));

vi.mock('@electron/services/providers/provider-migration', () => ({
  ensureProviderStoreMigrated: mocks.ensureProviderStoreMigrated,
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  listProviderAccounts: mocks.listProviderAccounts,
  deleteProviderAccount: vi.fn(),
  getProviderAccount: vi.fn(),
  getDefaultProviderAccountId: vi.fn(),
  providerAccountToConfig: mocks.providerAccountToConfig,
  providerConfigToAccount: vi.fn(),
  saveProviderAccount: vi.fn(),
  setDefaultProviderAccount: vi.fn(),
}));

vi.mock('@electron/utils/openclaw-auth', () => ({
  getActiveOpenClawProviders: mocks.getActiveOpenClawProviders,
  getOpenClawProvidersConfig: mocks.getOpenClawProvidersConfig,
  getOpenClawRuntimeApiKey: mocks.getOpenClawRuntimeApiKey,
  getOpenClawRuntimeCredentialProviders: mocks.getOpenClawRuntimeCredentialProviders,
}));

vi.mock('@electron/utils/provider-keys', () => ({
  getOpenClawProviderKeyForType: mocks.getOpenClawProviderKeyForType,
  getAliasSourceTypes: mocks.getAliasSourceTypes,
}));

vi.mock('@electron/utils/secure-storage', () => ({
  deleteApiKey: vi.fn(),
  deleteProvider: vi.fn(),
  getApiKey: mocks.getApiKey,
  hasApiKey: vi.fn(),
  setDefaultProvider: vi.fn(),
  storeApiKey: mocks.storeApiKey,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@electron/shared/providers/registry', () => ({
  PROVIDER_DEFINITIONS: [],
  getProviderDefinition: vi.fn(),
}));

import { ProviderService } from '@electron/services/providers/provider-service';

function makeAccount(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: 'test-provider',
    vendorId: 'custom' as ProviderAccount['vendorId'],
    label: 'Test Provider',
    authMode: 'api_key',
    enabled: true,
    isDefault: false,
    createdAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    ...overrides,
  };
}

function accountToConfig(account: ProviderAccount): ProviderConfig {
  return {
    id: account.id,
    name: account.label,
    type: account.vendorId,
    baseUrl: account.baseUrl,
    apiProtocol: account.apiProtocol,
    headers: account.headers,
    model: account.model,
    fallbackModels: account.fallbackModels,
    fallbackProviderIds: account.fallbackAccountIds,
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

describe('ProviderService.listLegacyProvidersWithKeyInfo', () => {
  let service: ProviderService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureProviderStoreMigrated.mockResolvedValue(undefined);
    mocks.getAliasSourceTypes.mockReturnValue([]);
    mocks.getApiKey.mockResolvedValue(null);
    mocks.providerAccountToConfig.mockImplementation(accountToConfig);
    mocks.getOpenClawProvidersConfig.mockResolvedValue({ providers: {}, defaultModel: undefined });
    mocks.getOpenClawRuntimeApiKey.mockResolvedValue(null);
    mocks.getOpenClawRuntimeCredentialProviders.mockResolvedValue(new Set<string>());
    mocks.storeApiKey.mockResolvedValue(true);
    mocks.getOpenClawProviderKeyForType.mockImplementation(
      (type: string, id: string) => type === 'custom' ? id : type,
    );
    service = new ProviderService();
  });

  it('marks providers with openclaw.json runtime credentials as configured', async () => {
    mocks.listProviderAccounts.mockResolvedValue([makeAccount({ id: 'new-api' })]);
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['new-api']));
    mocks.getOpenClawProvidersConfig.mockResolvedValue({
      providers: { 'new-api': { apiKey: 'NEW_API_KEY' } },
      defaultModel: undefined,
    });
    mocks.getOpenClawRuntimeCredentialProviders.mockResolvedValue(new Set(['new-api']));

    const result = await service.listLegacyProvidersWithKeyInfo();

    expect(result).toEqual([
      expect.objectContaining({
        id: 'new-api',
        hasKey: true,
        keyMasked: null,
      }),
    ]);
  });

  it('matches UUID accounts to runtime provider credentials by provider type', async () => {
    mocks.listProviderAccounts.mockResolvedValue([
      makeAccount({
        id: 'openrouter-uuid',
        vendorId: 'openrouter' as ProviderAccount['vendorId'],
        label: 'OpenRouter',
      }),
    ]);
    mocks.getActiveOpenClawProviders.mockResolvedValue(new Set(['openrouter']));
    mocks.getOpenClawProvidersConfig.mockResolvedValue({
      providers: { openrouter: { apiKey: 'OPENROUTER_API_KEY' } },
      defaultModel: undefined,
    });
    mocks.getOpenClawRuntimeCredentialProviders.mockResolvedValue(new Set(['openrouter']));

    const result = await service.listLegacyProvidersWithKeyInfo();

    expect(result).toEqual([
      expect.objectContaining({
        id: 'openrouter-uuid',
        type: 'openrouter',
        hasKey: true,
        keyMasked: null,
      }),
    ]);
  });
});
