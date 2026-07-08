import { test, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('portable workbench startup', () => {
  test('keeps initialized portable workspace across different parent paths', async () => {
    const rootA = await mkdtemp(join(tmpdir(), 'uclaw-portable-a-'));
    const rootB = await mkdtemp(join(tmpdir(), 'uclaw-portable-b-'));

    try {
      const dataA = join(rootA, 'data');
      await mkdir(join(dataA, 'uclaw'), { recursive: true });
      await mkdir(join(dataA, 'workspace', '.openclaw'), { recursive: true });
      await writeFile(join(dataA, 'uclaw', 'settings.json'), `${JSON.stringify({
        setupComplete: true,
        workspaceDir: 'workspace',
        gatewayAutoStart: false,
      }, null, 2)}\n`, 'utf8');
      await writeFile(join(dataA, 'workspace', '.openclaw', 'openclaw.json'), `${JSON.stringify({
        models: { default: 'new-api/deepseek-v4-flash' },
      }, null, 2)}\n`, 'utf8');

      const dataB = join(rootB, 'data');
      await cp(dataA, dataB, { recursive: true });

      expect(dataB).not.toBe(dataA);
      const copiedSettings = await readFile(join(dataB, 'uclaw', 'settings.json'), 'utf8');
      expect(copiedSettings).toContain('"workspaceDir": "workspace"');
      expect(copiedSettings).not.toContain(rootA.replace(/\\/g, '\\\\'));
    } finally {
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    }
  });
});
