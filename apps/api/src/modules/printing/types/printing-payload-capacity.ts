export const RC13_HTTP_RESPONSE_CHAR_LIMIT = 1_048_576;
export const PAYLOAD_WARN_BINARY_BYTES = 500 * 1024;
export const PAYLOAD_CRITICAL_BINARY_BYTES = 600 * 1024;

// Keep 64 Ki characters between the application hard gate and rc13's parser
// ceiling. The response is still checked after its final DTO and API envelope
// are serialized; this reserve is not a substitute for that exact check.
export const LEGACY_JSON_RESPONSE_HEADROOM_CHARS = 64 * 1024;
export const LEGACY_JSON_RESPONSE_SAFE_MAX_CHARS =
  RC13_HTTP_RESPONSE_CHAR_LIMIT - LEGACY_JSON_RESPONSE_HEADROOM_CHARS;

// Capacity planning reserves 16 Ki characters for the job DTO, receipt
// snapshot, printer/route metadata, requestId, timestamp, and JSON syntax.
// Runtime enforcement always uses the actual serialized response instead.
export const LEGACY_JSON_NON_PAYLOAD_RESERVE_CHARS = 16 * 1024;
export const DERIVED_SAFE_BINARY_BYTES = Math.floor(
  ((LEGACY_JSON_RESPONSE_SAFE_MAX_CHARS -
    LEGACY_JSON_NON_PAYLOAD_RESERVE_CHARS) *
    3) /
    4,
);

export type PrintPayloadCapacityLevel = 'NORMAL' | 'WARN' | 'CRITICAL';

export function printPayloadCapacityLevel(
  payloadBytes: number,
  serializedResponseChars: number,
): PrintPayloadCapacityLevel {
  if (
    payloadBytes >= PAYLOAD_CRITICAL_BINARY_BYTES ||
    serializedResponseChars > LEGACY_JSON_RESPONSE_SAFE_MAX_CHARS
  ) {
    return 'CRITICAL';
  }
  if (payloadBytes >= PAYLOAD_WARN_BINARY_BYTES) return 'WARN';
  return 'NORMAL';
}
