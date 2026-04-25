#!/usr/bin/env node
/**
 * Build a two-partition portable layout:
 *
 *   release/UClaw-USB-SHARE_EXFAT/
 *     windows/
 *     linux/
 *     data/
 *     workspace/
 *
 *   release/UClaw-USB-MAC_APPS_APFS/
 *     macos-arm64/
 *     macos-x64/
 *     Launch UClaw.command
 *
 * Copy the first directory to the ExFAT partition and the second directory to
 * the APFS partition. The macOS launcher passes the ExFAT data/workspace paths
 * explicitly so UClaw.app does not need to infer paths across partitions.
 */

import { execSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const RELEASE_DIR = join(ROOT, 'release');

const argValue = (name, fallback) => {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
};

const SHARE_OUT = resolve(argValue('--share-out', join(RELEASE_DIR, 'UClaw-USB-SHARE_EXFAT')));
const MAC_OUT = resolve(argValue('--mac-out', join(RELEASE_DIR, 'UClaw-USB-MAC_APPS_APFS')));
const SHARE_VOLUME = argValue('--share-volume', 'SHARE_EXFAT');

const PLATFORM_MAP = [
  { pattern: /win.*x64.*\.zip$/i, dir: 'windows', target: 'share' },
  { pattern: /linux.*x64.*\.zip$/i, dir: 'linux', target: 'share' },
  { pattern: /linux.*arm64.*\.zip$/i, dir: 'linux-arm64', target: 'share' },
  { pattern: /mac.*arm64.*\.zip$/i, dir: 'macos-arm64', target: 'mac' },
  { pattern: /mac.*x64.*\.zip$/i, dir: 'macos-x64', target: 'mac' },
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
    execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: 'inherit' });
  } else {
    execSync(`unzip -q -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
  }
}

function writeMacLauncher() {
  const launcherPath = join(MAC_OUT, 'Launch UClaw.command');
  const content = `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHARE_VOLUME="${SHARE_VOLUME}"
SHARE_ROOT="/Volumes/$SHARE_VOLUME"

export UCLAW_PORTABLE_ROOT="$SHARE_ROOT/data"
export UCLAW_WORKSPACE_DIR="$SHARE_ROOT/workspace"

APP=""
for candidate in "$SCRIPT_DIR/macos-arm64/UClaw.app" "$SCRIPT_DIR/macos-x64/UClaw.app" "$SCRIPT_DIR/UClaw.app"; do
  if [[ -d "$candidate" ]]; then
    APP="$candidate"
    break
  fi
done

if [[ -z "$APP" ]]; then
  echo "UClaw.app was not found next to this launcher."
  exit 1
fi

if [[ ! -d "$UCLAW_PORTABLE_ROOT" ]]; then
  echo "Shared data directory not found: $UCLAW_PORTABLE_ROOT"
  echo "Mount the ExFAT partition as /Volumes/$SHARE_VOLUME or edit this launcher."
  exit 1
fi

mkdir -p "$UCLAW_WORKSPACE_DIR"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
open "$APP"
`;
  writeFileSync(launcherPath, content, 'utf-8');
  chmodSync(launcherPath, 0o755);
}

function writeShareReadme() {
  writeFileSync(join(SHARE_OUT, 'README-PORTABLE.txt'), [
    'UClaw portable shared partition',
    '',
    'Keep this directory on the ExFAT partition named SHARE_EXFAT.',
    'Windows/Linux apps and shared UClaw data live here.',
    '',
    'macOS apps should live on the APFS partition. Start macOS with:',
    '  Launch UClaw.command',
    '',
  ].join('\n'), 'utf-8');
}

function main() {
  const zips = findZips();
  if (zips.length === 0) {
    console.error('No zip files found in release/. Run package:*:portable scripts first.');
    process.exit(1);
  }

  mkdirSync(SHARE_OUT, { recursive: true });
  mkdirSync(MAC_OUT, { recursive: true });

  let matched = 0;
  for (const zip of zips) {
    const entry = PLATFORM_MAP.find((item) => item.pattern.test(zip));
    if (!entry) {
      console.log(`skip ${zip} (no platform match)`);
      continue;
    }
    const destRoot = entry.target === 'mac' ? MAC_OUT : SHARE_OUT;
    console.log(`extract ${zip} -> ${entry.target}/${entry.dir}`);
    extractZip(join(RELEASE_DIR, zip), join(destRoot, entry.dir));
    matched += 1;
  }

  if (matched === 0) {
    console.error('No portable zips matched any known platform pattern.');
    process.exit(1);
  }

  mkdirSync(join(SHARE_OUT, 'data'), { recursive: true });
  mkdirSync(join(SHARE_OUT, 'workspace'), { recursive: true });
  writeShareReadme();
  writeMacLauncher();

  console.log('\nDone.');
  console.log(`ExFAT content: ${SHARE_OUT}`);
  console.log(`APFS content:  ${MAC_OUT}`);
}

main();
