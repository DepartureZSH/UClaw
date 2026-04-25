#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argValue = (name, fallback) => {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
};

const root = resolve(process.cwd());
const portableRoot = resolve(argValue('--portable-root', join(root, 'data', 'dev-portable', 'data')));
const workspaceDir = resolve(argValue('--workspace-dir', join(root, 'data', 'dev-portable', 'workspace')));

mkdirSync(portableRoot, { recursive: true });
mkdirSync(workspaceDir, { recursive: true });

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const child = spawn(command, ['dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    UCLAW_PORTABLE_ROOT: portableRoot,
    UCLAW_WORKSPACE_DIR: workspaceDir,
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
