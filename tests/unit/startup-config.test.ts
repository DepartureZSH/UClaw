import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_STARTUP_RUNTIME_CONFIG,
  resolveGatewayStartupConfig,
  resolveStartupRuntimeConfig,
} from '@electron/utils/startup-config';

const ENV_KEYS = [
  'UCLAW_STARTUP_TIMEOUT_APP_INIT_MS',
  'UCLAW_STARTUP_TIMEOUT_GATEWAY_START_MS',
  'UCLAW_GATEWAY_READY_WAIT_TIMEOUT_MS',
  'UCLAW_GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS',
];

describe('startup config', () => {
  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  it('uses default startup timeout values without overrides', () => {
    const config = resolveStartupRuntimeConfig();

    expect(config.stepTimeouts['app-init']).toBe(DEFAULT_STARTUP_RUNTIME_CONFIG.stepTimeouts['app-init']);
    expect(config.stepTimeouts['gateway-start']).toBe(45_000);
    expect(config.gateway.readyWaitTimeoutMs).toBe(45_000);
  });

  it('accepts persisted startup settings overrides', () => {
    const config = resolveStartupRuntimeConfig({
      startup: {
        stepTimeouts: {
          'gateway-start': 90_000,
        },
        gateway: {
          readyWaitTimeoutMs: 80_000,
          connectHandshakeTimeoutMs: 35_000,
        },
      },
    });

    expect(config.stepTimeouts['gateway-start']).toBe(90_000);
    expect(config.gateway.readyWaitTimeoutMs).toBe(80_000);
    expect(config.gateway.connectHandshakeTimeoutMs).toBe(35_000);
  });

  it('lets environment variables override persisted values', () => {
    process.env.UCLAW_STARTUP_TIMEOUT_GATEWAY_START_MS = '120000';
    process.env.UCLAW_GATEWAY_READY_WAIT_TIMEOUT_MS = '110000';

    const config = resolveStartupRuntimeConfig({
      startup: {
        stepTimeouts: {
          'gateway-start': 90_000,
        },
        gateway: {
          readyWaitTimeoutMs: 80_000,
        },
      },
    });

    expect(config.stepTimeouts['gateway-start']).toBe(120_000);
    expect(config.gateway.readyWaitTimeoutMs).toBe(110_000);
  });

  it('ignores invalid persisted and environment values', () => {
    process.env.UCLAW_GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS = '0';

    const startupConfig = resolveStartupRuntimeConfig({
      startup: {
        stepTimeouts: {
          'app-init': -1,
        },
      },
    });
    const gatewayConfig = resolveGatewayStartupConfig({ connectHandshakeTimeoutMs: 35_000 });

    expect(startupConfig.stepTimeouts['app-init']).toBe(DEFAULT_STARTUP_RUNTIME_CONFIG.stepTimeouts['app-init']);
    expect(gatewayConfig.connectHandshakeTimeoutMs).toBe(35_000);
  });
});
