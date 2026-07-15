import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  createOrderPrintJob,
  createPrintJobReprint,
  createTableBillPrintJob,
  getCashierPrintingFeatureState,
  listCashierMerchantTerminals,
  listCashierPrintJobs,
  listCashierPrintingPrinters,
  messageFromApiError,
} from '@/api';
import { cashierStorageKeys } from '@/config';
import type {
  CashierPrintJob,
  CashierMerchantTerminal,
  CashierPrintingAvailability,
  CashierPrintingFeatureState,
  CashierPrintingPrinter,
} from '@/types';
import { useAuthStore } from './auth';

export const usePrintingStore = defineStore('cashier-printing', () => {
  const featureState = ref<CashierPrintingFeatureState | null>(null);
  const printers = ref<CashierPrintingPrinter[]>([]);
  const terminals = ref<CashierMerchantTerminal[]>([]);
  const loading = ref(false);
  const submitting = ref(false);
  const error = ref('');
  const lastRefreshAt = ref<string | null>(null);

  const enabledUsbPrinters = computed(() =>
    printers.value.filter(
      (printer) => printer.enabled && printer.channelType === 'LOCAL_USB_ESCPOS',
    ),
  );
  const onlineTerminals = computed(() =>
    terminals.value.filter(
      (terminal) =>
        terminal.status === 'ACTIVE'
        && terminal.onlineState === 'ONLINE'
        && !terminal.revokedAt,
    ),
  );
  const readyUsbPrinters = computed(() => {
    const boundPrinterIds = new Set(
      onlineTerminals.value.flatMap((terminal) =>
        terminal.boundPrinterId ? [terminal.boundPrinterId] : [],
      ),
    );
    return enabledUsbPrinters.value.filter((printer) => boundPrinterIds.has(printer.id));
  });

  const availability = computed<CashierPrintingAvailability>(() => {
    const auth = useAuthStore();
    if (auth.demoMode) return 'DISABLED';
    if (loading.value && !featureState.value) return 'LOADING';
    if (error.value && !featureState.value) return 'UNAVAILABLE';
    if (
      !featureState.value?.taskCenterEnabled
      || !featureState.value.executionEnabled
      || featureState.value.merchantPrintingEnabled === false
    ) {
      return 'DISABLED';
    }
    if (!enabledUsbPrinters.value.length) return 'CONFIG_REQUIRED';
    if (!onlineTerminals.value.length) return 'TERMINAL_OFFLINE';
    if (!readyUsbPrinters.value.length) return 'CONFIG_REQUIRED';
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
    try {
      const [feature, nextPrinters, nextTerminals] = await Promise.all([
        getCashierPrintingFeatureState(),
        listCashierPrintingPrinters(),
        listCashierMerchantTerminals(),
      ]);
      featureState.value = feature;
      printers.value = nextPrinters;
      terminals.value = nextTerminals;
      lastRefreshAt.value = new Date().toISOString();
    } catch (caught) {
      error.value = messageFromApiError(caught);
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
    terminals.value = [];
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
    terminals,
    enabledUsbPrinters,
    onlineTerminals,
    readyUsbPrinters,
    availability,
    ready,
    loading,
    submitting,
    error,
    lastRefreshAt,
    refreshStatus,
    listEntityJobs,
    printOrder,
    printTableBill,
    reprint,
    clear,
  };
});

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
