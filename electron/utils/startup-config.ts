import type { StartupStepId } from '../../shared/startup';
import { DATA_ROOT_SOURCE_ENV } from './data-root';

export interface GatewayStartupConfig {
  waitForPortFreeTimeoutMs: number;
  readyWaitTimeoutMs: number;
  readyWaitPollIntervalMs: number;
  readyProbeTimeoutMs: number;
  challengeTimeoutMs: number;
  connectHandshakeTimeoutMs: number;
  subsystemReadyFallbackMs: number;
  subsystemReadyProbeInitialDelayMs: number;
  subsystemReadyProbeIntervalMs: number;
  subsystemReadyProbeTimeoutMs: number;
}

export interface StartupConfigSettings {
  stepTimeouts?: Partial<Record<StartupStepId, number>>;
  gateway?: Partial<GatewayStartupConfig>;
}

export interface StartupRuntimeConfig {
  stepTimeouts: Record<StartupStepId, number>;
  gateway: GatewayStartupConfig;
}

type StartupConfigSource = {
  startup?: StartupConfigSettings;
};

const STEP_ENV_KEYS: Record<StartupStepId, string> = {
  'app-init': 'UCLAW_STARTUP_TIMEOUT_APP_INIT_MS',
  'settings-load': 'UCLAW_STARTUP_TIMEOUT_SETTINGS_LOAD_MS',
  'workspace-resolve': 'UCLAW_STARTUP_TIMEOUT_WORKSPACE_RESOLVE_MS',
  'setup-check': 'UCLAW_STARTUP_TIMEOUT_SETUP_CHECK_MS',
  'config-sync': 'UCLAW_STARTUP_TIMEOUT_CONFIG_SYNC_MS',
  'provider-key-sync': 'UCLAW_STARTUP_TIMEOUT_PROVIDER_KEY_SYNC_MS',
  'gateway-start': 'UCLAW_STARTUP_TIMEOUT_GATEWAY_START_MS',
};

const GATEWAY_ENV_KEYS: Record<keyof GatewayStartupConfig, string> = {
  waitForPortFreeTimeoutMs: 'UCLAW_GATEWAY_WAIT_FOR_PORT_FREE_TIMEOUT_MS',
  readyWaitTimeoutMs: 'UCLAW_GATEWAY_READY_WAIT_TIMEOUT_MS',
  readyWaitPollIntervalMs: 'UCLAW_GATEWAY_READY_WAIT_POLL_INTERVAL_MS',
  readyProbeTimeoutMs: 'UCLAW_GATEWAY_READY_PROBE_TIMEOUT_MS',
  challengeTimeoutMs: 'UCLAW_GATEWAY_CHALLENGE_TIMEOUT_MS',
  connectHandshakeTimeoutMs: 'UCLAW_GATEWAY_CONNECT_HANDSHAKE_TIMEOUT_MS',
  subsystemReadyFallbackMs: 'UCLAW_GATEWAY_SUBSYSTEM_READY_FALLBACK_MS',
  subsystemReadyProbeInitialDelayMs: 'UCLAW_GATEWAY_SUBSYSTEM_READY_PROBE_INITIAL_DELAY_MS',
  subsystemReadyProbeIntervalMs: 'UCLAW_GATEWAY_SUBSYSTEM_READY_PROBE_INTERVAL_MS',
  subsystemReadyProbeTimeoutMs: 'UCLAW_GATEWAY_SUBSYSTEM_READY_PROBE_TIMEOUT_MS',
};

export const DEFAULT_STARTUP_RUNTIME_CONFIG: StartupRuntimeConfig = {
  stepTimeouts: {
    'app-init': 8_000,
    'settings-load': 5_000,
    'workspace-resolve': 15_000,
    'setup-check': 5_000,
    'config-sync': 20_000,
    'provider-key-sync': 10_000,
    'gateway-start': 45_000,
  },
  gateway: {
    waitForPortFreeTimeoutMs: 30_000,
    readyWaitTimeoutMs: 45_000,
    readyWaitPollIntervalMs: 200,
    readyProbeTimeoutMs: 1_500,
    challengeTimeoutMs: 10_000,
    connectHandshakeTimeoutMs: 20_000,
    subsystemReadyFallbackMs: 30_000,
    subsystemReadyProbeInitialDelayMs: 500,
    subsystemReadyProbeIntervalMs: 2_000,
    subsystemReadyProbeTimeoutMs: 5_000,
  },
};

export const PORTABLE_DATA_ROOT_STARTUP_RUNTIME_CONFIG: StartupRuntimeConfig = {
  ...DEFAULT_STARTUP_RUNTIME_CONFIG,
  stepTimeouts: {
    ...DEFAULT_STARTUP_RUNTIME_CONFIG.stepTimeouts,
    'gateway-start': 240_000,
  },
  gateway: {
    ...DEFAULT_STARTUP_RUNTIME_CONFIG.gateway,
    readyWaitTimeoutMs: 180_000,
    connectHandshakeTimeoutMs: 30_000,
    subsystemReadyFallbackMs: 90_000,
    subsystemReadyProbeInitialDelayMs: 1_000,
    subsystemReadyProbeTimeoutMs: 10_000,
  },
};

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.round(parsed);
}

function envNumber(key: string): number | undefined {
  return normalizePositiveInteger(process.env[key]);
}

export function resolveGatewayStartupConfig(
  overrides?: Partial<GatewayStartupConfig>,
): GatewayStartupConfig {
  const gateway = {
    ...(isExplicitDataRootSource() ? PORTABLE_DATA_ROOT_STARTUP_RUNTIME_CONFIG : DEFAULT_STARTUP_RUNTIME_CONFIG).gateway,
  };

  for (const key of Object.keys(gateway) as Array<keyof GatewayStartupConfig>) {
    const override = normalizePositiveInteger(overrides?.[key]);
    if (override !== undefined) {
      gateway[key] = override;
    }
  }

  for (const [key, envKey] of Object.entries(GATEWAY_ENV_KEYS) as Array<[keyof GatewayStartupConfig, string]>) {
    const override = envNumber(envKey);
    if (override !== undefined) {
      gateway[key] = override;
    }
  }

  return gateway;
}

export function resolveStartupRuntimeConfig(source?: StartupConfigSource | null): StartupRuntimeConfig {
  const defaults = isExplicitDataRootSource()
    ? PORTABLE_DATA_ROOT_STARTUP_RUNTIME_CONFIG
    : DEFAULT_STARTUP_RUNTIME_CONFIG;
  const stepTimeouts = { ...defaults.stepTimeouts };

  for (const step of Object.keys(stepTimeouts) as StartupStepId[]) {
    const override = normalizePositiveInteger(source?.startup?.stepTimeouts?.[step]);
    if (override !== undefined) {
      stepTimeouts[step] = override;
    }
  }

  for (const [step, envKey] of Object.entries(STEP_ENV_KEYS) as Array<[StartupStepId, string]>) {
    const override = envNumber(envKey);
    if (override !== undefined) {
      stepTimeouts[step] = override;
    }
  }

  return {
    stepTimeouts,
    gateway: resolveGatewayStartupConfig(source?.startup?.gateway),
  };
}

function isExplicitDataRootSource(): boolean {
  const source = process.env[DATA_ROOT_SOURCE_ENV];
  return source === 'argv' || source === 'env' || source === 'portable-marker';
}
