import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('points kimi web-search plugin credentials at the KIMI_API_KEY env ref', async () => {
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
    expect(config.plugins.entries.moonshot.config.webSearch.apiKey).toBe('${KIMI_API_KEY}');
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
