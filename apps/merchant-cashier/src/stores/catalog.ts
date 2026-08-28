import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  apiErrorTranslationKey,
  listCashierMenuCategories,
  listCashierMenuProducts,
} from '@/api';
import type { CashierMenuCategory, CashierMenuProduct } from '@/types';

export const CASHIER_CATALOG_TTL_MS = 5 * 60_000;

export const useCatalogStore = defineStore('cashier-catalog', () => {
  const categories = ref<CashierMenuCategory[]>([]);
  const products = ref<CashierMenuProduct[]>([]);
  const loading = ref(false);
  const revalidating = ref(false);
  const errorKey = ref('');
  const lastFetchedAt = ref(0);
  let request: Promise<{ categories: CashierMenuCategory[]; products: CashierMenuProduct[] }> | null = null;
  let dataGeneration = 0;

  const hasSnapshot = computed(() => lastFetchedAt.value > 0);
  const isFresh = computed(
    () => hasSnapshot.value && Date.now() - lastFetchedAt.value < CASHIER_CATALOG_TTL_MS,
  );

  function snapshot() {
    return { categories: categories.value, products: products.value };
  }

  function revalidate() {
    if (request) return request;
    const generation = dataGeneration;
    loading.value = !hasSnapshot.value;
    revalidating.value = hasSnapshot.value;
    errorKey.value = '';
    const nextRequest = Promise.all([
      listCashierMenuCategories(),
      listCashierMenuProducts(),
    ])
      .then(([nextCategories, nextProducts]) => {
        if (generation === dataGeneration) {
          categories.value = nextCategories;
          products.value = nextProducts;
          lastFetchedAt.value = Date.now();
        }
        return { categories: nextCategories, products: nextProducts };
      })
      .catch((error) => {
        if (generation === dataGeneration && !hasSnapshot.value) {
          errorKey.value = apiErrorTranslationKey(error, 'ordering.loadFailed');
        }
        throw error;
      })
      .finally(() => {
        if (request === nextRequest) request = null;
        if (generation === dataGeneration) {
          loading.value = false;
          revalidating.value = false;
        }
      });
    request = nextRequest;
    return nextRequest;
  }

  function loadCatalog(options: { force?: boolean } = {}) {
    if (hasSnapshot.value) {
      if (options.force || !isFresh.value) void revalidate().catch(() => undefined);
      return Promise.resolve(snapshot());
    }
    return revalidate();
  }

  function invalidate() {
    lastFetchedAt.value = 0;
  }

  function clear() {
    dataGeneration += 1;
    request = null;
    categories.value = [];
    products.value = [];
    loading.value = false;
    revalidating.value = false;
    errorKey.value = '';
    lastFetchedAt.value = 0;
  }

  return {
    categories,
    products,
    loading,
    revalidating,
    errorKey,
    lastFetchedAt,
    hasSnapshot,
    isFresh,
    loadCatalog,
    invalidate,
    clear,
  };
});
