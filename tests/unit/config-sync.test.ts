import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripSystemdSupervisorEnv } from '@electron/gateway/config-sync-env';

describe('stripSystemdSupervisorEnv', () => {
  it('removes systemd supervisor marker env vars', () => {
    const env = {
      PATH: '/usr/bin:/bin',
      OPENCLAW_SYSTEMD_UNIT: 'openclaw-gateway.service',
      INVOCATION_ID: 'abc123',
      SYSTEMD_EXEC_PID: '777',
      JOURNAL_STREAM: '8:12345',
      OTHER: 'keep-me',
    };

    const result = stripSystemdSupervisorEnv(env);

    expect(result).toEqual({
      PATH: '/usr/bin:/bin',
      OTHER: 'keep-me',
    });
  });

  it('keeps unrelated variables unchanged', () => {
    const env = {
      NODE_ENV: 'production',
      OPENCLAW_GATEWAY_TOKEN: 'token',
      CLAWDBOT_SKIP_CHANNELS: '0',
    };

    expect(stripSystemdSupervisorEnv(env)).toEqual(env);
  });

  it('does not mutate source env object', () => {
    const env = {
      OPENCLAW_SYSTEMD_UNIT: 'openclaw-gateway.service',
      VALUE: '1',
    };
    const before = { ...env };

    const result = stripSystemdSupervisorEnv(env);

    expect(env).toEqual(before);
    expect(result).toEqual({ VALUE: '1' });
  });
});

describe('gateway launch environment', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('passes explicit OpenClaw state and config paths to channel plugins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uclaw-gateway-env-'));
    const dataRoot = join(root, 'data');
    const configDir = join(dataRoot, 'workspace', '.openclaw');
    const openclawDir = join(root, 'openclaw');
    const entryPath = join(openclawDir, 'openclaw.mjs');
    try {
      await mkdir(openclawDir, { recursive: true });
      await mkdir(configDir, { recursive: true });
      await writeFile(join(openclawDir, 'package.json'), '{"name":"openclaw"}', 'utf8');
      await writeFile(entryPath, 'export {};', 'utf8');

      vi.doMock('electron', () => ({
        app: {
          isPackaged: false,
          getPath: () => join(dataRoot, 'uclaw'),
          getAppPath: () => root,
        },
      }));

      vi.doMock('@electron/utils/paths', () => ({
        getOpenClawDir: () => openclawDir,
        getOpenClawEntryPath: () => entryPath,
        isOpenClawPresent: () => true,
        getOpenClawConfigDir: () => configDir,
      }));
      vi.doMock('@electron/utils/data-root', () => ({
        getConfiguredDataRoot: () => dataRoot,
      }));
      vi.doMock('@electron/utils/store', () => ({
        getAllSettings: vi.fn(async () => ({
          gatewayToken: 'test-token',
          proxyEnabled: false,
        })),
      }));
      vi.doMock('@electron/utils/secure-storage', () => ({
        getApiKey: vi.fn(async () => undefined),
        getDefaultProvider: vi.fn(async () => undefined),
        getProvider: vi.fn(async () => undefined),
      }));
      vi.doMock('@electron/utils/provider-registry', () => ({
        getKeyableProviderTypes: () => [],
        getProviderEnvVar: (providerType: string) => `${providerType.toUpperCase()}_API_KEY`,
      }));
      vi.doMock('@electron/utils/channel-config', () => ({
        cleanupDanglingWeChatPluginState: vi.fn(async () => ({ cleanedDanglingState: false })),
        listConfiguredChannelsFromConfig: vi.fn(async () => []),
      }));
      vi.doMock('@electron/utils/openclaw-auth', () => ({
        batchSyncConfigFields: vi.fn(async () => undefined),
        getOpenClawRuntimeApiKey: vi.fn(async () => undefined),
        sanitizeOpenClawConfig: vi.fn(async () => undefined),
      }));
      vi.doMock('@electron/utils/openclaw-proxy', () => ({
        syncProxyConfigToOpenClaw: vi.fn(async () => undefined),
      }));
      vi.doMock('@electron/utils/proxy', () => ({
        buildProxyEnv: () => ({}),
        resolveProxySettings: () => ({ httpProxy: '', httpsProxy: '', allProxy: '' }),
      }));
      vi.doMock('@electron/utils/logger', () => ({
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
        },
      }));
      vi.doMock('@electron/utils/uv-env', () => ({
        getUvRuntimeEnv: vi.fn(async () => ({})),
      }));
      vi.doMock('@electron/services/providers/provider-migration', () => ({
        ensureProviderStoreMigrated: vi.fn(async () => undefined),
      }));
      vi.doMock('@electron/services/providers/provider-store', () => ({
        listProviderAccounts: vi.fn(async () => []),
      }));

      delete process.env.UCLAW_WORKSPACE_DIR;
      const { prepareGatewayLaunchContext } = await import('@electron/gateway/config-sync');
      const context = await prepareGatewayLaunchContext(18789);

      expect(context.forkEnv.OPENCLAW_HOME).toBe(dataRoot);
      expect(context.forkEnv.OPENCLAW_STATE_DIR).toBe(configDir);
      expect(context.forkEnv.CLAWDBOT_STATE_DIR).toBe(configDir);
      expect(context.forkEnv.OPENCLAW_OAUTH_DIR).toBe(join(configDir, 'credentials'));
      expect(context.forkEnv.OPENCLAW_CONFIG_PATH).toBe(join(configDir, 'openclaw.json'));
      expect(context.forkEnv.OPENCLAW_CONFIG).toBe(join(configDir, 'openclaw.json'));
      expect(context.forkEnv.OPENCLAW_SKIP_CHANNELS).toBe('1');
    } finally {
      delete process.env.UCLAW_WORKSPACE_DIR;
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('kimi web-search API key alias resolution', () => {
  const runtimeApiKey = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: () => '/tmp/uclaw-test-user-data',
        getAppPath: () => '/tmp/uclaw-test-app',
      },
    }));

    vi.doMock('@electron/utils/openclaw-auth', () => ({
      batchSyncConfigFields: vi.fn(),
      getOpenClawRuntimeApiKey: runtimeApiKey,
      sanitizeOpenClawConfig: vi.fn(),
    }));
  });

  it('backs up and reports corrupt openclaw.json instead of overwriting it', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'uclaw-corrupt-openclaw-'));
    try {
      const configPath = join(configDir, 'openclaw.json');
      await writeFile(configPath, '{"broken":', 'utf8');

      vi.doMock('@electron/utils/paths', () => ({
        getOpenClawDir: () => '/tmp/openclaw',
        getOpenClawEntryPath: () => '/tmp/openclaw/dist/cli.js',
        isOpenClawPresent: () => true,
        getOpenClawConfigDir: () => configDir,
      }));

      const { readGatewayOpenClawConfig } = await import('@electron/gateway/config-sync');
      await expect(readGatewayOpenClawConfig()).rejects.toThrow(`JSON parse failed for ${configPath}`);

      expect((await readFile(configPath, 'utf8')).trim()).toBe('{"broken":');
      const files = await readdir(configDir);
      expect(files.some((file) => file.startsWith('openclaw.json.corrupt.'))).toBe(true);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('detects kimi web search from moonshot plugin config', async () => {
    const { isKimiWebSearchEnabled } = await import('@electron/gateway/config-sync');

    expect(isKimiWebSearchEnabled({
      plugins: {
        entries: {
          moonshot: {
            enabled: true,
            config: {
              webSearch: {
                baseUrl: 'https://chatbot.example.test/v1',
                model: 'kimi-k2.5',
              },
            },
          },
        },
      },
    })).toBe(true);
  });

  it('detects legacy kimi web search when provider is set without enabled=true', async () => {
    const { isKimiWebSearchEnabled } = await import('@electron/gateway/config-sync');

    expect(isKimiWebSearchEnabled({
      tools: {
        web: {
          search: {
            provider: 'kimi',
          },
        },
      },
    })).toBe(true);

    expect(isKimiWebSearchEnabled({
      tools: {
        web: {
          search: {
            provider: 'kimi',
            enabled: false,
          },
        },
      },
    })).toBe(false);
  });

  it('clears env-style kimi web-search plugin credentials so Gateway uses KIMI_API_KEY env', async () => {
    const { applyKimiWebSearchApiKeyEnvReference } = await import('@electron/gateway/config-sync');
    const config = {
      tools: {
        web: {
          search: {
            provider: 'kimi',
          },
        },
      },
      plugins: {
        entries: {
          moonshot: {
            config: {
              webSearch: {
                model: 'kimi-k2.5',
                baseUrl: 'https://api.example.test/v1',
                apiKey: 'MOONSHOT_API_KEY',
              },
            },
          },
        },
      },
    };

    expect(applyKimiWebSearchApiKeyEnvReference(config)).toBe(true);
    expect(config.plugins.entries.moonshot.config.webSearch.apiKey).toBeUndefined();
  });

  it('does not create a moonshot web-search plugin entry when no apiKey needs clearing', async () => {
    const { applyKimiWebSearchApiKeyEnvReference } = await import('@electron/gateway/config-sync');
    const config = {
      tools: {
        web: {
          search: {
            provider: 'kimi',
          },
        },
      },
    };

    expect(applyKimiWebSearchApiKeyEnvReference(config)).toBe(false);
    expect(config).toEqual({
      tools: {
        web: {
          search: {
            provider: 'kimi',
          },
        },
      },
    });
  });

  it('does not overwrite an explicit kimi web-search API key', async () => {
    const { applyKimiWebSearchApiKeyEnvReference } = await import('@electron/gateway/config-sync');
    const config = {
      plugins: {
        entries: {
          moonshot: {
            config: {
              webSearch: {
                model: 'kimi-k2.5',
                apiKey: 'sk-explicit',
              },
            },
          },
        },
      },
    };

    expect(applyKimiWebSearchApiKeyEnvReference(config)).toBe(false);
    expect(config.plugins.entries.moonshot.config.webSearch.apiKey).toBe('sk-explicit');
  });

  it('resolves KIMI_API_KEY from the OpenClaw default model provider when providerEnv is empty', async () => {
    runtimeApiKey.mockResolvedValue('sk-custom-runtime');
    const { resolveKimiWebSearchApiKeyAlias } = await import('@electron/gateway/config-sync');

    await expect(resolveKimiWebSearchApiKeyAlias({}, {
      agents: {
        defaults: {
          model: {
            primary: 'custom-abc12345/kimi-k2.5',
          },
        },
      },
      plugins: {
        entries: {
          moonshot: {
            enabled: true,
            config: {
              webSearch: {
                model: 'kimi-k2.5',
              },
            },
          },
        },
      },
    })).resolves.toBe('sk-custom-runtime');

    expect(runtimeApiKey).toHaveBeenCalledWith(['custom-abc12345']);
  });

  it('resolves KIMI_API_KEY when the default model is stored as a string', async () => {
    runtimeApiKey.mockResolvedValue('sk-custom-runtime');
    const { getDefaultModelProviderKey, resolveKimiWebSearchApiKeyAlias } = await import('@electron/gateway/config-sync');
    const config = {
      agents: {
        defaults: {
          model: 'custom-abc12345/kimi-k2.5',
        },
      },
      plugins: {
        entries: {
          moonshot: {
            enabled: true,
            config: {
              webSearch: {
                model: 'kimi-k2.5',
              },
            },
          },
        },
      },
    };

    expect(getDefaultModelProviderKey(config)).toBe('custom-abc12345');
    await expect(resolveKimiWebSearchApiKeyAlias({}, config)).resolves.toBe('sk-custom-runtime');
    expect(runtimeApiKey).toHaveBeenCalledWith(['custom-abc12345']);
  });

  it('resolves KIMI_API_KEY from the provider that matches web-search model/baseUrl', async () => {
    runtimeApiKey.mockResolvedValue('sk-new-api-runtime');
    const { getKimiWebSearchProviderCandidates, resolveKimiWebSearchApiKeyAlias } = await import('@electron/gateway/config-sync');
    const config = {
      models: {
        providers: {
          'custom-abc12345': {
            baseUrl: 'https://api.example.test/v1/',
            api: 'openai-completions',
            models: [{ id: 'kimi-k2.5', name: 'Kimi K2.5' }],
          },
        },
      },
      plugins: {
        entries: {
          moonshot: {
            enabled: true,
            config: {
              webSearch: {
                baseUrl: 'https://api.example.test/v1',
                model: 'kimi-k2.5',
              },
            },
          },
        },
      },
    };

    expect(getKimiWebSearchProviderCandidates(config)).toEqual(['custom-abc12345', 'moonshot']);
    await expect(resolveKimiWebSearchApiKeyAlias({}, config)).resolves.toBe('sk-new-api-runtime');
    expect(runtimeApiKey).toHaveBeenCalledWith(['custom-abc12345', 'moonshot']);
  });

  it('does not override an explicit moonshot key', async () => {
    const { resolveKimiWebSearchApiKeyAlias } = await import('@electron/gateway/config-sync');

    await expect(resolveKimiWebSearchApiKeyAlias({ MOONSHOT_API_KEY: 'sk-moonshot' }, {
      tools: { web: { search: { enabled: true, provider: 'kimi' } } },
    })).resolves.toBeUndefined();
    expect(runtimeApiKey).not.toHaveBeenCalled();
  });
});
