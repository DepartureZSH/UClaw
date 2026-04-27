import { app } from 'electron';
import path from 'path';
import { existsSync, readFileSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

function fsPath(filePath: string): string {
  if (process.platform !== 'win32') return filePath;
  if (!filePath) return filePath;
  if (filePath.startsWith('\\\\?\\')) return filePath;
  const windowsPath = filePath.replace(/\//g, '\\');
  if (!path.win32.isAbsolute(windowsPath)) return windowsPath;
  if (windowsPath.startsWith('\\\\')) {
    return `\\\\?\\UNC\\${windowsPath.slice(2)}`;
  }
  return `\\\\?\\${windowsPath}`;
}
import { getAllSettings } from '../utils/store';
import { getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getProviderEnvVar, getKeyableProviderTypes } from '../utils/provider-registry';
import { getOpenClawDir, getOpenClawEntryPath, isOpenClawPresent, getOpenClawConfigDir } from '../utils/paths';
import { getUvMirrorEnv } from '../utils/uv-env';
import { cleanupDanglingWeChatPluginState, listConfiguredChannelsFromConfig } from '../utils/channel-config';
import { sanitizeOpenClawConfig, batchSyncConfigFields, getOpenClawRuntimeApiKey } from '../utils/openclaw-auth';
import { buildProxyEnv, resolveProxySettings } from '../utils/proxy';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import { logger } from '../utils/logger';
import { prependPathEntry } from '../utils/env-path';
import { copyPluginFromNodeModules, fixupPluginManifest, cpSyncSafe } from '../utils/plugin-install';
import { stripSystemdSupervisorEnv } from './config-sync-env';
import { withConfigLock } from '../utils/config-mutex';
import { ensureProviderStoreMigrated } from '../services/providers/provider-migration';
import { listProviderAccounts } from '../services/providers/provider-store';


export interface GatewayLaunchContext {
  appSettings: Awaited<ReturnType<typeof getAllSettings>>;
  openclawDir: string;
  entryScript: string;
  gatewayArgs: string[];
  forkEnv: Record<string, string | undefined>;
  mode: 'dev' | 'packaged';
  binPathExists: boolean;
  loadedProviderKeyCount: number;
  proxySummary: string;
  channelStartupSummary: string;
}

// ── Auto-upgrade bundled plugins on startup ──────────────────────

const CHANNEL_PLUGIN_MAP: Record<string, { dirName: string; npmName: string }> = {
  dingtalk: { dirName: 'dingtalk', npmName: '@soimy/dingtalk' },
  wecom: { dirName: 'wecom', npmName: '@wecom/wecom-openclaw-plugin' },
  feishu: { dirName: 'feishu-openclaw-plugin', npmName: '@larksuite/openclaw-lark' },

  'openclaw-weixin': { dirName: 'openclaw-weixin', npmName: '@tencent-weixin/openclaw-weixin' },
};

/**
 * OpenClaw 3.22+ ships Discord, Telegram, and other channels as built-in
 * extensions.  If a previous UClaw version copied one of these into
 * ~/.openclaw/extensions/, the broken copy overrides the working built-in
 * plugin and must be removed.
 */
const BUILTIN_CHANNEL_EXTENSIONS = ['discord', 'telegram', 'qqbot'];

function cleanupStaleBuiltInExtensions(): void {
  for (const ext of BUILTIN_CHANNEL_EXTENSIONS) {
    const extDir = join(getOpenClawConfigDir(), 'extensions', ext);
    if (existsSync(fsPath(extDir))) {
      logger.info(`[plugin] Removing stale built-in extension copy: ${ext}`);
      try {
        rmSync(fsPath(extDir), { recursive: true, force: true });
      } catch (err) {
        logger.warn(`[plugin] Failed to remove stale extension ${ext}:`, err);
      }
    }
  }
}

function readPluginVersion(pkgJsonPath: string): string | null {
  try {
    const raw = readFileSync(fsPath(pkgJsonPath), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function readGatewayOpenClawConfig(): Promise<Record<string, unknown>> {
  const configPath = join(getOpenClawConfigDir(), 'openclaw.json');
  try {
    const raw = await readFile(configPath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeGatewayOpenClawConfig(config: Record<string, unknown>): Promise<void> {
  const configDir = getOpenClawConfigDir();
  const configPath = join(configDir, 'openclaw.json');
  await mkdir(configDir, { recursive: true });

  const commands = readObject(config.commands) ?? {};
  commands.restart = true;
  config.commands = commands;

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

export function isKimiWebSearchEnabled(config: Record<string, unknown> | null | undefined): boolean {
  const tools = readObject(config?.tools);
  const web = readObject(tools?.web);
  const search = readObject(web?.search);
  if (search?.provider === 'kimi' && search.enabled !== false) {
    return true;
  }

  const plugins = readObject(config?.plugins);
  const entries = readObject(plugins?.entries);
  const moonshot = readObject(entries?.moonshot);
  if (moonshot?.enabled === false) {
    return false;
  }
  const moonshotConfig = readObject(moonshot?.config);
  const webSearch = readObject(moonshotConfig?.webSearch);
  return Boolean(webSearch && (typeof webSearch.model === 'string' || typeof webSearch.baseUrl === 'string'));
}

export function getDefaultModelProviderKey(config: Record<string, unknown> | null | undefined): string | undefined {
  const agents = readObject(config?.agents);
  const defaults = readObject(agents?.defaults);
  const modelConfig = defaults?.model;
  const model = readObject(modelConfig);
  const primary = typeof modelConfig === 'string'
    ? modelConfig.trim()
    : (typeof model?.primary === 'string' ? model.primary.trim() : '');
  const slashIndex = primary.indexOf('/');
  return slashIndex > 0 ? primary.slice(0, slashIndex) : undefined;
}

function normalizeProviderBaseUrl(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : undefined;
}

function getKimiWebSearchConfig(config: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  const plugins = readObject(config?.plugins);
  const entries = readObject(plugins?.entries);
  const moonshot = readObject(entries?.moonshot);
  const moonshotConfig = readObject(moonshot?.config);
  const webSearch = readObject(moonshotConfig?.webSearch);
  if (webSearch) {
    return webSearch;
  }

  const tools = readObject(config?.tools);
  const web = readObject(tools?.web);
  const search = readObject(web?.search);
  const kimi = readObject(search?.kimi);
  if (kimi) {
    return kimi;
  }
  return search?.provider === 'kimi' ? search : undefined;
}

function shouldClearKimiWebSearchApiKey(value: unknown): boolean {
  if (value == null) {
    return false;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return (
      trimmed.length === 0
      || /^[A-Z][A-Z0-9_]*$/.test(trimmed)
      || /^\$\{[A-Z][A-Z0-9_]*\}$/.test(trimmed)
    );
  }

  const ref = readObject(value);
  if (ref?.source === 'env') {
    return true;
  }

  return false;
}

export function applyKimiWebSearchApiKeyEnvReference(config: Record<string, unknown>): boolean {
  if (!isKimiWebSearchEnabled(config)) {
    return false;
  }

  const plugins = readObject(config.plugins);
  const entries = readObject(plugins?.entries);
  const moonshot = readObject(entries?.moonshot);
  const moonshotConfig = readObject(moonshot?.config);
  const webSearch = readObject(moonshotConfig?.webSearch);

  if (!webSearch || !shouldClearKimiWebSearchApiKey(webSearch.apiKey)) {
    return false;
  }

  delete webSearch.apiKey;
  return true;
}

async function ensureKimiWebSearchApiKeyEnvReference(): Promise<void> {
  await withConfigLock(async () => {
    const config = await readGatewayOpenClawConfig();
    if (!applyKimiWebSearchApiKeyEnvReference(config)) {
      return;
    }
    await writeGatewayOpenClawConfig(config);
    logger.info('[config-sync] Cleared kimi web-search inline credential; Gateway will use KIMI_API_KEY env');
  });
}

export function getKimiWebSearchProviderCandidates(
  config: Record<string, unknown> | null | undefined,
): string[] {
  const candidates: string[] = [];
  const addCandidate = (provider: string | undefined): void => {
    const normalized = provider?.trim();
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  addCandidate(getDefaultModelProviderKey(config));

  const webSearch = getKimiWebSearchConfig(config);
  const webSearchModel = typeof webSearch?.model === 'string' ? webSearch.model.trim() : '';
  const webSearchBaseUrl = normalizeProviderBaseUrl(webSearch?.baseUrl);
  const models = readObject(config?.models);
  const providers = readObject(models?.providers);

  if (providers) {
    for (const [providerKey, providerConfig] of Object.entries(providers)) {
      const provider = readObject(providerConfig);
      if (!provider) continue;

      const providerBaseUrl = normalizeProviderBaseUrl(provider.baseUrl);
      const providerModels = Array.isArray(provider.models) ? provider.models : [];
      const hasWebSearchModel = Boolean(webSearchModel && providerModels.some((model) => {
        const modelId = typeof (model as Record<string, unknown>)?.id === 'string'
          ? ((model as Record<string, unknown>).id as string).trim()
          : '';
        return modelId === webSearchModel || `${providerKey}/${modelId}` === webSearchModel;
      }));

      if (
        (webSearchBaseUrl && providerBaseUrl === webSearchBaseUrl)
        || hasWebSearchModel
      ) {
        addCandidate(providerKey);
      }
    }

    // Reused workspaces may only have the provider key in auth-profiles.json,
    // while webSearch stores a bare model/baseUrl. Keep this as a last resort
    // so Kimi search can reuse an existing OpenAI-compatible provider key.
    for (const providerKey of Object.keys(providers)) {
      if (providerKey !== 'moonshot') {
        addCandidate(providerKey);
      }
    }
    addCandidate('moonshot');
  }

  return candidates;
}

export async function resolveKimiWebSearchApiKeyAlias(
  providerEnv: Record<string, string>,
  config: Record<string, unknown> | null | undefined,
): Promise<string | undefined> {
  const existingKey = providerEnv.KIMI_API_KEY || providerEnv.MOONSHOT_API_KEY;
  if (existingKey) {
    return undefined;
  }
  if (!isKimiWebSearchEnabled(config)) {
    return undefined;
  }

  const envKey = Object.values(providerEnv).find(Boolean);
  if (envKey) {
    return envKey;
  }

  const providerCandidates = getKimiWebSearchProviderCandidates(config);
  if (providerCandidates.length === 0) {
    return undefined;
  }

  return await getOpenClawRuntimeApiKey(providerCandidates) ?? undefined;
}

export interface KimiWebSearchStatus {
  enabled: boolean;
  hasApiKey: boolean;
  ok: boolean;
  providerCandidates: string[];
  message: string;
}

function hasExplicitKimiWebSearchApiKey(config: Record<string, unknown> | null | undefined): boolean {
  const webSearch = getKimiWebSearchConfig(config);
  const apiKey = webSearch?.apiKey;
  if (typeof apiKey === 'string') {
    return !shouldClearKimiWebSearchApiKey(apiKey);
  }

  const apiKeyRef = readObject(apiKey);
  return Boolean(apiKeyRef && apiKeyRef.source !== 'env');
}

export async function getKimiWebSearchStatus(): Promise<KimiWebSearchStatus> {
  const config = await readGatewayOpenClawConfig();
  if (!isKimiWebSearchEnabled(config)) {
    return {
      enabled: false,
      hasApiKey: false,
      ok: true,
      providerCandidates: [],
      message: 'Kimi web search is not enabled',
    };
  }

  const providerCandidates = getKimiWebSearchProviderCandidates(config);
  if (hasExplicitKimiWebSearchApiKey(config)) {
    return {
      enabled: true,
      hasApiKey: true,
      ok: true,
      providerCandidates,
      message: 'Kimi web search has an explicit API key',
    };
  }

  const { providerEnv } = await loadProviderEnv();
  const hasApiKey = Boolean(providerEnv.KIMI_API_KEY || providerEnv.MOONSHOT_API_KEY);
  return {
    enabled: true,
    hasApiKey,
    ok: hasApiKey,
    providerCandidates,
    message: hasApiKey
      ? 'Kimi web search can resolve an API key'
      : 'Kimi web search is enabled but no compatible API key was found',
  };
}

function buildBundledPluginSources(pluginDirName: string): string[] {
  return app.isPackaged
    ? [
      join(process.resourcesPath, 'openclaw-plugins', pluginDirName),
      join(process.resourcesPath, 'app.asar.unpacked', 'build', 'openclaw-plugins', pluginDirName),
      join(process.resourcesPath, 'app.asar.unpacked', 'openclaw-plugins', pluginDirName),
    ]
    : [
      join(app.getAppPath(), 'build', 'openclaw-plugins', pluginDirName),
      join(process.cwd(), 'build', 'openclaw-plugins', pluginDirName),
    ];
}

/**
 * Auto-upgrade all configured channel plugins before Gateway start.
 * - Packaged mode: uses bundled plugins from resources/ (includes deps)
 * - Dev mode: falls back to node_modules/ with pnpm-aware dep collection
 */
function ensureConfiguredPluginsUpgraded(configuredChannels: string[]): void {
  for (const channelType of configuredChannels) {
    const pluginInfo = CHANNEL_PLUGIN_MAP[channelType];
    if (!pluginInfo) continue;
    const { dirName, npmName } = pluginInfo;

    const targetDir = join(getOpenClawConfigDir(), 'extensions', dirName);
    const targetManifest = join(targetDir, 'openclaw.plugin.json');
    const isInstalled = existsSync(fsPath(targetManifest));
    const installedVersion = isInstalled ? readPluginVersion(join(targetDir, 'package.json')) : null;

    // Try bundled sources first (packaged mode or if bundle-plugins was run)
    const bundledSources = buildBundledPluginSources(dirName);
    const bundledDir = bundledSources.find((dir) => existsSync(fsPath(join(dir, 'openclaw.plugin.json'))));

    if (bundledDir) {
      const sourceVersion = readPluginVersion(join(bundledDir, 'package.json'));
      // Install or upgrade if version differs or plugin not installed
      if (!isInstalled || (sourceVersion && installedVersion && sourceVersion !== installedVersion)) {
        logger.info(`[plugin] ${isInstalled ? 'Auto-upgrading' : 'Installing'} ${channelType} plugin${isInstalled ? `: ${installedVersion} → ${sourceVersion}` : `: ${sourceVersion}`} (bundled)`);
        try {
          mkdirSync(fsPath(join(getOpenClawConfigDir(), 'extensions')), { recursive: true });
          rmSync(fsPath(targetDir), { recursive: true, force: true });
          cpSyncSafe(bundledDir, targetDir);
          fixupPluginManifest(targetDir);
        } catch (err) {
          logger.warn(`[plugin] Failed to ${isInstalled ? 'auto-upgrade' : 'install'} ${channelType} plugin:`, err);
        }
      } else if (isInstalled) {
        // Same version already installed — still patch manifest ID in case it was
        // never corrected (e.g. installed before MANIFEST_ID_FIXES included this plugin).
        fixupPluginManifest(targetDir);
      }
      continue;
    }

    // Dev mode fallback: copy from node_modules/ with pnpm dep resolution
    if (!app.isPackaged) {
      const npmPkgPath = join(process.cwd(), 'node_modules', ...npmName.split('/'));
      if (!existsSync(fsPath(join(npmPkgPath, 'openclaw.plugin.json')))) continue;
      const sourceVersion = readPluginVersion(join(npmPkgPath, 'package.json'));
      if (!sourceVersion) continue;
      // Skip only if installed AND same version — but still patch manifest ID.
      if (isInstalled && installedVersion && sourceVersion === installedVersion) {
        fixupPluginManifest(targetDir);
        continue;
      }

      logger.info(`[plugin] ${isInstalled ? 'Auto-upgrading' : 'Installing'} ${channelType} plugin${isInstalled ? `: ${installedVersion} → ${sourceVersion}` : `: ${sourceVersion}`} (dev/node_modules)`);

      try {
        mkdirSync(fsPath(join(getOpenClawConfigDir(), 'extensions')), { recursive: true });
        copyPluginFromNodeModules(npmPkgPath, targetDir, npmName);
        fixupPluginManifest(targetDir);
      } catch (err) {
        logger.warn(`[plugin] Failed to ${isInstalled ? 'auto-upgrade' : 'install'} ${channelType} plugin from node_modules:`, err);
      }
    }
  }
}

/**
 * Ensure extension-specific packages are resolvable from shared dist/ chunks.
 *
 * OpenClaw's Rollup bundler creates shared chunks in dist/ (e.g.
 * sticker-cache-*.js) that eagerly `import "grammy"`.  ESM bare specifier
 * resolution walks from the importing file's directory upward:
 *   dist/node_modules/ → openclaw/node_modules/ → …
 * It does NOT search `dist/extensions/telegram/node_modules/`.
 *
 * NODE_PATH only works for CJS require(), NOT for ESM import statements.
 *
 * Fix: create symlinks in openclaw/node_modules/ pointing to packages in
 * dist/extensions/<ext>/node_modules/.  This makes the standard ESM
 * resolution algorithm find them.  Skip-if-exists avoids overwriting
 * openclaw's own deps (they take priority).
 */
let _extensionDepsLinked = false;

/**
 * Reset the extension-deps-linked cache so the next
 * ensureExtensionDepsResolvable() call re-scans and links.
 * Called before each Gateway launch to pick up newly installed extensions.
 */
export function resetExtensionDepsLinked(): void {
  _extensionDepsLinked = false;
}

function ensureExtensionDepsResolvable(openclawDir: string): void {
  if (_extensionDepsLinked) return;

  const extDir = join(openclawDir, 'dist', 'extensions');
  const topNM = join(openclawDir, 'node_modules');
  let linkedCount = 0;

  try {
    if (!existsSync(extDir)) return;

    for (const ext of readdirSync(extDir, { withFileTypes: true })) {
      if (!ext.isDirectory()) continue;
      const extNM = join(extDir, ext.name, 'node_modules');
      if (!existsSync(extNM)) continue;

      for (const pkg of readdirSync(extNM, { withFileTypes: true })) {
        if (pkg.name === '.bin') continue;

        if (pkg.name.startsWith('@')) {
          // Scoped package — iterate sub-entries
          const scopeDir = join(extNM, pkg.name);
          let scopeEntries;
          try { scopeEntries = readdirSync(scopeDir, { withFileTypes: true }); } catch { continue; }
          for (const sub of scopeEntries) {
            if (!sub.isDirectory()) continue;
            const dest = join(topNM, pkg.name, sub.name);
            if (existsSync(dest)) continue;
            try {
              mkdirSync(join(topNM, pkg.name), { recursive: true });
              symlinkSync(join(scopeDir, sub.name), dest);
              linkedCount++;
            } catch { /* skip on error — non-fatal */ }
          }
        } else {
          const dest = join(topNM, pkg.name);
          if (existsSync(dest)) continue;
          try {
            mkdirSync(topNM, { recursive: true });
            symlinkSync(join(extNM, pkg.name), dest);
            linkedCount++;
          } catch { /* skip on error — non-fatal */ }
        }
      }
    }
  } catch {
    // extensions dir may not exist or be unreadable — non-fatal
  }

  if (linkedCount > 0) {
    logger.info(`[extension-deps] Linked ${linkedCount} extension packages into ${topNM}`);
  }

  _extensionDepsLinked = true;
}

// ── Pre-launch sync ──────────────────────────────────────────────

export async function syncGatewayConfigBeforeLaunch(
  appSettings: Awaited<ReturnType<typeof getAllSettings>>,
): Promise<void> {
  // Reset the extension-deps cache so that newly installed extensions
  // (e.g. user added a channel while the app was running) get their
  // node_modules linked on the next Gateway spawn.
  resetExtensionDepsLinked();

  await syncProxyConfigToOpenClaw(appSettings, { preserveExistingWhenDisabled: true });

  try {
    await sanitizeOpenClawConfig();
  } catch (err) {
    logger.warn('Failed to sanitize openclaw.json:', err);
  }

  try {
    await cleanupDanglingWeChatPluginState();
  } catch (err) {
    logger.warn('Failed to clean dangling WeChat plugin state before launch:', err);
  }

  // Remove stale copies of built-in extensions (Discord, Telegram) that
  // override OpenClaw's working built-in plugins and break channel loading.
  try {
    cleanupStaleBuiltInExtensions();
  } catch (err) {
    logger.warn('Failed to clean stale built-in extensions:', err);
  }

  // Lazily install/upgrade channel plugins only when a real channel config
  // exists.  A broad plugins.allow list alone should not slow first launch.
  try {
    const rawCfg = await readGatewayOpenClawConfig();
    const configuredChannels = await listConfiguredChannelsFromConfig(rawCfg);

    ensureConfiguredPluginsUpgraded(configuredChannels);
  } catch (err) {
    logger.warn('Failed to auto-upgrade plugins:', err);
  }

  // Batch gateway token, browser config, and session idle into one read+write cycle.
  try {
    await batchSyncConfigFields(appSettings.gatewayToken);
  } catch (err) {
    logger.warn('Failed to batch-sync config fields to openclaw.json:', err);
  }
}

async function loadProviderEnv(): Promise<{ providerEnv: Record<string, string>; loadedProviderKeyCount: number }> {
  const providerEnv: Record<string, string> = {};
  const providerTypes = getKeyableProviderTypes();
  let loadedProviderKeyCount = 0;

  const setProviderEnvKey = (providerType: string | undefined, key: string | null | undefined): boolean => {
    if (!providerType || !key) {
      return false;
    }
    const envVar = getProviderEnvVar(providerType);
    if (!envVar || providerEnv[envVar]) {
      return false;
    }
    providerEnv[envVar] = key;
    loadedProviderKeyCount++;
    return true;
  };

  try {
    const defaultProviderId = await getDefaultProvider();
    if (defaultProviderId) {
      const defaultProvider = await getProvider(defaultProviderId);
      const defaultProviderType = defaultProvider?.type;
      const defaultProviderKey = await getApiKey(defaultProviderId);
      setProviderEnvKey(defaultProviderType, defaultProviderKey);
    }
  } catch (err) {
    logger.warn('Failed to load default provider key for environment injection:', err);
  }

  for (const providerType of providerTypes) {
    try {
      const key = await getApiKey(providerType);
      setProviderEnvKey(providerType, key);
    } catch (err) {
      logger.warn(`Failed to load API key for ${providerType}:`, err);
    }
  }

  try {
    await ensureProviderStoreMigrated();
    const accounts = await listProviderAccounts();
    for (const account of accounts) {
      try {
        const key = await getApiKey(account.id);
        setProviderEnvKey(account.vendorId, key);
      } catch (err) {
        logger.warn(`Failed to load API key for provider account ${account.id}:`, err);
      }
    }
  } catch (err) {
    logger.warn('Failed to load provider account keys for environment injection:', err);
  }

  // The moonshot web-search plugin resolves its API key from the env vars
  // KIMI_API_KEY or MOONSHOT_API_KEY (in that order).  When the active provider
  // is a compatible endpoint like `new-api` its secret is stored under a
  // different env var name (e.g. NEW_API_KEY).  If kimi web-search is enabled
  // and KIMI_API_KEY is not yet in the env map, inject an alias so the plugin
  // can find the key without requiring an inline apiKey in openclaw.json.
  try {
    const rawCfg = await readGatewayOpenClawConfig();
    if (isKimiWebSearchEnabled(rawCfg)) {
      await ensureKimiWebSearchApiKeyEnvReference();
    }
    const kimiKey = await resolveKimiWebSearchApiKeyAlias(providerEnv, rawCfg);
    if (kimiKey) {
      providerEnv['KIMI_API_KEY'] = kimiKey;
      logger.info('[config-sync] Aliased KIMI_API_KEY from compatible provider for kimi web-search');
    }
  } catch (err) {
    logger.warn('[config-sync] Failed to inject KIMI_API_KEY alias:', err);
  }

  return { providerEnv, loadedProviderKeyCount };
}

async function resolveChannelStartupPolicy(): Promise<{
  skipChannels: boolean;
  channelStartupSummary: string;
}> {
  try {
    const rawCfg = await readGatewayOpenClawConfig();
    const configuredChannels = await listConfiguredChannelsFromConfig(rawCfg);
    if (configuredChannels.length === 0) {
      return {
        skipChannels: true,
        channelStartupSummary: 'skipped(no configured channels)',
      };
    }

    return {
      skipChannels: false,
      channelStartupSummary: `enabled(${configuredChannels.join(',')})`,
    };
  } catch (error) {
    logger.warn('Failed to determine configured channels for gateway launch:', error);
    return {
      skipChannels: false,
      channelStartupSummary: 'enabled(unknown)',
    };
  }
}

export async function prepareGatewayLaunchContext(port: number): Promise<GatewayLaunchContext> {
  const openclawDir = getOpenClawDir();
  const entryScript = getOpenClawEntryPath();

  if (!isOpenClawPresent()) {
    throw new Error(`OpenClaw package not found at: ${openclawDir}`);
  }

  const appSettings = await getAllSettings();
  await syncGatewayConfigBeforeLaunch(appSettings);

  if (!existsSync(entryScript)) {
    throw new Error(`OpenClaw entry script not found at: ${entryScript}`);
  }

  const gatewayArgs = ['gateway', '--port', String(port), '--token', appSettings.gatewayToken, '--allow-unconfigured'];
  const mode = app.isPackaged ? 'packaged' : 'dev';

  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binPath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(process.cwd(), 'resources', 'bin', target);
  const binPathExists = existsSync(binPath);

  const { providerEnv, loadedProviderKeyCount } = await loadProviderEnv();

  const { skipChannels, channelStartupSummary } = await resolveChannelStartupPolicy();
  const uvEnv = await getUvMirrorEnv();
  const proxyEnv = buildProxyEnv(appSettings);
  const resolvedProxy = resolveProxySettings(appSettings);
  const proxySummary = appSettings.proxyEnabled
    ? `http=${resolvedProxy.httpProxy || '-'}, https=${resolvedProxy.httpsProxy || '-'}, all=${resolvedProxy.allProxy || '-'}`
    : 'disabled';

  const { NODE_OPTIONS: _nodeOptions, ...baseEnv } = process.env;
  const baseEnvRecord = baseEnv as Record<string, string | undefined>;
  const baseEnvPatched = binPathExists
    ? prependPathEntry(baseEnvRecord, binPath).env
    : baseEnvRecord;
  const forkEnv: Record<string, string | undefined> = {
    ...stripSystemdSupervisorEnv(baseEnvPatched),
    ...providerEnv,
    ...uvEnv,
    ...proxyEnv,
    OPENCLAW_GATEWAY_TOKEN: appSettings.gatewayToken,
    OPENCLAW_SKIP_CHANNELS: skipChannels ? '1' : '',
    CLAWDBOT_SKIP_CHANNELS: skipChannels ? '1' : '',
    OPENCLAW_NO_RESPAWN: '1',
    // Force Python subprocess to use UTF-8 for stdout/stderr on all platforms
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    // Expose the active provider API key as KIMI_API_KEY so the moonshot plugin's
    // web-search provider falls back to it via readProviderEnvValue(["KIMI_API_KEY",
    // "MOONSHOT_API_KEY"]) without needing to store any secret in openclaw.json.
    ...(providerEnv['NEW_API_KEY'] && !providerEnv['KIMI_API_KEY'] ? { KIMI_API_KEY: providerEnv['NEW_API_KEY'] } : {}),
  };

  // Set OPENCLAW_HOME so the gateway resolves all paths to the correct location.
  // Explicit workspace dir takes priority over portable-mode auto-detection.
  const workspaceDir = process.env.UCLAW_WORKSPACE_DIR?.trim();
  const portableRoot = process.env.UCLAW_PORTABLE_ROOT?.trim();
  if (workspaceDir) {
    forkEnv.OPENCLAW_HOME = workspaceDir;
  } else if (portableRoot) {
    forkEnv.OPENCLAW_HOME = portableRoot;
  }

  // Ensure extension-specific packages (e.g. grammy from the telegram
  // extension) are resolvable by shared dist/ chunks via symlinks in
  // openclaw/node_modules/.  NODE_PATH does NOT work for ESM imports.
  ensureExtensionDepsResolvable(openclawDir);

  return {
    appSettings,
    openclawDir,
    entryScript,
    gatewayArgs,
    forkEnv,
    mode,
    binPathExists,
    loadedProviderKeyCount,
    proxySummary,
    channelStartupSummary,
  };
}
