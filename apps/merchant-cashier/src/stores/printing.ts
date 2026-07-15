import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  createOrderPrintJob,
  createPrintJobReprint,
  createTableBillPrintJob,
  getCashierPrintingFeatureState,
  listCashierPrintJobs,
  listCashierPrintingPrinters,
  messageFromApiError,
} from '@/api';
import { cashierStorageKeys } from '@/config';
import type {
  CashierPrintJob,
  CashierPrintingAvailability,
  CashierPrintingFeatureState,
  CashierPrintingPrinter,
} from '@/types';
import { useAuthStore } from './auth';

export const usePrintingStore = defineStore('cashier-printing', () => {
  const featureState = ref<CashierPrintingFeatureState | null>(null);
  const printers = ref<CashierPrintingPrinter[]>([]);
  const loading = ref(false);
  const submitting = ref(false);
  const error = ref('');
  const statusError = ref('');
  const lastRefreshAt = ref<string | null>(null);

  const configuredUsbPrinters = computed(() =>
    printers.value.filter(isConfiguredUsbPrinter),
  );
  const enabledPrinters = computed(() =>
    printers.value.filter((printer) => printer.enabled),
  );
  const enabledUsbPrinters = computed(() =>
    configuredUsbPrinters.value.filter((printer) => printer.enabled),
  );
  const readyUsbPrinters = computed(() =>
    enabledUsbPrinters.value.filter(isReadyUsbPrinter),
  );

  const availability = computed<CashierPrintingAvailability>(() => {
    const auth = useAuthStore();
    if (auth.demoMode) return 'NOT_ENABLED';
    if (loading.value && !featureState.value) return 'LOADING';
    // Without a verified platform capability response, never infer that the
    // merchant is enabled. The separate network indicator carries diagnostics.
    if (statusError.value && !featureState.value) return 'NOT_ENABLED';
    if (featureState.value?.merchantPrintingEnabled !== true) return 'NOT_ENABLED';
    if (statusError.value) return 'DEVICE_OFFLINE';
    if (
      !enabledPrinters.value.length
      || enabledPrinters.value.every(isPrinterNotConfigured)
    ) return 'NOT_CONFIGURED';
    if (
      !auth.isAuthenticated
      || auth.mustChangePassword
      || !isExistingPrintingRole(auth.role)
      || !featureState.value.taskCenterEnabled
      || !featureState.value.executionEnabled
      || !readyUsbPrinters.value.length
    ) return 'DEVICE_OFFLINE';
    return 'READY';
  });

  const ready = computed(() => availability.value === 'READY');

  async function refreshStatus() {
    const auth = useAuthStore();
    if (auth.demoMode) {
      clear();
      return;
    }
    loading.value = true;
    error.value = '';
    statusError.value = '';
    try {
      const [feature, nextPrinters] = await Promise.all([
        getCashierPrintingFeatureState(),
        listCashierPrintingPrinters(),
      ]);
      featureState.value = feature;
      printers.value = nextPrinters;
      lastRefreshAt.value = new Date().toISOString();
    } catch (caught) {
      statusError.value = messageFromApiError(caught);
      error.value = statusError.value;
      throw caught;
    } finally {
      loading.value = false;
    }
  }

  async function listEntityJobs(entity: { orderId?: string; tableSessionId?: string }) {
    return listCashierPrintJobs({ ...entity, limit: 20 });
  }

  async function printOrder(orderId: string, printerId: string) {
    const operationKey = `order:${orderId}:${printerId}`;
    return submit(operationKey, (requestKey) =>
      createOrderPrintJob(orderId, printerId, requestKey),
    );
  }

  async function printTableBill(tableSessionId: string, printerId: string) {
    const operationKey = `table:${tableSessionId}:${printerId}`;
    return submit(operationKey, (requestKey) =>
      createTableBillPrintJob(tableSessionId, printerId, requestKey),
    );
  }

  async function reprint(jobId: string, reason: string, printerId?: string) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3) {
      throw new Error('Reprint reason must contain at least 3 characters');
    }
    const operationKey = `reprint:${jobId}:${printerId ?? 'original'}`;
    return submit(operationKey, (requestKey) =>
      createPrintJobReprint(jobId, {
        reason: normalizedReason,
        ...(printerId ? { printerId } : {}),
        requestKey,
      }),
    );
  }

  async function submit(
    operationKey: string,
    operation: (requestKey: string) => Promise<CashierPrintJob>,
  ) {
    if (!ready.value || submitting.value) throw new Error('Printing is not ready');
    const requestKey = getOrCreateRequestKey(operationKey);
    submitting.value = true;
    error.value = '';
    statusError.value = '';
    try {
      const result = await operation(requestKey);
      clearRequestKey(operationKey);
      return result;
    } catch (caught) {
      error.value = messageFromApiError(caught);
      throw caught;
    } finally {
      submitting.value = false;
    }
  }

  function clear() {
    featureState.value = null;
    printers.value = [];
    loading.value = false;
    submitting.value = false;
    error.value = '';
    lastRefreshAt.value = null;
  }

  function getOrCreateRequestKey(operationKey: string) {
    const keys = readRequestKeys();
    const existing = keys[operationKey];
    if (existing) return existing;
    const generated = `cashier.${createRequestId()}`;
    keys[operationKey] = generated;
    writeRequestKeys(keys);
    return generated;
  }

  function clearRequestKey(operationKey: string) {
    const keys = readRequestKeys();
    if (!(operationKey in keys)) return;
    delete keys[operationKey];
    writeRequestKeys(keys);
  }

  return {
    featureState,
    printers,
    configuredUsbPrinters,
    enabledPrinters,
    enabledUsbPrinters,
    readyUsbPrinters,
    availability,
    ready,
    loading,
    submitting,
    error,
    statusError,
    lastRefreshAt,
    refreshStatus,
    listEntityJobs,
    printOrder,
    printTableBill,
    reprint,
    clear,
  };
});

const USB_CHANNEL = 'LOCAL_USB_ESCPOS';
const USB_CUT_MODES = new Set(['NONE', 'HALF', 'FULL']);
const EXISTING_PRINTING_ROLES = new Set(['OWNER', 'MANAGER', 'STAFF']);

function isConfiguredUsbPrinter(printer: CashierPrintingPrinter) {
  if (printer.channelType !== USB_CHANNEL || !isPlainObject(printer.connectionConfig)) {
    return false;
  }
  const keys = Object.keys(printer.connectionConfig);
  if (keys.some((key) => !['paperWidthDots', 'threshold', 'cutMode'].includes(key))) {
    return false;
  }
  const { paperWidthDots, threshold, cutMode } = printer.connectionConfig;
  return (
    (paperWidthDots === undefined || isIntegerInRange(paperWidthDots, 200, 1024))
    && (threshold === undefined || isIntegerInRange(threshold, 0, 255))
    && (cutMode === undefined || (typeof cutMode === 'string' && USB_CUT_MODES.has(cutMode)))
  );
}

function isReadyUsbPrinter(printer: CashierPrintingPrinter) {
  return printer.status === 'ONLINE'
    && printer.readiness?.state === 'READY'
    && printer.readiness.channelImplemented === true
    && printer.readiness.configValid === true
    && printer.readiness.statusReady === true;
}

function isPrinterNotConfigured(printer: CashierPrintingPrinter) {
  if (printer.readiness?.state === 'NOT_CONFIGURED') return true;
  return printer.channelType === USB_CHANNEL && !isConfiguredUsbPrinter(printer);
}

function isExistingPrintingRole(role: string | null) {
  return role !== null && EXISTING_PRINTING_ROLES.has(role);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function readRequestKeys(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(cashierStorageKeys.printRequestKeys) || '{}',
    );
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([key, requestKey]) =>
          key.length <= 256
          && typeof requestKey === 'string'
          && /^cashier\.[A-Za-z0-9.-]{16,56}$/.test(requestKey),
      ),
    );
  } catch {
    return {};
  }
}

function writeRequestKeys(keys: Record<string, string>) {
  if (typeof window === 'undefined') return;
  const entries = Object.entries(keys).slice(-50);
  window.localStorage.setItem(
    cashierStorageKeys.printRequestKeys,
    JSON.stringify(Object.fromEntries(entries)),
  );
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Secure request ID generation is unavailable');
}
