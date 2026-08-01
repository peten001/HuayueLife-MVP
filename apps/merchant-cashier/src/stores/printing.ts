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
  CashierLocalPrinterChannel,
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

  const localPrinters = computed(() =>
    printers.value.filter(isActiveLocalPrinter),
  );
  const configuredLocalPrinters = computed(() =>
    localPrinters.value.filter(isConfiguredLocalPrinter),
  );
  const enabledPrinters = computed(() =>
    printers.value.filter((printer) => printer.enabled),
  );
  const enabledLocalPrinters = computed(() =>
    configuredLocalPrinters.value.filter((printer) => printer.enabled),
  );
  const readyLocalPrinters = computed(() =>
    enabledLocalPrinters.value.filter(isReadyLocalPrinter),
  );
  // Keep the RC5 aliases available while all new selection/readiness logic is
  // explicitly based on the three V2 local channels.
  const configuredUsbPrinters = configuredLocalPrinters;
  const enabledUsbPrinters = enabledLocalPrinters;
  const readyUsbPrinters = readyLocalPrinters;

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
      !configuredLocalPrinters.value.length
      || localPrinters.value.every(isPrinterNotConfigured)
    ) return 'NOT_CONFIGURED';
    if (
      !auth.isAuthenticated
      || auth.mustChangePassword
      || !isExistingPrintingRole(auth.role)
      || !featureState.value.taskCenterEnabled
      || !featureState.value.executionEnabled
      || !readyLocalPrinters.value.length
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
      printers.value = nextPrinters.filter((printer) => !isArchivedPrinter(printer));
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
    localPrinters,
    configuredLocalPrinters,
    configuredUsbPrinters,
    enabledPrinters,
    enabledLocalPrinters,
    enabledUsbPrinters,
    readyLocalPrinters,
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
const LAN_CHANNEL = 'LOCAL_LAN_ESCPOS';
const BLUETOOTH_CHANNEL = 'LOCAL_BLUETOOTH_ESCPOS';
const LOCAL_CHANNELS = new Set<CashierLocalPrinterChannel>([
  USB_CHANNEL,
  LAN_CHANNEL,
  BLUETOOTH_CHANNEL,
]);
const USB_CUT_MODES = new Set(['NONE', 'HALF', 'FULL']);
const EXISTING_PRINTING_ROLES = new Set(['OWNER', 'MANAGER', 'STAFF']);

function isActiveLocalPrinter(printer: CashierPrintingPrinter) {
  return LOCAL_CHANNELS.has(printer.channelType as CashierLocalPrinterChannel)
    && !isArchivedPrinter(printer);
}

function isArchivedPrinter(printer: CashierPrintingPrinter) {
  if (printer.v2?.archivedAt) return true;
  if (!isPlainObject(printer.capabilities)) return false;
  const binding = printer.capabilities.v2Binding;
  return isPlainObject(binding) && typeof binding.archivedAt === 'string';
}

function isConfiguredLocalPrinter(printer: CashierPrintingPrinter) {
  if (!isActiveLocalPrinter(printer) || !isPlainObject(printer.connectionConfig)) return false;
  if (printer.channelType === USB_CHANNEL) return isConfiguredUsbPrinter(printer);
  if (printer.channelType === LAN_CHANNEL) return isConfiguredLanPrinter(printer);
  return isConfiguredBluetoothPrinter(printer);
}

function isConfiguredUsbPrinter(printer: CashierPrintingPrinter) {
  if (printer.v2) {
    const { vendorId, productId } = printer.connectionConfig;
    return isIntegerInRange(vendorId, 0, 65_535)
      && isIntegerInRange(productId, 0, 65_535);
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

function isConfiguredLanPrinter(printer: CashierPrintingPrinter) {
  const { host, port } = printer.connectionConfig;
  return typeof host === 'string'
    && isPrivateIpv4(host)
    && isIntegerInRange(port, 1, 65_535);
}

function isConfiguredBluetoothPrinter(printer: CashierPrintingPrinter) {
  const { macAddress, deviceName, serviceUuid } = printer.connectionConfig;
  return typeof macAddress === 'string'
    && /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(macAddress)
    && typeof deviceName === 'string'
    && deviceName.trim().length > 0
    && typeof serviceUuid === 'string'
    && /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(serviceUuid);
}

function isReadyLocalPrinter(printer: CashierPrintingPrinter) {
  return printer.status === 'ONLINE'
    && printer.readiness?.state === 'READY'
    && printer.readiness.channelImplemented === true
    && printer.readiness.configValid === true
    && printer.readiness.statusReady === true;
}

function isPrinterNotConfigured(printer: CashierPrintingPrinter) {
  if (printer.readiness?.state === 'NOT_CONFIGURED') return true;
  return !isConfiguredLocalPrinter(printer);
}

function isPrivateIpv4(value: string) {
  const parts = value.trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
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
