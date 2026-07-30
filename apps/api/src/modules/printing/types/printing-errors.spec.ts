import {
  containsPrintingCredentialMaterial,
  sanitizePrintingError,
} from './printing-errors';

describe('printing diagnostic credential redaction', () => {
  const terminalCredential = `yt1.67.${'a'.repeat(43)}`;
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${'b'.repeat(20)}.${'c'.repeat(32)}`;

  it.each([
    terminalCredential,
    `authorization: Terminal ${terminalCredential}`,
    `Bearer ${jwt}`,
    jwt,
  ])('detects credential material embedded in a string value', (value) => {
    expect(containsPrintingCredentialMaterial(value)).toBe(true);
  });

  it('redacts terminal credentials and JWTs from persisted error text', () => {
    const sanitized = sanitizePrintingError(
      `failed authorization: Terminal ${terminalCredential}; bearer ${jwt}`,
    );

    expect(sanitized).not.toContain(terminalCredential);
    expect(sanitized).not.toContain(jwt);
    expect(sanitized).toContain('[redacted-terminal-credential]');
  });
});
