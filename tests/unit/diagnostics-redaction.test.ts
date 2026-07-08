import { describe, expect, it } from 'vitest';
import { redactDiagnosticsText, redactDiagnosticsValue } from '@electron/utils/diagnostics-redaction';

describe('diagnostics redaction', () => {
  it('redacts secret-looking text patterns', () => {
    const input = [
      'Authorization: Bearer sk-test-production-secret',
      'apiKey=sk-test-production-secret',
      'companyKey=uclaw_company_secret_1234567890',
      'cookie: session=abcdef1234567890',
    ].join('\n');

    const output = redactDiagnosticsText(input);

    expect(output).not.toContain('sk-test-production-secret');
    expect(output).not.toContain('uclaw_company_secret_1234567890');
    expect(output).not.toContain('abcdef1234567890');
    expect(output).toContain('[REDACTED]');
  });

  it('redacts nested object secret fields without removing safe metadata', () => {
    const output = redactDiagnosticsValue({
      provider: {
        apiKey: 'sk-test-production-secret',
        baseUrl: 'https://example.invalid/v1',
      },
      headers: {
        Authorization: 'Bearer token-value',
      },
      packageId: 'customer-package-a',
    });

    expect(output).toMatchObject({
      provider: {
        apiKey: '[REDACTED]',
        baseUrl: 'https://example.invalid/v1',
      },
      headers: {
        Authorization: '[REDACTED]',
      },
      packageId: 'customer-package-a',
    });
  });
});
