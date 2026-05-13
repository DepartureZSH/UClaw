import { app } from 'electron';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { request } from 'https';
import { getConfiguredDataRoot } from './data-root';
import { logger } from './logger';

const UV_MIRROR_ENV: Record<string, string> = {
  UV_PYTHON_INSTALL_MIRROR: 'https://registry.npmmirror.com/-/binary/python-build-standalone/',
  UV_INDEX_URL: 'https://pypi.tuna.tsinghua.edu.cn/simple/',
};

const GOOGLE_204_HOST = 'www.google.com';
const GOOGLE_204_PATH = '/generate_204';
const GOOGLE_204_TIMEOUT_MS = 2000;

let cachedOptimized: boolean | null = null;
let cachedPromise: Promise<boolean> | null = null;
let loggedOnce = false;

function getPlatformTarget(): string {
  return `${process.platform}-${process.arch}`;
}

export function getBundledPythonInstallDir(): string {
  const target = getPlatformTarget();
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'python', target)
    : join(process.cwd(), 'resources', 'python', target);
}

function hasBundledPythonInstall(dir: string): boolean {
  try {
    if (!existsSync(dir)) return false;
    return readdirSync(dir, { withFileTypes: true }).some((entry) => (
      entry.isDirectory() && entry.name.startsWith('cpython-')
    ));
  } catch {
    return false;
  }
}

function getLocaleAndTimezone(): { locale: string; timezone: string } {
  const locale = app.getLocale?.() || '';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  return { locale, timezone };
}

function isRegionOptimized(locale: string, timezone: string): boolean {
  // Prefer timezone when available to reduce false positives from locale alone.
  if (timezone) return timezone === 'Asia/Shanghai';
  return locale === 'zh-CN';
}

function probeGoogle204(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      resolve(value);
    };

    const req = request(
      {
        method: 'GET',
        hostname: GOOGLE_204_HOST,
        path: GOOGLE_204_PATH,
      },
      (res) => {
        const status = res.statusCode || 0;
        res.resume();
        finish(status >= 200 && status < 300);
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('google_204_timeout'));
    });

    req.on('error', () => finish(false));
    req.end();
  });
}

async function computeOptimization(): Promise<boolean> {
  const { locale, timezone } = getLocaleAndTimezone();

  if (isRegionOptimized(locale, timezone)) {
    if (!loggedOnce) {
      logger.info(`Region optimization enabled via locale/timezone (locale=${locale || 'unknown'}, tz=${timezone || 'unknown'})`);
      loggedOnce = true;
    }
    return true;
  }

  const reachable = await probeGoogle204(GOOGLE_204_TIMEOUT_MS);
  const isOptimized = !reachable;

  if (!loggedOnce) {
    const reason = reachable ? 'google_204_reachable' : 'google_204_unreachable';
    logger.info(`Network optimization probe: ${reason} (locale=${locale || 'unknown'}, tz=${timezone || 'unknown'})`);
    loggedOnce = true;
  }

  return isOptimized;
}

export async function shouldOptimizeNetwork(): Promise<boolean> {
  if (cachedOptimized !== null) return cachedOptimized;
  if (cachedPromise) return cachedPromise;

  if (!app.isReady()) {
    await app.whenReady();
  }

  cachedPromise = computeOptimization()
    .then((result) => {
      cachedOptimized = result;
      return result;
    })
    .catch((err) => {
      logger.warn('Network optimization check failed, defaulting to enabled:', err);
      cachedOptimized = true;
      return true;
    })
    .finally(() => {
      cachedPromise = null;
    });

  return cachedPromise;
}

export async function getUvMirrorEnv(): Promise<Record<string, string>> {
  const isOptimized = await shouldOptimizeNetwork();
  return isOptimized ? { ...UV_MIRROR_ENV } : {};
}

export async function getUvRuntimeEnv(options: { forceDataPython?: boolean } = {}): Promise<Record<string, string>> {
  const mirrorEnv = await getUvMirrorEnv();
  const runtimeDir = join(getConfiguredDataRoot(), 'uclaw', 'runtime', 'uv');
  const cacheDir = join(runtimeDir, 'cache');
  const dataDir = join(runtimeDir, 'data');
  const dataPythonInstallDir = join(runtimeDir, 'python');
  const bundledPythonInstallDir = getBundledPythonInstallDir();
  const pythonInstallDir = !options.forceDataPython && hasBundledPythonInstall(bundledPythonInstallDir)
    ? bundledPythonInstallDir
    : dataPythonInstallDir;
  const binDir = join(runtimeDir, 'bin');
  const toolDir = join(runtimeDir, 'tools');

  for (const dir of [cacheDir, dataDir, dataPythonInstallDir, binDir, toolDir]) {
    mkdirSync(dir, { recursive: true });
  }

  return {
    ...mirrorEnv,
    UV_CACHE_DIR: cacheDir,
    UV_PYTHON_INSTALL_DIR: pythonInstallDir,
    UV_PYTHON_BIN_DIR: binDir,
    UV_PYTHON_INSTALL_BIN: '0',
    UV_PYTHON_INSTALL_REGISTRY: '0',
    UV_TOOL_DIR: toolDir,
    UV_TOOL_BIN_DIR: binDir,
    UV_MANAGED_PYTHON: '1',
    UV_NO_CONFIG: '1',
    XDG_CACHE_HOME: cacheDir,
    XDG_DATA_HOME: dataDir,
  };
}

export async function warmupNetworkOptimization(): Promise<void> {
  try {
    await shouldOptimizeNetwork();
  } catch {
    // Ignore warmup failures
  }
}
