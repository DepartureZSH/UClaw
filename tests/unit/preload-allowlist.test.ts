import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('preload IPC allowlist', () => {
  it('allows diagnostics package channels', () => {
    const source = readFileSync(join(process.cwd(), 'electron/preload/index.ts'), 'utf8');

    expect(source).toContain("'diagnostics:collect'");
    expect(source).toContain("'diagnostics:copyText'");
  });
});
