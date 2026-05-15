#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'node_modules/openclaw');
const distDir = path.join(root, 'dist');

if (!fs.existsSync(distDir)) {
  console.warn(`[patch-openclaw] skipped: ${distDir} does not exist`);
  process.exit(0);
}

const targetNames = fs.readdirSync(distDir)
  .filter((name) => /^kimi-web-search-provider-.*\.js$/.test(name));

if (targetNames.length === 0) {
  console.warn(`[patch-openclaw] skipped: kimi web-search provider bundle not found in ${distDir}`);
  process.exit(0);
}

const search = '...KIMI_THINKING_MODELS.has(params.model) ? { thinking: { type: "disabled" } } : {},';
const replace = 'thinking: { type: "disabled" },';

let patched = 0;
let missing = 0;
for (const name of targetNames) {
  const file = path.join(distDir, name);
  const current = fs.readFileSync(file, 'utf8');
  if (current.includes(replace)) {
    continue;
  }
  if (!current.includes(search)) {
    console.warn(`[patch-openclaw] expected Kimi thinking snippet not found in ${file}`);
    missing++;
    continue;
  }
  fs.writeFileSync(file, current.replace(search, replace), 'utf8');
  patched++;
}

if (missing > 0) {
  console.error('[patch-openclaw] failed: Kimi web-search provider bundle changed and was not patched');
  process.exit(1);
}

console.log(`[patch-openclaw] Kimi web-search thinking disabled in ${patched}/${targetNames.length} file(s)`);
