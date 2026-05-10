#!/usr/bin/env node
/**
 * assemble-portable-usb.mjs
 *
 * Assembles a multi-platform portable USB image from the zip artifacts
 * produced by package:win:portable, package:mac:portable, and
 * package:linux:portable.
 *
 * Output structure:
 *   release/UClaw-USB/
 *     windows/          ← Windows zip extracted here
 *     macos-arm64/      ← macOS arm64 zip extracted here
 *     macos-x64/        ← macOS x64 zip extracted here
 *     linux/            ← Linux zip extracted here
 *     data/             ← shared data root
 *
 * Launch scripts pass --uclaw-data-root explicitly so all platforms share the
 * same settings and OpenClaw config without auto-detecting directories.
 *
 * Usage: node scripts/assemble-portable-usb.mjs [--out <dir>]
 */

import { execSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

// Parse --out argument
const outArgIdx = process.argv.indexOf('--out');
const OUT_DIR = outArgIdx !== -1
  ? resolve(process.argv[outArgIdx + 1])
  : join(ROOT, 'release', 'UClaw-USB');

const RELEASE_DIR = join(ROOT, 'release');

// Map zip filename patterns to target subdirectory names
const PLATFORM_MAP = [
  { pattern: /win.*x64.*\.zip$/i,        dir: 'windows' },
  { pattern: /mac.*arm64.*\.zip$/i,       dir: 'macos-arm64' },
  { pattern: /mac.*x64.*\.zip$/i,         dir: 'macos-x64' },
  { pattern: /linux.*x64.*\.zip$/i,       dir: 'linux' },
  { pattern: /linux.*arm64.*\.zip$/i,     dir: 'linux-arm64' },
];

function findZips() {
  if (!existsSync(RELEASE_DIR)) {
    console.error(`release/ directory not found at ${RELEASE_DIR}`);
    process.exit(1);
  }
  return readdirSync(RELEASE_DIR).filter((f) => f.endsWith('.zip'));
}

function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    // tar.exe (bundled with Windows 10+) supports zip extraction
    execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: 'inherit' });
  } else {
    execSync(`unzip -q -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
  }
}

function writeLaunchers(dataDir) {
  writeFileSync(join(OUT_DIR, 'Launch UClaw Windows.cmd'), [
    '@echo off',
    'set "SCRIPT_DIR=%~dp0"',
    'set "DATA_ROOT=%SCRIPT_DIR%data"',
    'start "" "%SCRIPT_DIR%windows\\UClaw.exe" --uclaw-data-root "%DATA_ROOT%"',
    '',
  ].join('\r\n'), 'utf8');

  const linuxLauncher = join(OUT_DIR, 'launch-uclaw-linux.sh');
  writeFileSync(linuxLauncher, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    'DATA_ROOT="$SCRIPT_DIR/data"',
    'for candidate in "$SCRIPT_DIR/linux/uclaw" "$SCRIPT_DIR/linux/UClaw" "$SCRIPT_DIR/linux/UClaw.AppImage"; do',
    '  if [[ -x "$candidate" || -f "$candidate" ]]; then',
    '    exec "$candidate" --uclaw-data-root "$DATA_ROOT"',
    '  fi',
    'done',
    'echo "Linux UClaw executable was not found."',
    'exit 1',
    '',
  ].join('\n'), 'utf8');
  chmodSync(linuxLauncher, 0o755);

  const macLauncher = join(OUT_DIR, 'launch-uclaw-macos.sh');
  writeFileSync(macLauncher, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    'DATA_ROOT="$SCRIPT_DIR/data"',
    'for candidate in "$SCRIPT_DIR/macos-arm64/UClaw.app" "$SCRIPT_DIR/macos-x64/UClaw.app" "$SCRIPT_DIR/UClaw.app"; do',
    '  if [[ -d "$candidate" ]]; then',
    '    open "$candidate" --args --uclaw-data-root "$DATA_ROOT"',
    '    exit 0',
    '  fi',
    'done',
    'echo "UClaw.app was not found."',
    'exit 1',
    '',
  ].join('\n'), 'utf8');
  chmodSync(macLauncher, 0o755);

  console.log(`  launchers use data root: ${dataDir}`);
}

function main() {
  const zips = findZips();
  if (zips.length === 0) {
    console.error('No zip files found in release/. Run package:*:portable scripts first.');
    process.exit(1);
  }

  console.log(`Assembling portable USB image → ${OUT_DIR}\n`);
  mkdirSync(OUT_DIR, { recursive: true });

  let matched = 0;
  for (const zip of zips) {
    const entry = PLATFORM_MAP.find((m) => m.pattern.test(zip));
    if (!entry) {
      console.log(`  skip  ${zip} (no platform match)`);
      continue;
    }
    const zipPath = join(RELEASE_DIR, zip);
    const destDir = join(OUT_DIR, entry.dir);
    console.log(`  extract  ${zip}  →  ${entry.dir}/`);
    extractZip(zipPath, destDir);
    matched++;
  }

  if (matched === 0) {
    console.error('No portable zips matched any known platform pattern.');
    process.exit(1);
  }

  // Create shared data/ directory and launchers that pass it explicitly.
  const dataDir = join(OUT_DIR, 'data');
  mkdirSync(dataDir, { recursive: true });
  writeLaunchers(dataDir);
  console.log(`\n  created  data/  (shared data root)`);

  console.log(`\nDone. USB image ready at:\n  ${OUT_DIR}\n`);
  console.log('Platform coverage:');
  for (const entry of PLATFORM_MAP) {
    const present = existsSync(join(OUT_DIR, entry.dir));
    console.log(`  ${present ? '✓' : '✗'}  ${entry.dir}`);
  }
}

main();
