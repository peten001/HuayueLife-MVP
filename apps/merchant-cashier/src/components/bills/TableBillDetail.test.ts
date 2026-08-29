import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import type { DineInCanonicalState, TableCardView, TableSessionDetail } from '@/types';
import TableBillDetail from './TableBillDetail.vue';

const table: TableCardView = {
  id: 'table-1', merchantId: 'merchant-1', tableNo: 'A01', qrToken: 'test-token', qrVersion: 1,
  status: 'ACTIVE', operationalStatus: 'IN_USE', canCloseSession: false, currentSession: null,
};

const session: TableSessionDetail = {
  id: 'session-1', sessionNo: 'TS-1', merchantId: 'merchant-1', tableId: 'table-1', tableNo: 'A01',
  status: 'OPEN', openedAt: '2026-08-30T00:00:00.000Z', orderCount: 1, itemCount: 2,
  totalAmountVnd: '120000', originalAmountVnd: '120000', payableAmountVnd: '120000',
  pendingOrderCount: 0, unfinishedOrderCount: 1, orders: [],
};

describe('TableBillDetail canonical-state UI', () => {
  afterEach(() => setLocale('zh'));

  it('renders only dish, quantity and price without raw order state labels', () => {
    const wrapper = mountDetail();
    expect(wrapper.get('[data-testid="table-item-summary"]').text()).toContain('牛肉粉');
    expect(wrapper.get('.committed-item-stepper output').text()).toBe('2');
    expect(wrapper.get('.table-item-summary-row__item-price').text()).toContain('120,000');
    expect(wrapper.find('.table-item-summary-row__source').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('待提交');
    expect(wrapper.text()).not.toContain('本次待加');
    expect(wrapper.text()).not.toContain('正在处理');
    expect(wrapper.text()).not.toContain('结果尚未确认');
  });

  it('emits immediate canonical line increase and decrease intents', async () => {
    const wrapper = mountDetail();
    await wrapper.get('[data-testid="increase-canonical-line"]').trigger('click');
    await wrapper.get('[data-testid="decrease-canonical-line"]').trigger('click');
    expect(wrapper.emitted('increaseLine')?.[0]?.[0]).toMatchObject({ lineKey: canonical().items[0]!.lineKey, quantity: 2 });
    expect(wrapper.emitted('decreaseLine')?.[0]?.[0]).toMatchObject({ lineKey: canonical().items[0]!.lineKey, quantity: 2 });
  });

  it('keeps the OPEN table context after the final item changes 1 to 0', async () => {
    const wrapper = mountDetail({ canonicalState: canonical(1) });
    await wrapper.setProps({ canonicalState: canonical(0), releaseEligible: true });
    expect(wrapper.get('[data-testid="right-panel-header"]').text()).toContain('A01');
    expect(wrapper.get('[data-testid="right-panel-header"]').text()).toContain('用餐中');
    expect(wrapper.find('[data-testid="right-panel-empty-table"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="dinein-release-empty"]').text()).toContain('释放空桌');
    expect(wrapper.find('[data-testid="dinein-checkout"]').exists()).toBe(false);
  });

  it('requires an explicit release-empty click and keeps the action secondary to the normal dock', async () => {
    const wrapper = mountDetail({ canonicalState: canonical(0), releaseEligible: true });
    await wrapper.get('[data-testid="dinein-release-empty"]').trigger('click');
    expect(wrapper.emitted('releaseEmpty')).toHaveLength(1);
    expect(wrapper.find('[data-testid="print-primary"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="dinein-settlement-adjustment"]').exists()).toBe(true);
  });

  it('disables decrement below locked quantity and disables historical product increment', () => {
    const state = canonical(1);
    state.items[0]!.lockedQuantity = 1;
    state.items[0]!.adjustableQuantity = 0;
    state.items[0]!.productId = null;
    const wrapper = mountDetail({ canonicalState: state });
    expect(wrapper.get('[data-testid="decrease-canonical-line"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="increase-canonical-line"]').attributes('disabled')).toBeDefined();
  });

  it('keeps remarks distinct and user-visible without exposing raw ids', () => {
    const state = canonical(2);
    state.items.push({ ...state.items[0]!, lineKey: `dline:sha256:${'2'.repeat(64)}`, remark: '少辣', quantity: 1, subtotalVnd: '60000' });
    const wrapper = mountDetail({ canonicalState: state });
    expect(wrapper.findAll('.table-item-summary-row')).toHaveLength(2);
    expect(wrapper.text()).toContain('少辣');
    expect(wrapper.text()).not.toContain(state.revision);
    expect(wrapper.text()).not.toContain('order-');
  });

  it('uses canonical totals for original, discount, rounding and payable', () => {
    const state = canonical(2);
    state.totals = { originalAmountVnd: '120000', discountPayableRateBps: 9000, discountAmountVnd: '12000', roundingAmountVnd: '8000', payableAmountVnd: '100000' };
    const wrapper = mountDetail({ canonicalState: state });
    expect(wrapper.get('.dinein-settlement-summary').text()).toContain('120,000');
    expect(wrapper.get('.dinein-settlement-summary').text()).toContain('12,000');
    expect(wrapper.get('.dinein-settlement-summary').text()).toContain('8,000');
    expect(wrapper.get('.dinein-settlement-summary').text()).toContain('100,000');
  });

  it('updates localized dish names without changing the line identity', async () => {
    const wrapper = mountDetail();
    setLocale('vi');
    await wrapper.vm.$nextTick();
    expect(wrapper.get('.table-item-summary-row__name strong').text()).toBe('Phở bò');
    setLocale('en');
    await wrapper.vm.$nextTick();
    expect(wrapper.get('.table-item-summary-row__name strong').text()).toBe('Beef pho');
  });

  it('keeps three-digit quantities and long amounts complete', () => {
    const state = canonical(123);
    state.items[0]!.subtotalVnd = '14000000';
    state.totals.originalAmountVnd = '14000000';
    state.totals.payableAmountVnd = '14000000';
    const wrapper = mountDetail({ canonicalState: state });
    expect(wrapper.get('.committed-item-stepper').classes()).toContain('committed-item-stepper--wide-quantity');
    expect(wrapper.get('.committed-item-stepper output').text()).toBe('123');
    expect(wrapper.get('.table-item-summary-row__item-price').text()).toContain('14,000,000');
  });
});

function mountDetail(extraProps: Record<string, unknown> = {}) {
  return mount(TableBillDetail, {
    props: { table, session, canonicalState: canonical(), orderableProductIds: new Set(['product-1']), ...extraProps },
    global: {
      plugins: [createPinia()],
      stubs: {
        PrintJobActions: { props: ['disabled'], template: '<button data-testid="print-primary" :disabled="disabled">Print</button>' },
      },
    },
  });
}

function canonical(quantity = 2): DineInCanonicalState {
  return {
    sessionId: 'session-1', tableId: 'table-1', tableNo: 'A01', tableName: null, sessionStatus: 'OPEN',
    revision: `dcs2:sha256:${'1'.repeat(64)}`,
    items: quantity ? [{
      lineKey: `dline:sha256:${'1'.repeat(64)}`, productId: 'product-1', productNameZh: '牛肉粉', productNameVi: 'Phở bò', productNameEn: 'Beef pho',
      remark: '', optionSignature: '', unitPriceVnd: '60000', quantity, lockedQuantity: 0, adjustableQuantity: quantity,
      subtotalVnd: (BigInt(quantity) * 60_000n).toString(), adjustability: 'RETURN', sourceSummary: { staffQuantity: quantity, qrQuantity: 0 },
    }] : [],
    totals: { originalAmountVnd: (BigInt(quantity) * 60_000n).toString(), discountPayableRateBps: null, discountAmountVnd: '0', roundingAmountVnd: '0', payableAmountVnd: (BigInt(quantity) * 60_000n).toString() },
    blockers: [], generatedAt: '2026-08-30T00:00:00.000Z',
  };
}
