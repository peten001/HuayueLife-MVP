import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  apiErrorTranslationKey,
  listCashierMenuCategories,
  listCashierMenuProducts,
} from '@/api';
import {
  readCashierStorage,
  removeCashierStorage,
  writeCashierStorage,
} from '@/platform/safe-storage';
import type { CashierMenuCategory, CashierMenuProduct } from '@/types';

export const CASHIER_CATALOG_CACHE_SCHEMA_VERSION = 1;
export const CASHIER_CATALOG_FRESH_TTL_MS = 2 * 60_000;
export const CASHIER_CATALOG_MAX_STALE_MS = 24 * 60 * 60_000;
export const CASHIER_CATALOG_TTL_MS = CASHIER_CATALOG_FRESH_TTL_MS;
export const CASHIER_CATALOG_STORAGE_PREFIX = 'yunqiao_cashier_catalog_v1';

export type CashierCatalogState =
  | 'EMPTY'
  | 'HYDRATED_STALE'
  | 'HYDRATED_FRESH'
  | 'FETCHING'
  | 'FRESH'
  | 'ERROR_WITH_CACHE'
  | 'ERROR_NO_CACHE';

interface PersistentCatalogCache {
  schemaVersion: number;
  merchantId: string;
  fetchedAt: number;
  categories: CashierMenuCategory[];
  products: CashierMenuProduct[];
}

interface CatalogSnapshot {
  categories: CashierMenuCategory[];
  products: CashierMenuProduct[];
}

export function cashierCatalogStorageKey(merchantId: string) {
  return `${CASHIER_CATALOG_STORAGE_PREFIX}:${encodeURIComponent(merchantId)}`;
}

export const useCatalogStore = defineStore('cashier-catalog', () => {
  const categories = ref<CashierMenuCategory[]>([]);
  const products = ref<CashierMenuProduct[]>([]);
  const loading = ref(false);
  const revalidating = ref(false);
  const errorKey = ref('');
  const lastFetchedAt = ref(0);
  const activeMerchantId = ref('');
  const state = ref<CashierCatalogState>('EMPTY');
  let request: Promise<CatalogSnapshot> | null = null;
  let dataGeneration = 0;

  const hasSnapshot = computed(() => Boolean(activeMerchantId.value && lastFetchedAt.value > 0));
  const ageMs = computed(() => hasSnapshot.value ? Math.max(0, Date.now() - lastFetchedAt.value) : Infinity);
  const isFresh = computed(() => hasSnapshot.value && ageMs.value < CASHIER_CATALOG_FRESH_TTL_MS);
  const isUsable = computed(() => hasSnapshot.value && ageMs.value <= CASHIER_CATALOG_MAX_STALE_MS);

  function snapshot(): CatalogSnapshot {
    return { categories: categories.value, products: products.value };
  }

  function activateMerchant(merchantId: string | null | undefined) {
    const normalizedMerchantId = merchantId?.trim() || '';
    if (normalizedMerchantId === activeMerchantId.value) {
      if (normalizedMerchantId && !hasSnapshot.value) hydratePersistentCache(normalizedMerchantId);
      return state.value;
    }
    resetMemory(normalizedMerchantId);
    if (normalizedMerchantId) hydratePersistentCache(normalizedMerchantId);
    return state.value;
  }

  function hydratePersistentCache(merchantId: string) {
    const key = cashierCatalogStorageKey(merchantId);
    const raw = readCashierStorage('local', key);
    if (!raw) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      removeCashierStorage('local', key);
      return false;
    }
    const cache = parsePersistentCache(parsed, merchantId);
    if (!cache) {
      removeCashierStorage('local', key);
      return false;
    }
    if (cache.fetchedAt > Date.now() + CASHIER_CATALOG_FRESH_TTL_MS) {
      removeCashierStorage('local', key);
      return false;
    }
    const cacheAgeMs = Math.max(0, Date.now() - cache.fetchedAt);
    if (cacheAgeMs > CASHIER_CATALOG_MAX_STALE_MS) {
      removeCashierStorage('local', key);
      return false;
    }
    categories.value = cache.categories;
    products.value = cache.products;
    lastFetchedAt.value = cache.fetchedAt;
    errorKey.value = '';
    state.value = cacheAgeMs < CASHIER_CATALOG_FRESH_TTL_MS
      ? 'HYDRATED_FRESH'
      : 'HYDRATED_STALE';
    return true;
  }

  function revalidate() {
    if (request) return request;
    if (!activeMerchantId.value) {
      return Promise.reject(new Error('Cashier catalog merchant is not active'));
    }
    const generation = dataGeneration;
    const merchantId = activeMerchantId.value;
    loading.value = !hasSnapshot.value;
    revalidating.value = hasSnapshot.value;
    if (!hasSnapshot.value) state.value = 'FETCHING';
    errorKey.value = '';
    const nextRequest = Promise.all([
      listCashierMenuCategories(),
      listCashierMenuProducts(),
    ])
      .then(([rawCategories, rawProducts]) => {
        const nextSnapshot = parseCatalogResponse(rawCategories, rawProducts);
        if (!nextSnapshot) throw new Error('Invalid cashier catalog response');
        if (generation === dataGeneration && merchantId === activeMerchantId.value) {
          const fetchedAt = Date.now();
          categories.value = nextSnapshot.categories;
          products.value = nextSnapshot.products;
          lastFetchedAt.value = fetchedAt;
          state.value = 'FRESH';
          persistSnapshotAsync({
            schemaVersion: CASHIER_CATALOG_CACHE_SCHEMA_VERSION,
            merchantId,
            fetchedAt,
            ...nextSnapshot,
          }, generation);
        }
        return nextSnapshot;
      })
      .catch((error) => {
        if (generation === dataGeneration && merchantId === activeMerchantId.value) {
          if (hasSnapshot.value) {
            state.value = 'ERROR_WITH_CACHE';
          } else {
            state.value = 'ERROR_NO_CACHE';
            errorKey.value = apiErrorTranslationKey(error, 'ordering.loadFailed');
          }
        }
        throw error;
      })
      .finally(() => {
        if (request === nextRequest) request = null;
        if (generation === dataGeneration && merchantId === activeMerchantId.value) {
          loading.value = false;
          revalidating.value = false;
        }
      });
    request = nextRequest;
    return nextRequest;
  }

  function loadCatalog(options: { force?: boolean } = {}) {
    if (hasSnapshot.value && !isUsable.value) discardSnapshot();
    if (hasSnapshot.value) {
      if (options.force || !isFresh.value) void revalidate().catch(() => undefined);
      return Promise.resolve(snapshot());
    }
    return revalidate();
  }

  function invalidate() {
    if (!hasSnapshot.value) return;
    lastFetchedAt.value = Date.now() - CASHIER_CATALOG_FRESH_TTL_MS - 1;
    state.value = 'HYDRATED_STALE';
  }

  function clear(options: { removePersistent?: boolean } = {}) {
    const merchantId = activeMerchantId.value;
    if (options.removePersistent && merchantId) {
      removeCashierStorage('local', cashierCatalogStorageKey(merchantId));
    }
    resetMemory('');
  }

  function resetMemory(merchantId: string) {
    dataGeneration += 1;
    request = null;
    activeMerchantId.value = merchantId;
    categories.value = [];
    products.value = [];
    loading.value = false;
    revalidating.value = false;
    errorKey.value = '';
    lastFetchedAt.value = 0;
    state.value = 'EMPTY';
  }

  function discardSnapshot() {
    categories.value = [];
    products.value = [];
    lastFetchedAt.value = 0;
    errorKey.value = '';
    state.value = 'EMPTY';
  }

  function persistSnapshotAsync(cache: PersistentCatalogCache, generation: number) {
    queueMicrotask(() => {
      if (generation !== dataGeneration || cache.merchantId !== activeMerchantId.value) return;
      writeCashierStorage(
        'local',
        cashierCatalogStorageKey(cache.merchantId),
        JSON.stringify(cache),
      );
    });
  }

  return {
    categories,
    products,
    loading,
    revalidating,
    errorKey,
    lastFetchedAt,
    activeMerchantId,
    state,
    hasSnapshot,
    isFresh,
    isUsable,
    activateMerchant,
    loadCatalog,
    invalidate,
    clear,
  };
});

function parsePersistentCache(value: unknown, expectedMerchantId: string): PersistentCatalogCache | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== CASHIER_CATALOG_CACHE_SCHEMA_VERSION) return null;
  if (value.merchantId !== expectedMerchantId) return null;
  if (!Number.isFinite(value.fetchedAt) || Number(value.fetchedAt) <= 0) return null;
  const snapshot = parseCatalogResponse(value.categories, value.products);
  if (!snapshot) return null;
  return {
    schemaVersion: CASHIER_CATALOG_CACHE_SCHEMA_VERSION,
    merchantId: expectedMerchantId,
    fetchedAt: Number(value.fetchedAt),
    ...snapshot,
  };
}

function parseCatalogResponse(
  rawCategories: unknown,
  rawProducts: unknown,
): CatalogSnapshot | null {
  if (!Array.isArray(rawCategories) || !Array.isArray(rawProducts)) return null;
  const categories = rawCategories.map(parseCategory);
  const products = rawProducts.map(parseProduct);
  if (categories.some((category) => !category) || products.some((product) => !product)) return null;
  return {
    categories: categories as CashierMenuCategory[],
    products: products as CashierMenuProduct[],
  };
}

function parseCategory(value: unknown): CashierMenuCategory | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.nameZh !== 'string'
    || typeof value.sortOrder !== 'number'
    || typeof value.isActive !== 'boolean'
  ) return null;
  return {
    id: value.id,
    nameZh: value.nameZh,
    nameVi: nullableString(value.nameVi),
    nameEn: nullableString(value.nameEn),
    sortOrder: value.sortOrder,
    isActive: value.isActive,
  };
}

function parseProduct(value: unknown): CashierMenuProduct | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.categoryId !== 'string'
    || typeof value.nameZh !== 'string'
    || typeof value.priceVnd !== 'string'
    || typeof value.sortOrder !== 'number'
    || !['DRAFT', 'ON_SALE', 'SOLD_OUT', 'OFF_SALE'].includes(String(value.status))
    || value.productType !== 'FOOD'
  ) return null;
  const category = value.category === null || value.category === undefined
    ? null
    : parseCategory(value.category);
  if (value.category !== null && value.category !== undefined && !category) return null;
  return {
    id: value.id,
    categoryId: value.categoryId,
    nameZh: value.nameZh,
    nameVi: nullableString(value.nameVi),
    nameEn: nullableString(value.nameEn),
    description: nullableString(value.description),
    imageUrl: nullableString(value.imageUrl),
    priceVnd: value.priceVnd,
    unit: nullableString(value.unit),
    sortOrder: value.sortOrder,
    status: value.status as CashierMenuProduct['status'],
    productType: 'FOOD',
    category,
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
