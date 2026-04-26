import type { IncomingMessage, ServerResponse } from 'http';
import {
  type ProviderConfig,
  getApiKey,
} from '../../utils/secure-storage';
import {
  getProviderConfig,
} from '../../utils/provider-registry';
import { deviceOAuthManager, type OAuthProviderType } from '../../utils/device-oauth';
import { browserOAuthManager, type BrowserOAuthProviderType } from '../../utils/browser-oauth';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  syncDefaultProviderToRuntime,
  syncDeletedProviderApiKeyToRuntime,
  syncDeletedProviderToRuntime,
  syncProviderApiKeyToRuntime,
  syncSavedProviderToRuntime,
  syncUpdatedProviderToRuntime,
} from '../../services/providers/provider-runtime-sync';
import { validateApiKeyWithProvider } from '../../services/providers/provider-validation';
import { getProviderService } from '../../services/providers/provider-service';
import { providerAccountToConfig } from '../../services/providers/provider-store';
import type { ProviderAccount } from '../../shared/providers/types';
import { logger } from '../../utils/logger';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import {
  getOpenClawRuntimeApiKey,
  getOpenClawRuntimeModelIds,
  patchProviderModelCosts,
} from '../../utils/openclaw-auth';
import { parsePricingResponse } from '../../utils/new-api-pricing';
import { getOpenClawProviderKeyForType } from '../../utils/provider-keys';

const legacyProviderRoutesWarned = new Set<string>();

function hasObjectChanges<T extends Record<string, unknown>>(
  existing: T,
  patch: Partial<T> | undefined,
): boolean {
  if (!patch) return false;
  const keys = Object.keys(patch) as Array<keyof T>;
  if (keys.length === 0) return false;
  return keys.some((key) => JSON.stringify(existing[key]) !== JSON.stringify(patch[key]));
}

export async function handleProviderRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  const providerService = getProviderService();
  const logLegacyProviderRoute = (route: string): void => {
    if (legacyProviderRoutesWarned.has(route)) return;
    legacyProviderRoutesWarned.add(route);
    logger.warn(
      `[provider-migration] Legacy HTTP route "${route}" is deprecated. Prefer /api/provider-accounts endpoints.`,
    );
  };

  if (url.pathname === '/api/provider-vendors' && req.method === 'GET') {
    sendJson(res, 200, await providerService.listVendors());
    return true;
  }

  if (url.pathname === '/api/provider-accounts' && req.method === 'GET') {
    sendJson(res, 200, await providerService.listAccounts());
    return true;
  }

  if (url.pathname === '/api/provider-accounts' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ account: ProviderAccount; apiKey?: string }>(req);
      const account = await providerService.createAccount(body.account, body.apiKey);
      await syncSavedProviderToRuntime(providerAccountToConfig(account), body.apiKey, ctx.gatewayManager);
      sendJson(res, 200, { success: true, account });
      // Async: fetch and persist model pricing for new-api accounts
      if (account.vendorId === 'new-api' && body.apiKey) {
        const baseUrl = (account.baseUrl || 'https://chatbot.cn.unreachablecity.club/v1').replace(/\/$/, '');
        const pricingBase = typeof account.metadata?.pricingBase === 'number' ? account.metadata.pricingBase : undefined;
        fetchModelsWithPricing(baseUrl, body.apiKey, pricingBase).then(({ pricing }) => {
          if (Object.keys(pricing).length > 0) {
            return patchProviderModelCosts('new-api', pricing);
          }
        }).catch((err) => logger.warn('Failed to auto-sync new-api pricing after create:', err));
      }
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/provider-accounts/default' && req.method === 'GET') {
    sendJson(res, 200, { accountId: await providerService.getDefaultAccountId() ?? null });
    return true;
  }

  if (url.pathname === '/api/provider-accounts/default' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ accountId: string }>(req);
      const currentDefault = await providerService.getDefaultAccountId();
      if (currentDefault === body.accountId) {
        sendJson(res, 200, { success: true, noChange: true });
        return true;
      }
      await providerService.setDefaultAccount(body.accountId);
      await syncDefaultProviderToRuntime(body.accountId, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // Shared helper: fetch models + pricing from a new-api compatible endpoint.
  // Runs in the main process so it is not subject to browser CORS restrictions.
  // pricingBase: USD per million tokens when model_ratio=1 (default 2 = standard new-api).
  async function fetchModelsWithPricing(
    baseUrl: string,
    apiKey: string,
    pricingBase?: number,
  ): Promise<{
    models: string[];
    pricing: Record<string, { input: number; output: number }>;
  }> {
    const apiRoot = baseUrl.replace(/\/v1$/, '');
    const authHeaders = { Authorization: `Bearer ${apiKey}` };
    let models: string[] = [];
    let pricing: Record<string, { input: number; output: number }> = {};

    try {
      const pricingRes = await proxyAwareFetch(`${apiRoot}/api/pricing`, { headers: authHeaders });
      if (pricingRes.ok) {
        const pricingJson = await pricingRes.json();
        const parsed = parsePricingResponse(pricingJson, pricingBase);
        models = parsed.models;
        pricing = parsed.pricing;
      }
    } catch { /* pricing endpoint not available */ }

    if (models.length === 0) {
      const modelsRes = await proxyAwareFetch(`${baseUrl}/models`, { headers: authHeaders });
      if (!modelsRes.ok) throw new Error(`Upstream HTTP ${modelsRes.status}`);
      const json = await modelsRes.json() as { data?: { id: string }[] };
      models = (json.data ?? []).map((m) => m.id).filter(Boolean);
    }

    return { models, pricing };
  }

  function normalizeConfiguredModelId(model: string | undefined, providerKeys: string[]): string | undefined {
    const trimmed = model?.trim();
    if (!trimmed) {
      return undefined;
    }
    for (const providerKey of providerKeys) {
      const prefix = `${providerKey}/`;
      if (trimmed.startsWith(prefix)) {
        return trimmed.slice(prefix.length);
      }
    }
    return trimmed;
  }

  function mergeModelIds(...groups: Array<Array<string | undefined>>): string[] {
    const models: string[] = [];
    for (const group of groups) {
      for (const model of group) {
        const trimmed = model?.trim();
        if (trimmed && !models.includes(trimmed)) {
          models.push(trimmed);
        }
      }
    }
    return models;
  }

  // POST /api/fetch-models — proxy for renderer: no CORS, accepts {baseUrl, apiKey} in body.
  if (url.pathname === '/api/fetch-models' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ baseUrl: string; apiKey: string }>(req);
      const baseUrl = (body.baseUrl || '').replace(/\/$/, '');
      if (!baseUrl || !body.apiKey) {
        sendJson(res, 400, { success: false, error: 'baseUrl and apiKey are required' });
        return true;
      }
      const result = await fetchModelsWithPricing(baseUrl, body.apiKey);
      sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && url.pathname.endsWith('/models') && req.method === 'GET') {
    const inner = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length, -'/models'.length));
    const accountId = inner.replace(/\/$/, '');
    try {
      const account = await providerService.getAccount(accountId);
      if (!account) {
        sendJson(res, 404, { success: false, error: 'Account not found' });
        return true;
      }
      const runtimeProviderKey = getOpenClawProviderKeyForType(account.vendorId, account.id);
      const providerCandidates = [runtimeProviderKey, account.id, account.vendorId];
      const apiKey = await getApiKey(accountId)
        || await getOpenClawRuntimeApiKey(providerCandidates);
      if (!apiKey) {
        sendJson(res, 400, { success: false, error: 'No API key stored for this account' });
        return true;
      }
      const baseUrl = (account.baseUrl || 'https://chatbot.cn.unreachablecity.club/v1').replace(/\/$/, '');
      const pricingBase = typeof account.metadata?.pricingBase === 'number' ? account.metadata.pricingBase : undefined;
      const configuredModels = await getOpenClawRuntimeModelIds(providerCandidates);
      const accountModels = mergeModelIds([
        normalizeConfiguredModelId(account.model, providerCandidates),
        ...((account.fallbackModels ?? []).map((model) => normalizeConfiguredModelId(model, providerCandidates))),
      ]);
      let result: Awaited<ReturnType<typeof fetchModelsWithPricing>>;
      try {
        result = await fetchModelsWithPricing(baseUrl, apiKey, pricingBase);
      } catch (error) {
        const fallbackModels = mergeModelIds(configuredModels, accountModels);
        if (fallbackModels.length === 0) {
          throw error;
        }
        result = { models: fallbackModels, pricing: {} };
      }
      result.models = mergeModelIds(result.models, configuredModels, accountModels);
      sendJson(res, 200, { success: true, ...result });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'GET') {
    const accountId = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    sendJson(res, 200, await providerService.getAccount(accountId));
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'PUT') {
    const accountId = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    try {
      const body = await parseJsonBody<{ updates: Partial<ProviderAccount>; apiKey?: string }>(req);
      const existing = await providerService.getAccount(accountId);
      if (!existing) {
        sendJson(res, 404, { success: false, error: 'Provider account not found' });
        return true;
      }
      const hasPatchChanges = hasObjectChanges(existing as unknown as Record<string, unknown>, body.updates);
      if (!hasPatchChanges && body.apiKey === undefined) {
        sendJson(res, 200, { success: true, noChange: true, account: existing });
        return true;
      }
      const nextAccount = await providerService.updateAccount(accountId, body.updates, body.apiKey);
      await syncUpdatedProviderToRuntime(providerAccountToConfig(nextAccount), body.apiKey, ctx.gatewayManager);
      sendJson(res, 200, { success: true, account: nextAccount });
      // Async: re-fetch pricing when api key or baseUrl changed for new-api accounts
      if (nextAccount.vendorId === 'new-api' && (body.apiKey || body.updates?.baseUrl !== undefined)) {
        const apiKeyForPricing = body.apiKey ?? await getApiKey(accountId).catch(() => null);
        if (apiKeyForPricing) {
          const baseUrl = (nextAccount.baseUrl || 'https://chatbot.cn.unreachablecity.club/v1').replace(/\/$/, '');
          const pricingBase = typeof nextAccount.metadata?.pricingBase === 'number' ? nextAccount.metadata.pricingBase : undefined;
          fetchModelsWithPricing(baseUrl, apiKeyForPricing, pricingBase).then(({ pricing }) => {
            if (Object.keys(pricing).length > 0) {
              return patchProviderModelCosts('new-api', pricing);
            }
          }).catch((err) => logger.warn('Failed to auto-sync new-api pricing after update:', err));
        }
      }
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/provider-accounts/') && req.method === 'DELETE') {
    const accountId = decodeURIComponent(url.pathname.slice('/api/provider-accounts/'.length));
    try {
      const existing = await providerService.getAccount(accountId);
      const runtimeProviderKey = existing?.authMode === 'oauth_browser'
        ? (existing.vendorId === 'google'
          ? 'google-gemini-cli'
          : (existing.vendorId === 'openai' ? 'openai-codex' : undefined))
        : undefined;
      if (url.searchParams.get('apiKeyOnly') === '1') {
        await providerService.deleteLegacyProviderApiKey(accountId);
        await syncDeletedProviderApiKeyToRuntime(
          existing ? providerAccountToConfig(existing) : null,
          accountId,
          runtimeProviderKey,
        );
        sendJson(res, 200, { success: true });
        return true;
      }
      await providerService.deleteAccount(accountId);
      await syncDeletedProviderToRuntime(
        existing ? providerAccountToConfig(existing) : null,
        accountId,
        ctx.gatewayManager,
        runtimeProviderKey,
      );
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers' && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers');
    sendJson(res, 200, await providerService.listLegacyProvidersWithKeyInfo());
    return true;
  }

  if (url.pathname === '/api/providers/default' && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers/default');
    sendJson(res, 200, { providerId: await providerService.getDefaultLegacyProvider() ?? null });
    return true;
  }

  if (url.pathname === '/api/providers/default' && req.method === 'PUT') {
    logLegacyProviderRoute('PUT /api/providers/default');
    try {
      const body = await parseJsonBody<{ providerId: string }>(req);
      const currentDefault = await providerService.getDefaultLegacyProvider();
      if (currentDefault === body.providerId) {
        sendJson(res, 200, { success: true, noChange: true });
        return true;
      }
      await providerService.setDefaultLegacyProvider(body.providerId);
      await syncDefaultProviderToRuntime(body.providerId, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/validate' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/validate');
    try {
      const body = await parseJsonBody<{ providerId: string; apiKey: string; options?: { baseUrl?: string; apiProtocol?: string } }>(req);
      const provider = await providerService.getLegacyProvider(body.providerId);
      const providerType = provider?.type || body.providerId;
      const registryBaseUrl = getProviderConfig(providerType)?.baseUrl;
      const resolvedBaseUrl = body.options?.baseUrl || provider?.baseUrl || registryBaseUrl;
      const resolvedProtocol = body.options?.apiProtocol || provider?.apiProtocol;
      sendJson(res, 200, await validateApiKeyWithProvider(providerType, body.apiKey, { baseUrl: resolvedBaseUrl, apiProtocol: resolvedProtocol }));
    } catch (error) {
      sendJson(res, 500, { valid: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/oauth/start' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/oauth/start');
    try {
      const body = await parseJsonBody<{
        provider: OAuthProviderType | BrowserOAuthProviderType;
        region?: 'global' | 'cn';
        accountId?: string;
        label?: string;
      }>(req);
      if (body.provider === 'google' || body.provider === 'openai') {
        await browserOAuthManager.startFlow(body.provider, {
          accountId: body.accountId,
          label: body.label,
        });
      } else {
        await deviceOAuthManager.startFlow(body.provider, body.region, {
          accountId: body.accountId,
          label: body.label,
        });
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/oauth/cancel' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/oauth/cancel');
    try {
      await deviceOAuthManager.stopFlow();
      await browserOAuthManager.stopFlow();
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers/oauth/submit' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers/oauth/submit');
    try {
      const body = await parseJsonBody<{ code: string }>(req);
      const accepted = browserOAuthManager.submitManualCode(body.code || '');
      if (!accepted) {
        sendJson(res, 400, { success: false, error: 'No active manual OAuth input pending' });
        return true;
      }
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/providers' && req.method === 'POST') {
    logLegacyProviderRoute('POST /api/providers');
    try {
      const body = await parseJsonBody<{ config: ProviderConfig; apiKey?: string }>(req);
      const config = body.config;
      await providerService.saveLegacyProvider(config);
      if (body.apiKey !== undefined) {
        const trimmedKey = body.apiKey.trim();
        if (trimmedKey) {
          await providerService.setLegacyProviderApiKey(config.id, trimmedKey);
          await syncProviderApiKeyToRuntime(config.type, config.id, trimmedKey);
        }
      }
      await syncSavedProviderToRuntime(config, body.apiKey, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'GET') {
    logLegacyProviderRoute('GET /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    if (providerId.endsWith('/api-key')) {
      const actualId = providerId.slice(0, -('/api-key'.length));
      sendJson(res, 200, { apiKey: await providerService.getLegacyProviderApiKey(actualId) });
      return true;
    }
    if (providerId.endsWith('/has-api-key')) {
      const actualId = providerId.slice(0, -('/has-api-key'.length));
      sendJson(res, 200, { hasKey: await providerService.hasLegacyProviderApiKey(actualId) });
      return true;
    }
    sendJson(res, 200, await providerService.getLegacyProvider(providerId));
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'PUT') {
    logLegacyProviderRoute('PUT /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    try {
      const body = await parseJsonBody<{ updates: Partial<ProviderConfig>; apiKey?: string }>(req);
      const existing = await providerService.getLegacyProvider(providerId);
      if (!existing) {
        sendJson(res, 404, { success: false, error: 'Provider not found' });
        return true;
      }
      const hasPatchChanges = hasObjectChanges(existing as unknown as Record<string, unknown>, body.updates);
      if (!hasPatchChanges && body.apiKey === undefined) {
        sendJson(res, 200, { success: true, noChange: true });
        return true;
      }
      const nextConfig: ProviderConfig = { ...existing, ...body.updates, updatedAt: new Date().toISOString() };
      await providerService.saveLegacyProvider(nextConfig);
      if (body.apiKey !== undefined) {
        const trimmedKey = body.apiKey.trim();
        if (trimmedKey) {
          await providerService.setLegacyProviderApiKey(providerId, trimmedKey);
          await syncProviderApiKeyToRuntime(nextConfig.type, providerId, trimmedKey);
        } else {
          await providerService.deleteLegacyProviderApiKey(providerId);
          await syncDeletedProviderApiKeyToRuntime(existing, providerId);
        }
      }
      await syncUpdatedProviderToRuntime(nextConfig, body.apiKey, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/providers/') && req.method === 'DELETE') {
    logLegacyProviderRoute('DELETE /api/providers/:id');
    const providerId = decodeURIComponent(url.pathname.slice('/api/providers/'.length));
    try {
      const existing = await providerService.getLegacyProvider(providerId);
      if (url.searchParams.get('apiKeyOnly') === '1') {
        await providerService.deleteLegacyProviderApiKey(providerId);
        await syncDeletedProviderApiKeyToRuntime(existing, providerId);
        sendJson(res, 200, { success: true });
        return true;
      }
      await providerService.deleteLegacyProvider(providerId);
      await syncDeletedProviderToRuntime(existing, providerId, ctx.gatewayManager);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
