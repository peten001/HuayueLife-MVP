export type TableQrLaunchInput = { token: string } | { scene: string };

const TABLE_QR_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const LEGACY_SCENE_PATTERN = /^t\d+v\d+$/;
const CANONICAL_TABLE_QR_URL_PATTERN =
  /^https:\/\/api\.huayueyouxuan\.com(?::443)?\/t\/([a-f0-9]{64})$/;

export function parseTableQrLaunchInput(
  options?: Record<string, unknown>,
): TableQrLaunchInput | null {
  const token = normalizeToken(options?.token);
  if (token) return { token };

  const scene = normalizeScene(options?.scene);
  if (scene) return { scene };

  if (options?.q !== undefined && options.q !== null) {
    const qToken = parseCanonicalTableQrUrl(options.q);
    return qToken ? { token: qToken } : null;
  }

  for (const candidate of [options?.path, options?.result, options?.rawData]) {
    const parsed = parseLegacyScanCandidate(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function parseLegacyScanCandidate(value: unknown): TableQrLaunchInput | null {
  const decoded = decodeOnce(value);
  if (decoded === null) return null;

  const token = normalizeDecodedToken(decoded);
  if (token) return { token };

  const scene = normalizeDecodedScene(decoded);
  if (scene) return { scene };

  const tableQrToken = parseDecodedCanonicalTableQrUrl(decoded);
  return tableQrToken ? { token: tableQrToken } : null;
}

function parseCanonicalTableQrUrl(value: unknown) {
  const decoded = decodeOnce(value);
  return decoded === null ? '' : parseDecodedCanonicalTableQrUrl(decoded);
}

function parseDecodedCanonicalTableQrUrl(value: string) {
  return value.match(CANONICAL_TABLE_QR_URL_PATTERN)?.[1] ?? '';
}

function normalizeToken(value: unknown) {
  const decoded = decodeOnce(value);
  return decoded === null ? '' : normalizeDecodedToken(decoded);
}

function normalizeScene(value: unknown) {
  const decoded = decodeOnce(value);
  return decoded === null ? '' : normalizeDecodedScene(decoded);
}

function normalizeDecodedToken(value: string) {
  return TABLE_QR_TOKEN_PATTERN.test(value) ? value : '';
}

function normalizeDecodedScene(value: string) {
  return LEGACY_SCENE_PATTERN.test(value) ? value : '';
}

function decodeOnce(value: unknown) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (!text) return null;

  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}
