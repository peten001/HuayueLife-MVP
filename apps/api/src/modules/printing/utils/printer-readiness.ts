import { PrinterChannelType, PrintingPrinterStatus, Prisma } from '@prisma/client';

export const IMPLEMENTED_PRINTING_CHANNELS = new Set<PrinterChannelType>([
  'LOCAL_USB_ESCPOS',
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
  const configValid = isConnectionConfigValid(
    record.channelType,
    record.connectionConfig,
  );
  const statusReady = record.status === 'ONLINE';
  const evidence = connectorEvidence(record.capabilities);
  const evidenceUpdatedAt = connectorEvidenceUpdatedAt(record.capabilities);
  const evidenceTimestamp = evidenceUpdatedAt?.getTime() ?? Number.NaN;
  const evidenceFresh =
    Number.isFinite(evidenceTimestamp) &&
    evidenceTimestamp >= now.getTime() - PRINTER_EXECUTION_EVIDENCE_TTL_MS &&
    evidenceTimestamp <= now.getTime() + 30_000;
  const executionEvidenceReady =
    evidenceFresh && hasExplicitUsbExecutionEvidence(evidence);
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
  if (channelType !== 'LOCAL_USB_ESCPOS') return false;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
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
