import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir, hostname } from 'node:os';

export const DATA_ROOT_ENV = 'UCLAW_DATA_ROOT';
export const DATA_ROOT_ARG = '--uclaw-data-root';
export const PORTABLE_DATA_ROOT_MARKER = 'uclaw-portable.json';

type ElectronAppLike = Pick<typeof import('electron').app, 'getPath' | 'setPath'>;

export interface DataRootResolution {
  dataRoot: string;
  uclawDir: string;
  openclawDir: string;
  source: 'argv' | 'env' | 'portable-marker' | 'default';
  lockPath?: string;
  releaseDataRootLock?: () => void;
}

export interface ResolveDataRootOptions {
  argv?: string[];
  defaultUserDataDir: string;
  exePath: string;
}

export interface StorageMigrationResult {
  migrated: boolean;
  sentinelPath: string;
  copiedFrom: string[];
}

export interface DataRootLock {
  lockPath: string;
  owner?: DataRootLockOwner;
  release: () => void;
}

export interface DataRootLockOwner {
  schema: 'uclaw-data-root-lock';
  version: 1;
  pid: number;
  host: string;
  platform: NodeJS.Platform;
  acquiredAt: string;
}

export function assertDataRootWritable(dataRoot: string): void {
  const probeDir = join(dataRoot, 'uclaw');
  const probePath = join(probeDir, `.write-probe-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(probePath, 'ok', 'utf8');
    rmSync(probePath, { force: true });
  } catch (error) {
    throw new Error(`data root writable check failed: ${dataRoot}`, { cause: error });
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function readDataRootLockOwner(lockPath: string): DataRootLockOwner | undefined {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Partial<DataRootLockOwner>;
    if (
      parsed.schema === 'uclaw-data-root-lock'
      && parsed.version === 1
      && typeof parsed.pid === 'number'
      && Number.isFinite(parsed.pid)
      && parsed.pid > 0
      && typeof parsed.host === 'string'
      && typeof parsed.platform === 'string'
      && typeof parsed.acquiredAt === 'string'
    ) {
      return {
        schema: 'uclaw-data-root-lock',
        version: 1,
        pid: parsed.pid,
        host: parsed.host,
        platform: parsed.platform as NodeJS.Platform,
        acquiredAt: parsed.acquiredAt,
      };
    }
  } catch {
    // Treat unreadable or malformed locks as held. This protects shared
    // removable data roots from concurrent writes until the user inspects it.
  }
  return undefined;
}

export function acquireDataRootLock(dataRoot: string): DataRootLock {
  const lockDir = join(dataRoot, 'uclaw');
  const lockPath = join(lockDir, 'data-root.lock');
  const owner: DataRootLockOwner = {
    schema: 'uclaw-data-root-lock',
    version: 1,
    pid: process.pid,
    host: hostname(),
    platform: process.platform,
    acquiredAt: new Date().toISOString(),
  };

  mkdirSync(lockDir, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        writeFileSync(fd, `${JSON.stringify(owner, null, 2)}\n`, 'utf8');
      } finally {
        closeSync(fd);
      }

      let released = false;
      return {
        lockPath,
        owner,
        release: () => {
          if (released) return;
          released = true;
          const currentOwner = readDataRootLockOwner(lockPath);
          if (
            currentOwner?.pid === owner.pid
            && currentOwner.host === owner.host
            && currentOwner.platform === owner.platform
          ) {
            rmSync(lockPath, { force: true });
          }
        },
      };
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno !== 'EEXIST') {
        throw new Error(`data root lock acquisition failed: ${dataRoot}`, { cause: error });
      }

      const existingOwner = readDataRootLockOwner(lockPath);
      const sameMachine = existingOwner
        && existingOwner.host === owner.host
        && existingOwner.platform === owner.platform;
      if (sameMachine && !isPidAlive(existingOwner.pid)) {
        rmSync(lockPath, { force: true });
        continue;
      }

      const ownerDescriptor = existingOwner
        ? `${existingOwner.platform}/${existingOwner.host} pid=${existingOwner.pid} acquiredAt=${existingOwner.acquiredAt}`
        : 'unknown owner';
      throw new Error(`data root already locked: ${dataRoot} (${ownerDescriptor})`);
    }
  }

  throw new Error(`data root lock acquisition failed: ${dataRoot}`);
}

function normalizeRootPath(value: string, exePath: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${DATA_ROOT_ARG} requires a non-empty path`);
  }
  return isAbsolute(trimmed)
    ? resolve(trimmed)
    : resolve(dirname(exePath), trimmed);
}

function readDataRootArg(argv: string[] = process.argv): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === DATA_ROOT_ARG) {
      return argv[index + 1] ?? '';
    }
    if (arg.startsWith(`${DATA_ROOT_ARG}=`)) {
      return arg.slice(DATA_ROOT_ARG.length + 1);
    }
  }
  return null;
}

function readPortableMarkerDataRoot(exePath: string): string | null {
  const markerPath = join(dirname(exePath), PORTABLE_DATA_ROOT_MARKER);
  if (!existsSync(markerPath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(markerPath, 'utf8')) as {
      schema?: unknown;
      version?: unknown;
      dataRoot?: unknown;
    };
    if (
      parsed.schema !== 'uclaw-portable-data-root'
      || parsed.version !== 1
      || typeof parsed.dataRoot !== 'string'
    ) {
      throw new Error('unexpected marker schema');
    }
    return normalizeRootPath(parsed.dataRoot, exePath);
  } catch (error) {
    throw new Error(`portable data root marker is invalid: ${markerPath}`, { cause: error });
  }
}

export function resolveDataRoot(options: ResolveDataRootOptions): DataRootResolution {
  const argRoot = readDataRootArg(options.argv);
  const envRoot = process.env[DATA_ROOT_ENV]?.trim() || null;
  const configuredRoot = argRoot ?? envRoot;
  const portableMarkerRoot = configuredRoot === null
    ? readPortableMarkerDataRoot(options.exePath)
    : null;
  const dataRoot = configuredRoot !== null
    ? normalizeRootPath(configuredRoot, options.exePath)
    : (portableMarkerRoot ?? resolve(dirname(options.defaultUserDataDir)));

  return {
    dataRoot,
    uclawDir: join(dataRoot, 'uclaw'),
    openclawDir: join(dataRoot, '.openclaw'),
    source: argRoot !== null
      ? 'argv'
      : (envRoot ? 'env' : (portableMarkerRoot ? 'portable-marker' : 'default')),
  };
}

export function getConfiguredDataRoot(): string {
  const fromEnv = process.env[DATA_ROOT_ENV]?.trim();
  if (fromEnv) return resolve(fromEnv);

  // Fallback for utility tests/imports that run outside the main-process bootstrap.
  return join(homedir(), '.uclaw-data');
}

function copyMissingRecursive(source: string, target: string, copiedFrom: Set<string>): boolean {
  if (!existsSync(source)) return false;
  const sourceStats = statSync(source);

  if (sourceStats.isDirectory()) {
    mkdirSync(target, { recursive: true });
    let copied = false;
    for (const entry of readdirSync(source)) {
      copied = copyMissingRecursive(join(source, entry), join(target, entry), copiedFrom) || copied;
    }
    if (copied) copiedFrom.add(source);
    return copied;
  }

  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    copiedFrom.add(source);
    return true;
  }

  return false;
}

export function migrateLegacyStorage(options: {
  dataRoot: string;
  uclawDir: string;
  openclawDir: string;
  legacyUserDataDir: string;
  legacyOpenClawDirs?: string[];
}): StorageMigrationResult {
  const sentinelPath = join(options.uclawDir, '.storage-migrated');
  if (existsSync(sentinelPath)) {
    return { migrated: false, sentinelPath, copiedFrom: [] };
  }

  const copiedFrom = new Set<string>();
  const legacyUserDataDir = resolve(options.legacyUserDataDir);
  const uclawDir = resolve(options.uclawDir);

  if (legacyUserDataDir !== uclawDir) {
    copyMissingRecursive(legacyUserDataDir, uclawDir, copiedFrom);
  }

  // Do not import the user's standalone ~/.openclaw by default. That directory
  // may be owned by OpenClaw CLI or other tools, while UClaw should only migrate
  // its own app data unless an explicit caller supplies legacy OpenClaw dirs.
  const openclawCandidates = options.legacyOpenClawDirs ?? [];
  for (const candidate of openclawCandidates) {
    if (resolve(candidate) !== resolve(options.openclawDir)) {
      copyMissingRecursive(candidate, options.openclawDir, copiedFrom);
    }
  }

  mkdirSync(options.uclawDir, { recursive: true });
  writeFileSync(sentinelPath, `${JSON.stringify({
    version: 1,
    migratedAt: new Date().toISOString(),
    copiedFrom: Array.from(copiedFrom),
  }, null, 2)}\n`, 'utf8');

  return { migrated: copiedFrom.size > 0, sentinelPath, copiedFrom: Array.from(copiedFrom) };
}

export function initializeDataRoot(app: ElectronAppLike): DataRootResolution {
  const legacyUserDataDir = app.getPath('userData');
  const resolution = resolveDataRoot({
    defaultUserDataDir: legacyUserDataDir,
    exePath: app.getPath('exe'),
  });

  const dataRootLock = acquireDataRootLock(resolution.dataRoot);
  try {
    assertDataRootWritable(resolution.dataRoot);
    mkdirSync(resolution.uclawDir, { recursive: true });
    mkdirSync(resolution.openclawDir, { recursive: true });
    app.setPath('userData', resolution.uclawDir);
    process.env[DATA_ROOT_ENV] = resolution.dataRoot;

    // UClaw no longer auto-imports legacy Roaming/AppData state. A fresh data
    // root must stay fresh, especially for USB packages moved between machines.
    // Explicit import can be added later as a user-confirmed repair action.
  } catch (error) {
    dataRootLock.release();
    throw error;
  }

  return {
    ...resolution,
    lockPath: dataRootLock.lockPath,
    releaseDataRootLock: dataRootLock.release,
  };
}
