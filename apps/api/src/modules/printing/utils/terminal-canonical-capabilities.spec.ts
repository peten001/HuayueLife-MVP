import {
  normalizeTerminalCapabilities,
  reportedTerminalPlatform,
  terminalSupportsBinaryPrintArtifact,
} from './terminal-canonical-capabilities';

describe('terminal canonical capabilities', () => {
  it('normalizes historical Windows camel-case acronym damage', () => {
    const normalized = normalizeTerminalCapabilities({
      connector: {
        platform: 'windows',
        serveR_ESC_POS_PAYLOAD_V1: true,
        raW_PAYLOAD_PASSTHROUGH: true,
      },
    });

    expect(normalized).toEqual({
      connector: {
        platform: 'WINDOWS',
        SERVER_ESC_POS_PAYLOAD_V1: true,
        RAW_PAYLOAD_PASSTHROUGH: true,
      },
      reportedPlatform: 'WINDOWS',
    });
    expect(reportedTerminalPlatform(normalized)).toBe('WINDOWS');
  });

  it('does not manufacture canonical support from unrelated capability data', () => {
    const normalized = normalizeTerminalCapabilities({
      connector: { platform: 'ANDROID', channels: ['LOCAL_USB_ESCPOS'] },
    });

    expect(normalized).not.toHaveProperty('SERVER_ESC_POS_PAYLOAD_V1');
    expect(normalized).not.toHaveProperty('RAW_PAYLOAD_PASSTHROUGH');
  });

  it('normalizes binary artifact capability casing without enabling it implicitly', () => {
    const normalized = normalizeTerminalCapabilities({
      connector: { binarY_PRINT_ARTIFACT_V1: true },
    });
    expect(normalized).toEqual({
      connector: { BINARY_PRINT_ARTIFACT_V1: true },
    });
    expect(terminalSupportsBinaryPrintArtifact(normalized)).toBe(true);
    expect(terminalSupportsBinaryPrintArtifact({ connector: {} })).toBe(false);
  });
});
