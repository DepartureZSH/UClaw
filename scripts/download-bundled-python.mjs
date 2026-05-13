#!/usr/bin/env zx

import 'zx/globals';
import { spawn } from 'node:child_process';

const ROOT_DIR = path.resolve(__dirname, '..');
const PYTHON_VERSION = '3.12';
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'python');
const TEMP_BASE = path.join(ROOT_DIR, 'temp_python_download');

const TARGETS = {
  'win32-x64': {
    uvBin: path.join(ROOT_DIR, 'resources', 'bin', 'win32-x64', 'uv.exe'),
    installArgs: ['python', 'install', PYTHON_VERSION, '--no-bin', '--no-registry'],
  },
};

const PLATFORM_GROUPS = {
  win: ['win32-x64'],
};

function resolveTargetIds() {
  if (argv.platform) {
    const targets = PLATFORM_GROUPS[argv.platform];
    if (!targets) {
      echo(chalk.red`❌ Python bundling is not configured for platform: ${argv.platform}`);
      echo(`Available platforms: ${Object.keys(PLATFORM_GROUPS).join(', ')}`);
      process.exit(1);
    }
    return targets;
  }

  const currentId = `${os.platform()}-${os.arch()}`;
  if (!TARGETS[currentId]) {
    echo(chalk.yellow`⚠️ Python bundling is not configured for ${currentId}; skipping.`);
    return [];
  }
  return [currentId];
}

function runUv(targetId, target, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(target.uvBin, target.installArgs, {
      cwd: ROOT_DIR,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) echo(chalk.gray`[python:${targetId}] ${text}`);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) echo(chalk.gray`[python:${targetId}] ${text}`);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`uv python install failed for ${targetId} with exit code ${code}`));
      }
    });
  });
}

async function setupTarget(targetId) {
  const target = TARGETS[targetId];
  if (!target) {
    echo(chalk.yellow`⚠️ Target ${targetId} is not supported by this script.`);
    return;
  }
  if (!await fs.pathExists(target.uvBin)) {
    throw new Error(`Bundled uv not found at ${target.uvBin}. Run pnpm run uv:download:win first.`);
  }

  const installDir = path.join(OUTPUT_BASE, targetId);
  const cacheDir = path.join(TEMP_BASE, targetId, 'cache');
  const dataDir = path.join(TEMP_BASE, targetId, 'data');
  const binDir = path.join(TEMP_BASE, targetId, 'bin');

  echo(chalk.blue`\n🐍 Setting up bundled CPython ${PYTHON_VERSION} for ${targetId}...`);
  await fs.remove(installDir);
  await fs.remove(path.join(TEMP_BASE, targetId));
  await fs.ensureDir(installDir);
  await fs.ensureDir(cacheDir);
  await fs.ensureDir(dataDir);
  await fs.ensureDir(binDir);

  const env = {
    ...process.env,
    UV_CACHE_DIR: cacheDir,
    UV_PYTHON_INSTALL_DIR: installDir,
    UV_PYTHON_BIN_DIR: binDir,
    UV_PYTHON_INSTALL_BIN: '0',
    UV_PYTHON_INSTALL_REGISTRY: '0',
    UV_MANAGED_PYTHON: '1',
    UV_NO_CONFIG: '1',
    XDG_CACHE_HOME: cacheDir,
    XDG_DATA_HOME: dataDir,
  };

  try {
    await runUv(targetId, target, env);
    echo(chalk.green`✅ Bundled Python ready: ${installDir}`);
  } finally {
    await fs.remove(path.join(TEMP_BASE, targetId));
  }
}

const targetIds = resolveTargetIds();
for (const targetId of targetIds) {
  await setupTarget(targetId);
}

if (targetIds.length > 0) {
  echo(chalk.green`\n🎉 Bundled Python setup complete.`);
}
