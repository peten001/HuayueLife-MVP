import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '@/i18n';
import type { MerchantOrder, TableCardView, TableSessionDetail } from '@/types';
import TableBillDetail from './TableBillDetail.vue';

const table: TableCardView = {
  id: 'table-1',
  merchantId: 'merchant-1',
  tableNo: 'A01',
  qrToken: 'not-a-real-token',
  qrVersion: 1,
  status: 'ACTIVE',
  operationalStatus: 'IN_USE',
  canCloseSession: false,
  currentSession: null,
};

const order: MerchantOrder = {
  id: 'order-1',
  orderNo: 'O-1001',
  merchantId: 'merchant-1',
  orderType: 'DINE_IN',
  status: 'ACCEPTED',
  tableId: 'table-1',
  tableSessionId: 'session-1',
  tableNoSnapshot: 'A01',
  itemAmountVnd: '120000',
  deliveryFeeVnd: '0',
  totalAmountVnd: '120000',
  settlementStatus: 'UNSETTLED',
  createdAt: '2026-07-24T01:00:00.000Z',
  updatedAt: '2026-07-24T01:00:00.000Z',
  customerRemark: '少辣',
  items: [{
    id: 'item-1',
    productId: 'product-1',
    productNameZhSnapshot: '牛肉粉',
    productNameViSnapshot: 'Phở bò',
    productNameEnSnapshot: 'Beef pho',
    unitPriceVnd: '60000',
    quantity: 2,
    subtotalVnd: '120000',
  }],
};

function session(pendingOrderCount = 0): TableSessionDetail {
  return {
    id: 'session-1',
    sessionNo: 'TS-1',
    merchantId: 'merchant-1',
    tableId: 'table-1',
    tableNo: 'A01',
    status: 'OPEN',
    openedAt: '2026-07-24T00:00:00.000Z',
    orderCount: 1,
    itemCount: 2,
    totalAmountVnd: '120000',
    pendingOrderCount,
    unfinishedOrderCount: 1,
    orders: [{
      id: order.id,
      orderNo: order.orderNo,
      createdByStaffId: order.createdByStaffId,
      status: order.status,
      createdAt: order.createdAt,
      itemAmountVnd: order.itemAmountVnd,
      deliveryFeeVnd: order.deliveryFeeVnd,
      totalAmountVnd: order.totalAmountVnd,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productNameZhSnapshot: item.productNameZhSnapshot,
        productNameViSnapshot: item.productNameViSnapshot,
        productNameEnSnapshot: item.productNameEnSnapshot,
        productNameZh: item.productNameZh,
        productNameVi: item.productNameVi,
        productNameEn: item.productNameEn,
        quantity: item.quantity,
        unitPriceVnd: item.unitPriceVnd || '0',
        subtotalVnd: item.subtotalVnd,
      })),
    }],
  };
}

function mountDetail(extraProps: Record<string, unknown> = {}) {
  return mount(TableBillDetail, {
    props: { table, session: session(), ...extraProps },
    global: {
      plugins: [createPinia()],
      stubs: {
        PrintJobActions: {
          props: ['disabled'],
          template: '<button data-testid="print-primary" :disabled="disabled">Print</button>',
        },
      },
    },
  });
}

describe('TableBillDetail V2 table workspace', () => {
  afterEach(() => setLocale('zh'));

  it('renders one merged dine-in item stream without order tabs or cards', () => {
    const wrapper = mountDetail();
    expect(wrapper.get('[data-testid="table-item-summary"]').text()).toContain('牛肉粉');
    expect(wrapper.get('.table-item-summary-row__source').text()).toBe('顾客');
    expect(wrapper.find('[data-testid="table-detail-tabs"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="table-order-details"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="dinein-accept"]').exists()).toBe(false);
  });

  it('counts total dish quantity while merging same-identity source facts into one adjustable row', async () => {
    const base = session();
    const customerOrder = {
      ...base.orders[0]!,
      items: [{ ...base.orders[0]!.items[0]!, quantity: 3, subtotalVnd: '180000' }],
    };
    const staffOrder = {
      ...customerOrder,
      id: 'order-staff',
      orderNo: 'O-1002',
      status: 'ACCEPTED' as const,
      createdByStaffId: 'staff-1',
      items: [{ ...base.orders[0]!.items[0]!, id: 'item-staff', quantity: 2, subtotalVnd: '120000' }],
    };
    const lastOrder = {
      ...base.orders[0]!,
      id: 'order-last',
      orderNo: 'O-1003',
      status: 'ACCEPTED' as const,
      items: [{ ...base.orders[0]!.items[0]!, id: 'item-last', quantity: 2, subtotalVnd: '120000' }],
    };
    const wrapper = mountDetail({
      session: { ...base, orderCount: 3, itemCount: 7, orders: [customerOrder, staffOrder, lastOrder] },
    });
    expect(wrapper.get('.table-detail-header__meta').text()).toContain('7 个菜');
    const rows = wrapper.findAll('.table-item-summary-row');
    expect(rows).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="decrease-order-item"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="decrease-order-item"]').every((button) => button.attributes('disabled') === undefined)).toBe(true);
    expect(rows[0]!.get('.committed-item-stepper output').text()).toBe('7');
    expect(rows[0]!.attributes('data-raw-item-ids')).toBe('item-1,item-staff,item-last');
    await rows[0]!.get('[data-testid="decrease-order-item"]').trigger('click');
    expect(wrapper.emitted('decreaseItem')?.[0]?.[0]).toMatchObject({ id: 'item-last' });
    expect(wrapper.emitted('decreaseItem')?.[0]?.[2]).toBe(7);
    await wrapper.setProps({ session: { ...base, orderCount: 2, itemCount: 5, orders: [customerOrder, staffOrder] } });
    expect(wrapper.get('.table-detail-header__meta').text()).toContain('5 个菜');
    expect(wrapper.findAll('.table-item-summary-row')).toHaveLength(1);
    expect(wrapper.get('.committed-item-stepper output').text()).toBe('5');
  });

  it('keeps the adjustment column but disables completed rows with a status reason', () => {
    const base = session();
    const wrapper = mountDetail({ session: { ...base, orders: [{ ...base.orders[0]!, status: 'COMPLETED' as const }] } });
    const button = wrapper.get('[data-testid="decrease-order-item"]');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('title')).toContain('订单状态');
  });

  it('keeps the last returnable quantity enabled and blocks a zero-quantity row', async () => {
    const base = session();
    const lastQuantitySession = {
      ...base,
      itemCount: 1,
      orders: [{
        ...base.orders[0]!,
        items: [{ ...base.orders[0]!.items[0]!, quantity: 1, subtotalVnd: '60000' }],
      }],
    };
    const wrapper = mountDetail({ session: lastQuantitySession });
    const button = wrapper.get('[data-testid="decrease-order-item"]');

    expect(button.attributes('disabled')).toBeUndefined();
    await button.trigger('click');
    expect(wrapper.emitted('decreaseItem')?.[0]?.[0]).toMatchObject({
      id: 'item-1',
      quantity: 1,
    });

    await wrapper.setProps({
      session: {
        ...lastQuantitySession,
        itemCount: 0,
        orders: [{
          ...lastQuantitySession.orders[0]!,
          items: [{
            ...lastQuantitySession.orders[0]!.items[0]!,
            quantity: 0,
            subtotalVnd: '0',
          }],
        }],
      },
    });
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('title')).toContain('没有可退数量');
  });

  it('updates item names immediately when the locale changes', async () => {
    const localizedSession = session();
    localizedSession.orders[0]!.items[0] = {
      ...localizedSession.orders[0]!.items[0]!,
      productNameVi: 'Phở bò',
    };
    const wrapper = mountDetail({ session: localizedSession });
    expect(wrapper.get('[data-testid="table-item-summary"]').text()).toContain('牛肉粉');

    setLocale('vi');
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-testid="table-item-summary"]').text()).toContain('Phở bò');

    setLocale('en');
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-testid="table-item-summary"]').text()).toContain('Beef pho');
  });

  it('shows the authoritative discount, rounding and payable breakdown compactly', () => {
    const wrapper = mountDetail({
      session: {
        ...session(0),
        originalAmountVnd: '513000',
        discountPayableRateBps: 9000,
        discountAmountVnd: '51300',
        roundingApplied: true,
        roundingAmountVnd: '1700',
        payableAmountVnd: '460000',
      },
      adjustmentApplied: true,
      payableAmount: '460000',
    });
    expect(wrapper.find('[data-testid="table-settlement-summary"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="table-rounding-rule"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="dinein-settlement-adjustment"]').text()).toBe('优惠');
    expect(wrapper.text()).toContain('51,300');
    expect(wrapper.text()).toContain('1,700');
    expect(wrapper.get('.table-bill-total-row').text()).toContain('460,000');
    expect(wrapper.get('.table-bill-total-row').text()).toContain('加菜');
    expect(wrapper.get('.dinein-summary-row').classes()).toContain('dinein-summary-row');
    expect(wrapper.get('[data-testid="table-order-items"]').classes()).toContain('dinein-action-button');
    expect(wrapper.get('[data-testid="dinein-action-dock"] .dinein-action-button').classes()).toContain('dinein-action-button');
    expect(wrapper.get('[data-testid="dinein-settlement-adjustment"]').classes()).toContain('dinein-action-button');
    expect(wrapper.get('[data-testid="dinein-checkout"]').classes()).toContain('dinein-action-button');
    expect(wrapper.get('.dinein-settlement-summary').findAll('dt').map((label) => label.text())).toEqual([
      '原金额',
      '折扣',
      '抹零',
      '实收',
    ]);
    expect(wrapper.get('.dinein-settlement-summary').text()).not.toContain('商品原金额');
    expect(wrapper.get('.dinein-settlement-summary').text()).not.toContain('折扣优惠');
    expect(wrapper.get('.dinein-settlement-summary').text()).not.toContain('抹零金额');
    expect(wrapper.get('.dinein-settlement-summary').text()).not.toContain('最终应收');
  });

  it.each(['14000000', '99999999'])('keeps long total %s complete and on one line', (amount) => {
    const wrapper = mountDetail({
      session: { ...session(0), totalAmountVnd: amount, payableAmountVnd: amount },
      payableAmount: amount,
    });
    const total = wrapper.get('.dinein-settlement-summary .is-payable dd');
    expect(total.text()).toContain(Number(amount).toLocaleString('en-US'));
    expect(total.attributes('title')).toContain(Number(amount).toLocaleString('en-US'));
    expect(wrapper.get('.table-item-summary-row').find('[data-testid="decrease-order-item"]').exists()).toBe(true);
  });

  it('keeps the item price anchor fixed through 9,999,999 and expands at 10,000,000', async () => {
    const base = session();
    const withSubtotal = (subtotalVnd: string) => ({
      ...base,
      orders: [{
        ...base.orders[0]!,
        items: [{ ...base.orders[0]!.items[0]!, unitPriceVnd: subtotalVnd, quantity: 1, subtotalVnd }],
      }],
    });
    const wrapper = mountDetail({ session: withSubtotal('9999999') });

    expect(wrapper.get('.table-item-summary-row').classes()).not.toContain('table-item-summary-row--extended-price');
    await wrapper.setProps({ session: withSubtotal('10000000') });
    expect(wrapper.get('.table-item-summary-row').classes()).toContain('table-item-summary-row--extended-price');
  });

  it.each([
    [1, false],
    [99, false],
    [100, true],
    [999, true],
    [1000, true],
  ])('uses the expanding quantity slot at the 100 boundary for quantity %i', (quantity, expectedWide) => {
    const base = session();
    const wrapper = mountDetail({
      session: {
        ...base,
        orders: [{
          ...base.orders[0]!,
          items: [{
            ...base.orders[0]!.items[0]!,
            quantity,
            subtotalVnd: String(60_000 * quantity),
          }],
        }],
      },
    });

    expect(wrapper.get('.committed-item-stepper').classes().includes('committed-item-stepper--wide-quantity'))
      .toBe(expectedWide);
  });

  it('renders the production-sized discount amounts completely without zero rounding rows', () => {
    const wrapper = mountDetail({
      session: {
        ...session(0),
        originalAmountVnd: '1541000',
        discountPayableRateBps: 8500,
        discountAmountVnd: '231150',
        roundingApplied: false,
        roundingAmountVnd: '0',
        payableAmountVnd: '1309850',
      },
      adjustmentApplied: true,
      payableAmount: '1309850',
    });
    const summary = wrapper.get('.dinein-settlement-summary');
    const values = summary.findAll('dd').map((value) => value.text());

    expect(values).toEqual([
      expect.stringContaining('1,541,000'),
      expect.stringContaining('-231,150'),
      expect.stringContaining('1,309,850'),
    ]);
    expect(summary.text()).not.toContain('抹零金额');
    summary.findAll('dd').forEach((value) => {
      expect(value.classes()).not.toContain('is-truncated');
    });
  });

  it('keeps source, item, quantity, amount and remove action on one row', async () => {
    const wrapper = mountDetail();
    expect(wrapper.get('.table-detail-header').text()).not.toContain('人数数据未提供');
    const row = wrapper.get('.table-item-summary-row');
    expect(row.text()).toContain('牛肉粉');
    expect(row.text()).toContain('120,000');
    expect(row.find('[data-testid="decrease-order-item"]').exists()).toBe(true);
    await row.get('[data-testid="decrease-order-item"]').trigger('click');
    expect(wrapper.emitted('decreaseItem')?.[0]?.[0]).toMatchObject({ id: 'item-1' });
  });

  it('exposes inline minus and plus without mutating the committed quantity locally', async () => {
    const wrapper = mountDetail();
    const row = wrapper.get('.table-item-summary-row');
    expect(row.get('.committed-item-stepper output').text()).toBe('2');

    await row.get('[data-testid="increase-committed-item"]').trigger('click');

    expect(wrapper.emitted('increaseItem')?.[0]?.[0]).toMatchObject({
      id: 'item-1',
      productId: 'product-1',
      quantity: 2,
    });
    expect(row.get('.committed-item-stepper output').text()).toBe('2');
  });

  it('shows row-local decrease busy feedback without freezing plus or another bill action', async () => {
    const base = session();
    const mergeKey = JSON.stringify({ productId: 'product-1', remark: '' });
    const wrapper = mountDetail({
      pendingDecreaseMergeKeys: new Set([mergeKey]),
      orderableProductIds: new Set(['product-1']),
    });
    const row = wrapper.get('.table-item-summary-row');
    expect(row.classes()).toContain('table-item-summary-row--mutation-busy');
    expect(row.get('.committed-item-stepper').attributes('aria-busy')).toBe('true');
    expect(row.get('[data-testid="decrease-order-item"]').attributes('disabled')).toBeDefined();
    expect(row.find('.row-mutation-spinner').exists()).toBe(true);
    expect(row.get('[data-testid="increase-committed-item"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('[data-testid="table-order-items"]').attributes('disabled')).toBeUndefined();
    expect(base.orders[0]!.items[0]!.quantity).toBe(2);
  });

  it('renders normal pending decreases optimistically without disabling repeated minus or plus', async () => {
    const mergeKey = JSON.stringify({ productId: 'product-1', remark: '' });
    const wrapper = mountDetail({
      pendingDecreaseQuantities: { [mergeKey]: 1 },
      pendingDecreaseMergeKeys: new Set<string>(),
      orderableProductIds: new Set(['product-1']),
    });
    const row = wrapper.get('.table-item-summary-row');
    expect(row.get('.committed-item-stepper output').text()).toBe('1');
    expect(row.get('[data-testid="decrease-order-item"]').attributes('disabled')).toBeUndefined();
    expect(row.get('[data-testid="increase-committed-item"]').attributes('disabled')).toBeUndefined();
    expect(row.find('.row-mutation-spinner').exists()).toBe(false);

    await row.get('[data-testid="decrease-order-item"]').trigger('click');
    expect(wrapper.emitted('decreaseItem')).toHaveLength(1);
  });

  it('keeps the zero-quantity row in place until the 1-to-0 response reconciles', () => {
    const mergeKey = JSON.stringify({ productId: 'product-1', remark: '' });
    const oneItemSession = session();
    oneItemSession.orders[0]!.items[0]!.quantity = 1;
    oneItemSession.orders[0]!.items[0]!.subtotalVnd = '60000';
    const wrapper = mountDetail({
      session: oneItemSession,
      pendingDecreaseQuantities: { [mergeKey]: 1 },
      pendingDecreaseMergeKeys: new Set<string>(),
      orderableProductIds: new Set(['product-1']),
    });
    const row = wrapper.get('.table-item-summary-row');
    expect(row.get('.committed-item-stepper output').text()).toBe('0');
    expect(row.get('[data-testid="decrease-order-item"]').attributes('disabled')).toBeDefined();
    expect(row.get('[data-testid="increase-committed-item"]').attributes('disabled')).toBeUndefined();
  });

  it('keeps a historical unavailable row visible while disabling only its plus action', () => {
    const wrapper = mountDetail({ orderableProductIds: new Set<string>() });
    const row = wrapper.get('.table-item-summary-row');
    expect(row.text()).toContain('牛肉粉');
    expect(row.get('[data-testid="increase-committed-item"]').attributes('disabled')).toBeDefined();
    expect(row.get('[data-testid="decrease-order-item"]').attributes('disabled')).toBeUndefined();
  });

  it('keeps print, adjustment and checkout in the bottom action dock', async () => {
    const wrapper = mountDetail({
      actionsDisabled: true,
      checkoutDisabled: true,
    });
    expect(wrapper.get('[data-testid="print-primary"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('[data-testid="dinein-settlement-adjustment"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="dinein-checkout"]').attributes('disabled')).toBeDefined();

    await wrapper.setProps({
      actionsDisabled: false,
      checkoutDisabled: false,
    });
    expect(wrapper.get('[data-testid="dinein-settlement-adjustment"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('[data-testid="dinein-checkout"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).not.toContain('接单');
  });

  it('keeps the empty-table shell without opening hints or an open-table action', () => {
    const empty = { ...table, operationalStatus: 'AVAILABLE' as const };
    const wrapper = mountDetail({ table: empty, session: null });
    expect(wrapper.find('[data-testid="right-panel-header"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="right-panel-body"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="right-panel-footer"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="empty-order-primary"]').text()).toBe('订单中没有商品');
    expect(wrapper.get('[data-testid="empty-order-secondary"]').text()).toBe('请从屏幕左侧的菜单中选择');
    expect(wrapper.find('[data-testid="empty-order-icon"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="right-panel-body"]').text()).not.toContain('当前桌台空闲');
    expect(wrapper.get('[data-testid="right-panel-body"]').text()).not.toContain('此桌台空闲，可直接开台点菜');
    expect(wrapper.find('[data-testid="right-panel-body"] [data-testid="table-order-items"]').exists()).toBe(false);
    expect(wrapper.find('.order-chat-workspace').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="right-panel-footer"] button').every((button) => button.attributes('disabled') !== undefined)).toBe(true);
  });

  it('keeps the same fixed shell when no table is selected', () => {
    const wrapper = mountDetail({ table: null, session: null });

    expect(wrapper.get('[data-testid="table-detail"]').classes()).toContain('table-bill-shell--no-selection');
    expect(wrapper.get('[data-testid="right-panel-header"]').text()).toContain('请选择桌台');
    expect(wrapper.get('[data-testid="right-panel-body"]').text()).toContain('选择占用中的桌台');
    expect(wrapper.find('[data-testid="right-panel-footer"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="right-panel-footer"] button').every((button) => button.attributes('disabled') !== undefined)).toBe(true);
  });

  it('keeps the same fixed shell for an active table', () => {
    const wrapper = mountDetail();

    expect(wrapper.get('[data-testid="table-detail"]').classes()).toContain('table-bill-shell--active');
    expect(wrapper.get('[data-testid="right-panel-header"]').text()).toContain('A01');
    expect(wrapper.get('[data-testid="right-panel-body"]').text()).toContain('牛肉粉');
    expect(wrapper.get('[data-testid="right-panel-footer"]').text()).toContain('结账');
  });

  it('labels staff additions as 加菜 and keeps the remove action after amount', async () => {
    const accepted = { ...order, status: 'ACCEPTED' as const, createdByStaffId: 'staff-1' };
    const wrapper = mountDetail({ session: {
      ...session(0),
      orders: [{ ...session(0).orders[0]!, status: 'ACCEPTED' as const, createdByStaffId: accepted.createdByStaffId }],
    } });
    expect(wrapper.get('.table-item-summary-row__source').text()).toContain('加菜');
    expect(wrapper.find('[data-testid="decrease-order-item"]').exists()).toBe(true);
    await wrapper.get('[data-testid="decrease-order-item"]').trigger('click');
    expect(wrapper.emitted('decreaseItem')?.[0]?.[0]).toMatchObject({ id: 'item-1' });
  });

  it('merges pending additions into the current row without changing authoritative payable', async () => {
    const wrapper = mountDetail({
      draftLines: [{ lineId: 'committed:item-1', sourceItemId: 'item-1', product: {
        id: 'product-1',
        categoryId: 'category-1',
        nameZh: '牛肉粉',
        nameVi: 'Phở bò',
        nameEn: 'Beef pho',
        priceVnd: '60000',
        sortOrder: 1,
        status: 'ON_SALE',
        productType: 'FOOD',
      }, quantity: 1 }],
    });
    const row = wrapper.get('.table-item-summary-row');

    expect(row.get('.committed-item-stepper output').text()).toBe('3');
    expect(row.text()).not.toContain('×');
    expect(row.text()).toContain('180,000');
    expect(row.get('.table-item-summary-row__item-price').text()).toBe('180,000');
    expect(row.get('.table-item-summary-row__item-price').text()).not.toMatch(/VND|₫/);
    expect(row.get('[data-testid="pending-line-note"]').text()).toContain('+1');
    expect(wrapper.get('.dinein-settlement-summary .is-pending').text()).toContain('60,000');
    expect(wrapper.get('.dinein-settlement-summary .is-pending').text()).toContain('VND');
    expect(wrapper.get('.dinein-settlement-summary .is-payable').text()).toContain('120,000');
    expect(wrapper.get('.dinein-settlement-summary .is-payable').text()).toContain('VND');

    expect(row.get('[data-testid="decrease-order-item"]').attributes('disabled')).toBeUndefined();
    await row.get('[data-testid="decrease-order-item"]').trigger('click');
    expect(wrapper.emitted('decreaseItem')).toHaveLength(1);
  });

  it('merges one pending product increment into the same canonical committed row', () => {
    const base = session();
    const secondOrder = {
      ...base.orders[0]!,
      id: 'order-2',
      items: [{ ...base.orders[0]!.items[0]!, id: 'item-2', quantity: 2 }],
    };
    const wrapper = mountDetail({
      session: { ...base, orders: [base.orders[0]!, secondOrder] },
      draftLines: [{ lineId: 'committed:item-2', sourceItemId: 'item-2', product: {
        id: 'product-1',
        categoryId: 'category-1',
        nameZh: '牛肉粉',
        priceVnd: '60000',
        sortOrder: 1,
        status: 'ON_SALE',
        productType: 'FOOD',
      }, quantity: 1 }],
    });
    const rows = wrapper.findAll('.table-item-summary-row');

    expect(rows).toHaveLength(1);
    expect(rows[0]!.get('.committed-item-stepper output').text()).toBe('5');
    expect(rows[0]!.get('[data-testid="pending-line-note"]').text()).toContain('+1');
    expect(rows[0]!.attributes('data-raw-item-ids')).toBe('item-1,item-2');
  });

  it('keeps one canonical same-product row stable after raw order facts reorder', async () => {
    const base = session();
    const itemA = { ...base.orders[0]!.items[0]!, id: 'item-a', quantity: 3, subtotalVnd: '180000' };
    const itemB = { ...base.orders[0]!.items[0]!, id: 'item-b', quantity: 2, subtotalVnd: '120000' };
    const itemC = { ...base.orders[0]!.items[0]!, id: 'item-c', quantity: 1, subtotalVnd: '60000' };
    const orders = [
      { ...base.orders[0]!, id: 'order-a', items: [itemA] },
      { ...base.orders[0]!, id: 'order-b', items: [itemB] },
      { ...base.orders[0]!, id: 'order-c', items: [itemC] },
    ];
    const draftLines = [
      { lineId: 'committed:item-a', sourceItemId: 'item-a', product: productFixture(), quantity: 1 },
      { lineId: 'committed:item-b', sourceItemId: 'item-b', product: productFixture(), quantity: 2 },
    ];
    const wrapper = mountDetail({ session: { ...base, orders }, draftLines });

    let rows = wrapper.findAll('.table-item-summary-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.get('.committed-item-stepper output').text()).toBe('9');
    expect(rows[0]!.get('[data-testid="decrease-order-item"]').attributes('disabled')).toBeUndefined();
    const mergeKey = rows[0]!.attributes('data-merge-key');
    await rows[0]!.get('[data-testid="decrease-order-item"]').trigger('click');
    await rows[0]!.get('[data-testid="increase-committed-item"]').trigger('click');
    expect(wrapper.emitted('decreaseItem')).toHaveLength(1);
    expect(wrapper.emitted('increaseItem')?.[0]?.[0]).toMatchObject({ id: 'item-c' });
    expect(wrapper.emitted('increaseItem')?.[0]?.[2]).toBe(mergeKey);

    await wrapper.setProps({ session: { ...base, orders: [orders[2]!, orders[0]!, orders[1]!] } });
    rows = wrapper.findAll('.table-item-summary-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attributes('data-merge-key')).toBe(mergeKey);
    expect(rows[0]!.attributes('data-raw-item-ids')).toBe('item-c,item-a,item-b');
    await rows[0]!.get('[data-testid="increase-committed-item"]').trigger('click');
    expect(wrapper.emitted('increaseItem')?.[1]?.[0]).toMatchObject({ id: 'item-b' });
  });

  it('renders distinct products by earliest source fact after increments and snapshot reordering', async () => {
    const base = session();
    const fact = (productId: string, second: number, suffix: string) => ({
      ...base.orders[0]!,
      id: `order-${suffix}`,
      orderNo: `O-${suffix}`,
      createdAt: `2026-07-24T01:00:0${second}.000Z`,
      items: [{
        ...base.orders[0]!.items[0]!,
        id: `item-${suffix}`,
        productId,
        productNameZhSnapshot: `菜品 ${productId}`,
        quantity: 1,
        subtotalVnd: '60000',
      }],
    });
    const a = fact('A', 1, 'a');
    const b = fact('B', 2, 'b');
    const c = fact('C', 3, 'c');
    const bPlus = fact('B', 4, 'b-plus');
    const aPlus = fact('A', 5, 'a-plus');
    const wrapper = mountDetail({ session: { ...base, orders: [c, b, a] } });
    const renderedIds = () => wrapper.findAll('.table-item-summary-row')
      .map((row) => row.attributes('data-product-id'));

    expect(renderedIds()).toEqual(['A', 'B', 'C']);

    await wrapper.setProps({ session: { ...base, orders: [bPlus, c, a, b] } });
    expect(renderedIds()).toEqual(['A', 'B', 'C']);
    expect(wrapper.findAll('.committed-item-stepper output').map((output) => output.text()))
      .toEqual(['1', '2', '1']);

    await wrapper.setProps({ session: { ...base, orders: [c, aPlus, b, a, bPlus] } });
    expect(renderedIds()).toEqual(['A', 'B', 'C']);
    expect(wrapper.findAll('.committed-item-stepper output').map((output) => output.text()))
      .toEqual(['2', '2', '1']);
  });

  it('keeps the rendered merge-key ledger stable through minus snapshots, refresh and zero re-add', async () => {
    const base = session();
    const fact = (productId: string, second: number, suffix: string, quantity = 1) => ({
      ...base.orders[0]!,
      id: `order-${suffix}`,
      orderNo: `O-${suffix}`,
      createdAt: `2026-07-24T01:00:0${second}.000Z`,
      items: [{
        ...base.orders[0]!.items[0]!,
        id: `item-${suffix}`,
        productId,
        productNameZhSnapshot: `菜品 ${productId}`,
        quantity,
        subtotalVnd: String(60_000 * quantity),
      }],
    });
    const a = fact('A', 1, 'a', 2);
    const b = fact('B', 2, 'b', 4);
    const c = fact('C', 3, 'c', 2);
    const d = fact('D', 4, 'd');
    const bPlus = fact('B', 5, 'b-plus');
    const wrapper = mountDetail({ session: { ...base, orders: [d, bPlus, c, b, a] } });
    const renderedIds = () => wrapper.findAll('.table-item-summary-row')
      .map((row) => row.attributes('data-product-id'));

    expect(renderedIds()).toEqual(['A', 'B', 'C', 'D']);

    const bAfterMinus = fact('B', 2, 'b', 3);
    await wrapper.setProps({ session: { ...base, orders: [c, bPlus, a, d, bAfterMinus] } });
    expect(renderedIds()).toEqual(['A', 'B', 'C', 'D']);
    expect(wrapper.findAll('.committed-item-stepper output').map((output) => output.text()))
      .toEqual(['2', '4', '2', '1']);

    const bAfterRepeatedMinus = fact('B', 2, 'b', 2);
    const aAfterMinus = fact('A', 1, 'a');
    const cAfterMinus = fact('C', 3, 'c');
    await wrapper.setProps({
      session: { ...base, orders: [bPlus, d, cAfterMinus, bAfterRepeatedMinus, aAfterMinus] },
    });
    expect(renderedIds()).toEqual(['A', 'B', 'C', 'D']);

    await wrapper.setProps({
      session: { ...base, orders: [d, aAfterMinus, bAfterRepeatedMinus, cAfterMinus, bPlus] },
    });
    expect(renderedIds()).toEqual(['A', 'B', 'C', 'D']);

    await wrapper.setProps({ session: { ...base, orders: [d, cAfterMinus, aAfterMinus] } });
    expect(renderedIds()).toEqual(['A', 'C', 'D']);

    await wrapper.setProps({
      session: { ...base, orders: [d, cAfterMinus, aAfterMinus] },
      draftLines: [{
        lineId: 'product:B:readded',
        product: { ...productFixture(), id: 'B', nameZh: '菜品 B' },
        quantity: 1,
        firstAddedAt: '2026-07-24T01:00:08.000Z',
        firstAddedSequence: 8,
      }],
    });
    expect(renderedIds()).toEqual(['A', 'C', 'D', 'B']);
  });

  it('keeps same-product rows separate when normalized remarks differ', () => {
    const base = session();
    const plain = { ...base.orders[0]!.items[0]!, id: 'item-plain', quantity: 1, subtotalVnd: '60000', remark: null };
    const lessSalt = { ...plain, id: 'item-less-salt', remark: ' 少盐 ' };
    const wrapper = mountDetail({
      session: {
        ...base,
        orders: [
          { ...base.orders[0]!, id: 'order-plain', items: [plain] },
          { ...base.orders[0]!, id: 'order-less-salt', items: [lessSalt] },
        ],
      },
    });

    const rows = wrapper.findAll('.table-item-summary-row');
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.find('[data-testid="canonical-line-remark"]').text() === '少盐'))
      .toBeDefined();
  });
});

function productFixture() {
  return {
    id: 'product-1',
    categoryId: 'category-1',
    nameZh: '牛肉粉',
    priceVnd: '60000',
    sortOrder: 1,
    status: 'ON_SALE' as const,
    productType: 'FOOD' as const,
  };
}
