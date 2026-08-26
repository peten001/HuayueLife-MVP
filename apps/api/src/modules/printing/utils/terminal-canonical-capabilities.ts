const SERVER_PAYLOAD_CAPABILITY = 'SERVER_ESC_POS_PAYLOAD_V1';
const RAW_PAYLOAD_CAPABILITY = 'RAW_PAYLOAD_PASSTHROUGH';
export const BINARY_PRINT_ARTIFACT_CAPABILITY = 'BINARY_PRINT_ARTIFACT_V1';

const REPORTED_PLATFORMS = new Set(['ANDROID', 'WINDOWS', 'WEB', 'SERVER']);

export function normalizeTerminalCapabilities(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...value };
  const connector = isPlainObject(normalized.connector)
    ? normalizeConnectorCapabilities(normalized.connector)
    : null;

  if (connector) normalized.connector = connector;
  const root = normalizeConnectorCapabilities(normalized);
  const reportedPlatform = reportedTerminalPlatform(root);
  if (reportedPlatform) root.reportedPlatform = reportedPlatform;
  return root;
}

export function terminalSupportsCanonicalPayload(value: unknown) {
  if (!isPlainObject(value)) return false;
  const connector = isPlainObject(value.connector) ? value.connector : value;
  return (
    capabilityValue(connector, SERVER_PAYLOAD_CAPABILITY) === true &&
    capabilityValue(connector, RAW_PAYLOAD_CAPABILITY) === true
  );
}

export function terminalSupportsBinaryPrintArtifact(value: unknown) {
  if (!isPlainObject(value)) return false;
  const connector = isPlainObject(value.connector) ? value.connector : value;
  return capabilityValue(connector, BINARY_PRINT_ARTIFACT_CAPABILITY) === true;
}

export function reportedTerminalPlatform(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  const explicit = normalizedPlatform(value.reportedPlatform);
  if (explicit) return explicit;
  const connector = isPlainObject(value.connector) ? value.connector : value;
  return normalizedPlatform(connector.platform);
}

function normalizeConnectorCapabilities(value: Record<string, unknown>) {
  const normalized = { ...value };
  canonicalizeCapabilityKey(normalized, SERVER_PAYLOAD_CAPABILITY);
  canonicalizeCapabilityKey(normalized, RAW_PAYLOAD_CAPABILITY);
  canonicalizeCapabilityKey(normalized, BINARY_PRINT_ARTIFACT_CAPABILITY);
  const platform = normalizedPlatform(normalized.platform);
  if (platform) normalized.platform = platform;
  return normalized;
}

function canonicalizeCapabilityKey(
  value: Record<string, unknown>,
  canonicalKey: string,
) {
  let selected: unknown;
  let found = false;
  for (const key of Object.keys(value)) {
    if (key.toUpperCase() !== canonicalKey) continue;
    if (key === canonicalKey || !found) selected = value[key];
    found = true;
    if (key !== canonicalKey) delete value[key];
  }
  if (found) value[canonicalKey] = selected;
}

function capabilityValue(value: Record<string, unknown>, canonicalKey: string) {
  for (const [key, nested] of Object.entries(value)) {
    if (key.toUpperCase() === canonicalKey) return nested;
  }
  return undefined;
}

function normalizedPlatform(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return REPORTED_PLATFORMS.has(normalized) ? normalized : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
