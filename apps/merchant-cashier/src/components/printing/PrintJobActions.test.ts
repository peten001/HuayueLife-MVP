import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore, useNetworkStore, usePrintingStore, useUiStore } from '@/stores';
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

  it('keeps a visible error when creating a print job fails', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const printing = readyStores();
    vi.spyOn(printing, 'listEntityJobs').mockResolvedValue([]);
    vi.spyOn(printing, 'printOrder').mockRejectedValue(new Error('printer unavailable'));
    const wrapper = mount(PrintJobActions, {
      props: { compact: true, orderId: 'order-1' },
      global: { plugins: [pinia] },
    });
    await flushPromises();

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(useUiStore().toasts.map((toast) => toast.tone)).toEqual(['error']);
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
