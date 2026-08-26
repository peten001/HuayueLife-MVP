import { serializeApiSuccessResponse } from '../../../common/utils/api-success-response';
import {
  DERIVED_SAFE_BINARY_BYTES,
  LEGACY_JSON_RESPONSE_SAFE_MAX_CHARS,
  PAYLOAD_CRITICAL_BINARY_BYTES,
  PAYLOAD_WARN_BINARY_BYTES,
  printPayloadCapacityLevel,
  RC13_HTTP_RESPONSE_CHAR_LIMIT,
} from './printing-payload-capacity';

describe('legacy printing payload capacity contract', () => {
  it('locks the rc13 limit, warning/critical thresholds, and reserved safe capacity', () => {
    expect(RC13_HTTP_RESPONSE_CHAR_LIMIT).toBe(1_048_576);
    expect(PAYLOAD_WARN_BINARY_BYTES).toBe(500 * 1024);
    expect(PAYLOAD_CRITICAL_BINARY_BYTES).toBe(600 * 1024);
    expect(LEGACY_JSON_RESPONSE_SAFE_MAX_CHARS).toBe(983_040);
    expect(DERIVED_SAFE_BINARY_BYTES).toBe(724_992);
  });

  it.each([
    [100, 'NORMAL', true],
    [300, 'NORMAL', true],
    [500, 'WARN', true],
    [600, 'CRITICAL', true],
    [700, 'CRITICAL', true],
    [750, 'CRITICAL', false],
    [768, 'CRITICAL', false],
    [780, 'CRITICAL', false],
    [1024, 'CRITICAL', false],
    [2048, 'CRITICAL', false],
    [5120, 'CRITICAL', false],
  ] as const)(
    'classifies %i KiB from its actual final serialized response',
    (payloadKiB, expectedLevel, expectedAllowed) => {
      const payloadBytes = payloadKiB * 1024;
      const response = payloadTransferResponse(payloadBytes);
      const serialized = serializeApiSuccessResponse(
        response,
        `req_${'x'.repeat(32)}`,
        new Date('2026-08-26T00:00:00.000Z'),
      );
      const serializedResponseChars = serialized.length;
      const serializedResponseBytes = Buffer.byteLength(serialized, 'utf8');
      const expectedBase64Chars = Math.ceil(payloadBytes / 3) * 4;

      expect(
        printPayloadCapacityLevel(payloadBytes, serializedResponseChars),
      ).toBe(expectedLevel);
      expect(
        serializedResponseChars <= LEGACY_JSON_RESPONSE_SAFE_MAX_CHARS,
      ).toBe(expectedAllowed);
      expect(response.job.renderedPayloadBase64).toHaveLength(
        expectedBase64Chars,
      );
      expect(serializedResponseBytes).toBeGreaterThanOrEqual(
        serializedResponseChars,
      );
      expect(serialized).toContain('renderedPayloadBase64');
    },
  );
});

function payloadTransferResponse(payloadBytes: number) {
  return {
    job: {
      id: 301n,
      merchantId: '7',
      receiptType: 'TABLE_BILL',
      status: 'CLAIMED',
      leaseVersion: 4,
      renderedPayloadBase64: Buffer.alloc(payloadBytes, 0xa5).toString('base64'),
      renderedPayloadSha256: 'a'.repeat(64),
      renderedPayloadByteLength: payloadBytes,
      receiptSnapshot: { schemaVersion: 3, metadata: 'x'.repeat(12_000) },
    },
  };
}
