#!/usr/bin/env zx

import 'zx/globals';
import { readFileSync, existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(ROOT, 'resources', 'skills', 'preinstalled-manifest.json');
const OUTPUT_ROOT = join(ROOT, 'build', 'preinstalled-skills');
const TMP_ROOT = join(ROOT, 'build', '.tmp-preinstalled-skills');

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing manifest: ${MANIFEST_PATH}`);
  }
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.skills)) {
    throw new Error('Invalid preinstalled-skills manifest format');
  }
  for (const item of parsed.skills) {
    if (!item.slug || !item.repo || !item.repoPath) {
      throw new Error(`Invalid manifest entry: ${JSON.stringify(item)}`);
    }
  }
  return parsed.skills;
}

function groupByRepoRef(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const ref = entry.ref || 'main';
    const key = `${entry.repo}#${ref}`;
    if (!grouped.has(key)) grouped.set(key, { repo: entry.repo, ref, entries: [] });
    grouped.get(key).entries.push(entry);
  }
  return [...grouped.values()];
}

function createRepoDirName(repo, ref) {
  return `${repo.replace(/[\\/]/g, '__')}__${ref.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function toGitPath(inputPath) {
  if (process.platform !== 'win32') return inputPath;
  // Git on Windows accepts forward slashes and avoids backslash escape quirks.
  return inputPath.replace(/\\/g, '/');
}

function normalizeRepoPath(repoPath) {
  return repoPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function shouldCopySkillFile(srcPath) {
  const base = basename(srcPath);
  if (base === '.git') return false;
  if (base === '.subset.tar') return false;
  return true;
}

function extractArchive(archiveFileName, cwd) {
  const result = spawnSync('tar', ['-xf', archiveFileName], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    cwd,
  });
  if (result.error || result.status !== 0) {
    if (process.platform === 'win32') {
      // Some Windows images expose bsdtar instead of tar.
      const result2 = spawnSync('bsdtar', ['-xf', archiveFileName], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        cwd,
      });
      if (result2.error) throw result2.error;
      if (result2.status !== 0) {
        const stderr = result2.stderr?.trim() || result2.stdout?.trim() || '';
        throw new Error(`bsdtar failed (exit ${result2.status}): ${stderr}`);
      }
      return;
    }
    if (result.error) throw result.error;
    const stderr = result.stderr?.trim() || result.stdout?.trim() || '';
    throw new Error(`tar failed (exit ${result.status}): ${stderr}`);
  }
}

function git(args, opts = {}) {
  // Use spawnSync to invoke git directly, bypassing any shell (cmd/WSL).
  // On Windows, routing git through a shell can trigger WSL bash integration
  // even when no Linux distribution is installed, causing a fatal spawn error.
  const result = spawnSync('git', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...opts,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || '';
    const stdout = result.stdout?.trim() || '';
    throw new Error(`git ${args[0]} failed (exit ${result.status}): ${stderr || stdout}`);
  }
  return result.stdout ?? '';
}

async function fetchSparseRepo(repo, ref, paths, checkoutDir) {
  const remote = `https://github.com/${repo}.git`;
  mkdirSync(checkoutDir, { recursive: true });
  const gitCheckoutDir = toGitPath(checkoutDir);
  const archiveFileName = '.subset.tar';
  const archivePath = join(checkoutDir, archiveFileName);
  const archivePaths = [...new Set(paths.map(normalizeRepoPath))];

  git(['init', gitCheckoutDir]);
  git(['-C', gitCheckoutDir, 'remote', 'add', 'origin', remote]);
  git(['-C', gitCheckoutDir, 'fetch', '--depth', '1', 'origin', ref]);
  // Do not checkout working tree on Windows: upstream repos may contain
  // Windows-invalid paths. Export only requested directories via git archive.
  git(['-C', gitCheckoutDir, 'archive', '--format=tar', `--output=${archiveFileName}`, 'FETCH_HEAD', ...archivePaths]);
  extractArchive(archiveFileName, checkoutDir);
  rmSync(archivePath, { force: true });

  const commit = git(['-C', gitCheckoutDir, 'rev-parse', 'FETCH_HEAD']).trim();
  return commit;
}

echo`Bundling preinstalled skills...`;

if (process.env.SKIP_PREINSTALLED_SKILLS === '1') {
  echo`⏭  SKIP_PREINSTALLED_SKILLS=1 set, skipping skills fetch.`;
  process.exit(0);
}

const manifestSkills = loadManifest();

rmSync(OUTPUT_ROOT, { recursive: true, force: true });
mkdirSync(OUTPUT_ROOT, { recursive: true });
rmSync(TMP_ROOT, { recursive: true, force: true });
mkdirSync(TMP_ROOT, { recursive: true });

const lock = {
  generatedAt: new Date().toISOString(),
  skills: [],
};

const groups = groupByRepoRef(manifestSkills);
for (const group of groups) {
  const repoDir = join(TMP_ROOT, createRepoDirName(group.repo, group.ref));
  const sparsePaths = [...new Set(group.entries.map((entry) => entry.repoPath))];

  echo`Fetching ${group.repo} @ ${group.ref}`;
  const commit = await fetchSparseRepo(group.repo, group.ref, sparsePaths, repoDir);
  echo`   commit ${commit}`;

  for (const entry of group.entries) {
    const sourceDir = join(repoDir, entry.repoPath);
    const targetDir = join(OUTPUT_ROOT, entry.slug);

    if (!existsSync(sourceDir)) {
      throw new Error(`Missing source path in repo checkout: ${entry.repoPath}`);
    }

    rmSync(targetDir, { recursive: true, force: true });
    cpSync(sourceDir, targetDir, { recursive: true, dereference: true, filter: shouldCopySkillFile });

    const skillManifest = join(targetDir, 'SKILL.md');
    if (!existsSync(skillManifest)) {
      throw new Error(`Skill ${entry.slug} is missing SKILL.md after copy`);
    }

    const requestedVersion = (entry.version || '').trim();
    const resolvedVersion = !requestedVersion || requestedVersion === 'main'
      ? commit
      : requestedVersion;
    lock.skills.push({
      slug: entry.slug,
      version: resolvedVersion,
      repo: entry.repo,
      repoPath: entry.repoPath,
      ref: group.ref,
      commit,
    });

    echo`   OK ${entry.slug}`;
  }
}

writeFileSync(join(OUTPUT_ROOT, '.preinstalled-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
rmSync(TMP_ROOT, { recursive: true, force: true });
echo`Preinstalled skills ready: ${OUTPUT_ROOT}`;
