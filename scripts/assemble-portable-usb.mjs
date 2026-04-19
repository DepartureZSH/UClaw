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
 *     data/             ← shared user data (triggers portable mode)
 *
 * Each platform executable walks up its directory tree to find data/,
 * so all platforms share the same settings and OpenClaw config.
 *
 * Usage: node scripts/assemble-portable-usb.mjs [--out <dir>]
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
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

  // Create shared data/ directory (presence triggers portable mode in all executables)
  const dataDir = join(OUT_DIR, 'data');
  mkdirSync(dataDir, { recursive: true });
  console.log(`\n  created  data/  (shared user data directory)`);

  console.log(`\nDone. USB image ready at:\n  ${OUT_DIR}\n`);
  console.log('Platform coverage:');
  for (const entry of PLATFORM_MAP) {
    const present = existsSync(join(OUT_DIR, entry.dir));
    console.log(`  ${present ? '✓' : '✗'}  ${entry.dir}`);
  }
}

main();
