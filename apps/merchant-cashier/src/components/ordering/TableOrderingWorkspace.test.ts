import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CashierApiError } from '@/api';
import { setLocale } from '@/i18n';
import type { MerchantOrderMutationResult } from '@/types';

const apiMocks = vi.hoisted(() => ({
  listCashierMenuCategories: vi.fn(),
  listCashierMenuProducts: vi.fn(),
  createMerchantTableOrder: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api')>(),
  ...apiMocks,
}));

import TableOrderingWorkspace from './TableOrderingWorkspace.vue';

const category = {
  id: 'category-1',
  nameZh: '主食',
  nameVi: 'Món chính',
  sortOrder: 1,
  isActive: true,
};
const product = {
  id: 'product-1',
  categoryId: category.id,
  nameZh: '牛肉粉',
  nameVi: 'Phở bò',
  priceVnd: '60000',
  sortOrder: 1,
  status: 'ON_SALE' as const,
  productType: 'FOOD' as const,
  category,
};
const longNameProduct = {
  ...product,
  id: 'product-long',
  nameZh: '非常长的牛肉粉菜名用于验证两行截断与可读性',
  nameVi: 'Phở bò với cà chua sốt đen và rau thơm nhiều món để測試長文本',
  description: 'A very long product description that validates Vietnamese wrapping and line handling in compact card layouts.',
};
const result: MerchantOrderMutationResult = {
  order: {
    id: 'order-added',
    orderNo: 'ADD-1',
    merchantId: 'merchant-1',
    tableId: 'table-1',
    tableSessionId: 'session-1',
    orderType: 'DINE_IN',
    status: 'PENDING_ACCEPTANCE',
    itemAmountVnd: '60000',
    deliveryFeeVnd: '0',
    totalAmountVnd: '60000',
    settlementStatus: 'UNSETTLED',
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    items: [{
      id: 'item-added',
      productId: product.id,
      productNameZhSnapshot: product.nameZh,
      unitPriceVnd: product.priceVnd,
      quantity: 1,
      subtotalVnd: product.priceVnd,
    }],
  },
  session: {
    id: 'session-1',
    sessionNo: 'S-1',
    merchantId: 'merchant-1',
    tableId: 'table-1',
    tableNo: 'A01',
    status: 'OPEN',
    openedAt: '2026-07-17T00:00:00.000Z',
    orderCount: 1,
    itemCount: 1,
    totalAmountVnd: '60000',
    pendingOrderCount: 1,
    unfinishedOrderCount: 1,
    orders: [],
  },
};

function mountWorkspace(overrides?: { sessionId?: string }) {
  return mount(TableOrderingWorkspace, {
    props: {
      open: true,
      tableId: 'table-1',
      tableLabel: 'A01',
      sessionId: overrides?.sessionId ?? 'session-1',
    },
    global: {
      plugins: [createPinia()],
      stubs: { Teleport: true },
    },
  });
}

describe('TableOrderingWorkspace', () => {
  afterEach(() => setLocale('zh'));

  beforeEach(() => {
    apiMocks.listCashierMenuCategories.mockReset().mockResolvedValue([category]);
    apiMocks.listCashierMenuProducts.mockReset().mockResolvedValue([
      product,
      { ...product, id: 'product-off', nameZh: '停售菜', status: 'OFF_SALE' },
    ]);
    apiMocks.createMerchantTableOrder.mockReset();
  });

  it('loads categories, searches products and excludes zero-quantity items', async () => {
    const wrapper = mountWorkspace();
    await flushPromises();

    expect(wrapper.text()).toContain('主食');
    expect(wrapper.text()).toContain('牛肉粉');
    expect(wrapper.text()).not.toContain('停售菜');
    expect(wrapper.get('[data-testid="confirm-table-order"]').attributes('disabled')).toBeDefined();

    await wrapper.get('[aria-label="增加数量"]').trigger('click');
    expect(wrapper.get('.table-ordering-product[data-product-id="product-1"] .table-ordering-quantity output').text()).toBe('1');
    expect(wrapper.get('[data-testid="confirm-table-order"]').attributes('disabled')).toBeUndefined();

    await wrapper.get('[aria-label="减少数量"]').trigger('click');
    expect(wrapper.get('.table-ordering-product[data-product-id="product-1"] .table-ordering-quantity').findAll('output')).toHaveLength(0);
    expect(wrapper.get('[data-testid="confirm-table-order"]').attributes('disabled')).toBeDefined();

    await wrapper.get('input[type="search"]').setValue('不存在');
    expect(wrapper.text()).toContain('暂无可点菜品');
  });

  it('submits one open-only request when no session exists', async () => {
    const deferred = createDeferred<MerchantOrderMutationResult>();
    const openOnlyResult: MerchantOrderMutationResult = {
      ...result,
      order: null,
    };
    apiMocks.createMerchantTableOrder.mockReturnValueOnce(deferred.promise);
    const wrapper = mountWorkspace({ sessionId: '' });
    await flushPromises();

    const confirm = wrapper.get('[data-testid="confirm-table-order"]');
    expect(confirm.text()).toContain('仅开台');
    expect(confirm.attributes('disabled')).toBeUndefined();
    await confirm.trigger('click');
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledOnce();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledWith('table-1', {
      idempotencyKey: expect.stringMatching(/^add-/),
      items: [],
    });

    deferred.resolve(openOnlyResult);
    await flushPromises();
    expect(wrapper.emitted('created')).toEqual([[openOnlyResult]]);
  });

  it.each([
    ['zh', '仅开台'],
    ['vi', 'Chỉ mở bàn'],
    ['en', 'Open table only'],
  ])('shows open-only submit label in %s locale', (locale, label) => {
    setLocale(locale as 'zh' | 'vi' | 'en');
    const wrapper = mountWorkspace({ sessionId: '' });

    expect(wrapper.get('[data-testid="confirm-table-order"]').text()).toContain(label);
  });

  it('shows only add button when quantity is zero', async () => {
    const wrapper = mountWorkspace();
    await flushPromises();
    const quantityControl = wrapper.get('.table-ordering-product[data-product-id="product-1"] .table-ordering-quantity');

    expect(quantityControl.findAll('button')).toHaveLength(1);
    expect(quantityControl.findAll('output')).toHaveLength(0);
    expect(wrapper.find('[aria-label="减少数量"]').exists()).toBe(false);
    expect(quantityControl.text()).toBe('');
  });

  it('shows minus, quantity and add controls when quantity is greater than zero', async () => {
    const wrapper = mountWorkspace();
    await flushPromises();
    await wrapper.get('[aria-label="增加数量"]').trigger('click');

    const quantityControl = wrapper.get('.table-ordering-product[data-product-id="product-1"] .table-ordering-quantity');
    expect(wrapper.get('.table-ordering-product[data-product-id="product-1"] .table-ordering-remark-button').text()).toBe('备注');
    const buttons = quantityControl.findAll('button');

    expect(buttons).toHaveLength(2);
    expect(quantityControl.findAll('output')).toHaveLength(1);
    expect(quantityControl.find('output').text()).toBe('1');
    expect(wrapper.find('[aria-label="减少数量"]').exists()).toBe(true);
  });

  it('returns to single add button when quantity decreases to zero', async () => {
    const wrapper = mountWorkspace();
    await flushPromises();
    const productQuantity = wrapper.get('.table-ordering-product[data-product-id="product-1"] .table-ordering-quantity');
    await wrapper.get('[aria-label="增加数量"]').trigger('click');
    await wrapper.get('[aria-label="减少数量"]').trigger('click');

    expect(productQuantity.findAll('button')).toHaveLength(1);
    expect(productQuantity.findAll('output')).toHaveLength(0);
    expect(wrapper.find('[aria-label="减少数量"]').exists()).toBe(false);
  });

  it('opens remark dialog and saves remark without expanding card content', async () => {
    const wrapper = mountWorkspace();
    await flushPromises();
    await wrapper.get('[aria-label="增加数量"]').trigger('click');
    await nextTick();
    await flushPromises();

    const product = wrapper.get('.table-ordering-product[data-product-id="product-1"]');

    const beforeHeight = product.element.getBoundingClientRect().height;

    await product.get('button.table-ordering-remark-button').trigger('click');
    const dialog = wrapper.get('[data-testid="table-ordering-item-remark-dialog"]');
    await dialog.get('textarea').setValue('少辣');
    await dialog.get('button.primary-action').trigger('click');
    await nextTick();
    const updatedProduct = wrapper.get('.table-ordering-product[data-product-id="product-1"]');

    expect(updatedProduct.text()).toContain('已备注');
    expect(wrapper.find('[data-testid="table-ordering-item-remark-dialog"]').exists()).toBe(false);
    expect(updatedProduct.element.getBoundingClientRect().height).toBe(beforeHeight);
  });

  it.each([
    ['zh', longNameProduct.nameZh],
    ['vi', longNameProduct.nameVi],
  ])('renders long %s dish names in card copy', async (locale, expectedName) => {
    apiMocks.listCashierMenuProducts.mockResolvedValueOnce([longNameProduct]);
    setLocale(locale as 'zh' | 'vi');
    const wrapper = mountWorkspace();
    await flushPromises();
    expect(wrapper.get('.table-ordering-product__copy strong').text()).toContain(expectedName);
  });

  it.each([
    ['zh', '增加数量', '确认开台并点菜'],
    ['vi', 'Tăng số lượng', 'Mở bàn và gọi món'],
    ['en', 'Increase quantity', 'Open Table & Add Items'],
  ])('shows open+add submit label in %s locale', async (locale, increaseLabel, label) => {
    setLocale(locale as 'zh' | 'vi' | 'en');
    const wrapper = mountWorkspace({ sessionId: '' });
    await flushPromises();

    const increaseButton = wrapper.get(`[aria-label="${increaseLabel}"]`);
    await increaseButton.trigger('click');
    expect(wrapper.get('[data-testid="confirm-table-order"]').text()).toContain(label);
  });

  it('submits one new order with one stable idempotency key despite repeated clicks', async () => {
    const deferred = createDeferred<MerchantOrderMutationResult>();
    apiMocks.createMerchantTableOrder.mockReturnValueOnce(deferred.promise);
    const wrapper = mountWorkspace();
    await flushPromises();
    await wrapper.get('[aria-label="增加数量"]').trigger('click');
    await flushPromises();
    await wrapper.get('.table-ordering-product[data-product-id="product-1"] .table-ordering-remark-button').trigger('click');
    const dialog = wrapper.get('[data-testid="table-ordering-item-remark-dialog"]');
    await dialog.get('textarea').setValue('少辣');
    await dialog.get('button.primary-action').trigger('click');

    const confirm = wrapper.get('[data-testid="confirm-table-order"]');
    await confirm.trigger('click');
    await confirm.trigger('click');

    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="ordering-navigation-guard"]').exists()).toBe(true);
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledWith('table-1', {
      idempotencyKey: expect.stringMatching(/^add-/),
      items: [{ productId: 'product-1', quantity: 1, remark: '少辣' }],
    });

    deferred.resolve(result);
    await flushPromises();
    expect(wrapper.emitted('created')).toEqual([[result]]);
  });

  it.each([
    ['transport', new CashierApiError({ code: 'NETWORK_ERROR', message: 'offline' })],
    ['408', new CashierApiError({ code: 'HTTP_408', message: 'timeout', status: 408 })],
    ['429', new CashierApiError({ code: 'HTTP_429', message: 'throttled', status: 429 })],
    ['500', new CashierApiError({ code: 'HTTP_500', message: 'server error', status: 500 })],
  ])('freezes an uncertain %s response and retries the exact same payload', async (_label, error) => {
    apiMocks.createMerchantTableOrder
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(result);
    const wrapper = mountWorkspace();
    await flushPromises();
    const increase = wrapper.get('[aria-label="增加数量"]');
    await increase.trigger('click');

    const confirm = wrapper.get('[data-testid="confirm-table-order"]');
    await confirm.trigger('click');
    await flushPromises();
    expect(wrapper.get('[aria-label="增加数量"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[aria-label="减少数量"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('.table-ordering-product[data-product-id="product-1"] .table-ordering-remark-button').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="ordering-outcome-uncertain"]').text()).toContain('结果尚未确认');
    expect(wrapper.get('.table-ordering-close').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button.secondary-action').attributes('disabled')).toBeDefined();
    await wrapper.trigger('keydown', { key: 'Escape' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.find('[data-testid="ordering-navigation-guard"]').exists()).toBe(true);

    await wrapper.setProps({ open: false });
    expect(wrapper.find('[data-testid="table-ordering-workspace"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="ordering-navigation-guard"]').exists()).toBe(true);
    await wrapper.setProps({ open: true });
    expect(wrapper.get('output').text()).toBe('1');

    await wrapper.get('[data-testid="confirm-table-order"]').trigger('click');
    await flushPromises();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledTimes(2);
    expect(apiMocks.createMerchantTableOrder.mock.calls[1]?.[1]).toEqual(
      apiMocks.createMerchantTableOrder.mock.calls[0]?.[1],
    );
    expect(wrapper.emitted('created')).toEqual([[result]]);
    expect(wrapper.find('[data-testid="ordering-navigation-guard"]').exists()).toBe(false);
  });

  it('releases the key and payload only after a definitive 4xx rejection', async () => {
    apiMocks.createMerchantTableOrder
      .mockRejectedValueOnce(new CashierApiError({ code: 'ORDER_STATUS_CHANGED', message: 'changed', status: 409 }))
      .mockResolvedValueOnce(result);
    const wrapper = mountWorkspace();
    await flushPromises();
    await wrapper.get('[aria-label="增加数量"]').trigger('click');
    await wrapper.get('[data-testid="confirm-table-order"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="ordering-outcome-uncertain"]').exists()).toBe(false);
    expect(wrapper.get('[aria-label="增加数量"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('[aria-label="增加数量"]').trigger('click');
    await wrapper.get('[data-testid="confirm-table-order"]').trigger('click');
    await flushPromises();

    const firstPayload = apiMocks.createMerchantTableOrder.mock.calls[0]?.[1];
    const secondPayload = apiMocks.createMerchantTableOrder.mock.calls[1]?.[1];
    expect(secondPayload?.idempotencyKey).not.toBe(firstPayload?.idempotencyKey);
    expect(secondPayload?.items).toEqual([{ productId: 'product-1', quantity: 2 }]);
  });

  it('retries an uncertain payload against its captured table even if live context changes', async () => {
    apiMocks.createMerchantTableOrder
      .mockRejectedValueOnce(new CashierApiError({ code: 'HTTP_500', message: 'failed', status: 500 }))
      .mockResolvedValueOnce(result);
    const wrapper = mountWorkspace();
    await flushPromises();
    await wrapper.get('[aria-label="增加数量"]').trigger('click');
    await wrapper.get('[data-testid="confirm-table-order"]').trigger('click');
    await flushPromises();
    const originalPayload = apiMocks.createMerchantTableOrder.mock.calls[0]?.[1];

    await wrapper.setProps({ tableId: 'table-2', sessionId: 'session-2', tableLabel: 'B02' });
    expect(wrapper.get('[data-testid="confirm-table-order"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).toContain('A01 号桌');
    await wrapper.get('[data-testid="confirm-table-order"]').trigger('click');
    await flushPromises();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenNthCalledWith(2, 'table-1', originalPayload);
    expect(apiMocks.createMerchantTableOrder.mock.calls[1]?.[1]).toEqual(originalPayload);
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
