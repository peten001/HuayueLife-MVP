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

function catalogProducts(count: number) {
  return Array.from({ length: count }, (_, index): CashierMenuProduct => ({
    ...product,
    id: `product-${index + 1}`,
    nameZh: `分页菜品${String(index + 1).padStart(3, '0')}`,
    nameVi: `Món phân trang ${index + 1}`,
    nameEn: `Paged dish ${index + 1}`,
    sortOrder: index + 1,
  }));
}

function mountWorkspace(overrides: {
  embedded?: boolean;
  disabled?: boolean;
  productQuantities?: Record<string, number>;
  pendingAddQuantities?: Record<string, number>;
  mutationLocked?: boolean;
  mobileV2Presentation?: boolean;
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
      mobileV2Presentation: overrides.mobileV2Presentation,
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

  it('renders only the active 20-item desktop page without issuing catalog requests on page turns', async () => {
    apiMocks.listCashierMenuCategories.mockResolvedValueOnce([category]);
    apiMocks.listCashierMenuProducts.mockResolvedValueOnce(catalogProducts(45));
    const wrapper = mountWorkspace({ embedded: true });
    await flushPromises();

    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(20);
    expect(wrapper.get('[data-testid="table-ordering-pagination"]').text()).toContain('1 / 3');
    expect(wrapper.text()).toContain('分页菜品001');
    expect(wrapper.text()).not.toContain('分页菜品021');

    await wrapper.get('[data-testid="ordering-next-page"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(20);
    expect(wrapper.get('[data-testid="table-ordering-pagination"]').text()).toContain('2 / 3');
    expect(wrapper.text()).toContain('分页菜品021');
    expect(wrapper.text()).not.toContain('分页菜品001');
    expect(apiMocks.listCashierMenuCategories).toHaveBeenCalledOnce();
    expect(apiMocks.listCashierMenuProducts).toHaveBeenCalledOnce();

    await wrapper.get('[data-testid="ordering-next-page"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(5);
    expect(wrapper.get('[data-testid="ordering-next-page"]').attributes('disabled')).toBeDefined();
  });

  it('resets desktop pagination after search and table context changes', async () => {
    apiMocks.listCashierMenuCategories.mockResolvedValueOnce([category]);
    apiMocks.listCashierMenuProducts.mockResolvedValueOnce(catalogProducts(45));
    const wrapper = mountWorkspace({ embedded: true });
    await flushPromises();
    await wrapper.get('[data-testid="ordering-next-page"]').trigger('click');
    expect(wrapper.get('[data-testid="table-ordering-pagination"]').text()).toContain('2 / 3');

    await wrapper.get('input[type="search"]').setValue('分页菜品045');
    await flushPromises();
    expect(wrapper.get('[data-testid="table-ordering-pagination"]').text()).toContain('1 / 1');
    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(1);

    await wrapper.get('input[type="search"]').setValue('');
    await flushPromises();
    expect(wrapper.get('[data-testid="table-ordering-pagination"]').text()).toContain('1 / 3');
    await wrapper.get('[data-testid="ordering-next-page"]').trigger('click');
    await wrapper.setProps({ tableId: 'table-2' });
    await flushPromises();
    expect(wrapper.get('[data-testid="table-ordering-pagination"]').text()).toContain('1 / 3');
    expect(wrapper.text()).toContain('分页菜品001');
  });

  it('resets to page one after category selection and a changed catalog identity', async () => {
    const firstCategoryProducts = catalogProducts(25);
    const secondCategoryProducts = catalogProducts(25).map((item, index) => ({
      ...item,
      id: `drink-${index + 1}`,
      categoryId: secondCategory.id,
      nameZh: `饮品分页${String(index + 1).padStart(3, '0')}`,
      category: secondCategory,
    }));
    apiMocks.listCashierMenuCategories.mockResolvedValueOnce([category, secondCategory]);
    apiMocks.listCashierMenuProducts.mockResolvedValueOnce([...firstCategoryProducts, ...secondCategoryProducts]);
    const wrapper = mountWorkspace({ embedded: true });
    await flushPromises();
    await wrapper.get('[data-testid="ordering-next-page"]').trigger('click');
    expect(wrapper.get('[data-testid="table-ordering-pagination"]').text()).toContain('2 / 3');

    const drinks = wrapper.findAll('[data-testid="table-ordering-category-strip"] button')
      .find((button) => button.text() === '饮品');
    expect(drinks).toBeDefined();
    await drinks!.trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="table-ordering-pagination"]').text()).toContain('1 / 2');
    expect(wrapper.text()).toContain('饮品分页001');

    await wrapper.get('[data-testid="ordering-next-page"]').trigger('click');
    const store = useCatalogStore();
    store.products = secondCategoryProducts.slice(0, 5);
    await flushPromises();
    expect(wrapper.get('[data-testid="table-ordering-pagination"]').text()).toContain('1 / 1');
    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(5);
  });

  it('paints the mobile first screen before progressively completing the same scrollable catalog', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    apiMocks.listCashierMenuCategories.mockResolvedValueOnce([category]);
    apiMocks.listCashierMenuProducts.mockResolvedValueOnce(catalogProducts(45));
    const wrapper = mountWorkspace({ embedded: true });
    await flushPromises();

    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(20);
    expect(wrapper.get('.table-ordering-product-grid').attributes('data-total-product-count')).toBe('45');
    expect(wrapper.find('[data-testid="table-ordering-pagination"]').exists()).toBe(false);
    await vi.waitFor(() => expect(wrapper.findAll('.table-ordering-product')).toHaveLength(45));
    expect(wrapper.findAll('.table-ordering-product').map((card) => card.attributes('data-product-id')))
      .toEqual(catalogProducts(45).map((item) => item.id));
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

  it('keeps normal pending additions interactive and allows the menu to close', async () => {
    const wrapper = mountWorkspace({
      embedded: false,
      productQuantities: { [product.id]: 5 },
      pendingAddQuantities: { [product.id]: 3 },
      mutationLocked: false,
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="ordering-navigation-guard"]').exists()).toBe(false);
    const close = wrapper.get('.table-ordering-close');
    expect(close.attributes('disabled')).toBeUndefined();
    await close.trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
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

  it('scopes desktop search to the active category and searches globally only in All', async () => {
    const wrapper = mountWorkspace({ embedded: true });
    await flushPromises();

    const categories = wrapper.findAll('[data-testid="table-ordering-category-strip"] button');
    const all = categories.find((button) => button.text() === '全部');
    const drinks = categories.find((button) => button.text() === '饮品');
    expect(all).toBeDefined();
    expect(drinks).toBeDefined();

    await drinks!.trigger('click');
    const search = wrapper.get('input[type="search"]');
    await search.setValue('牛肉粉');
    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(0);

    await search.setValue('冰咖啡');
    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(1);
    expect(wrapper.text()).toContain('冰咖啡');

    await all!.trigger('click');
    await search.setValue('牛肉粉');
    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(1);
    expect(wrapper.text()).toContain('牛肉粉');
  });

  it('loads the visible image again after category and search result changes', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      if (this.classList.contains('table-ordering-products__scroller')) {
        return { top: 100, bottom: 700, left: 0, right: 390, width: 390, height: 600 } as DOMRect;
      }
      if (this instanceof HTMLImageElement) {
        return { top: 140, bottom: 220, left: 20, right: 100, width: 80, height: 80 } as DOMRect;
      }
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
    });
    apiMocks.listCashierMenuProducts.mockResolvedValueOnce([
      { ...product, imageUrl: '/uploads/beef-pho.jpg' },
      { ...secondProduct, imageUrl: '/uploads/iced-coffee.jpg' },
    ]);
    const wrapper = mountWorkspace();
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.findAll('.table-ordering-product img[src]')).toHaveLength(2));

    const drinks = wrapper.findAll('[data-testid="table-ordering-category-strip"] button')
      .find((button) => button.text() === '饮品');
    expect(drinks).toBeDefined();
    await drinks!.trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.get('.table-ordering-product img').attributes('src'))
      .toContain('/uploads/iced-coffee.jpg'));

    await wrapper.get('input[type="search"]').setValue('冰咖啡');
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.get('.table-ordering-product img').attributes('src'))
      .toContain('/uploads/iced-coffee.jpg'));
    wrapper.unmount();
  });

  it('prefers the menu thumbnail and falls back to the original when the thumbnail fails', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      if (this.classList.contains('table-ordering-products__scroller')) {
        return { top: 0, bottom: 700, left: 0, right: 390, width: 390, height: 700 } as DOMRect;
      }
      if (this instanceof HTMLImageElement) {
        return { top: 20, bottom: 100, left: 20, right: 100, width: 80, height: 80 } as DOMRect;
      }
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
    });
    apiMocks.listCashierMenuProducts.mockResolvedValueOnce([{
      ...product,
      imageUrl: '/uploads/products/original.jpg',
      menuThumbnailUrl: '/uploads/product-thumbnails/1/hash-menu.webp',
    }]);
    const wrapper = mountWorkspace();
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.get('.table-ordering-product img').attributes('src'))
      .toContain('/uploads/product-thumbnails/1/hash-menu.webp'));

    await wrapper.get('.table-ordering-product img').trigger('error');
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.get('.table-ordering-product img').attributes('src'))
      .toContain('/uploads/products/original.jpg'));
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

  it('keeps mobile V2 search scoped to the selected category and uses All globally', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    const wrapper = mountWorkspace({ embedded: true, mobileV2Presentation: true });
    await flushPromises();

    const tableContext = wrapper.get('.table-ordering-mobile-v2-topbar').element;
    const categories = wrapper.get('[data-testid="table-ordering-category-strip"]').element;
    expect(tableContext.nextElementSibling).toBe(categories);
    const mobileV2Styles = readFileSync(resolve(process.cwd(), 'src/mobile-v2/mobile-v2.css'), 'utf8');
    expect(mobileV2Styles).toMatch(/\.table-ordering-workspace--mobile-v2 \.table-ordering-header \.table-ordering-mobile-v2-categories\s*\{[^}]*grid-row:\s*2;/s);
    expect(mobileV2Styles).toMatch(/\.table-ordering-mobile-v2-search-mode \.table-ordering-search input:focus-visible\s*\{[^}]*outline:\s*none;[^}]*box-shadow:\s*none;/s);

    const drinks = wrapper.findAll('[data-testid="table-ordering-category-strip"] button')
      .find((button) => button.text() === '饮品');
    await drinks!.trigger('click');
    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(1);

    await wrapper.get('.table-ordering-mobile-v2-search-trigger').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="table-ordering-mobile-v2-search-mode"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="table-ordering-category-strip"]').exists()).toBe(false);
    expect(wrapper.find('.table-ordering-mobile-v2-topbar').exists()).toBe(false);

    const search = wrapper.get('[data-testid="table-ordering-search"] input');
    await search.setValue('牛肉粉');
    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(0);

    await search.setValue('冰咖啡');
    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(1);
    expect(wrapper.text()).toContain('冰咖啡');

    await wrapper.get('.table-ordering-mobile-v2-search-back').trigger('click');
    expect(wrapper.find('[data-testid="table-ordering-mobile-v2-search-mode"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="table-ordering-category-strip"]').exists()).toBe(true);
    expect(wrapper.find('.table-ordering-mobile-v2-topbar').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="table-ordering-category-strip"] button')
      .find((button) => button.text() === '饮品')?.classes()).toContain('is-active');

    const all = wrapper.findAll('[data-testid="table-ordering-category-strip"] button')
      .find((button) => button.text() === '全部');
    expect(all).toBeDefined();
    await all!.trigger('click');
    await wrapper.get('.table-ordering-mobile-v2-search-trigger').trigger('click');
    await flushPromises();
    const globalSearch = wrapper.get('[data-testid="table-ordering-search"] input');
    await globalSearch.setValue('牛肉粉');
    expect(wrapper.findAll('.table-ordering-product')).toHaveLength(1);
    expect(wrapper.text()).toContain('牛肉粉');
  });

  it('dismisses the mobile keyboard when the user touches the product area', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    const blur = vi.spyOn(HTMLInputElement.prototype, 'blur');
    const wrapper = mountWorkspace({ embedded: true, mobileV2Presentation: true });
    await flushPromises();

    await wrapper.get('.table-ordering-mobile-v2-search-trigger').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="table-ordering-products-scroller"]').trigger('pointerdown');

    expect(blur).toHaveBeenCalledOnce();
  });

  it('locks a selected mobile V2 product row to its explicit plus and minus controls', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    const wrapper = mountWorkspace({
      embedded: true,
      mobileV2Presentation: true,
      productQuantities: { [product.id]: 1 },
    });
    await flushPromises();

    await productCard(wrapper).trigger('click');
    expect(wrapper.emitted('addProduct')).toBeUndefined();

    const stepperButtons = productCard(wrapper).findAll('.table-ordering-product__stepper button');
    await stepperButtons[0]!.trigger('click');
    await stepperButtons[1]!.trigger('click');
    expect(wrapper.emitted('removeProduct')).toEqual([[product.id]]);
    expect(wrapper.emitted('addProduct')).toEqual([[product.id]]);

    await productCard(wrapper, secondProduct.id).trigger('click');
    expect(wrapper.emitted('addProduct')).toEqual([[product.id], [secondProduct.id]]);
  });

  it('retains the compact Cashier density, touch and horizontal category contracts', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles/cashier-v2-phase1.css'), 'utf8');
    const mobileV5 = styles.slice(styles.indexOf('/* Mobile ordering V5:'));
    const mobileV6 = styles.slice(styles.indexOf('/* Mobile header responsibility split V6 FINAL:'));
    expect(mobileV5).toMatch(/\.table-ordering-product-grid\s*\{[^}]*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
    expect(mobileV5).toMatch(/\.table-ordering-product\s*\{[^}]*min-height:\s*116px;/s);
    expect(mobileV6).toMatch(/\.table-ordering-category-strip\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto/s);
    expect(mobileV6).toMatch(/\.table-ordering-category-strip button\s*\{[^}]*white-space:\s*nowrap;/s);
    const desktopV9 = styles.slice(styles.indexOf('/* Desktop menu pagination V9:'));
    expect(desktopV9).toMatch(/grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
    expect(desktopV9).toMatch(/grid-template-rows:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    expect(desktopV9).toMatch(/\.table-ordering-workspace--embedded\s*\{[^}]*top:\s*auto\s*!important;[^}]*right:\s*auto\s*!important;[^}]*bottom:\s*auto\s*!important;[^}]*left:\s*auto\s*!important;/s);
    expect(desktopV9).toMatch(/\.table-ordering-category-strip\s*\{[^}]*flex-wrap:\s*wrap;[^}]*overflow:\s*visible;/s);
    expect(desktopV9).toMatch(/\.table-ordering-products__scroller\s*\{[^}]*overflow:\s*hidden;[^}]*contain:\s*none;/s);
    expect(desktopV9).toMatch(/\.table-ordering-products__scroller\s*\{[^}]*justify-content:\s*stretch;[^}]*align-content:\s*start;/s);
    expect(desktopV9).toMatch(/\.table-ordering-category-strip\s*\{[^}]*justify-content:\s*flex-start;[^}]*align-content:\s*start;/s);
    expect(desktopV9).toMatch(/\.table-ordering-products__viewport\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*margin:\s*0;/s);
    expect(desktopV9).toMatch(/\.table-ordering-product-grid\s*\{[^}]*justify-content:\s*start;[^}]*align-content:\s*start;[^}]*max-width:\s*none;[^}]*margin:\s*0;/s);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
