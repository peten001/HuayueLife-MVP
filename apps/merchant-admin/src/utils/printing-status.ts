import type { PrintingPrinter, PrintingRule } from '@/types/printing';

export const PRINTING_STATE_CHANGED_EVENT = 'yunqiao:printing-state-changed';

export type PrinterConfigurationState = 'CONFIGURED' | 'NOT_CONFIGURED' | 'DISABLED';
export type PrinterConnectionState =
  | 'CONNECTED'
  | 'OFFLINE'
  | 'RECONNECTING'
  | 'WAITING_PERMISSION'
  | 'DEVICE_NOT_DETECTED'
  | 'UNKNOWN';

export interface PrintingCenterSummary {
  localChannel: 'AVAILABLE' | 'NOT_CONFIGURED';
  automaticPrinting: 'ENABLED' | 'DISABLED';
  recentTerminalConnection: 'ONLINE' | 'OFFLINE' | 'NOT_REPORTED';
  lastEvidenceAt: string | null;
  lastConnectedAt: string | null;
}

const DEFAULT_EVIDENCE_TTL_MS = 120_000;
const MAX_FUTURE_SKEW_MS = 30_000;

export function printerConfigurationState(
  printer: PrintingPrinter,
): PrinterConfigurationState {
  if (!printer.enabled) return 'DISABLED';
  if (
    printer.channelType === 'LOCAL_USB_ESCPOS'
    && printer.readiness?.channelImplemented === true
    && printer.readiness.configValid === true
  ) {
    return 'CONFIGURED';
  }
  return 'NOT_CONFIGURED';
}

export function printerConnectionState(
  printer: PrintingPrinter,
  now = Date.now(),
): PrinterConnectionState {
  const evidenceAt = evidenceTimestamp(printer);
  const evidence = connectorEvidence(printer);
  const evidenceFresh = isEvidenceFresh(printer, evidenceAt, now);

  if (evidenceFresh && evidence) {
    if (evidence.usbDeviceRecognized === false) return 'DEVICE_NOT_DETECTED';
    if (
      evidence.usbDeviceRecognized === true
      && evidence.usbPermissionGranted === false
    ) {
      return 'WAITING_PERMISSION';
    }
    if (
      printer.readiness?.state === 'READY'
      && printer.readiness.statusReady === true
      && printer.readiness.executionEvidenceReady !== false
    ) {
      return 'CONNECTED';
    }
    if (printer.status === 'OFFLINE' || printer.status === 'ERROR') return 'OFFLINE';
    if (
      evidence.usbDeviceRecognized === true
      || evidence.usbPermissionGranted === true
      || evidence.usbInterfaceValid === true
      || evidence.usbEndpointValid === true
      || evidence.appExecutionReady === true
    ) {
      return 'RECONNECTING';
    }
  }

  if (evidenceAt !== null && !evidenceFresh) return 'OFFLINE';
  if (printer.status === 'OFFLINE' || printer.status === 'ERROR') return 'OFFLINE';
  return 'UNKNOWN';
}

export function resolvePrintingCenterSummary(
  printers: PrintingPrinter[],
  rules: PrintingRule[],
  automaticCreationAvailable: boolean,
  now = Date.now(),
): PrintingCenterSummary {
  const lastEvidenceAt = latestPrinterEvidenceAt(printers);
  const lastConnectedAt = latestPrinterConnectedAt(printers);
  const connections = printers.map((printer) => printerConnectionState(printer, now));
  const configuredPrinterIds = new Set(
    printers
      .filter((printer) => printerConfigurationState(printer) === 'CONFIGURED')
      .map((printer) => printer.id),
  );
  return {
    localChannel: printers.some(
      (printer) => printerConfigurationState(printer) === 'CONFIGURED',
    )
      ? 'AVAILABLE'
      : 'NOT_CONFIGURED',
    automaticPrinting: automaticCreationAvailable && rules.some(
      (rule) =>
        rule.enabled &&
        rule.autoPrint &&
        configuredPrinterIds.has(rule.printerId),
    )
      ? 'ENABLED'
      : 'DISABLED',
    recentTerminalConnection: connections.includes('CONNECTED')
      ? 'ONLINE'
      : lastEvidenceAt
        ? 'OFFLINE'
        : 'NOT_REPORTED',
    lastEvidenceAt,
    lastConnectedAt,
  };
}

export function latestPrinterEvidenceAt(printers: PrintingPrinter[]) {
  let latest: { value: string; timestamp: number } | null = null;
  for (const printer of printers) {
    const value = printer.readiness?.evidenceUpdatedAt;
    const timestamp = evidenceTimestamp(printer);
    if (!value || timestamp === null) continue;
    if (!latest || timestamp > latest.timestamp) latest = { value, timestamp };
  }
  return latest?.value ?? null;
}

export function latestPrinterConnectedAt(printers: PrintingPrinter[]) {
  return latestCapabilityTimestamp(printers, 'lastConnectedAt');
}

export function printerLastConnectedAt(printer: PrintingPrinter) {
  const capabilities = asRecord(printer.capabilities);
  const value = capabilities?.lastConnectedAt;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function latestCapabilityTimestamp(
  printers: PrintingPrinter[],
  key: string,
) {
  let latest: { value: string; timestamp: number } | null = null;
  for (const printer of printers) {
    const capabilities = asRecord(printer.capabilities);
    const value = capabilities?.[key];
    if (typeof value !== 'string') continue;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) continue;
    if (!latest || timestamp > latest.timestamp) latest = { value, timestamp };
  }
  return latest?.value ?? null;
}

function connectorEvidence(printer: PrintingPrinter) {
  const capabilities = asRecord(printer.capabilities);
  return asRecord(capabilities?.connectorStatus);
}

function evidenceTimestamp(printer: PrintingPrinter) {
  const value = printer.readiness?.evidenceUpdatedAt;
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isEvidenceFresh(
  printer: PrintingPrinter,
  evidenceAt: number | null,
  now: number,
) {
  if (evidenceAt === null) return false;
  const ttl = printer.readiness?.evidenceTtlMs;
  const evidenceTtlMs =
    typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0
      ? ttl
      : DEFAULT_EVIDENCE_TTL_MS;
  return evidenceAt >= now - evidenceTtlMs && evidenceAt <= now + MAX_FUTURE_SKEW_MS;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
