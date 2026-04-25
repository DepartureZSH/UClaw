import { describe, expect, it } from 'vitest';
import {
  buildPortableDiagnostics,
  extractAppBundlePath,
  isAppTranslocatedPath,
} from '../../electron/utils/portable-diagnostics';

describe('portable diagnostics', () => {
  it('detects macOS App Translocation paths', () => {
    const exePath = '/private/var/folders/xx/T/AppTranslocation/ABC/UClaw.app/Contents/MacOS/UClaw';

    expect(isAppTranslocatedPath(exePath)).toBe(true);
    expect(extractAppBundlePath(exePath)).toBe('/private/var/folders/xx/T/AppTranslocation/ABC/UClaw.app');
  });

  it('builds stable diagnostics from portable environment values', () => {
    const diagnostics = buildPortableDiagnostics({
      platform: 'darwin',
      exePath: '/Volumes/MAC_APPS_APFS/UClaw.app/Contents/MacOS/UClaw',
      appPath: '/Volumes/MAC_APPS_APFS/UClaw.app/Contents/Resources/app.asar',
      userDataDir: '/Volumes/SHARE_EXFAT/data/uclaw',
      portableRoot: '/Volumes/SHARE_EXFAT/data',
      workspaceDir: '/Volumes/SHARE_EXFAT/workspace',
    });

    expect(diagnostics.isPortable).toBe(true);
    expect(diagnostics.isAppTranslocated).toBe(false);
    expect(diagnostics.portableRoot).toBe('/Volumes/SHARE_EXFAT/data');
    expect(diagnostics.workspaceDir).toBe('/Volumes/SHARE_EXFAT/workspace');
    expect(diagnostics.recommendedLaunchCommand).toContain('/Volumes/MAC_APPS_APFS/UClaw.app');
  });

  it('includes repair commands when macOS diagnostics are requested', () => {
    const diagnostics = buildPortableDiagnostics({
      platform: 'darwin',
      exePath: '/private/var/folders/xx/T/AppTranslocation/ABC/UClaw.app/Contents/MacOS/UClaw',
      appPath: '/private/var/folders/xx/T/AppTranslocation/ABC/UClaw.app/Contents/Resources/app.asar',
      userDataDir: '/tmp/uclaw',
      portableRoot: null,
      workspaceDir: null,
    });

    expect(diagnostics.isAppTranslocated).toBe(true);
    expect(diagnostics.translocationFixCommands.join('\n')).toContain('xattr -dr com.apple.quarantine');
    expect(diagnostics.translocationFixCommands.join('\n')).toContain('lsregister');
  });
});
