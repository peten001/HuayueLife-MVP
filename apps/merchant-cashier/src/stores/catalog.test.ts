import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  listCashierMenuCategories: vi.fn(),
  listCashierMenuProducts: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api')>(),
  ...apiMocks,
}));

import { CASHIER_CATALOG_TTL_MS, useCatalogStore } from './catalog';

const categories = [{ id: 'category-1', nameZh: '热菜', nameVi: null, nameEn: null, isActive: true, sortOrder: 1 }];
const products = [{ id: 'product-1', categoryId: 'category-1', nameZh: '鱼香肉丝', nameVi: null, nameEn: null, imageUrl: null, priceVnd: '88000', status: 'ON_SALE' as const, sortOrder: 1 }];

describe('cashier catalog cache', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useRealTimers();
    apiMocks.listCashierMenuCategories.mockReset().mockResolvedValue(categories);
    apiMocks.listCashierMenuProducts.mockReset().mockResolvedValue(products);
  });

  it('deduplicates the first request and serves fresh reopen or table switches with zero HTTP calls', async () => {
    const store = useCatalogStore();
    const first = store.loadCatalog();
    const concurrent = store.loadCatalog();
    await Promise.all([first, concurrent]);

    expect(apiMocks.listCashierMenuCategories).toHaveBeenCalledTimes(1);
    expect(apiMocks.listCashierMenuProducts).toHaveBeenCalledTimes(1);

    await store.loadCatalog();
    await store.loadCatalog();
    expect(apiMocks.listCashierMenuCategories).toHaveBeenCalledTimes(1);
    expect(apiMocks.listCashierMenuProducts).toHaveBeenCalledTimes(1);
  });

  it('returns stale data immediately and deduplicates one background revalidation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00.000Z'));
    const store = useCatalogStore();
    await store.loadCatalog();
    const refreshedProducts = [{ ...products[0]!, priceVnd: '99000' }];
    const refresh = deferred<typeof refreshedProducts>();
    apiMocks.listCashierMenuProducts.mockReturnValueOnce(refresh.promise);
    vi.advanceTimersByTime(CASHIER_CATALOG_TTL_MS + 1);

    await expect(store.loadCatalog()).resolves.toMatchObject({ products });
    await expect(store.loadCatalog()).resolves.toMatchObject({ products });
    expect(apiMocks.listCashierMenuProducts).toHaveBeenCalledTimes(2);

    refresh.resolve(refreshedProducts);
    await vi.runAllTimersAsync();
    expect(store.products[0]?.priceVnd).toBe('99000');
  });

  it('does not restore another merchant catalog after clear', async () => {
    const pending = deferred<typeof products>();
    apiMocks.listCashierMenuProducts.mockReturnValueOnce(pending.promise);
    const store = useCatalogStore();
    const request = store.loadCatalog();
    store.clear();
    pending.resolve(products);
    await request;
    expect(store.products).toEqual([]);
    expect(store.categories).toEqual([]);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
