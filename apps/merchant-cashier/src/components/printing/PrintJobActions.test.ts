import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CashierApiError } from '@/api';
import { useAuthStore, useNetworkStore, usePrintingStore, useUiStore } from '@/stores';
import type { CashierPrintJob } from '@/types';
import PrintJobActions from './PrintJobActions.vue';

const printer = {
  id: 'printer-1',
  name: 'Front USB',
  channelType: 'LOCAL_USB_ESCPOS',
  paperWidth: 'MM80' as const,
  enabled: true,
  status: 'ONLINE' as const,
  connectionConfig: {},
  readiness: {
    state: 'READY' as const,
    channelImplemented: true,
    configValid: true,
    statusReady: true,
  },
};

const existingJob = {
  id: 'job-1',
  orderId: 'order-1',
  printerId: printer.id,
  receiptType: 'ORDER_CUSTOMER',
  source: 'MANUAL',
  status: 'FAILED',
  attemptCount: 1,
  maxAttempts: 3,
  createdAt: '2026-07-16T08:00:00.000Z',
} as const;

function readyStores() {
  const auth = useAuthStore();
  auth.$patch({
    accessToken: 'non-sensitive-test-auth',
    session: {
      id: 'staff-1',
      displayName: 'Test staff',
      username: 'test-staff',
      role: 'OWNER',
      mustChangePassword: false,
      merchant: { id: 'merchant-1', nameZh: 'Test merchant', status: 'ACTIVE' },
    },
  });
  const network = useNetworkStore();
  network.$patch({ online: true, apiReachable: true });
  const printing = usePrintingStore();
  printing.$patch({
    featureState: {
      taskCenterEnabled: true,
      automaticCreationEnabled: false,
      executionEnabled: true,
      legacyPrintingEnabled: false,
      merchantPrintingEnabled: true,
      executionState: 'READY_FOR_CONNECTOR',
    },
    printers: [printer],
  });
  return printing;
}

describe('PrintJobActions compact action', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the existing order PrintJob flow without rendering the standalone card', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const printing = readyStores();
    vi.spyOn(printing, 'listEntityJobs').mockResolvedValue([]);
    const printOrder = vi.spyOn(printing, 'printOrder').mockResolvedValue({
      id: 'job-1',
      orderId: 'order-1',
      printerId: printer.id,
      receiptType: 'ORDER_CUSTOMER',
      source: 'MANUAL',
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: 3,
      createdAt: '2026-07-16T08:00:00.000Z',
    });
    const wrapper = mount(PrintJobActions, {
      props: { compact: true, orderId: 'order-1' },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    expect(wrapper.find('.print-job-actions').exists()).toBe(false);
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(printOrder).toHaveBeenCalledWith('order-1', 'printer-1');
    expect(useUiStore().toasts).toEqual([]);
    wrapper.unmount();
  });

  it('prioritizes one TABLE_BILL request, keeps the compact print label, and blocks a rapid second click', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const printing = readyStores();
    const listEntityJobs = vi.spyOn(printing, 'listEntityJobs').mockResolvedValue([]);
    let resolveJob!: (job: CashierPrintJob) => void;
    const printTableBill = vi.spyOn(printing, 'printTableBill').mockImplementation(
      () => new Promise<CashierPrintJob>((resolve) => { resolveJob = resolve; }),
    );
    const printOrder = vi.spyOn(printing, 'printOrder');
    const wrapper = mount(PrintJobActions, {
      props: {
        compact: true,
        tableSessionId: 'session-417',
        orderId: 'order-652',
        compactMode: 'inline',
      },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    expect(wrapper.get('button').text()).toBe('打印');
    expect(wrapper.get('button').attributes('data-print-state')).toBe('ready');
    expect(wrapper.get('button').classes()).toContain('detail-print-action--inline');
    expect(listEntityJobs).toHaveBeenCalledWith({ tableSessionId: 'session-417' });
    await wrapper.get('button').trigger('click');
    await wrapper.get('button').trigger('click');

    expect(printTableBill).toHaveBeenCalledTimes(1);
    expect(printTableBill).toHaveBeenCalledWith('session-417', 'printer-1');
    expect(printOrder).not.toHaveBeenCalled();
    expect(wrapper.get('button').text()).toContain('提交中');
    expect(wrapper.get('button').attributes('data-print-state')).toBe('submitting');
    expect(wrapper.get('button').attributes('aria-busy')).toBe('true');

    resolveJob({
      id: 'job-table-1',
      tableSessionId: 'session-417',
      printerId: printer.id,
      receiptType: 'TABLE_BILL',
      source: 'MANUAL',
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: 3,
      createdAt: '2026-08-29T02:00:00.000Z',
    });
    await flushPromises();
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button').text()).toContain('打印中');
    expect(wrapper.get('button').attributes('data-print-state')).toBe('printing');
    await wrapper.get('button').trigger('click');
    expect(printTableBill).toHaveBeenCalledTimes(1);
    expect(useUiStore().toasts).toEqual([]);
    wrapper.unmount();
  });

  it('blocks a new direct print while the same entity already has an in-flight job', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const printing = readyStores();
    vi.spyOn(printing, 'listEntityJobs').mockResolvedValue([
      {
        ...existingJob,
        tableSessionId: 'session-417',
        orderId: null,
        status: 'CLAIMED',
      },
    ]);
    const printTableBill = vi.spyOn(printing, 'printTableBill');
    const wrapper = mount(PrintJobActions, {
      props: { compact: true, tableSessionId: 'session-417' },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button').text()).toContain('打印中');
    expect(wrapper.get('button').attributes('data-print-state')).toBe('printing');
    await wrapper.get('button').trigger('click');
    expect(printTableBill).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('renders an offline printer as a grey disabled action with an explicit reason', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const printing = readyStores();
    printing.$patch({
      printers: [{
        ...printer,
        status: 'OFFLINE',
        readiness: { ...printer.readiness, state: 'DEVICE_OFFLINE', statusReady: false },
      }],
    });
    const wrapper = mount(PrintJobActions, {
      props: { compact: true, orderId: 'order-1' },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    const button = wrapper.get('button');
    expect(button.text()).toContain('设备离线');
    expect(button.attributes('data-print-state')).toBe('offline');
    expect(button.attributes('data-print-tone')).toBe('muted');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('title')).toBe('打印设备离线');
    wrapper.unmount();
  });

  it('shows checking and blocks the print while API reachability is unknown', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    readyStores();
    useNetworkStore().$patch({ apiReachable: null });
    const wrapper = mount(PrintJobActions, {
      props: { compact: true, orderId: 'order-1' },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    expect(wrapper.get('button').text()).toContain('检查打印');
    expect(wrapper.get('button').attributes('data-print-state')).toBe('checking');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button').attributes('aria-busy')).toBe('true');
    wrapper.unmount();
  });

  it('renders a confirmed API outage as an offline disabled action', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    readyStores();
    useNetworkStore().$patch({ apiReachable: false });
    const wrapper = mount(PrintJobActions, {
      props: { compact: true, orderId: 'order-1' },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    expect(wrapper.get('button').text()).toContain('网络断开');
    expect(wrapper.get('button').attributes('data-print-state')).toBe('network-offline');
    expect(wrapper.get('button').attributes('data-print-tone')).toBe('muted');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('shows a transient success state after the active job succeeds', async () => {
    vi.useFakeTimers();
    const pinia = createPinia();
    setActivePinia(pinia);
    const printing = readyStores();
    const pendingJob: CashierPrintJob = {
      id: 'job-success',
      tableSessionId: 'session-417',
      printerId: printer.id,
      receiptType: 'TABLE_BILL',
      source: 'MANUAL',
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: 3,
      createdAt: '2026-09-01T01:00:00.000Z',
    };
    vi.spyOn(printing, 'listEntityJobs')
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ ...pendingJob, status: 'SUCCEEDED', completedAt: '2026-09-01T01:00:02.000Z' }]);
    vi.spyOn(printing, 'printTableBill').mockResolvedValue(pendingJob);
    const wrapper = mount(PrintJobActions, {
      props: { compact: true, tableSessionId: 'session-417' },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.get('button').attributes('data-print-state')).toBe('printing');

    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();
    expect(wrapper.get('button').text()).toContain('已打印');
    expect(wrapper.get('button').attributes('data-print-state')).toBe('success');
    expect(wrapper.get('button').attributes('data-print-tone')).toBe('success');

    await vi.advanceTimersByTimeAsync(2_500);
    await flushPromises();
    expect(wrapper.get('button').text()).toBe('打印');
    expect(wrapper.get('button').attributes('data-print-state')).toBe('ready');
    wrapper.unmount();
  });

  it('locks an active job whose server outcome is unknown so it cannot be printed twice', async () => {
    vi.useFakeTimers();
    const pinia = createPinia();
    setActivePinia(pinia);
    const printing = readyStores();
    const pendingJob: CashierPrintJob = {
      id: 'job-unknown',
      orderId: 'order-1',
      printerId: printer.id,
      receiptType: 'ORDER_CUSTOMER',
      source: 'MANUAL',
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: 3,
      createdAt: '2026-09-01T01:00:00.000Z',
    };
    vi.spyOn(printing, 'listEntityJobs')
      .mockResolvedValueOnce([])
      .mockResolvedValue([{
        ...pendingJob,
        status: 'FAILED',
        lastErrorCode: 'PRINT_OUTCOME_UNKNOWN',
      }]);
    const printOrder = vi.spyOn(printing, 'printOrder').mockResolvedValue(pendingJob);
    const wrapper = mount(PrintJobActions, {
      props: { compact: true, orderId: 'order-1' },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    await wrapper.get('button').trigger('click');
    await flushPromises();
    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();

    expect(wrapper.get('button').text()).toContain('结果未知');
    expect(wrapper.get('button').attributes('data-print-state')).toBe('unknown');
    expect(wrapper.get('button').attributes('data-print-tone')).toBe('warning');
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    await wrapper.get('button').trigger('click');
    expect(printOrder).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('keeps a visible retry action when creating a print job is definitively rejected', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const printing = readyStores();
    vi.spyOn(printing, 'listEntityJobs').mockResolvedValue([]);
    vi.spyOn(printing, 'printOrder').mockRejectedValue(new CashierApiError({
      status: 409,
      code: 'PRINTER_OFFLINE',
      message: 'printer unavailable',
    }));
    const wrapper = mount(PrintJobActions, {
      props: { compact: true, orderId: 'order-1' },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(useUiStore().toasts.map((toast) => toast.tone)).toEqual(['error']);
    expect(wrapper.get('button').text()).toContain('重试打印');
    expect(wrapper.get('button').attributes('data-print-state')).toBe('error');
    expect(wrapper.get('button').attributes('data-print-tone')).toBe('error');
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('keeps an uncertain result visible and reconciles with the same request on retry', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const printing = readyStores();
    vi.spyOn(printing, 'listEntityJobs').mockResolvedValue([]);
    const printOrder = vi.spyOn(printing, 'printOrder').mockRejectedValue(new Error('connection lost'));
    const wrapper = mount(PrintJobActions, {
      props: { compact: true, orderId: 'order-1' },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(useUiStore().toasts.map((toast) => toast.tone)).toEqual(['warning']);
    expect(wrapper.get('button').text()).toContain('结果未知');
    expect(wrapper.get('button').attributes('data-print-state')).toBe('unknown');
    expect(wrapper.get('button').attributes('data-print-tone')).toBe('warning');
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    await wrapper.get('button').trigger('click');
    expect(printOrder).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('reprints silently after the required dangerous-action reason is confirmed', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const printing = readyStores();
    vi.spyOn(printing, 'listEntityJobs').mockResolvedValue([existingJob]);
    const reprint = vi.spyOn(printing, 'reprint').mockResolvedValue({
      ...existingJob,
      id: 'job-2',
      status: 'PENDING',
      attemptCount: 0,
      source: 'MANUAL_REPRINT',
    });
    const wrapper = mount(PrintJobActions, {
      props: { orderId: 'order-1' },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    await wrapper.get('.print-job-actions__buttons button:last-child').trigger('click');
    await wrapper.get('.print-job-actions__reason input').setValue('小票破损');
    await wrapper.get('.print-job-actions__reason').trigger('submit');
    await flushPromises();

    expect(reprint).toHaveBeenCalledWith('job-1', '小票破损', 'printer-1');
    expect(wrapper.find('.print-job-actions__reason').exists()).toBe(false);
    expect(useUiStore().toasts).toEqual([]);
    wrapper.unmount();
  });

  it('keeps a visible error when a confirmed reprint fails', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const printing = readyStores();
    vi.spyOn(printing, 'listEntityJobs').mockResolvedValue([existingJob]);
    vi.spyOn(printing, 'reprint').mockRejectedValue(new Error('reprint unavailable'));
    const wrapper = mount(PrintJobActions, {
      props: { orderId: 'order-1' },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    await wrapper.get('.print-job-actions__buttons button:last-child').trigger('click');
    await wrapper.get('.print-job-actions__reason input').setValue('小票破损');
    await wrapper.get('.print-job-actions__reason').trigger('submit');
    await flushPromises();

    expect(wrapper.find('.print-job-actions__reason').exists()).toBe(true);
    expect(useUiStore().toasts.map((toast) => toast.tone)).toEqual(['error']);
    wrapper.unmount();
  });
});
