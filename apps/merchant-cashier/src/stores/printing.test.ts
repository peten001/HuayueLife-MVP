import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  createOrderPrintJob: vi.fn(),
  createPrintJobReprint: vi.fn(),
  createTableBillPrintJob: vi.fn(),
  getCashierPrintingFeatureState: vi.fn(),
  listCashierPrintJobs: vi.fn(),
  listCashierPrintingPrinters: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api')>(),
  ...apiMocks,
}));

import { usePrintingStore } from './printing';

const enabledFeature = {
  taskCenterEnabled: true,
  automaticCreationEnabled: false,
  executionEnabled: true,
  legacyPrintingEnabled: false,
  executionState: 'READY_FOR_CONNECTOR' as const,
};

const usbPrinter = {
  id: 'printer-1',
  name: 'Front USB',
  channelType: 'LOCAL_USB_ESCPOS',
  paperWidth: 'MM80' as const,
  enabled: true,
  status: 'ONLINE',
};

describe('cashier printing gate', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    apiMocks.getCashierPrintingFeatureState.mockResolvedValue(enabledFeature);
    apiMocks.listCashierPrintingPrinters.mockResolvedValue([usbPrinter]);
  });

  it('is ready only when task execution and an enabled USB printer are available', async () => {
    const store = usePrintingStore();
    await store.refreshStatus();
    expect(store.availability).toBe('READY');
    expect(store.ready).toBe(true);

    apiMocks.listCashierPrintingPrinters.mockResolvedValueOnce([]);
    await store.refreshStatus();
    expect(store.availability).toBe('CONFIG_REQUIRED');

    apiMocks.listCashierPrintingPrinters.mockResolvedValueOnce([
      { ...usbPrinter, status: 'OFFLINE' },
    ]);
    await store.refreshStatus();
    expect(store.availability).toBe('TERMINAL_OFFLINE');

    apiMocks.getCashierPrintingFeatureState.mockResolvedValueOnce({
      ...enabledFeature,
      executionEnabled: false,
      executionState: 'CONNECTOR_PENDING',
    });
    await store.refreshStatus();
    expect(store.availability).toBe('DISABLED');
  });

  it('does not submit a job while printing is disabled', async () => {
    apiMocks.getCashierPrintingFeatureState.mockResolvedValueOnce({
      ...enabledFeature,
      executionEnabled: false,
      executionState: 'CONNECTOR_PENDING',
    });
    const store = usePrintingStore();
    await store.refreshStatus();

    await expect(store.printOrder('order-1', 'printer-1')).rejects.toThrow('not ready');
    expect(apiMocks.createOrderPrintJob).not.toHaveBeenCalled();
  });

  it('creates only controlled server jobs and requires a reason for reprint', async () => {
    const job = {
      id: 'job-1',
      orderId: 'order-1',
      printerId: 'printer-1',
      receiptType: 'ORDER_CUSTOMER',
      source: 'MANUAL_REPRINT',
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: 3,
      createdAt: '2026-07-15T00:00:00.000Z',
    };
    apiMocks.createOrderPrintJob.mockResolvedValue(job);
    apiMocks.createPrintJobReprint.mockResolvedValue({ ...job, id: 'job-2' });
    const store = usePrintingStore();
    await store.refreshStatus();

    await expect(store.printOrder('order-1', 'printer-1')).resolves.toEqual(job);
    expect(apiMocks.createOrderPrintJob).toHaveBeenCalledWith(
      'order-1',
      'printer-1',
      expect.stringMatching(/^cashier\./),
    );
    await expect(store.reprint('job-1', '   ')).rejects.toThrow('reason');
    expect(apiMocks.createPrintJobReprint).not.toHaveBeenCalled();
    await store.reprint('job-1', 'Damaged receipt', 'printer-1');
    expect(apiMocks.createPrintJobReprint).toHaveBeenCalledWith('job-1', {
      reason: 'Damaged receipt',
      printerId: 'printer-1',
      requestKey: expect.stringMatching(/^cashier\./),
    });
  });

  it('reuses the same persisted request key after an ambiguous network failure', async () => {
    const job = {
      id: 'job-1',
      orderId: 'order-1',
      printerId: 'printer-1',
      receiptType: 'ORDER_CUSTOMER',
      source: 'MANUAL',
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: 3,
      createdAt: '2026-07-15T00:00:00.000Z',
    };
    apiMocks.createOrderPrintJob
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(job);
    const store = usePrintingStore();
    await store.refreshStatus();

    await expect(store.printOrder('order-1', 'printer-1')).rejects.toThrow('response lost');
    const firstKey = apiMocks.createOrderPrintJob.mock.calls[0]?.[2];
    await expect(store.printOrder('order-1', 'printer-1')).resolves.toEqual(job);
    expect(apiMocks.createOrderPrintJob.mock.calls[1]?.[2]).toBe(firstKey);
    expect(window.localStorage.getItem('yunqiao_cashier_print_request_keys')).toBe('{}');
  });
});
