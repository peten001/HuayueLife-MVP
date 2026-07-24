import { describe, expect, it } from 'vitest';

import { sanitizeDiagnosticError } from './terminal-debug';

describe('terminal diagnostic redaction', () => {
  it('removes query, bearer, JSON, and JWT credentials from visible errors', () => {
    const error = [
      'https://cashier.example.test/start?token=query-secret&merchant=42',
      'Authorization: Bearer opaque-secret',
      '{"accessToken":"json-secret"}',
      'eyJabcdefghijk.abcdefghijk.abcdefghijk',
    ].join(' ');

    const result = sanitizeDiagnosticError(error);

    expect(result).not.toContain('query-secret');
    expect(result).not.toContain('opaque-secret');
    expect(result).not.toContain('json-secret');
    expect(result).not.toContain('eyJabcdefghijk');
    expect(result).toContain('[redacted]');
  });
});
