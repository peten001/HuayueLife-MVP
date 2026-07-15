export const PRINTING_ERROR_CODES = {
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  PRINTER_OFFLINE: 'PRINTER_OFFLINE',
  CONFIG_INVALID: 'CONFIG_INVALID',
  TEMPLATE_INVALID: 'TEMPLATE_INVALID',
  CHANNEL_NOT_IMPLEMENTED: 'CHANNEL_NOT_IMPLEMENTED',
  LEASE_EXPIRED: 'LEASE_EXPIRED',
  PRINT_OUTCOME_UNKNOWN: 'PRINT_OUTCOME_UNKNOWN',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  UNKNOWN: 'UNKNOWN',
  RESOURCE_NOT_FOUND: 'PRINTING_RESOURCE_NOT_FOUND',
  PRINTER_DISABLED: 'PRINTER_DISABLED',
  STATE_CONFLICT: 'PRINT_JOB_STATE_CONFLICT',
  TASK_CENTER_DISABLED: 'PRINTING_TASK_CENTER_DISABLED',
  AUTO_CREATE_DISABLED: 'PRINTING_AUTO_CREATE_DISABLED',
  EXECUTION_DISABLED: 'PRINTING_EXECUTION_DISABLED',
} as const;

export type PrintingErrorCode =
  (typeof PRINTING_ERROR_CODES)[keyof typeof PRINTING_ERROR_CODES];

export function sanitizePrintingError(message: string | null | undefined) {
  if (!message) return null;
  return message
    .replace(
      /(token|password|secret|cookie|authorization|credential|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[redacted]',
    )
    .replace(/\b\d{8,15}\b/g, '[redacted-number]')
    .slice(0, 300);
}
