import { flushPromises, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CashierApiError } from '@/api';
import { setLocale, t } from '@/i18n';
import { useNetworkStore, useOrdersStore, useTablesStore, useUiStore } from '@/stores';
import type { DiningTable, DineInCanonicalState, TableSessionDetail } from '@/types';
import TableBillDetail from '@/components/bills/TableBillDetail.vue';
import CheckoutPaymentDialog from '@/components/settlement/CheckoutPaymentDialog.vue';
import TableOverviewPage from './TableOverviewPage.vue';

const mocks = vi.hoisted(() => ({
  route: { params: { tableId: 'table-1' }, query: {}, meta: {} },
  replace: vi.fn(),
  getDineInCanonicalState: vi.fn(),
  checkoutTableSession: vi.fn(),
  listDiningTables: vi.fn(),
  listOpenTableSessions: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
}));
vi.mock('@/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api')>(),
  getDineInCanonicalState: mocks.getDineInCanonicalState,
  checkoutTableSession: mocks.checkoutTableSession,
  listDiningTables: mocks.listDiningTables,
  listOpenTableSessions: mocks.listOpenTableSessions,
}));

const table: DiningTable = {
  id: 'table-1', merchantId: 'merchant-1', tableNo: '02', qrToken: 'test', qrVersion: 1, status: 'ACTIVE',
};
const session: TableSessionDetail = {
  id: 'session-1', sessionNo: 'SESSION-1', merchantId: table.merchantId, tableId: table.id, tableNo: table.tableNo,
  status: 'OPEN', openedAt: '2026-10-17T00:00:00.000Z', orderCount: 1, itemCount: 1,
  totalAmountVnd: '50000', pendingOrderCount: 0, unfinishedOrderCount: 1, orders: [],
};
const state: DineInCanonicalState = {
  sessionId: session.id, tableId: table.id, tableNo: table.tableNo, sessionStatus: 'OPEN', openedAt: session.openedAt,
  revision: 'dcs2:sha256:' + '1'.repeat(64),
  items: [{
    lineKey: 'dline:sha256:' + '1'.repeat(64), productId: 'product-1', productNameZh: '青椒肉丝',
    remark: '', optionSignature: '', activeSince: session.openedAt, displayOrderKey: '1', unitPriceVnd: '50000',
    quantity: 1, returnedQuantity: 0, unnotifiedQuantity: 0, lockedQuantity: 0, adjustableQuantity: 1,
    subtotalVnd: '50000', adjustability: 'RETURN', sourceSummary: { staffQuantity: 1, qrQuantity: 0 },
  }],
  totals: { originalAmountVnd: '50000', discountPayableRateBps: null, discountAmountVnd: '0', roundingAmountVnd: '0', payableAmountVnd: '50000' },
  blockers: [], generatedAt: session.openedAt,
};

async function openDialog(mobile = false) {
  const pinia = createPinia(); setActivePinia(pinia);
  const tables = useTablesStore();
  tables.$patch({ tables: [table], openSessions: [session], selectedTableId: table.id, selectedSessionDetail: session });
  vi.spyOn(tables, 'hydrateTableSelection').mockResolvedValue(session);
  vi.spyOn(tables, 'fetchTables').mockResolvedValue([]);
  vi.spyOn(useOrdersStore(), 'selectOrder').mockResolvedValue(null);
  useNetworkStore().$patch({ online: true, apiReachable: true });
  const wrapper = shallowMount(TableOverviewPage, {
    attachTo: document.body,
    props: { mobileV2Presentation: mobile },
    global: { plugins: [pinia], stubs: { CheckoutPaymentDialog: false } },
  });
  await flushPromises();
  wrapper.getComponent(TableBillDetail).vm.$emit('checkout');
  await flushPromises();
  await wrapper.get('input[value="CASH"]').setValue(true);
  return wrapper;
}

describe('table checkout feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLocale('zh');
    mocks.getDineInCanonicalState.mockResolvedValue(state);
    mocks.checkoutTableSession.mockReset();
    mocks.listDiningTables.mockResolvedValue([table]);
    mocks.listOpenTableSessions.mockResolvedValue([]);
  });
  afterEach(() => { setLocale('zh'); document.body.innerHTML = ''; });

  it.each([
    ['KDS_CHECKOUT_MAKING_REQUIRED', 'table.kitchenMakingRequired', false],
    ['KDS_CHECKOUT_SERVING_REQUIRED', 'table.kitchenServingRequired', false],
    ['KDS_CHECKOUT_MAKING_REQUIRED', 'table.kitchenMakingRequired', true],
    ['KDS_CHECKOUT_SERVING_REQUIRED', 'table.kitchenServingRequired', true],
  ] as const)('shows %s inside the payment dialog (%s, mobile=%s)', async (code, key, mobile) => {
    mocks.checkoutTableSession.mockRejectedValue(new CashierApiError({ status: 409, code, message: 'kitchen incomplete' }));
    const wrapper = await openDialog(mobile);
    await wrapper.get('.payment-dialog footer .primary-action').trigger('click');
    await flushPromises();

    expect(wrapper.get('.payment-dialog footer [role="alert"]').text()).toBe(t(key));
    expect(wrapper.getComponent(CheckoutPaymentDialog).props('open')).toBe(true);
    expect((wrapper.get('input[value="CASH"]').element as HTMLInputElement).checked).toBe(true);
    expect(useUiStore().toasts).toEqual([]);
    for (const locale of ['vi', 'en'] as const) {
      setLocale(locale); await flushPromises();
      expect(wrapper.get('.payment-dialog footer [role="alert"]').text()).toBe(t(key));
    }
    wrapper.unmount();
  });

  it('allows a new checkout after a definitive kitchen rejection and closes on success', async () => {
    mocks.checkoutTableSession
      .mockRejectedValueOnce(new CashierApiError({ status: 409, code: 'KDS_CHECKOUT_MAKING_REQUIRED', message: 'incomplete' }))
      .mockResolvedValueOnce({ session: { ...session, status: 'CLOSED' }, orders: [] });
    const wrapper = await openDialog();
    await wrapper.get('.payment-dialog footer .primary-action').trigger('click'); await flushPromises();
    await wrapper.get('.payment-dialog footer .primary-action').trigger('click'); await flushPromises();
    expect(mocks.checkoutTableSession).toHaveBeenCalledTimes(2);
    expect(mocks.checkoutTableSession.mock.calls[1]![1]).toBe('CASH');
    expect(mocks.checkoutTableSession.mock.calls[1]![2].requestKey).not.toBe(mocks.checkoutTableSession.mock.calls[0]![2].requestKey);
    expect(wrapper.find('.payment-dialog').exists()).toBe(false);
    expect(mocks.replace).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('clears the previous rejection when cancelling and reopening the dialog', async () => {
    mocks.checkoutTableSession.mockRejectedValue(new CashierApiError({ status: 409, code: 'KDS_CHECKOUT_SERVING_REQUIRED', message: 'incomplete' }));
    const wrapper = await openDialog();
    await wrapper.get('.payment-dialog footer .primary-action').trigger('click'); await flushPromises();
    await wrapper.get('.payment-dialog footer .secondary-action').trigger('click'); await flushPromises();
    wrapper.getComponent(TableBillDetail).vm.$emit('checkout'); await flushPromises();
    expect(wrapper.find('.payment-dialog [role="alert"]').exists()).toBe(false);
    expect(wrapper.get('.payment-dialog footer .primary-action').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('keeps the same request for a retry when the checkout result is uncertain', async () => {
    mocks.checkoutTableSession.mockRejectedValue(new CashierApiError({ status: 0, code: 'NETWORK_ERROR', message: 'timeout' }));
    const wrapper = await openDialog();
    await wrapper.get('.payment-dialog footer .primary-action').trigger('click'); await flushPromises();
    expect(wrapper.get('.payment-dialog footer [role="alert"]').text()).toBe(t('mutation.outcomeUncertain'));
    await wrapper.get('.payment-dialog footer .primary-action').trigger('click'); await flushPromises();
    expect(mocks.checkoutTableSession.mock.calls[1]).toEqual(mocks.checkoutTableSession.mock.calls[0]);
    wrapper.unmount();
  });
});
