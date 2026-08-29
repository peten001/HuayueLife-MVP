import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  listCashierMenuCategories: vi.fn(),
  listCashierMenuProducts: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api')>(),
  ...apiMocks,
}));

import {
  CASHIER_CATALOG_CACHE_SCHEMA_VERSION,
  CASHIER_CATALOG_FRESH_TTL_MS,
  CASHIER_CATALOG_MAX_STALE_MS,
  cashierCatalogStorageKey,
  useCatalogStore,
} from './catalog';

const merchantId = 'merchant-1';
const categories = [{ id: 'category-1', nameZh: '热菜', nameVi: null, nameEn: null, isActive: true, sortOrder: 1 }];
const products = [{
  id: 'product-1',
  categoryId: 'category-1',
  nameZh: '鱼香肉丝',
  nameVi: null,
  nameEn: null,
  description: null,
  imageUrl: null,
  priceVnd: '88000',
  unit: '份',
  status: 'ON_SALE' as const,
  productType: 'FOOD' as const,
  sortOrder: 1,
  category: categories[0],
}];

describe('cashier persistent catalog SWR', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.useRealTimers();
    apiMocks.listCashierMenuCategories.mockReset().mockResolvedValue(categories);
    apiMocks.listCashierMenuProducts.mockReset().mockResolvedValue(products);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('deduplicates the canonical request and serves fresh reopen or table switches with zero HTTP', async () => {
    const store = activeStore();
    const first = store.loadCatalog();
    const concurrent = store.loadCatalog();
    await Promise.all([first, concurrent]);

    expect(apiMocks.listCashierMenuCategories).toHaveBeenCalledTimes(1);
    expect(apiMocks.listCashierMenuProducts).toHaveBeenCalledTimes(1);
    expect(store.state).toBe('FRESH');

    await store.loadCatalog();
    await store.loadCatalog();
    expect(apiMocks.listCashierMenuCategories).toHaveBeenCalledTimes(1);
    expect(apiMocks.listCashierMenuProducts).toHaveBeenCalledTimes(1);
  });

  it('hydrates a valid fresh cache only for the active merchant with zero HTTP', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'));
    seedCache(merchantId, Date.now() - 1_000);
    const store = activeStore();

    expect(store.state).toBe('HYDRATED_FRESH');
    expect(store.products).toEqual(products);
    await store.loadCatalog();
    expect(apiMocks.listCashierMenuCategories).not.toHaveBeenCalled();
    expect(apiMocks.listCashierMenuProducts).not.toHaveBeenCalled();
  });

  it('rejects a cache whose embedded merchant does not match its key', async () => {
    localStorage.setItem(
      cashierCatalogStorageKey('merchant-b'),
      JSON.stringify(cachePayload(merchantId, Date.now())),
    );
    const store = useCatalogStore();
    store.activateMerchant('merchant-b');

    expect(store.state).toBe('EMPTY');
    expect(store.products).toEqual([]);
    await store.loadCatalog();
    expect(apiMocks.listCashierMenuProducts).toHaveBeenCalledOnce();
  });

  it.each([
    ['corrupt JSON', '{broken'],
    ['wrong schema version', JSON.stringify({ ...cachePayload(merchantId, Date.now()), schemaVersion: 999 })],
  ])('ignores %s and falls back to the canonical fetch', async (_label, value) => {
    const key = cashierCatalogStorageKey(merchantId);
    localStorage.setItem(key, value);
    const store = activeStore();

    expect(store.state).toBe('EMPTY');
    expect(localStorage.getItem(key)).toBeNull();
    await store.loadCatalog();
    expect(store.products).toEqual(products);
    expect(apiMocks.listCashierMenuProducts).toHaveBeenCalledOnce();
  });

  it('returns stale data immediately and performs exactly one background revalidation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'));
    seedCache(merchantId, Date.now() - CASHIER_CATALOG_FRESH_TTL_MS - 1);
    const refreshedProducts = [{ ...products[0]!, priceVnd: '99000' }];
    const refresh = deferred<typeof refreshedProducts>();
    apiMocks.listCashierMenuProducts.mockReturnValueOnce(refresh.promise);
    const store = activeStore();

    expect(store.state).toBe('HYDRATED_STALE');
    await expect(store.loadCatalog()).resolves.toMatchObject({ products });
    await expect(store.loadCatalog()).resolves.toMatchObject({ products });
    expect(apiMocks.listCashierMenuCategories).toHaveBeenCalledTimes(1);
    expect(apiMocks.listCashierMenuProducts).toHaveBeenCalledTimes(1);

    refresh.resolve(refreshedProducts);
    await vi.runAllTimersAsync();
    expect(store.products[0]?.priceVnd).toBe('99000');
    expect(store.state).toBe('FRESH');
  });

  it('does not expose a snapshot older than max stale and fetches canonical data', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'));
    seedCache(merchantId, Date.now() - CASHIER_CATALOG_MAX_STALE_MS - 1);
    const store = activeStore();

    expect(store.hasSnapshot).toBe(false);
    expect(store.products).toEqual([]);
    await store.loadCatalog();
    expect(apiMocks.listCashierMenuProducts).toHaveBeenCalledOnce();
    expect(store.state).toBe('FRESH');
  });

  it('keeps hydrated data usable when revalidation fails', async () => {
    seedCache(merchantId, Date.now() - CASHIER_CATALOG_FRESH_TTL_MS - 1);
    apiMocks.listCashierMenuProducts.mockRejectedValueOnce(new Error('offline'));
    const store = activeStore();

    await expect(store.loadCatalog()).resolves.toMatchObject({ products });
    await Promise.resolve();
    await Promise.resolve();
    expect(store.products).toEqual(products);
    expect(store.errorKey).toBe('');
    expect(store.state).toBe('ERROR_WITH_CACHE');
  });

  it('reports an error without cache without crashing the store', async () => {
    apiMocks.listCashierMenuProducts.mockRejectedValueOnce(new Error('offline'));
    const store = activeStore();

    await expect(store.loadCatalog()).rejects.toThrow('offline');
    expect(store.products).toEqual([]);
    expect(store.state).toBe('ERROR_NO_CACHE');
    expect(store.errorKey).not.toBe('');
  });

  it('treats storage quota failure as non-fatal after a successful fetch', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    const store = activeStore();

    await expect(store.loadCatalog()).resolves.toMatchObject({ products });
    await Promise.resolve();
    expect(store.products).toEqual(products);
    expect(store.state).toBe('FRESH');
  });

  it('does not let an old merchant in-flight response overwrite the next merchant', async () => {
    const pending = deferred<typeof products>();
    apiMocks.listCashierMenuProducts.mockReturnValueOnce(pending.promise);
    const store = activeStore();
    const request = store.loadCatalog();
    store.activateMerchant('merchant-2');
    pending.resolve(products);
    await request;
    expect(store.products).toEqual([]);
    expect(store.activeMerchantId).toBe('merchant-2');
  });
});

function activeStore() {
  const store = useCatalogStore();
  store.activateMerchant(merchantId);
  return store;
}

function seedCache(cacheMerchantId: string, fetchedAt: number) {
  localStorage.setItem(
    cashierCatalogStorageKey(cacheMerchantId),
    JSON.stringify(cachePayload(cacheMerchantId, fetchedAt)),
  );
}

function cachePayload(cacheMerchantId: string, fetchedAt: number) {
  return {
    schemaVersion: CASHIER_CATALOG_CACHE_SCHEMA_VERSION,
    merchantId: cacheMerchantId,
    fetchedAt,
    categories,
    products,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
