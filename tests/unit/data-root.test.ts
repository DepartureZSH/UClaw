import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireDataRootLock,
  assertDataRootWritable,
  initializeDataRoot,
  migrateLegacyStorage,
  resolveDataRoot,
} from '../../electron/utils/data-root';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('data root', () => {
  it('uses the parent of Electron userData by default', () => {
    const resolved = resolveDataRoot({
      argv: ['electron', 'app.js'],
      defaultUserDataDir: '/Users/me/Library/Application Support/UClaw',
      exePath: '/Applications/UClaw.app/Contents/MacOS/UClaw',
    });

    expect(resolved.source).toBe('default');
    expect(resolved.dataRoot).toBe(resolve('/Users/me/Library/Application Support'));
    expect(resolved.uclawDir).toBe(join(resolved.dataRoot, 'uclaw'));
    expect(resolved.openclawDir).toBe(join(resolved.dataRoot, '.openclaw'));
  });

  it('supports absolute startup argument paths', () => {
    const resolved = resolveDataRoot({
      argv: ['electron', 'app.js', '--uclaw-data-root=/Volumes/UClaw/data'],
      defaultUserDataDir: '/Users/me/Library/Application Support/UClaw',
      exePath: '/Applications/UClaw.app/Contents/MacOS/UClaw',
    });

    expect(resolved.source).toBe('argv');
    expect(resolved.dataRoot).toBe(resolve('/Volumes/UClaw/data'));
  });

  it('resolves relative startup argument paths from the executable directory', () => {
    const resolved = resolveDataRoot({
      argv: ['electron', 'app.js', '--uclaw-data-root', '../data'],
      defaultUserDataDir: '/tmp/UClaw',
      exePath: '/Volumes/UClaw/windows/UClaw.exe',
    });

    expect(resolved.dataRoot).toBe(resolve(dirname('/Volumes/UClaw/windows/UClaw.exe'), '../data'));
  });

  it('uses a portable marker next to the executable when no explicit data root is provided', async () => {
    const exeDir = await makeTempDir('uclaw-portable-exe-');
    const exePath = join(exeDir, 'UClaw.exe');
    await writeFile(join(exeDir, 'uclaw-portable.json'), `${JSON.stringify({
      schema: 'uclaw-portable-data-root',
      version: 1,
      dataRoot: 'data',
    })}\n`, 'utf8');

    const resolved = resolveDataRoot({
      argv: ['UClaw.exe'],
      defaultUserDataDir: 'C:\\Users\\me\\AppData\\Roaming\\UClaw',
      exePath,
    });

    expect(resolved.source).toBe('portable-marker');
    expect(resolved.dataRoot).toBe(resolve(exeDir, 'data'));
  });

  it('lets explicit startup arguments override the portable marker', async () => {
    const exeDir = await makeTempDir('uclaw-portable-exe-');
    const exePath = join(exeDir, 'UClaw.exe');
    await writeFile(join(exeDir, 'uclaw-portable.json'), `${JSON.stringify({
      schema: 'uclaw-portable-data-root',
      version: 1,
      dataRoot: 'data',
    })}\n`, 'utf8');

    const resolved = resolveDataRoot({
      argv: ['UClaw.exe', '--uclaw-data-root', '../explicit-data'],
      defaultUserDataDir: 'C:\\Users\\me\\AppData\\Roaming\\UClaw',
      exePath,
    });

    expect(resolved.source).toBe('argv');
    expect(resolved.dataRoot).toBe(resolve(dirname(exePath), '../explicit-data'));
  });

  it('rejects empty startup argument paths', () => {
    expect(() => resolveDataRoot({
      argv: ['electron', 'app.js', '--uclaw-data-root='],
      defaultUserDataDir: '/tmp/UClaw',
      exePath: '/tmp/UClaw.exe',
    })).toThrow('--uclaw-data-root requires a non-empty path');
  });

  it('checks whether the data root can be written before startup continues', async () => {
    const dataRoot = await makeTempDir('uclaw-data-root-');
    expect(() => assertDataRootWritable(dataRoot)).not.toThrow();
  });

  it('throws a classified data-root error when the data root cannot be used as a directory', async () => {
    const dataRootFile = join(await makeTempDir('uclaw-data-root-file-parent-'), 'data-root-file');
    await writeFile(dataRootFile, 'not a directory', 'utf8');

    expect(() => assertDataRootWritable(dataRootFile)).toThrow('data root writable check failed');
  });

  it('blocks a second writer until the data-root lock is released', async () => {
    const dataRoot = await makeTempDir('uclaw-data-root-lock-');
    const first = acquireDataRootLock(dataRoot);

    expect(() => acquireDataRootLock(dataRoot)).toThrow('data root already locked');
    first.release();
    const second = acquireDataRootLock(dataRoot);
    second.release();
  });

  it('cleans a stale lock only when it belongs to the same host and platform', async () => {
    const dataRoot = await makeTempDir('uclaw-data-root-stale-lock-');
    const lockDir = join(dataRoot, 'uclaw');
    await mkdir(lockDir, { recursive: true });
    await writeFile(join(lockDir, 'data-root.lock'), `${JSON.stringify({
      schema: 'uclaw-data-root-lock',
      version: 1,
      pid: 99999999,
      host: hostname(),
      platform: process.platform,
      acquiredAt: '2026-05-10T00:00:00.000Z',
    })}\n`, 'utf8');

    const lock = acquireDataRootLock(dataRoot);
    expect(lock.lockPath).toBe(join(lockDir, 'data-root.lock'));
    lock.release();
  });

  it('keeps cross-host data-root locks as S0 safety blockers', async () => {
    const dataRoot = await makeTempDir('uclaw-data-root-cross-host-lock-');
    const lockDir = join(dataRoot, 'uclaw');
    await mkdir(lockDir, { recursive: true });
    await writeFile(join(lockDir, 'data-root.lock'), `${JSON.stringify({
      schema: 'uclaw-data-root-lock',
      version: 1,
      pid: 99999999,
      host: 'other-host',
      platform: process.platform,
      acquiredAt: '2026-05-10T00:00:00.000Z',
    })}\n`, 'utf8');

    expect(() => acquireDataRootLock(dataRoot)).toThrow('data root already locked');
  });

  it('migrates missing legacy files once without overwriting existing files', async () => {
    const legacyUserData = await makeTempDir('uclaw-legacy-user-data-');
    const dataRoot = await makeTempDir('uclaw-data-root-');
    const uclawDir = join(dataRoot, 'uclaw');
    const openclawDir = join(dataRoot, '.openclaw');

    await writeFile(join(legacyUserData, 'settings.json'), '{"legacy":true}', 'utf8');
    await writeFile(join(legacyUserData, 'uclaw-providers.json'), '{"providers":true}', 'utf8');
    await mkdir(join(dataRoot, 'uclaw'), { recursive: true });
    await writeFile(join(uclawDir, 'settings.json'), '{"new":true}', 'utf8');

    const first = migrateLegacyStorage({
      dataRoot,
      uclawDir,
      openclawDir,
      legacyUserDataDir: legacyUserData,
      legacyOpenClawDirs: [],
    });
    const second = migrateLegacyStorage({
      dataRoot,
      uclawDir,
      openclawDir,
      legacyUserDataDir: legacyUserData,
      legacyOpenClawDirs: [],
    });

    expect(first.sentinelPath).toBe(join(uclawDir, '.storage-migrated'));
    expect(first.migrated).toBe(true);
    expect(second.migrated).toBe(false);
    expect(existsSync(first.sentinelPath)).toBe(true);
    expect(readFileSync(join(uclawDir, 'settings.json'), 'utf8')).toBe('{"new":true}');
    expect(readFileSync(join(uclawDir, 'uclaw-providers.json'), 'utf8')).toBe('{"providers":true}');
  });

  it('does not auto-migrate legacy Roaming UClaw files during data-root initialization', async () => {
    const legacyUserData = await makeTempDir('uclaw-legacy-user-data-');
    const exeDir = await makeTempDir('uclaw-portable-exe-');
    await writeFile(join(legacyUserData, 'settings.json'), '{"workspaceDir":"E:/old/workspace"}', 'utf8');
    await writeFile(join(exeDir, 'uclaw-portable.json'), `${JSON.stringify({
      schema: 'uclaw-portable-data-root',
      version: 1,
      dataRoot: 'data',
    })}\n`, 'utf8');

    let userDataPath = legacyUserData;
    const appLike = {
      getPath(name: string) {
        if (name === 'userData') return userDataPath;
        if (name === 'exe') return join(exeDir, 'UClaw.exe');
        throw new Error(`unexpected path request: ${name}`);
      },
      setPath(name: string, value: string) {
        if (name !== 'userData') throw new Error(`unexpected path set: ${name}`);
        userDataPath = value;
      },
    };

    const previousDataRootEnv = process.env.UCLAW_DATA_ROOT;
    const previousDataRootSourceEnv = process.env.UCLAW_DATA_ROOT_SOURCE;
    delete process.env.UCLAW_DATA_ROOT;
    delete process.env.UCLAW_DATA_ROOT_SOURCE;
    try {
      const initialized = initializeDataRoot(appLike);
      try {
        expect(initialized.source).toBe('portable-marker');
        expect(existsSync(join(initialized.uclawDir, 'settings.json'))).toBe(false);
      } finally {
        initialized.releaseDataRootLock?.();
      }
    } finally {
      if (previousDataRootEnv === undefined) {
        delete process.env.UCLAW_DATA_ROOT;
      } else {
        process.env.UCLAW_DATA_ROOT = previousDataRootEnv;
      }
      if (previousDataRootSourceEnv === undefined) {
        delete process.env.UCLAW_DATA_ROOT_SOURCE;
      } else {
        process.env.UCLAW_DATA_ROOT_SOURCE = previousDataRootSourceEnv;
      }
    }
  });

  it('does not import standalone OpenClaw config unless explicitly requested', async () => {
    const legacyUserData = await makeTempDir('uclaw-legacy-user-data-');
    const standaloneOpenClaw = await makeTempDir('openclaw-user-owned-');
    const dataRoot = await makeTempDir('uclaw-data-root-');
    const uclawDir = join(dataRoot, 'uclaw');
    const openclawDir = join(dataRoot, '.openclaw');

    await writeFile(join(standaloneOpenClaw, 'openclaw.json'), '{"userOwned":true}', 'utf8');

    migrateLegacyStorage({
      dataRoot,
      uclawDir,
      openclawDir,
      legacyUserDataDir: legacyUserData,
    });

    expect(existsSync(join(openclawDir, 'openclaw.json'))).toBe(false);
  });
});
