import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CashierApiError } from '@/api';
import { productDirectMergeKey } from '@/domain';
import { setLocale } from '@/i18n';
import type { CashierMenuProduct, MerchantOrderMutationResult } from '@/types';

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
  nameEn: 'Mains',
  sortOrder: 1,
  isActive: true,
};
const secondCategory = {
  ...category,
  id: 'category-2',
  nameZh: '饮品',
  nameVi: 'Đồ uống',
  nameEn: 'Drinks',
  sortOrder: 2,
};
const product: CashierMenuProduct = {
  id: 'product-1',
  categoryId: category.id,
  nameZh: '牛肉粉',
  nameVi: 'Phở bò',
  nameEn: 'Beef pho',
  priceVnd: '60000',
  sortOrder: 1,
  status: 'ON_SALE',
  productType: 'FOOD',
  category,
};
const secondProduct: CashierMenuProduct = {
  ...product,
  id: 'product-2',
  categoryId: secondCategory.id,
  nameZh: '冰咖啡',
  nameVi: 'Cà phê đá',
  nameEn: 'Iced coffee',
  priceVnd: '30000',
  category: secondCategory,
};

function mutationResult(
  selectedProduct: CashierMenuProduct = product,
  sessionId = 'session-1',
): MerchantOrderMutationResult {
  return {
    order: {
      id: `order-${selectedProduct.id}`,
      orderNo: `ADD-${selectedProduct.id}`,
      merchantId: 'merchant-1',
      tableId: 'table-1',
      tableSessionId: sessionId,
      orderType: 'DINE_IN',
      status: 'ACCEPTED',
      itemAmountVnd: selectedProduct.priceVnd,
      deliveryFeeVnd: '0',
      totalAmountVnd: selectedProduct.priceVnd,
      settlementStatus: 'UNSETTLED',
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
      items: [{
        id: `item-${selectedProduct.id}`,
        productId: selectedProduct.id,
        productNameZhSnapshot: selectedProduct.nameZh,
        unitPriceVnd: selectedProduct.priceVnd,
        quantity: 1,
        subtotalVnd: selectedProduct.priceVnd,
      }],
    },
    session: {
      id: sessionId,
      sessionNo: 'S-1',
      merchantId: 'merchant-1',
      tableId: 'table-1',
      tableNo: 'A01',
      status: 'OPEN',
      openedAt: '2026-08-27T00:00:00.000Z',
      orderCount: 1,
      itemCount: 1,
      totalAmountVnd: selectedProduct.priceVnd,
      pendingOrderCount: 0,
      unfinishedOrderCount: 1,
      orders: [],
    },
  };
}

function openResult(sessionId = 'session-1'): MerchantOrderMutationResult {
  return { ...mutationResult(product, sessionId), order: null };
}

function mountWorkspace(overrides: {
  sessionId?: string;
  embedded?: boolean;
  disabled?: boolean;
  productQuantities?: Record<string, number>;
} = {}) {
  return mount(TableOrderingWorkspace, {
    props: {
      open: true,
      tableId: 'table-1',
      tableLabel: 'A01',
      sessionId: overrides.sessionId ?? 'session-1',
      embedded: overrides.embedded,
      disabled: overrides.disabled,
      productQuantities: overrides.productQuantities,
    },
    global: {
      plugins: [createPinia()],
      stubs: { Teleport: true },
    },
  });
}

function productCard(wrapper: ReturnType<typeof mountWorkspace>, productId = product.id) {
  return wrapper.get(`.table-ordering-product[data-product-id="${productId}"]`);
}

describe('TableOrderingWorkspace V6 direct ordering', () => {
  afterEach(() => {
    setLocale('zh');
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    apiMocks.listCashierMenuCategories.mockReset().mockResolvedValue([category, secondCategory]);
    apiMocks.listCashierMenuProducts.mockReset().mockResolvedValue([
      product,
      secondProduct,
      { ...product, id: 'product-off', nameZh: '停售菜', status: 'OFF_SALE' },
    ]);
    apiMocks.createMerchantTableOrder.mockReset();
  });

  it('loads the orderable catalog, keeps currency compact and removes the confirmation footer', async () => {
    const wrapper = mountWorkspace({ embedded: true });
    await flushPromises();
    expect(wrapper.text()).toContain('牛肉粉');
    expect(wrapper.text()).toContain('冰咖啡');
    expect(wrapper.text()).not.toContain('停售菜');
    expect(productCard(wrapper).get('.table-ordering-product__price').text()).toBe('60,000');
    expect(wrapper.find('.table-ordering-footer').exists()).toBe(false);
    expect(wrapper.find('[data-testid="confirm-table-order"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('待提交');
  });

  it('renders only the canonical product quantity as an X badge and lets three digits expand', async () => {
    const wrapper = mountWorkspace({ embedded: true, productQuantities: {} });
    await flushPromises();
    expect(productCard(wrapper).find('.table-ordering-product__quick-add').exists()).toBe(false);

    await wrapper.setProps({ productQuantities: { [product.id]: 1 } });
    expect(productCard(wrapper).get('.table-ordering-product__quick-add output').text()).toBe('X1');

    await wrapper.setProps({ productQuantities: { [product.id]: 2 } });
    expect(productCard(wrapper).get('.table-ordering-product__quick-add output').text()).toBe('X2');

    await wrapper.setProps({ productQuantities: { [product.id]: 100 } });
    expect(productCard(wrapper).get('.table-ordering-product__quick-add output').text()).toBe('X100');
  });

  it('shows a recoverable catalog failure and reloads from the visible retry action', async () => {
    apiMocks.listCashierMenuProducts
      .mockRejectedValueOnce(new CashierApiError({ code: 'NETWORK_ERROR', message: 'offline' }))
      .mockResolvedValueOnce([product]);
    const wrapper = mountWorkspace();
    await flushPromises();
    expect(wrapper.text()).toContain('网络连接失败');
    await wrapper.get('.state-panel--error button').trigger('click');
    await flushPromises();
    expect(apiMocks.listCashierMenuProducts).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain('牛肉粉');
  });

  it('persists one direct add when an active-table product card is clicked', async () => {
    const result = mutationResult();
    apiMocks.createMerchantTableOrder.mockResolvedValueOnce(result);
    const wrapper = mountWorkspace();
    await flushPromises();
    await productCard(wrapper).trigger('click');
    await flushPromises();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledOnce();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledWith('table-1', {
      idempotencyKey: expect.stringMatching(/^add-/),
      items: [{ productId: product.id, quantity: 1 }],
    });
    expect(wrapper.emitted('created')).toEqual([[result]]);
    expect(wrapper.find('[data-testid="confirm-table-order"]').exists()).toBe(false);
  });

  it('opens an empty table through the formal open-only contract before adding the clicked product', async () => {
    const opened = openResult('session-new');
    const added = mutationResult(product, 'session-new');
    apiMocks.createMerchantTableOrder.mockResolvedValueOnce(opened).mockResolvedValueOnce(added);
    const wrapper = mountWorkspace({ sessionId: '' });
    await flushPromises();
    await productCard(wrapper).trigger('click');
    await flushPromises();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledTimes(2);
    expect(apiMocks.createMerchantTableOrder).toHaveBeenNthCalledWith(1, 'table-1', {
      idempotencyKey: expect.stringMatching(/^add-/),
      items: [],
    });
    expect(apiMocks.createMerchantTableOrder).toHaveBeenNthCalledWith(2, 'table-1', {
      idempotencyKey: expect.stringMatching(/^add-/),
      items: [{ productId: product.id, quantity: 1 }],
    });
    expect(wrapper.emitted('created')).toEqual([[opened], [added]]);
    expect(wrapper.get('[data-testid="table-ordering-workspace"]').attributes('data-session-id')).toBe('session-new');
  });

  it('serializes rapid empty-table clicks behind one open-only mutation', async () => {
    const deferredOpen = createDeferred<MerchantOrderMutationResult>();
    apiMocks.createMerchantTableOrder
      .mockReturnValueOnce(deferredOpen.promise)
      .mockResolvedValueOnce(mutationResult(product, 'session-new'))
      .mockResolvedValueOnce(mutationResult(product, 'session-new'));
    const wrapper = mountWorkspace({ sessionId: '' });
    await flushPromises();
    await productCard(wrapper).trigger('click');
    await productCard(wrapper).trigger('click');
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledOnce();
    deferredOpen.resolve(openResult('session-new'));
    await flushPromises();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledTimes(3);
    expect(apiMocks.createMerchantTableOrder.mock.calls.filter(([, payload]) => payload.items.length === 0)).toHaveLength(1);
    expect(apiMocks.createMerchantTableOrder.mock.calls.slice(1).map(([, payload]) => payload.items)).toEqual([
      [{ productId: product.id, quantity: 1 }],
      [{ productId: product.id, quantity: 1 }],
    ]);
    expect(new Set(apiMocks.createMerchantTableOrder.mock.calls.map(([, payload]) => payload.idempotencyKey)).size).toBe(3);
  });

  it('exposes five rapid same-item clicks as one optimistic quantity-five canonical line', async () => {
    const deferred = createDeferred<MerchantOrderMutationResult>();
    apiMocks.createMerchantTableOrder
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValue(mutationResult());
    const wrapper = mountWorkspace();
    await flushPromises();

    for (let index = 0; index < 5; index += 1) await productCard(wrapper).trigger('click');
    await wrapper.vm.$nextTick();

    const pending = wrapper.emitted('draftChanged')?.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(pending).toEqual([expect.objectContaining({
      mergeKey: productDirectMergeKey(product.id),
      quantity: 5,
      firstAddedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      firstAddedSequence: 0,
    })]);
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledOnce();

    deferred.resolve(mutationResult());
    await flushPromises();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledTimes(5);
    expect(apiMocks.createMerchantTableOrder.mock.calls.map(([, payload]) => payload.items)).toEqual(
      Array.from({ length: 5 }, () => [{ productId: product.id, quantity: 1 }]),
    );
  });

  it('merges three card clicks and two right-stepper clicks into one optimistic quantity-five line', async () => {
    const deferred = createDeferred<MerchantOrderMutationResult>();
    apiMocks.createMerchantTableOrder
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValue(mutationResult());
    const wrapper = mountWorkspace();
    await flushPromises();

    await productCard(wrapper).trigger('click');
    await productCard(wrapper).trigger('click');
    await productCard(wrapper).trigger('click');
    const exposed = wrapper.vm as unknown as {
      queueProductAddition: (
        productId: string,
        lineId?: string,
        sourceItemId?: string,
        mergeKey?: string,
        remark?: string,
      ) => boolean;
    };
    const mergeKey = productDirectMergeKey(product.id);
    expect(exposed.queueProductAddition(product.id, `canonical:${mergeKey}`, 'item-9', mergeKey)).toBe(true);
    expect(exposed.queueProductAddition(product.id, `canonical:${mergeKey}`, 'item-9', mergeKey)).toBe(true);
    await wrapper.vm.$nextTick();

    const pending = wrapper.emitted('draftChanged')?.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(pending).toEqual([expect.objectContaining({
      mergeKey,
      sourceItemId: 'item-9',
      quantity: 5,
    })]);

    deferred.resolve(mutationResult());
    await flushPromises();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledTimes(5);
  });

  it('preserves first-click metadata and queue order for different pending products', async () => {
    const deferred = createDeferred<MerchantOrderMutationResult>();
    apiMocks.createMerchantTableOrder
      .mockReturnValueOnce(deferred.promise)
      .mockResolvedValue(mutationResult(secondProduct));
    const wrapper = mountWorkspace();
    await flushPromises();

    await productCard(wrapper, product.id).trigger('click');
    await productCard(wrapper, secondProduct.id).trigger('click');
    await wrapper.vm.$nextTick();

    const pending = wrapper.emitted('draftChanged')?.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(pending.map((line) => line.product && (line.product as CashierMenuProduct).id))
      .toEqual([product.id, secondProduct.id]);
    expect(pending.map((line) => line.firstAddedSequence)).toEqual([0, 1]);
    expect(pending.every((line) => typeof line.firstAddedAt === 'string')).toBe(true);

    deferred.resolve(mutationResult(product));
    await flushPromises();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledTimes(2);
  });

  it('preserves clicked-product identity across consecutive different products', async () => {
    apiMocks.createMerchantTableOrder
      .mockResolvedValueOnce(mutationResult(product))
      .mockResolvedValueOnce(mutationResult(secondProduct));
    const wrapper = mountWorkspace();
    await flushPromises();
    await productCard(wrapper, product.id).trigger('click');
    await productCard(wrapper, secondProduct.id).trigger('click');
    await flushPromises();
    expect(apiMocks.createMerchantTableOrder.mock.calls.map(([, payload]) => payload.items)).toEqual([
      [{ productId: product.id, quantity: 1 }],
      [{ productId: secondProduct.id, quantity: 1 }],
    ]);
  });

  it('keeps committed-row identity in the optimistic line while persisting one unit', async () => {
    const deferred = createDeferred<MerchantOrderMutationResult>();
    apiMocks.createMerchantTableOrder.mockReturnValueOnce(deferred.promise);
    const wrapper = mountWorkspace();
    await flushPromises();
    const exposed = wrapper.vm as unknown as {
      queueProductAddition: (
        productId: string,
        lineId?: string,
        sourceItemId?: string,
        mergeKey?: string,
        remark?: string,
      ) => boolean;
    };
    const mergeKey = productDirectMergeKey(product.id, '少盐');
    expect(exposed.queueProductAddition(product.id, 'committed:item-9', 'item-9', mergeKey, '少盐')).toBe(true);
    await wrapper.vm.$nextTick();
    const drafts = wrapper.emitted('draftChanged')?.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(drafts).toEqual([expect.objectContaining({
      lineId: 'committed:item-9',
      mergeKey,
      sourceItemId: 'item-9',
      remark: '少盐',
      quantity: 1,
    })]);
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledWith('table-1', expect.objectContaining({
      items: [{ productId: product.id, quantity: 1, remark: '少盐' }],
    }));
    deferred.resolve(mutationResult());
    await flushPromises();
    expect(wrapper.emitted('draftChanged')?.at(-1)?.[0]).toEqual([]);
  });

  it('retries an uncertain direct add with the exact same table and payload', async () => {
    apiMocks.createMerchantTableOrder
      .mockRejectedValueOnce(new CashierApiError({ code: 'NETWORK_ERROR', message: 'offline' }))
      .mockResolvedValueOnce(mutationResult());
    const wrapper = mountWorkspace();
    await flushPromises();
    await productCard(wrapper).trigger('click');
    await flushPromises();
    const original = apiMocks.createMerchantTableOrder.mock.calls[0];
    expect(wrapper.find('[data-testid="ordering-navigation-guard"]').exists()).toBe(true);
    expect(productCard(wrapper).attributes('aria-disabled')).toBe('false');
    expect(productCard(wrapper, secondProduct.id).attributes('aria-disabled')).toBe('true');
    await productCard(wrapper, secondProduct.id).trigger('click');
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledOnce();
    await wrapper.setProps({ tableId: 'table-2', tableLabel: 'B02', sessionId: 'session-2' });
    await productCard(wrapper).trigger('click');
    await flushPromises();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledTimes(2);
    expect(apiMocks.createMerchantTableOrder.mock.calls[1]).toEqual(original);
    expect(wrapper.find('[data-testid="ordering-navigation-guard"]').exists()).toBe(false);
  });

  it('releases a definitively rejected direct add and assigns the next click a new key', async () => {
    apiMocks.createMerchantTableOrder
      .mockRejectedValueOnce(new CashierApiError({ code: 'PRODUCT_NOT_AVAILABLE', message: 'gone', status: 409 }))
      .mockResolvedValueOnce(mutationResult());
    const wrapper = mountWorkspace();
    await flushPromises();
    await productCard(wrapper).trigger('click');
    await flushPromises();
    await productCard(wrapper).trigger('click');
    await flushPromises();
    const firstPayload = apiMocks.createMerchantTableOrder.mock.calls[0]?.[1];
    const secondPayload = apiMocks.createMerchantTableOrder.mock.calls[1]?.[1];
    expect(secondPayload.idempotencyKey).not.toBe(firstPayload.idempotencyKey);
    expect(secondPayload.items).toEqual([{ productId: product.id, quantity: 1 }]);
  });

  it('recovers an open race signalled by TABLE_ALREADY_OPEN and still adds the intended product', async () => {
    apiMocks.createMerchantTableOrder
      .mockRejectedValueOnce(new CashierApiError({ code: 'TABLE_ALREADY_OPEN', message: 'open', status: 409 }))
      .mockResolvedValueOnce(mutationResult(product, 'session-race'));
    const wrapper = mountWorkspace({ sessionId: '' });
    await flushPromises();
    await productCard(wrapper).trigger('click');
    await flushPromises();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledTimes(2);
    expect(apiMocks.createMerchantTableOrder.mock.calls[1]?.[1].items).toEqual([
      { productId: product.id, quantity: 1 },
    ]);
  });

  it('keeps category and multilingual search paths bound to direct add', async () => {
    apiMocks.createMerchantTableOrder
      .mockResolvedValueOnce(mutationResult(secondProduct))
      .mockResolvedValueOnce(mutationResult(product));
    const wrapper = mountWorkspace({ embedded: true });
    await flushPromises();
    const categoryButtons = wrapper.findAll('[data-testid="table-ordering-category-strip"] button');
    await categoryButtons.find((button) => button.text() === '饮品')!.trigger('click');
    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(1);
    await productCard(wrapper, secondProduct.id).trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="table-ordering-category-strip"] button').trigger('click');
    await wrapper.get('input[type="search"]').setValue('niuroufen');
    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(1);
    await productCard(wrapper).trigger('click');
    await flushPromises();
    expect(apiMocks.createMerchantTableOrder.mock.calls.map(([, payload]) => payload.items[0]?.productId)).toEqual([
      secondProduct.id,
      product.id,
    ]);
  });

  it('keeps the mobile search and all category rows outside the product scroller', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const wrapper = mountWorkspace({ embedded: true });
    await flushPromises();

    const header = wrapper.get('.table-ordering-header');
    const scroller = wrapper.get('[data-testid="table-ordering-products-scroller"]');
    const search = header.get('[data-testid="table-ordering-search"]');
    const categoryStrip = header.get('[data-testid="table-ordering-category-strip"]');
    expect(wrapper.findAll('[data-testid="table-ordering-category-strip"]')).toHaveLength(1);
    expect(scroller.find('[data-testid="table-ordering-category-strip"]').exists()).toBe(false);
    expect(search.element.compareDocumentPosition(categoryStrip.element) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('keeps one top safe-area owner and the iOS search and category density contracts', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles/cashier-v2-phase1.css'), 'utf8');
    const viewport = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const mobileHotfix = styles.slice(styles.indexOf('/* Mobile density hotfix V4:'));

    expect(styles).toMatch(/\.table-ordering-workspace--embedded\s*\{[^}]*padding-top:\s*0;/s);
    expect(mobileHotfix).toMatch(/\.table-ordering-header\s*\{[^}]*gap:\s*2px;[^}]*padding:\s*2px 8px;/s);
    expect(mobileHotfix).toMatch(/\.table-ordering-header > \.table-ordering-search\s*\{[^}]*height:\s*42px;/s);
    expect(mobileHotfix).toMatch(/\.table-ordering-header > \.table-ordering-search:focus-within\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px/s);
    expect(mobileHotfix).toMatch(/\.table-ordering-header > \.table-ordering-search input\s*\{[^}]*min-height:\s*0;[^}]*font-size:\s*16px;/s);
    expect(mobileHotfix).toMatch(/\.table-ordering-header > \.table-ordering-search input:focus-visible\s*\{[^}]*outline:\s*none;[^}]*box-shadow:\s*none;/s);
    expect(mobileHotfix).toMatch(/\.table-ordering-category-strip\s*\{[^}]*row-gap:\s*0;[^}]*column-gap:\s*10px;/s);
    expect(mobileHotfix).toMatch(/\.table-ordering-category-strip button\s*\{[^}]*min-height:\s*44px;/s);
    expect(mobileHotfix).toMatch(/\.table-ordering-products\s*\{[^}]*padding:\s*2px 8px 8px;/s);
    expect(viewport).toContain('viewport-fit=cover');
    expect(viewport).not.toMatch(/maximum-scale|user-scalable\s*=\s*no/i);
  });

  it('pins the V5 mobile four-column density, dark search and safe interaction contracts', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles/cashier-v2-phase1.css'), 'utf8');
    const mobileV5 = styles.slice(styles.indexOf('/* Mobile ordering V5:'));
    const source = readFileSync(resolve(process.cwd(), 'src/components/ordering/TableOrderingWorkspace.vue'), 'utf8');

    expect(mobileV5).toMatch(/\.cashier-mobile-search-context\s*\{[^}]*background:\s*#102a39;/s);
    expect(mobileV5).toMatch(/\.cashier-mobile-menu-search \.table-ordering-search:focus-within\s*\{[^}]*box-shadow:\s*none;/s);
    expect(mobileV5).toMatch(/\.cashier-mobile-menu-search \.table-ordering-search input\s*\{[^}]*font-size:\s*16px;/s);
    expect(mobileV5).toMatch(/\.table-ordering-product-grid\s*\{[^}]*repeat\(4,\s*minmax\(0,\s*1fr\)\);[^}]*gap:\s*5px;/s);
    expect(mobileV5).toMatch(/\.table-ordering-product\s*\{[^}]*min-height:\s*116px;/s);
    expect(mobileV5).toMatch(/\.table-ordering-product__content strong\s*\{[^}]*font-size:\s*12px;[^}]*-webkit-line-clamp:\s*2;/s);
    expect(mobileV5).toMatch(/\.table-ordering-product__quick-add output\s*\{[^}]*max-width:\s*none;[^}]*overflow:\s*visible;[^}]*background:\s*#2e9f62;/s);
    expect(source).toContain('X{{ canonicalQuantityForProduct(product.id) }}');
    expect(source).not.toContain('<output>×');
  });

  it('supports explicit keyboard result selection without adding on an unselected Enter', async () => {
    apiMocks.createMerchantTableOrder.mockResolvedValueOnce(mutationResult());
    const wrapper = mountWorkspace();
    await flushPromises();
    const search = wrapper.get('input[type="search"]');
    await search.setValue('牛');
    await search.trigger('keydown', { key: 'Enter' });
    expect(apiMocks.createMerchantTableOrder).not.toHaveBeenCalled();
    await search.trigger('keydown', { key: 'ArrowDown' });
    await productCard(wrapper).trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(apiMocks.createMerchantTableOrder).toHaveBeenCalledOnce();
  });

  it.each([
    ['zh', '牛肉粉'],
    ['vi', 'Phở bò'],
    ['en', 'Beef pho'],
  ])('renders the direct-order catalog in %s without legacy submit copy', async (locale, expected) => {
    setLocale(locale as 'zh' | 'vi' | 'en');
    const wrapper = mountWorkspace();
    await flushPromises();
    expect(wrapper.text()).toContain(expected);
    expect(wrapper.find('.table-ordering-footer').exists()).toBe(false);
  });

  it('does not enqueue a direct add when writes are disabled', async () => {
    const wrapper = mountWorkspace({ disabled: true });
    await flushPromises();
    await productCard(wrapper).trigger('click');
    expect(apiMocks.createMerchantTableOrder).not.toHaveBeenCalled();
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
