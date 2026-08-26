import { ApiSuccessResponse } from '../dto/api-response.dto';

export function buildApiSuccessResponse<T>(
  data: T,
  requestId: string,
  timestamp = new Date(),
): ApiSuccessResponse<unknown> {
  return {
    code: 'OK',
    message: 'success',
    data: normalizeBigInt(data),
    requestId,
    timestamp: timestamp.toISOString(),
  };
}

export function serializeApiSuccessResponse(
  data: unknown,
  requestId: string,
  timestamp = new Date(),
) {
  return JSON.stringify(buildApiSuccessResponse(data, requestId, timestamp));
}

function normalizeBigInt(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeBigInt);
  }
  if (value instanceof Date) {
    return value;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeBigInt(item)]),
    );
  }
  return value;
}
