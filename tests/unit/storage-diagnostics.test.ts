import { describe, expect, it } from 'vitest';
import {
  buildStorageDiagnostics,
  extractAppBundlePath,
  isAppTranslocatedPath,
} from '../../electron/utils/storage-diagnostics';

describe('storage diagnostics', () => {
  it('detects macOS App Translocation paths', () => {
    const exePath = '/private/var/folders/xx/T/AppTranslocation/ABC/UClaw.app/Contents/MacOS/UClaw';

    expect(isAppTranslocatedPath(exePath)).toBe(true);
    expect(extractAppBundlePath(exePath)).toBe('/private/var/folders/xx/T/AppTranslocation/ABC/UClaw.app');
  });

  it('builds stable diagnostics from data root values', () => {
    const diagnostics = buildStorageDiagnostics({
      platform: 'darwin',
      exePath: '/Volumes/MAC_APPS_APFS/UClaw.app/Contents/MacOS/UClaw',
      appPath: '/Volumes/MAC_APPS_APFS/UClaw.app/Contents/Resources/app.asar',
      dataRoot: '/Volumes/SHARE_EXFAT/data',
      uclawDir: '/Volumes/SHARE_EXFAT/data/uclaw',
      openclawDir: '/Volumes/SHARE_EXFAT/data/.openclaw',
      workspaceDir: '/Volumes/SHARE_EXFAT/workspace',
      settingsPath: '/Volumes/SHARE_EXFAT/data/uclaw/settings.json',
      providerStorePath: '/Volumes/SHARE_EXFAT/data/uclaw/uclaw-providers.json',
    });

    expect(diagnostics.isAppTranslocated).toBe(false);
    expect(diagnostics.dataRoot).toBe('/Volumes/SHARE_EXFAT/data');
    expect(diagnostics.openclawDir).toBe('/Volumes/SHARE_EXFAT/data/.openclaw');
    expect(diagnostics.workspaceDir).toBe('/Volumes/SHARE_EXFAT/workspace');
    expect(diagnostics.recommendedLaunchCommand).toContain('/Volumes/MAC_APPS_APFS/UClaw.app');
  });

  it('includes repair commands when macOS diagnostics are requested', () => {
    const diagnostics = buildStorageDiagnostics({
      platform: 'darwin',
      exePath: '/private/var/folders/xx/T/AppTranslocation/ABC/UClaw.app/Contents/MacOS/UClaw',
      appPath: '/private/var/folders/xx/T/AppTranslocation/ABC/UClaw.app/Contents/Resources/app.asar',
      dataRoot: '/tmp/data',
      uclawDir: '/tmp/data/uclaw',
      openclawDir: '/tmp/data/.openclaw',
      workspaceDir: null,
      settingsPath: '/tmp/data/uclaw/settings.json',
      providerStorePath: '/tmp/data/uclaw/uclaw-providers.json',
    });

    expect(diagnostics.isAppTranslocated).toBe(true);
    expect(diagnostics.translocationFixCommands.join('\n')).toContain('xattr -dr com.apple.quarantine');
    expect(diagnostics.translocationFixCommands.join('\n')).toContain('lsregister');
  });
});
