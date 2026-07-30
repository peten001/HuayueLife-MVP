import { Prisma } from '@prisma/client';
import { isIP } from 'node:net';
import { containsPrintingCredentialMaterial } from './printing-errors';

export const ANDROID_LAN_ESCPOS_ADAPTER = 'ANDROID_LAN_ESCPOS';
export const LAN_EXECUTION_EVIDENCE_TTL_MS = 120_000;

export type LanBindingMetadata = {
  terminalId: string;
  localBindingId: string;
  terminalInstanceId: string;
  executor: 'TERMINAL';
  adapter: typeof ANDROID_LAN_ESCPOS_ADAPTER;
  bindingVersion: number;
  bindingUpdatedAt: string;
};

export function lanBindingMetadata(value: Prisma.JsonValue): LanBindingMetadata | null {
  if (!isPlainObject(value) || !isPlainObject(value.lanBinding)) return null;
  const binding = value.lanBinding;
  if (
    !isPositiveId(binding.terminalId) ||
    typeof binding.localBindingId !== 'string' ||
    !binding.localBindingId ||
    typeof binding.terminalInstanceId !== 'string' ||
    !binding.terminalInstanceId ||
    binding.executor !== 'TERMINAL' ||
    binding.adapter !== ANDROID_LAN_ESCPOS_ADAPTER ||
    !Number.isInteger(binding.bindingVersion) ||
    Number(binding.bindingVersion) < 1 ||
    Number(binding.bindingVersion) > 2_147_483_647 ||
    !validIsoTimestamp(binding.bindingUpdatedAt)
  ) {
    return null;
  }
  return {
    terminalId: binding.terminalId,
    localBindingId: binding.localBindingId,
    terminalInstanceId: binding.terminalInstanceId,
    executor: 'TERMINAL',
    adapter: ANDROID_LAN_ESCPOS_ADAPTER,
    bindingVersion: Number(binding.bindingVersion),
    bindingUpdatedAt: String(binding.bindingUpdatedAt),
  };
}

export function lanConnectorEvidence(value: Prisma.JsonValue) {
  if (!isPlainObject(value) || !isPlainObject(value.connectorStatus)) return null;
  const updatedAt = isoDate(value.connectorStatusUpdatedAt);
  return {
    status: value.connectorStatus.status,
    serviceRunning: value.connectorStatus.serviceRunning === true,
    executionEnabled: value.connectorStatus.executionEnabled === true,
    updatedAt,
  };
}

export function isFresh(date: Date | null, now = new Date()) {
  if (!date) return false;
  const timestamp = date.getTime();
  return (
    Number.isFinite(timestamp) &&
    timestamp >= now.getTime() - LAN_EXECUTION_EVIDENCE_TTL_MS &&
    timestamp <= now.getTime() + 30_000
  );
}

export function validLanConnectionConfig(value: Prisma.JsonValue) {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.host === 'string' &&
    isPrivateIpv4(value.host) &&
    Number.isInteger(value.port) &&
    Number(value.port) >= 1 &&
    Number(value.port) <= 65535
  );
}

export function lanEndpoint(value: Prisma.JsonValue) {
  if (!validLanConnectionConfig(value) || !isPlainObject(value)) return null;
  return { host: String(value.host), port: Number(value.port) };
}

export function isPrivateIpv4(value: string) {
  if (isIP(value) !== 4) return false;
  const octets = value.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)
  ) {
    return false;
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function safeJson(value: Record<string, unknown>, maximumBytes = 8_192) {
  assertNoSecrets(value);
  const serialized = JSON.stringify(value);
  if (serialized.length > maximumBytes) throw new Error('JSON_TOO_LARGE');
  return JSON.parse(serialized) as Prisma.InputJsonObject;
}

function assertNoSecrets(value: unknown) {
  if (
    typeof value === 'string' &&
    containsPrintingCredentialMaterial(value)
  ) {
    throw new Error('SENSITIVE_FIELD');
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/password|secret|token|cookie|authorization|credential|api[_-]?key/i.test(key)) {
      throw new Error('SENSITIVE_FIELD');
    }
    assertNoSecrets(nested);
  }
}

function isPositiveId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,38}$/.test(value);
}

function validIsoTimestamp(value: unknown) {
  return isoDate(value) !== null;
}

function isoDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
