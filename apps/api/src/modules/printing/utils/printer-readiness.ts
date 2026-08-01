import { PrinterChannelType, PrintingPrinterStatus, Prisma } from '@prisma/client';
import {
  isFresh,
  lanBindingMetadata,
  lanConnectorEvidence,
} from '../types/lan-terminal-binding';
import { v2BindingMetadata } from '../types/v2-terminal-binding';

export const IMPLEMENTED_PRINTING_CHANNELS = new Set<PrinterChannelType>([
  'LOCAL_USB_ESCPOS',
  'LOCAL_LAN_ESCPOS',
  'CLOUD_FEIE',
  'CLOUD_YILIAN',
  'LOCAL_BLUETOOTH_ESCPOS',
]);

export const PRINTER_EXECUTION_EVIDENCE_TTL_MS = 120_000;

export type PrinterReadinessState =
  | 'NOT_CONFIGURED'
  | 'DEVICE_OFFLINE'
  | 'READY';

export type PrinterReadinessRecord = {
  channelType: PrinterChannelType;
  enabled: boolean;
  status: PrintingPrinterStatus;
  connectionConfig: Prisma.JsonValue;
  capabilities: Prisma.JsonValue;
};

export function printerReadiness(
  record: PrinterReadinessRecord,
  now = new Date(),
) {
  const channelImplemented = IMPLEMENTED_PRINTING_CHANNELS.has(
    record.channelType,
  );
  const usb = record.channelType === 'LOCAL_USB_ESCPOS';
  const lan = record.channelType === 'LOCAL_LAN_ESCPOS';
  const bluetooth = record.channelType === 'LOCAL_BLUETOOTH_ESCPOS';
  const v2 = Boolean(v2BindingMetadata(record.capabilities));
  const cloud =
    record.channelType === 'CLOUD_FEIE' ||
    record.channelType === 'CLOUD_YILIAN';
  const configValid = isConnectionConfigValid(
    record.channelType,
    record.connectionConfig,
  );
  const statusReady = record.status === 'ONLINE';
  const evidence = connectorEvidence(record.capabilities);
  const evidenceUpdatedAt = v2
    ? v2StatusReportedAt(record.capabilities)
    : usb || lan
      ? connectorEvidenceUpdatedAt(record.capabilities)
    : cloud
      ? cloudEvidenceUpdatedAt(record.capabilities)
      : null;
  const evidenceTimestamp = evidenceUpdatedAt?.getTime() ?? Number.NaN;
  const evidenceFresh =
    Number.isFinite(evidenceTimestamp) &&
    evidenceTimestamp >= now.getTime() - PRINTER_EXECUTION_EVIDENCE_TTL_MS &&
    evidenceTimestamp <= now.getTime() + 30_000;
  const executionEvidenceReady =
    evidenceFresh &&
    (v2
      ? hasExplicitV2ExecutionEvidence(record.capabilities, now)
      : usb
      ? hasExplicitUsbExecutionEvidence(evidence)
      : lan
        ? hasExplicitLanExecutionEvidence(record.capabilities, now)
        : cloud || bluetooth);
  const state: PrinterReadinessState =
    !record.enabled
      ? 'NOT_CONFIGURED'
      : !channelImplemented
        ? 'DEVICE_OFFLINE'
        : !configValid
          ? 'NOT_CONFIGURED'
          : !statusReady || !executionEvidenceReady
            ? 'DEVICE_OFFLINE'
            : 'READY';

  return {
    state,
    channelImplemented,
    configValid,
    statusReady,
    executionEvidenceReady,
    evidenceUpdatedAt: evidenceUpdatedAt?.toISOString() ?? null,
    evidenceTtlMs: PRINTER_EXECUTION_EVIDENCE_TTL_MS,
  } as const;
}

export function isReadyPrinter(
  record: PrinterReadinessRecord,
  now = new Date(),
) {
  return printerReadiness(record, now).state === 'READY';
}

/**
 * USB printer identity and permission stay on the Android device. The server
 * therefore accepts an empty object as a complete USB configuration (the
 * connector uses safe defaults), but it rejects malformed or unknown fields.
 */
export function isConnectionConfigValid(
  channelType: PrinterChannelType,
  value: Prisma.JsonValue,
) {
  if (!isPlainObject(value)) return false;
  if (channelType === 'LOCAL_LAN_ESCPOS') {
    if (!isPlainObject(value)) return false;
    const host = value.host;
    const port = value.port;
    return typeof host === 'string' && isPrivateIpv4(host) && Number.isInteger(port) && Number(port) >= 1 && Number(port) <= 65535;
  }
  if (channelType === 'CLOUD_FEIE') {
    return isPlainObject(value) && typeof value.printerSn === 'string' && value.printerSn.length > 0;
  }
  if (channelType === 'CLOUD_YILIAN') {
    return isPlainObject(value) && typeof value.machineCode === 'string' && value.machineCode.length > 0;
  }
  if (channelType === 'LOCAL_BLUETOOTH_ESCPOS') {
    return (
      typeof value.macAddress === 'string' &&
      /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(value.macAddress) &&
      typeof value.deviceName === 'string' &&
      value.deviceName.length > 0 &&
      typeof value.serviceUuid === 'string' &&
      /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(
        value.serviceUuid,
      )
    );
  }
  if (channelType !== 'LOCAL_USB_ESCPOS') return false;
  if ('vendorId' in value || 'productId' in value) {
    const allowed = new Set([
      'vendorId',
      'productId',
      'deviceName',
      'interfaceClass',
      'endpointAddress',
    ]);
    return (
      !Object.keys(value).some((key) => !allowed.has(key)) &&
      isIntegerInRange(value.vendorId, 0, 65_535) &&
      isIntegerInRange(value.productId, 0, 65_535) &&
      (value.deviceName === undefined ||
        (typeof value.deviceName === 'string' && value.deviceName.length > 0)) &&
      (value.interfaceClass === undefined ||
        isIntegerInRange(value.interfaceClass, 0, 255)) &&
      (value.endpointAddress === undefined ||
        isIntegerInRange(value.endpointAddress, 0, 255))
    );
  }
  const allowed = new Set(['paperWidthDots', 'threshold', 'cutMode']);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  const paperWidthDots = value.paperWidthDots;
  if (
    paperWidthDots !== undefined &&
    (!Number.isInteger(paperWidthDots) ||
      Number(paperWidthDots) < 200 ||
      Number(paperWidthDots) > 1024)
  ) {
    return false;
  }
  const threshold = value.threshold;
  if (
    threshold !== undefined &&
    (!Number.isInteger(threshold) ||
      Number(threshold) < 0 ||
      Number(threshold) > 255)
  ) {
    return false;
  }
  const cutMode = value.cutMode;
  if (
    cutMode !== undefined &&
    !['NONE', 'HALF', 'FULL'].includes(String(cutMode))
  ) {
    return false;
  }
  return true;
}

/**
 * CONNECTED is only promoted to ONLINE when the Android connector reports all
 * positive, current prerequisites. Missing/false/unknown evidence fails closed.
 */
export function hasExplicitUsbExecutionEvidence(
  value: Record<string, unknown> | undefined,
) {
  return Boolean(
    value &&
      value.usbDeviceRecognized === true &&
      value.usbPermissionGranted === true &&
      value.usbInterfaceValid === true &&
      value.usbEndpointValid === true &&
      value.appExecutionReady === true,
  );
}

export function hasExplicitLanExecutionEvidence(
  capabilities: Prisma.JsonValue,
  now = new Date(),
) {
  const binding = lanBindingMetadata(capabilities);
  const evidence = lanConnectorEvidence(capabilities);
  return Boolean(
    binding &&
      evidence?.status === 'CONNECTED' &&
      evidence.serviceRunning &&
      evidence.executionEnabled &&
      isFresh(evidence.updatedAt, now),
  );
}

export function hasExplicitV2ExecutionEvidence(
  capabilities: Prisma.JsonValue,
  now = new Date(),
) {
  if (!isPlainObject(capabilities) || !isPlainObject(capabilities.v2Status)) {
    return false;
  }
  const reportedAt = capabilities.v2Status.reportedAt;
  const parsed = typeof reportedAt === 'string' ? new Date(reportedAt) : null;
  return Boolean(
    parsed &&
      !Number.isNaN(parsed.getTime()) &&
      isFresh(parsed, now) &&
      capabilities.v2Status.status === 'CONNECTED',
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
}

function isPrivateIpv4(value: string) {
  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return false;
  return octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
}

function connectorEvidence(value: Prisma.JsonValue) {
  if (!isPlainObject(value)) return undefined;
  return isPlainObject(value.connectorStatus)
    ? value.connectorStatus
    : undefined;
}

function connectorEvidenceUpdatedAt(value: Prisma.JsonValue) {
  if (!isPlainObject(value)) return null;
  const raw = value.connectorStatusUpdatedAt;
  if (typeof raw !== 'string') return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function cloudEvidenceUpdatedAt(value: Prisma.JsonValue) {
  if (!isPlainObject(value)) return null;
  const raw = value.cloudStatusUpdatedAt;
  if (typeof raw !== 'string') return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function v2StatusReportedAt(value: Prisma.JsonValue) {
  if (!isPlainObject(value) || !isPlainObject(value.v2Status)) return null;
  const raw = value.v2Status.reportedAt;
  if (typeof raw !== 'string') return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isIntegerInRange(value: unknown, min: number, max: number) {
  return (
    Number.isInteger(value) && Number(value) >= min && Number(value) <= max
  );
}
