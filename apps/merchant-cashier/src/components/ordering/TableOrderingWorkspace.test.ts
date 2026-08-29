import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CashierApiError } from '@/api';
import { setLocale } from '@/i18n';
import type { CashierMenuProduct } from '@/types';

const apiMocks = vi.hoisted(() => ({
  listCashierMenuCategories: vi.fn(),
  listCashierMenuProducts: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api')>(),
  ...apiMocks,
}));

import TableOrderingWorkspace from './TableOrderingWorkspace.vue';
import { useCatalogStore } from '@/stores';

const category = {
  id: 'category-1', nameZh: '主食', nameVi: 'Món chính', nameEn: 'Mains', sortOrder: 1, isActive: true,
};
const secondCategory = {
  ...category, id: 'category-2', nameZh: '饮品', nameVi: 'Đồ uống', nameEn: 'Drinks', sortOrder: 2,
};
const product: CashierMenuProduct = {
  id: 'product-1', categoryId: category.id, nameZh: '牛肉粉', nameVi: 'Phở bò', nameEn: 'Beef pho',
  priceVnd: '60000', unit: '份', sortOrder: 1, status: 'ON_SALE', productType: 'FOOD', category,
};
const secondProduct: CashierMenuProduct = {
  ...product, id: 'product-2', categoryId: secondCategory.id, nameZh: '冰咖啡', nameVi: 'Cà phê đá',
  nameEn: 'Iced coffee', priceVnd: '30000', category: secondCategory,
};

function mountWorkspace(overrides: {
  embedded?: boolean;
  disabled?: boolean;
  productQuantities?: Record<string, number>;
  pendingAddQuantities?: Record<string, number>;
  mutationLocked?: boolean;
  pinia?: Pinia;
} = {}) {
  const pinia = overrides.pinia || createPinia();
  setActivePinia(pinia);
  useCatalogStore().activateMerchant('merchant-1');
  return mount(TableOrderingWorkspace, {
    props: {
      open: true,
      tableId: 'table-1',
      tableLabel: 'A01',
      sessionId: 'session-1',
      embedded: overrides.embedded,
      disabled: overrides.disabled,
      productQuantities: overrides.productQuantities,
      pendingAddQuantities: overrides.pendingAddQuantities,
      mutationLocked: overrides.mutationLocked,
    },
    global: { plugins: [pinia], stubs: { Teleport: true } },
  });
}

function productCard(wrapper: ReturnType<typeof mountWorkspace>, productId = product.id) {
  return wrapper.get(`.table-ordering-product[data-product-id="${productId}"]`);
}

describe('TableOrderingWorkspace shared-controller UI', () => {
  afterEach(() => {
    setLocale('zh');
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    localStorage.clear();
    apiMocks.listCashierMenuCategories.mockReset().mockResolvedValue([category, secondCategory]);
    apiMocks.listCashierMenuProducts.mockReset().mockResolvedValue([
      product,
      secondProduct,
      { ...product, id: 'product-off', nameZh: '停售菜', status: 'OFF_SALE' },
    ]);
  });

  it('remains a catalog UI consumer and emits the selected product without owning an API mutation', async () => {
    const wrapper = mountWorkspace({ embedded: true });
    await flushPromises();
    expect(wrapper.text()).toContain('牛肉粉');
    expect(wrapper.text()).not.toContain('停售菜');
    expect(productCard(wrapper).get('.table-ordering-product__price').text()).toBe('60,000/份');

    await productCard(wrapper).trigger('click');
    expect(wrapper.emitted('addProduct')).toEqual([[product.id]]);

    const source = readFileSync(resolve(process.cwd(), 'src/components/ordering/TableOrderingWorkspace.vue'), 'utf8');
    expect(source).not.toContain('createMerchantTableOrder');
    expect(source).not.toContain('directAddQueue');
  });

  it('renders immediate shared pending quantity and navigation lock without layout replacement', async () => {
    const wrapper = mountWorkspace({
      embedded: true,
      productQuantities: { [product.id]: 5 },
      pendingAddQuantities: { [product.id]: 3 },
      mutationLocked: true,
    });
    await flushPromises();
    expect(productCard(wrapper).get('.table-ordering-product__quick-add output').text()).toBe('X5');
    expect(productCard(wrapper).attributes('aria-busy')).toBe('true');
    expect(wrapper.find('[data-testid="ordering-navigation-guard"]').exists()).toBe(true);
  });

  it('preserves pending mutation UI while a stale catalog revalidates', async () => {
    const pinia = createPinia();
    const wrapper = mountWorkspace({
      pinia,
      embedded: true,
      productQuantities: { [product.id]: 4 },
      pendingAddQuantities: { [product.id]: 2 },
      mutationLocked: true,
    });
    await flushPromises();
    const refresh = deferred<CashierMenuProduct[]>();
    apiMocks.listCashierMenuProducts.mockReturnValueOnce(refresh.promise);
    const store = useCatalogStore();
    store.invalidate();
    await store.loadCatalog();

    expect(store.revalidating).toBe(true);
    expect(productCard(wrapper).get('.table-ordering-product__quick-add output').text()).toBe('X4');
    expect(productCard(wrapper).attributes('aria-busy')).toBe('true');

    refresh.resolve([product, secondProduct]);
    await flushPromises();
    expect(productCard(wrapper).get('.table-ordering-product__quick-add output').text()).toBe('X4');
  });

  it('does not emit when writes are disabled', async () => {
    const wrapper = mountWorkspace({ disabled: true });
    await flushPromises();
    await productCard(wrapper).trigger('click');
    expect(wrapper.emitted('addProduct')).toBeUndefined();
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

  it('reuses the shared catalog snapshot when the menu is reopened', async () => {
    const pinia = createPinia();
    const first = mountWorkspace({ pinia });
    await flushPromises();
    expect(apiMocks.listCashierMenuProducts).toHaveBeenCalledOnce();
    first.unmount();
    const second = mountWorkspace({ pinia });
    await flushPromises();
    expect(apiMocks.listCashierMenuProducts).toHaveBeenCalledOnce();
    expect(second.text()).toContain('牛肉粉');
  });

  it('keeps multilingual search and keyboard selection bound to one add event', async () => {
    setLocale('vi');
    const wrapper = mountWorkspace();
    await flushPromises();
    const search = wrapper.get('input[type="search"]');
    await search.setValue('cà phê');
    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(1);
    await search.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('addProduct')).toBeUndefined();
    await search.trigger('keydown', { key: 'ArrowDown' });
    await productCard(wrapper, secondProduct.id).trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('addProduct')).toEqual([[secondProduct.id]]);
  });

  it('keeps the mobile search and category strip outside the product scroller', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    const wrapper = mountWorkspace({ embedded: true });
    await flushPromises();
    const header = wrapper.get('.table-ordering-header');
    const scroller = wrapper.get('[data-testid="table-ordering-products-scroller"]');
    expect(header.find('[data-testid="table-ordering-search"]').exists()).toBe(true);
    expect(header.find('[data-testid="table-ordering-category-strip"]').exists()).toBe(true);
    expect(scroller.find('[data-testid="table-ordering-category-strip"]').exists()).toBe(false);
  });

  it('retains the compact Cashier density, touch and horizontal category contracts', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles/cashier-v2-phase1.css'), 'utf8');
    const mobileV5 = styles.slice(styles.indexOf('/* Mobile ordering V5:'));
    const mobileV6 = styles.slice(styles.indexOf('/* Mobile header responsibility split V6 FINAL:'));
    expect(mobileV5).toMatch(/\.table-ordering-product-grid\s*\{[^}]*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
    expect(mobileV5).toMatch(/\.table-ordering-product\s*\{[^}]*min-height:\s*116px;/s);
    expect(mobileV6).toMatch(/\.table-ordering-category-strip\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto/s);
    expect(mobileV6).toMatch(/\.table-ordering-category-strip button\s*\{[^}]*white-space:\s*nowrap;/s);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
