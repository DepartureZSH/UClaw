import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveDeviceIdentityPath } from '@electron/utils/device-identity';

describe('device identity utilities', () => {
  it('uses the unified identity file', () => {
    expect(
      resolveDeviceIdentityPath('/tmp/uclaw-user-data', {
        platform: 'win32',
      }),
    ).toBe(path.join('/tmp/uclaw-user-data', 'uclaw-device-identity.json'));
  });
});
