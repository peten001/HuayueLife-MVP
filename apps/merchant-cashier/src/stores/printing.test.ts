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
import { useAuthStore } from './auth';

const enabledFeature = {
  taskCenterEnabled: true,
  automaticCreationEnabled: false,
  executionEnabled: true,
  legacyPrintingEnabled: false,
  merchantPrintingEnabled: true,
  executionState: 'READY_FOR_CONNECTOR' as const,
};

const usbPrinter = {
  id: 'printer-1',
  name: 'Front USB',
  channelType: 'LOCAL_USB_ESCPOS',
  paperWidth: 'MM80' as const,
  enabled: true,
  status: 'ONLINE' as const,
  connectionConfig: {},
  capabilities: {
    platform: 'ANDROID',
    usbHost: true,
    channels: ['LOCAL_USB_ESCPOS'],
    connectorState: 'CONNECTED',
    usbDeviceRecognized: true,
    usbPermissionGranted: true,
    usbInterfaceValid: true,
    usbEndpointValid: true,
    appExecutionReady: true,
  },
  readiness: {
    state: 'READY' as const,
    channelImplemented: true,
    configValid: true,
    statusReady: true,
  },
};

function authenticate() {
  const auth = useAuthStore();
  auth.$patch({
    accessToken: 'unit-test-token',
    session: {
      id: 'staff-1',
      displayName: 'Test Staff',
      username: 'test-staff',
      role: 'STAFF',
      mustChangePassword: false,
      merchant: { id: 'merchant-1', nameZh: 'Test Merchant', status: 'ACTIVE' },
    },
  });
}

describe('cashier printing gate', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    authenticate();
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    apiMocks.getCashierPrintingFeatureState.mockResolvedValue(enabledFeature);
    apiMocks.listCashierPrintingPrinters.mockResolvedValue([usbPrinter]);
  });

  it('distinguishes the four real printing availability states', async () => {
    const store = usePrintingStore();
    await store.refreshStatus();
    expect(store.availability).toBe('READY');
    expect(store.ready).toBe(true);

    apiMocks.listCashierPrintingPrinters.mockResolvedValueOnce([]);
    await store.refreshStatus();
    expect(store.availability).toBe('NOT_CONFIGURED');

    apiMocks.listCashierPrintingPrinters.mockResolvedValueOnce([
      { ...usbPrinter, status: 'OFFLINE' },
    ]);
    await store.refreshStatus();
    expect(store.availability).toBe('DEVICE_OFFLINE');

    apiMocks.getCashierPrintingFeatureState.mockResolvedValueOnce({
      ...enabledFeature,
      merchantPrintingEnabled: false,
    });
    await store.refreshStatus();
    expect(store.availability).toBe('NOT_ENABLED');
  });

  it.each(['UNKNOWN', 'UNVERIFIED', 'OFFLINE', 'ERROR', 'DISABLED'] as const)(
    'does not treat %s as ready',
    async (status) => {
      apiMocks.listCashierPrintingPrinters.mockResolvedValueOnce([
        { ...usbPrinter, status },
      ]);
      const store = usePrintingStore();
      await store.refreshStatus();
      expect(store.availability).toBe('DEVICE_OFFLINE');
      expect(store.readyUsbPrinters).toEqual([]);
    },
  );

  it('fails closed when the server readiness proof is absent or offline', async () => {
    const store = usePrintingStore();
    apiMocks.listCashierPrintingPrinters.mockResolvedValueOnce([
      { ...usbPrinter, readiness: undefined },
    ]);
    await store.refreshStatus();
    expect(store.availability).toBe('DEVICE_OFFLINE');

    apiMocks.listCashierPrintingPrinters.mockResolvedValueOnce([
      {
        ...usbPrinter,
        readiness: { ...usbPrinter.readiness, state: 'DEVICE_OFFLINE' },
      },
    ]);
    await store.refreshStatus();
    expect(store.availability).toBe('DEVICE_OFFLINE');
  });

  it('treats a disabled printer as not configured for execution', async () => {
    apiMocks.listCashierPrintingPrinters.mockResolvedValueOnce([
      { ...usbPrinter, enabled: false },
    ]);
    const store = usePrintingStore();
    await store.refreshStatus();
    expect(store.availability).toBe('NOT_CONFIGURED');
  });

  it.each([
    'channelImplemented',
    'configValid',
    'statusReady',
  ] as const)('requires the server readiness proof %s to be positive', async (proof) => {
    apiMocks.listCashierPrintingPrinters.mockResolvedValueOnce([
      {
        ...usbPrinter,
        readiness: { ...usbPrinter.readiness, [proof]: false },
      },
    ]);
    const store = usePrintingStore();
    await store.refreshStatus();
    expect(store.availability).toBe('DEVICE_OFFLINE');
  });

  it('accepts the empty USB default config and rejects invalid USB configuration', async () => {
    const store = usePrintingStore();
    await store.refreshStatus();
    expect(store.availability).toBe('READY');

    apiMocks.listCashierPrintingPrinters.mockResolvedValueOnce([
      {
        ...usbPrinter,
        connectionConfig: { paperWidthDots: 100 },
        readiness: { ...usbPrinter.readiness, state: 'NOT_CONFIGURED' },
      },
    ]);
    await store.refreshStatus();
    expect(store.availability).toBe('NOT_CONFIGURED');
  });

  it('treats an enabled but unimplemented channel as offline, not unconfigured', async () => {
    apiMocks.listCashierPrintingPrinters.mockResolvedValueOnce([
      {
        ...usbPrinter,
        channelType: 'CLOUD_FEIE',
        status: 'UNVERIFIED',
        readiness: {
          state: 'DEVICE_OFFLINE',
          channelImplemented: false,
          configValid: true,
          statusReady: false,
        },
      },
    ]);
    const store = usePrintingStore();
    await store.refreshStatus();
    expect(store.availability).toBe('DEVICE_OFFLINE');
  });

  it('fails closed when execution or the existing account permission is unavailable', async () => {
    apiMocks.getCashierPrintingFeatureState.mockResolvedValueOnce({
      ...enabledFeature,
      executionEnabled: false,
      executionState: 'CONNECTOR_PENDING',
    });
    const store = usePrintingStore();
    await store.refreshStatus();
    expect(store.availability).toBe('DEVICE_OFFLINE');

    const auth = useAuthStore();
    auth.$patch({ accessToken: '', session: null });
    apiMocks.getCashierPrintingFeatureState.mockResolvedValueOnce(enabledFeature);
    await store.refreshStatus();
    expect(store.availability).toBe('DEVICE_OFFLINE');
  });

  it('does not keep showing READY after a status refresh fails', async () => {
    const store = usePrintingStore();
    await store.refreshStatus();
    expect(store.availability).toBe('READY');

    apiMocks.getCashierPrintingFeatureState.mockRejectedValueOnce(new Error('status unavailable'));
    await expect(store.refreshStatus()).rejects.toThrow('status unavailable');
    expect(store.availability).toBe('DEVICE_OFFLINE');
    expect(store.ready).toBe(false);
  });

  it('fails closed to NOT_ENABLED when the platform capability cannot be verified initially', async () => {
    apiMocks.getCashierPrintingFeatureState.mockRejectedValueOnce(
      new Error('status unavailable'),
    );
    const store = usePrintingStore();
    await expect(store.refreshStatus()).rejects.toThrow('status unavailable');
    expect(store.availability).toBe('NOT_ENABLED');
    expect(store.ready).toBe(false);
  });

  it('does not submit a job while printing is disabled', async () => {
    apiMocks.getCashierPrintingFeatureState.mockResolvedValueOnce({
      ...enabledFeature,
      merchantPrintingEnabled: false,
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
