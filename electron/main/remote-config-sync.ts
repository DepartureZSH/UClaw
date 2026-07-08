import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { saveProvider, setDefaultProvider, storeApiKey } from '../utils/secure-storage';
import { applyInitialPluginConfig } from '../utils/skill-config';
import {
  getConfiguredDataRoot,
  getConfiguredPortableDataRootConfig,
  type PortableProvisioningConfig,
} from '../utils/data-root';
import { logger } from '../utils/logger';
import { getSetting } from '../utils/store';
import {
  syncDefaultProviderToRuntime,
  syncSavedProviderToRuntime,
} from '../services/providers/provider-runtime-sync';

const REMOTE_CONFIG_ENDPOINT_ENV = 'UCLAW_REMOTE_CONFIG_ENDPOINT';
const REMOTE_CONFIG_PACKAGE_ID_ENV = 'UCLAW_REMOTE_CONFIG_PACKAGE_ID';
const REMOTE_CONFIG_PUBLIC_KEY_ID_ENV = 'UCLAW_REMOTE_CONFIG_PUBLIC_KEY_ID';
const REMOTE_CONFIG_TIMEOUT_MS = 15_000;
const REMOTE_CONFIG_CACHE_FILE = 'remote-config-cache.json';
const DEFAULT_COMPANY_SUPPORT_URL = 'https://chatbot.cn.unreachablecity.club/';

export interface RemoteConfigProvider {
  id: 'new-api';
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

export interface RemoteConfigWebSearch {
  enabled: boolean;
  model?: string;
}

export interface RemoteConfigPayload {
  success: boolean;
  configVersion: string;
  provider: RemoteConfigProvider;
  webSearch?: RemoteConfigWebSearch;
  expiresAt?: string;
  message?: string;
}

export interface RemoteConfigSyncResult {
  status: 'skipped' | 'success' | 'warning';
  message: string;
  detail?: string;
  configVersion?: string;
  source?: 'remote' | 'cache';
}

export interface CompanySupportLinkResult {
  success: boolean;
  url: string;
  title: string;
  message: string;
  source: 'remote' | 'fallback';
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function resolveProvisioningConfig(): Promise<PortableProvisioningConfig> {
  const markerProvisioning = getConfiguredPortableDataRootConfig()?.provisioning ?? {};
  const companyKey = await getSetting('companyKey').catch(() => '');
  return {
    endpoint: normalizeString(process.env[REMOTE_CONFIG_ENDPOINT_ENV]) || markerProvisioning.endpoint,
    packageId: normalizeString(process.env[REMOTE_CONFIG_PACKAGE_ID_ENV]) || normalizeString(companyKey) || markerProvisioning.packageId,
    publicKeyId: normalizeString(process.env[REMOTE_CONFIG_PUBLIC_KEY_ID_ENV]) || markerProvisioning.publicKeyId,
  };
}

function getCachePath(dataRoot = getConfiguredDataRoot()): string {
  return join(dataRoot, 'uclaw', REMOTE_CONFIG_CACHE_FILE);
}

function validateRemoteConfig(raw: unknown): RemoteConfigPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('remote config response is not an object');
  }
  const payload = raw as Record<string, unknown>;
  if (payload.success !== true) {
    throw new Error(`remote config rejected request: ${normalizeString(payload.message) || 'unknown reason'}`);
  }
  const provider = payload.provider as Record<string, unknown> | undefined;
  const id = normalizeString(provider?.id) || 'new-api';
  if (id !== 'new-api') {
    throw new Error(`remote config only supports new-api provider: ${id}`);
  }
  const baseUrl = normalizeString(provider?.baseUrl).replace(/\/+$/, '');
  const apiKey = normalizeString(provider?.apiKey);
  const defaultModel = normalizeString(provider?.defaultModel);
  const configVersion = normalizeString(payload.configVersion);
  if (!baseUrl || !apiKey || !defaultModel || !configVersion) {
    throw new Error('remote config response is missing provider/baseUrl/apiKey/defaultModel/configVersion');
  }

  const webSearch = payload.webSearch && typeof payload.webSearch === 'object' && !Array.isArray(payload.webSearch)
    ? payload.webSearch as Record<string, unknown>
    : undefined;

  return {
    success: true,
    configVersion,
    provider: {
      id,
      baseUrl,
      apiKey,
      defaultModel,
    },
    webSearch: webSearch
      ? {
        enabled: webSearch.enabled !== false,
        model: normalizeString(webSearch.model) || undefined,
      }
      : undefined,
    expiresAt: normalizeString(payload.expiresAt) || undefined,
    message: normalizeString(payload.message) || undefined,
  };
}

async function readCachedConfig(cachePath = getCachePath()): Promise<RemoteConfigPayload | null> {
  if (!existsSync(cachePath)) return null;
  const raw = await readFile(cachePath, 'utf8');
  return validateRemoteConfig(JSON.parse(raw));
}

async function writeCachedConfig(config: RemoteConfigPayload, cachePath = getCachePath()): Promise<void> {
  await mkdir(join(getConfiguredDataRoot(), 'uclaw'), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function fetchRemoteConfig(
  provisioning: Required<Pick<PortableProvisioningConfig, 'endpoint' | 'packageId'>>,
  options: { appVersion: string; platform: NodeJS.Platform; currentConfigVersion?: string },
): Promise<RemoteConfigPayload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_CONFIG_TIMEOUT_MS);
  try {
    const response = await fetch(provisioning.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        packageId: provisioning.packageId,
        appVersion: options.appVersion,
        platform: options.platform,
        configVersion: options.currentConfigVersion ?? '',
      }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(`remote config unauthorized: HTTP ${response.status}`);
    }
    if (!response.ok) {
      throw new Error(`remote config unavailable: HTTP ${response.status}`);
    }
    return validateRemoteConfig(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSupportUrl(value: unknown): string {
  const raw = normalizeString(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function parseSupportLinkPayload(raw: unknown): CompanySupportLinkResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const payload = raw as Record<string, unknown>;
  const support = payload.support && typeof payload.support === 'object' && !Array.isArray(payload.support)
    ? payload.support as Record<string, unknown>
    : {};
  const url = normalizeSupportUrl(
    support.url
    ?? support.websiteUrl
    ?? payload.supportUrl
    ?? payload.websiteUrl
    ?? payload.url,
  );
  if (!url) return null;
  return {
    success: true,
    url,
    title: normalizeString(support.title ?? payload.title) || 'UClaw 客服支持',
    message: normalizeString(support.message ?? payload.message) || '请打开官网联系运维支持。',
    source: 'remote',
  };
}

function fallbackSupportLink(): CompanySupportLinkResult {
  return {
    success: true,
    url: DEFAULT_COMPANY_SUPPORT_URL,
    title: 'UClaw 客服支持',
    message: '远程客服入口暂不可用，请通过官网联系运维支持。',
    source: 'fallback',
  };
}

export async function getCompanySupportLink(options: {
  appVersion: string;
  platform?: NodeJS.Platform;
}): Promise<CompanySupportLinkResult> {
  const provisioning = await resolveProvisioningConfig();
  if (!provisioning.endpoint) return fallbackSupportLink();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(provisioning.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestType: 'support-link',
        packageId: provisioning.packageId ?? '',
        appVersion: options.appVersion,
        platform: options.platform ?? process.platform,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`support link request failed: HTTP ${response.status}`);
    }
    const parsed = parseSupportLinkPayload(await response.json());
    return parsed ?? fallbackSupportLink();
  } catch (error) {
    logger.warn('[remote-config] Failed to fetch company support link; using fallback:', error);
    return fallbackSupportLink();
  } finally {
    clearTimeout(timeout);
  }
}

export async function applyRemoteConfig(config: RemoteConfigPayload): Promise<void> {
  const now = new Date().toISOString();
  const providerId = config.provider.id || 'new-api';
  const providerConfig = {
    id: providerId,
    name: providerId === 'new-api' ? 'New API' : providerId,
    type: providerId,
    baseUrl: config.provider.baseUrl,
    apiProtocol: 'openai-completions',
    model: config.provider.defaultModel,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  } as const;
  await saveProvider(providerConfig);
  await storeApiKey(providerId, config.provider.apiKey);
  await setDefaultProvider(providerId);
  await syncSavedProviderToRuntime(providerConfig, config.provider.apiKey);
  await syncDefaultProviderToRuntime(providerId);
  await applyInitialPluginConfig(
    config.provider.apiKey,
    config.provider.baseUrl,
    config.webSearch?.enabled === false ? undefined : config.webSearch?.model,
  );
}

export async function syncRemoteConfig(options: {
  appVersion: string;
  platform?: NodeJS.Platform;
}): Promise<RemoteConfigSyncResult> {
  const provisioning = await resolveProvisioningConfig();
  if (!provisioning.endpoint || !provisioning.packageId) {
    if (!provisioning.endpoint && provisioning.packageId) {
      return {
        status: 'skipped',
        message: '发布包缺少远程配置下发端点，请重新下载完整的 UClaw 发布包。',
        detail: 'REMOTE_CONFIG_ENDPOINT_MISSING',
      };
    }
    return { status: 'skipped', message: '未配置远程配置下发，跳过' };
  }

  const cached = await readCachedConfig().catch((error) => {
    logger.warn('[remote-config] Failed to read cached config:', error);
    return null;
  });

  try {
    const remote = await fetchRemoteConfig(
      { endpoint: provisioning.endpoint, packageId: provisioning.packageId },
      {
        appVersion: options.appVersion,
        platform: options.platform ?? process.platform,
        currentConfigVersion: cached?.configVersion,
      },
    );
    await applyRemoteConfig(remote);
    await writeCachedConfig(remote);
    logger.info(`[remote-config] Synced config version ${remote.configVersion}`);
    return {
      status: 'success',
      source: 'remote',
      configVersion: remote.configVersion,
      message: `远程配置已同步：${remote.configVersion}`,
    };
  } catch (error) {
    if (cached) {
      await applyRemoteConfig(cached);
      logger.warn('[remote-config] Remote sync failed; applied cached config:', error);
      return {
        status: 'warning',
        source: 'cache',
        configVersion: cached.configVersion,
        message: '远程配置暂不可用，已使用上一次缓存配置',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    throw error;
  }
}
