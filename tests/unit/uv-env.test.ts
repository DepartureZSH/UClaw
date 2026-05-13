import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { state } = vi.hoisted(() => ({
  state: {
    dataRoot: '',
  },
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    isReady: () => true,
    whenReady: async () => undefined,
    getLocale: () => 'zh-CN',
  },
}));

vi.mock('@electron/utils/data-root', () => ({
  getConfiguredDataRoot: () => state.dataRoot,
}));

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('uv runtime env', () => {
  beforeEach(async () => {
    vi.resetModules();
    state.dataRoot = await makeTempDir('uclaw-uv-data-');
    const resourcesPath = await makeTempDir('uclaw-uv-resources-');
    Object.defineProperty(process, 'resourcesPath', {
      value: resourcesPath,
      configurable: true,
    });
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('prefers bundled managed Python over data-root downloads when present', async () => {
    const bundledPythonDir = join(process.resourcesPath, 'resources', 'python', `${process.platform}-${process.arch}`);
    await mkdir(join(bundledPythonDir, 'cpython-3.12.12-windows-x86_64-none'), { recursive: true });

    const { getUvRuntimeEnv } = await import('@electron/utils/uv-env');
    const env = await getUvRuntimeEnv();

    expect(env.UV_PYTHON_INSTALL_DIR).toBe(bundledPythonDir);
    expect(env.UV_CACHE_DIR).toBe(join(state.dataRoot, 'uclaw', 'runtime', 'uv', 'cache'));
    expect(env.UV_TOOL_DIR).toBe(join(state.dataRoot, 'uclaw', 'runtime', 'uv', 'tools'));
  });

  it('can force Python installation back to the data root for fallback repair', async () => {
    const bundledPythonDir = join(process.resourcesPath, 'resources', 'python', `${process.platform}-${process.arch}`);
    await mkdir(join(bundledPythonDir, 'cpython-3.12.12-windows-x86_64-none'), { recursive: true });

    const { getUvRuntimeEnv } = await import('@electron/utils/uv-env');
    const env = await getUvRuntimeEnv({ forceDataPython: true });

    expect(env.UV_PYTHON_INSTALL_DIR).toBe(join(state.dataRoot, 'uclaw', 'runtime', 'uv', 'python'));
  });
});
