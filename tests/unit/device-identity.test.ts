import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveDeviceIdentityPath } from '@electron/utils/device-identity';

describe('device identity utilities', () => {
  it('uses the legacy identity file outside portable mode', () => {
    expect(
      resolveDeviceIdentityPath('/tmp/uclaw-user-data', {
        platform: 'win32',
        portableRoot: null,
      }),
    ).toBe(path.join('/tmp/uclaw-user-data', 'uclaw-device-identity.json'));
  });

  it('uses a platform-specific identity file in portable mode', () => {
    expect(
      resolveDeviceIdentityPath('/tmp/uclaw-user-data', {
        platform: 'darwin',
        portableRoot: '/Volumes/UClaw',
      }),
    ).toBe(path.join('/tmp/uclaw-user-data', 'uclaw-device-identity-darwin.json'));
  });
});
