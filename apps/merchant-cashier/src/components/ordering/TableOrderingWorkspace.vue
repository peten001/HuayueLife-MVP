<script setup lang="ts">
import { Check, ChevronLeft, ChevronRight, ImageIcon, Minus, Plus, Search, X } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import {
  formatItemPrice,
  productMatchesQuery,
  resolveMediaUrl,
} from '@/domain';
import { useI18n } from '@/i18n';
import { useCatalogStore, useUiStore } from '@/stores';
import { useMediaQuery } from '@/composables';
import type {
  CashierMenuCategory,
  CashierMenuProduct,
} from '@/types';
import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import LoadingState from '@/components/common/LoadingState.vue';
import DeferredCatalogImage from './DeferredCatalogImage.vue';
import {
  createMobileMenuProgressiveRender,
  mobileMenuInitialRenderCount,
} from './mobile-menu-progressive-render';

const props = defineProps<{
  open: boolean;
  tableId: string;
  tableLabel: string;
  sessionId: string;
  disabled?: boolean;
  topDialogOpen?: boolean;
  embedded?: boolean;
  productQuantities?: Record<string, number>;
  pendingAddQuantities?: Record<string, number>;
  mutationLocked?: boolean;
  mobileV2Presentation?: boolean;
  tableSecondaryLabel?: string;
}>();

const emit = defineEmits<{
  close: [];
  addProduct: [productId: string];
  removeProduct: [productId: string];
  resetSelection: [];
  viewOrder: [];
}>();

const { t, locale } = useI18n();
const uiStore = useUiStore();
const catalogStore = useCatalogStore();
const { categories, products, loading, errorKey: loadErrorKey } = storeToRefs(catalogStore);
const mobileOrderingLayout = useMediaQuery('(max-width: 899px)');
const activeCategoryId = ref('ALL');
const query = ref('');
const workspace = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const activeResultIndex = ref(-1);
const productCards = ref<HTMLElement[]>([]);
const failedThumbnailUrls = ref(new Set<string>());
const currentPage = ref(1);
const mobileVisibleProductCount = ref(0);
const mobileSearchOpen = ref(false);
let previouslyFocused: HTMLElement | null = null;
let firstMenuPaintMarked = false;
let firstProductCardMarked = false;
const DESKTOP_PAGE_SIZE = 20;

function markMenuPerformance(name: string) {
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    performance.mark(name);
  }
}

markMenuPerformance('menu_component_mount_start');

// Mobile V6 renders four 116px cards per row with a 17px row gap. The fixed
// header/search/category/footer chrome leaves innerHeight - 196px for products.
// This derives the eager window from the same measured 430/390/375 geometry.
const initialMobileImageCount = computed(() => {
  if (!mobileOrderingLayout.value || typeof window === 'undefined') return 0;
  const visibleProductHeight = Math.max(0, window.innerHeight - 196);
  return 4 * Math.max(1, Math.ceil(visibleProductHeight / 133));
});
const initialMobileProductCount = computed(() =>
  mobileMenuInitialRenderCount(initialMobileImageCount.value),
);

const activeCategories = computed(() => categories.value.filter((category) => category.isActive));
const categoryIds = computed(() => new Set(activeCategories.value.map((category) => category.id)));
const orderableProducts = computed(() => products.value.filter((product) =>
  product.status === 'ON_SALE' && categoryIds.value.has(product.categoryId),
));
const orderableProductIds = computed(() => new Set(orderableProducts.value.map((product) => product.id)));
const filteredProducts = computed(() => {
  const categoryProducts = activeCategoryId.value === 'ALL'
    ? orderableProducts.value
    : orderableProducts.value.filter((product) => product.categoryId === activeCategoryId.value);
  if (!query.value.trim()) return categoryProducts;
  return categoryProducts.filter((product) => productMatchesQuery(product, query.value));
});
const totalPages = computed(() => Math.max(1, Math.ceil(filteredProducts.value.length / DESKTOP_PAGE_SIZE)));
const visiblePageProducts = computed(() => {
  if (mobileOrderingLayout.value) {
    return filteredProducts.value.slice(0, mobileVisibleProductCount.value);
  }
  const start = (currentPage.value - 1) * DESKTOP_PAGE_SIZE;
  return filteredProducts.value.slice(start, start + DESKTOP_PAGE_SIZE);
});
const mobileV2Menu = computed(() => Boolean(props.mobileV2Presentation && props.embedded));
const mobileTableContext = computed(() => [props.tableLabel, props.tableSecondaryLabel]
  .map((value) => value?.trim())
  .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
  .join(' / '));
const selectedServingCount = computed(() => Object.values(props.productQuantities ?? {})
  .reduce((sum, quantity) => sum + Math.max(0, quantity || 0), 0));
const progressiveRender = createMobileMenuProgressiveRender({
  onVisibleCountChange: (count) => {
    mobileVisibleProductCount.value = count;
    if (!firstProductCardMarked && count > 0) {
      void nextTick(() => {
        if (firstProductCardMarked || !productCards.value.length) return;
        firstProductCardMarked = true;
        markMenuPerformance('first_product_card_rendered');
      });
    }
  },
  onFirstPaint: () => {
    if (firstMenuPaintMarked) return;
    firstMenuPaintMarked = true;
    markMenuPerformance('menu_first_paint');
  },
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    previouslyFocused = !props.embedded && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    resetWorkspaceView();
    void loadCatalog();
    if (!props.embedded) void nextTick(() => searchInput.value?.focus());
  },
  { immediate: true },
);

watch(() => props.open, (open, wasOpen) => {
  if (!open && wasOpen) {
    previouslyFocused?.focus();
    previouslyFocused = null;
  }
});

watch([query, activeCategoryId], () => {
  currentPage.value = 1;
  activeResultIndex.value = -1;
  productCards.value = [];
});

watch(() => props.tableId, () => {
  currentPage.value = 1;
  activeResultIndex.value = -1;
  productCards.value = [];
});

watch([categories, products], () => {
  currentPage.value = 1;
  activeResultIndex.value = -1;
  productCards.value = [];
});

watch(
  [filteredProducts, mobileOrderingLayout, initialMobileProductCount],
  ([nextProducts, mobile]) => {
    const progressive = mobile && activeCategoryId.value === 'ALL' && !query.value.trim();
    progressiveRender.reset({
      totalCount: nextProducts.length,
      initialCount: initialMobileProductCount.value,
      progressive,
    });
  },
  { immediate: true, flush: 'post' },
);

watch(categories, (nextCategories) => {
  if (nextCategories.length) markMenuPerformance('category_data_ready');
}, { immediate: true });

watch(products, (nextProducts) => {
  if (nextProducts.length) markMenuPerformance('product_data_ready');
}, { immediate: true });

watch(totalPages, (nextTotalPages) => {
  if (currentPage.value > nextTotalPages) currentPage.value = nextTotalPages;
});

watch(currentPage, () => {
  activeResultIndex.value = -1;
  productCards.value = [];
});

function productName(product: CashierMenuProduct) {
  if (locale.value === 'vi') return product.nameVi || product.nameZh;
  if (locale.value === 'en') return product.nameEn || product.nameZh;
  return product.nameZh;
}

function productCardImage(product: CashierMenuProduct) {
  const thumbnailUrl = product.menuThumbnailUrl?.trim();
  if (thumbnailUrl && !failedThumbnailUrls.value.has(thumbnailUrl)) return thumbnailUrl;
  return product.imageUrl?.trim() || '';
}

function handleProductImageError(product: CashierMenuProduct) {
  const thumbnailUrl = product.menuThumbnailUrl?.trim();
  const originalUrl = product.imageUrl?.trim();
  if (!thumbnailUrl || !originalUrl || thumbnailUrl === originalUrl) return;
  if (productCardImage(product) !== thumbnailUrl) return;
  failedThumbnailUrls.value = new Set([...failedThumbnailUrls.value, thumbnailUrl]);
}

function categoryName(category: CashierMenuCategory) {
  if (locale.value === 'vi') return category.nameVi || category.nameZh;
  if (locale.value === 'en') return category.nameEn || category.nameZh;
  return category.nameZh;
}

function productCategoryName(product: CashierMenuProduct) {
  const category = activeCategories.value.find((candidate) => candidate.id === product.categoryId);
  return category ? categoryName(category) : '';
}

function selectCategory(categoryId: string, event: MouseEvent) {
  activeCategoryId.value = categoryId;
  (event.currentTarget as HTMLElement | null)?.scrollIntoView?.({
    block: 'nearest',
    inline: 'nearest',
  });
}

function pendingQuantityForProduct(productId: string) {
  return props.pendingAddQuantities?.[productId] || 0;
}

function canonicalQuantityForProduct(productId: string) {
  const canonicalQuantity = props.productQuantities?.[productId];
  return canonicalQuantity === undefined
    ? pendingQuantityForProduct(productId)
    : Math.max(0, canonicalQuantity);
}

function productInteractionDisabled(productId: string) {
  return Boolean(props.disabled || loading.value || !orderableProductIds.value.has(productId));
}

function queueProductAddition(productId: string) {
  if (!props.open || productInteractionDisabled(productId)) return false;
  emit('addProduct', productId);
  return true;
}

function queueProductRemoval(productId: string) {
  if (!props.open || productInteractionDisabled(productId) || canonicalQuantityForProduct(productId) <= 0) return false;
  emit('removeProduct', productId);
  return true;
}

function openMobileSearch() {
  activeCategoryId.value = 'ALL';
  mobileSearchOpen.value = true;
  void nextTick(() => searchInput.value?.focus());
}

function closeMobileSearch() {
  query.value = '';
  activeResultIndex.value = -1;
  mobileSearchOpen.value = false;
}

function resetWorkspaceView() {
  activeCategoryId.value = 'ALL';
  query.value = '';
  loadErrorKey.value = '';
  currentPage.value = 1;
  activeResultIndex.value = -1;
  mobileSearchOpen.value = false;
}

function goToPage(page: number) {
  currentPage.value = Math.min(totalPages.value, Math.max(1, page));
}

async function loadCatalog() {
  if (!props.open) return;
  try {
    await catalogStore.loadCatalog();
  } catch {
    // The shared store exposes the localized loading error to this workspace.
  }
}

function requestClose() {
  if (props.mutationLocked) {
    uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
    return;
  }
  emit('close');
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open || props.topDialogOpen) return;
  const target = event.target as HTMLElement | null;
  const isTyping = target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || Boolean(target?.isContentEditable);
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
    event.preventDefault();
    if (mobileV2Menu.value && !mobileSearchOpen.value) openMobileSearch();
    else searchInput.value?.focus();
    return;
  }
  if (event.key === '/' && !isTyping) {
    event.preventDefault();
    if (mobileV2Menu.value && !mobileSearchOpen.value) openMobileSearch();
    else searchInput.value?.focus();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    if (query.value) {
      query.value = '';
      activeResultIndex.value = -1;
      searchInput.value?.focus();
    } else if (mobileV2Menu.value && mobileSearchOpen.value) {
      closeMobileSearch();
    } else requestClose();
    return;
  }
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && query.value.trim() && visiblePageProducts.value.length) {
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const next = activeResultIndex.value < 0
      ? direction > 0 ? 0 : visiblePageProducts.value.length - 1
      : (activeResultIndex.value + direction + visiblePageProducts.value.length) % visiblePageProducts.value.length;
    activeResultIndex.value = next;
    void nextTick(() => productCards.value[next]?.focus());
    return;
  }
  const activeCard = productCards.value[activeResultIndex.value];
  if (
    event.key === 'Enter'
    && activeResultIndex.value >= 0
    && query.value.trim()
    && (event.target === searchInput.value || event.target === activeCard)
  ) {
    const selected = visiblePageProducts.value[activeResultIndex.value];
    if (!selected) return;
    event.preventDefault();
    queueProductAddition(selected.id);
    return;
  }
  if (props.embedded || event.key !== 'Tab' || !workspace.value) return;
  const focusable = [...workspace.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (!props.embedded || !props.open || props.topDialogOpen) return;
  const target = event.target as HTMLElement | null;
  const isTyping = target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || Boolean(target?.isContentEditable);
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
    event.preventDefault();
    if (mobileV2Menu.value && !mobileSearchOpen.value) openMobileSearch();
    else searchInput.value?.focus();
  } else if (event.key === '/' && !isTyping) {
    event.preventDefault();
    if (mobileV2Menu.value && !mobileSearchOpen.value) openMobileSearch();
    else searchInput.value?.focus();
  }
}

function onProductCardKeydown(productId: string, event: KeyboardEvent) {
  if (!['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  queueProductAddition(productId);
}

onMounted(() => {
  markMenuPerformance('menu_component_mount_end');
  document.addEventListener('keydown', onDocumentKeydown);
  void nextTick(() => markMenuPerformance('menu_first_dom_commit'));
});
onBeforeUnmount(() => {
  progressiveRender.stop();
  document.removeEventListener('keydown', onDocumentKeydown);
});

function setProductCardRef(element: Element | null, index: number) {
  if (element instanceof HTMLElement) productCards.value[index] = element;
}

</script>

<template>
  <Teleport to="body" :disabled="embedded">
    <div
      v-if="mutationLocked"
      class="table-ordering-navigation-guard"
      data-testid="ordering-navigation-guard"
      aria-hidden="true"
    />
    <section
      v-if="open"
      ref="workspace"
      class="table-ordering-workspace"
      :class="{
        'table-ordering-workspace--embedded': embedded,
        'table-ordering-workspace--mobile-v2': mobileV2Menu,
        'has-mobile-selection': mobileV2Menu && selectedServingCount > 0,
        'is-mobile-search-mode': mobileV2Menu && mobileSearchOpen,
      }"
      data-testid="table-ordering-workspace"
      :data-session-id="sessionId"
      :role="embedded ? 'region' : 'dialog'"
      :aria-modal="embedded ? undefined : 'true'"
      :aria-label="t('ordering.title')"
      @keydown="onKeydown"
    >
      <header class="table-ordering-header">
        <template v-if="mobileV2Menu">
          <div v-if="mobileSearchOpen" class="table-ordering-mobile-v2-search-mode" data-testid="table-ordering-mobile-v2-search-mode">
            <button type="button" class="table-ordering-mobile-v2-search-back" :aria-label="t('common.cancel')" @click="closeMobileSearch">
              <ChevronLeft :size="28" :stroke-width="2" aria-hidden="true" />
            </button>
            <label class="table-ordering-search" data-testid="table-ordering-search">
              <Search :size="18" aria-hidden="true" />
              <input
                ref="searchInput"
                v-model="query"
                type="search"
                :placeholder="t('ordering.searchPlaceholder')"
                :aria-label="t('ordering.searchLabel')"
                :aria-activedescendant="activeResultIndex >= 0 ? `ordering-product-${visiblePageProducts[activeResultIndex]?.id}` : undefined"
                autocomplete="off"
                @keydown.stop="onKeydown"
              />
            </label>
          </div>
          <template v-else>
            <div class="table-ordering-mobile-v2-topbar">
              <button
                type="button"
                class="table-ordering-mobile-v2-close"
                :aria-label="t('fulfillment.backToTables')"
                :disabled="mutationLocked"
                @click="requestClose"
              ><X :size="25" :stroke-width="2" aria-hidden="true" /></button>
              <strong>{{ mobileTableContext }}</strong>
              <button
                type="button"
                class="table-ordering-mobile-v2-search-trigger"
                :aria-label="t('ordering.searchLabel')"
                aria-expanded="false"
                @click="openMobileSearch"
              ><Search :size="23" :stroke-width="2" aria-hidden="true" /></button>
            </div>
            <nav
              class="table-ordering-category-strip table-ordering-mobile-v2-categories"
              :aria-label="t('ordering.categories')"
              data-testid="table-ordering-category-strip"
            >
              <button type="button" :class="{ 'is-active': activeCategoryId === 'ALL' }" :aria-pressed="activeCategoryId === 'ALL'" @click="activeCategoryId = 'ALL'">
                {{ t('common.all') }}
              </button>
              <button
                v-for="category in activeCategories"
                :key="`mobile-v2-strip-${category.id}`"
                type="button"
                :class="{ 'is-active': activeCategoryId === category.id }"
                :aria-pressed="activeCategoryId === category.id"
                @click="selectCategory(category.id, $event)"
              >{{ categoryName(category) }}</button>
            </nav>
          </template>
        </template>
        <template v-else>
          <div v-if="!embedded">
            <span>{{ t('ordering.tableContext', { table: tableLabel }) }}</span>
            <h2>{{ t('ordering.title') }}</h2>
          </div>
          <Teleport v-if="embedded && mobileOrderingLayout" to="#cashier-mobile-menu-search">
            <label class="table-ordering-search" data-testid="table-ordering-search">
              <Search :size="18" aria-hidden="true" />
              <input
                ref="searchInput"
                v-model="query"
                type="search"
                :placeholder="t('ordering.searchPlaceholder')"
                :aria-label="t('ordering.searchLabel')"
                :aria-activedescendant="activeResultIndex >= 0 ? `ordering-product-${visiblePageProducts[activeResultIndex]?.id}` : undefined"
                autocomplete="off"
                @keydown.stop="onKeydown"
              />
              <kbd>{{ t('ordering.searchShortcut') }}</kbd>
            </label>
          </Teleport>
          <Teleport v-else to="#cashier-toolbar-menu-search" :disabled="!embedded">
            <label class="table-ordering-search" data-testid="table-ordering-search">
              <Search :size="18" aria-hidden="true" />
              <input
                ref="searchInput"
                v-model="query"
                type="search"
                :placeholder="t('ordering.searchPlaceholder')"
                :aria-label="t('ordering.searchLabel')"
                :aria-activedescendant="activeResultIndex >= 0 ? `ordering-product-${visiblePageProducts[activeResultIndex]?.id}` : undefined"
                autocomplete="off"
                @keydown.stop="onKeydown"
              />
              <kbd>{{ t('ordering.searchShortcut') }}</kbd>
            </label>
          </Teleport>
          <nav
            v-if="embedded && mobileOrderingLayout"
            class="table-ordering-category-strip"
            :aria-label="t('ordering.categories')"
            data-testid="table-ordering-category-strip"
          >
            <button type="button" :class="{ 'is-active': activeCategoryId === 'ALL' }" :aria-pressed="activeCategoryId === 'ALL'" @click="activeCategoryId = 'ALL'">
              {{ t('common.all') }}
            </button>
            <button
              v-for="category in activeCategories"
              :key="`mobile-strip-${category.id}`"
              type="button"
              :class="{ 'is-active': activeCategoryId === category.id }"
              :aria-pressed="activeCategoryId === category.id"
              @click="selectCategory(category.id, $event)"
            >{{ categoryName(category) }}</button>
          </nav>
          <button
            v-if="!embedded"
            type="button"
            class="table-ordering-close"
            :aria-label="t('common.cancel')"
            :disabled="mutationLocked"
            @click="requestClose"
          ><X :size="22" aria-hidden="true" /></button>
        </template>
      </header>

      <div class="table-ordering-body">
        <nav class="table-ordering-categories" :aria-label="t('ordering.categories')">
          <button type="button" :class="{ 'is-active': activeCategoryId === 'ALL' }" :aria-pressed="activeCategoryId === 'ALL'" @click="activeCategoryId = 'ALL'">
            {{ t('common.all') }}
          </button>
          <button
            v-for="category in activeCategories"
            :key="category.id"
            type="button"
            :class="{ 'is-active': activeCategoryId === category.id }"
            :aria-pressed="activeCategoryId === category.id"
            @click="selectCategory(category.id, $event)"
          >{{ categoryName(category) }}</button>
        </nav>

        <div class="table-ordering-products">
          <div class="table-ordering-products__scroller" data-testid="table-ordering-products-scroller">
            <nav
              v-if="!embedded || !mobileOrderingLayout"
              class="table-ordering-category-strip"
              :aria-label="t('ordering.categories')"
              data-testid="table-ordering-category-strip"
            >
              <button type="button" :class="{ 'is-active': activeCategoryId === 'ALL' }" :aria-pressed="activeCategoryId === 'ALL'" @click="activeCategoryId = 'ALL'">
                {{ t('common.all') }}
              </button>
              <button
                v-for="category in activeCategories"
                :key="`strip-${category.id}`"
                type="button"
                :class="{ 'is-active': activeCategoryId === category.id }"
                :aria-pressed="activeCategoryId === category.id"
                @click="selectCategory(category.id, $event)"
              >{{ categoryName(category) }}</button>
            </nav>

            <div class="table-ordering-products__viewport" data-testid="table-ordering-products-viewport">
              <LoadingState v-if="loading" :label="t('ordering.loading')" />
              <ErrorState
                v-else-if="loadErrorKey"
                :title="t('error.title')"
                :description="t(loadErrorKey)"
                :retry-label="t('common.retry')"
                @retry="loadCatalog"
              />
              <EmptyState
                v-else-if="!filteredProducts.length"
                :title="t('ordering.emptyTitle')"
                :description="t('ordering.emptyDescription')"
              />
              <div
                v-else
                class="table-ordering-product-grid"
                :data-visible-product-count="visiblePageProducts.length"
                :data-total-product-count="filteredProducts.length"
              >
                <article
                  v-for="(product, index) in visiblePageProducts"
                  :key="product.id"
                  :id="`ordering-product-${product.id}`"
                  :ref="(element) => setProductCardRef(element as Element | null, index)"
                  class="table-ordering-product"
                  :class="{
                    'is-selected': canonicalQuantityForProduct(product.id) > 0,
                    'is-keyboard-active': activeResultIndex === index,
                    'is-submitting': pendingQuantityForProduct(product.id) > 0,
                  }"
                  :data-product-id="product.id"
                  :tabindex="mobileV2Menu ? -1 : embedded ? 0 : activeResultIndex === index ? 0 : -1"
                  :role="mobileV2Menu ? undefined : 'button'"
                  :aria-busy="pendingQuantityForProduct(product.id) > 0"
                  :aria-disabled="productInteractionDisabled(product.id)"
                  @click="queueProductAddition(product.id)"
                  @keydown="onProductCardKeydown(product.id, $event)"
                >
                  <span class="table-ordering-product__image">
                    <DeferredCatalogImage
                      v-if="resolveMediaUrl(productCardImage(product))"
                      :src="resolveMediaUrl(productCardImage(product))"
                      :alt="productName(product)"
                      :eager="index < initialMobileImageCount"
                      :cache-key="product.id"
                      @error="handleProductImageError(product)"
                    />
                    <ImageIcon :size="24" aria-hidden="true" />
                    <span v-if="mobileV2Menu && canonicalQuantityForProduct(product.id) > 0" class="table-ordering-product__selection-check" aria-hidden="true">
                      <Check :size="17" :stroke-width="3" />
                    </span>
                    <b v-if="!mobileV2Menu" class="table-ordering-product__price">
                      {{ formatItemPrice(product.priceVnd, locale) }}<small v-if="product.unit">/{{ product.unit }}</small>
                    </b>
                    <div v-if="!mobileV2Menu && canonicalQuantityForProduct(product.id) > 0" class="table-ordering-product__quick-add" aria-live="polite">
                      <output>X{{ canonicalQuantityForProduct(product.id) }}</output>
                    </div>
                  </span>
                  <div class="table-ordering-product__content">
                    <strong>
                      {{ productName(product) }}
                      <small v-if="mobileV2Menu && productCategoryName(product)">· {{ productCategoryName(product) }}</small>
                    </strong>
                    <b v-if="mobileV2Menu" class="table-ordering-product__price-inline">
                      {{ formatItemPrice(product.priceVnd, locale) }}<small v-if="product.unit">/{{ product.unit }}</small>
                    </b>
                  </div>
                  <div v-if="mobileV2Menu" class="table-ordering-product__mobile-actions">
                    <div v-if="canonicalQuantityForProduct(product.id) > 0" class="table-ordering-product__stepper" :aria-label="t('ordering.quantityFor', { name: productName(product) })">
                      <button type="button" :aria-label="t('ordering.decreaseQuantity')" :disabled="productInteractionDisabled(product.id)" @click.stop="queueProductRemoval(product.id)">
                        <Minus :size="21" aria-hidden="true" />
                      </button>
                      <output aria-live="polite">{{ canonicalQuantityForProduct(product.id) }}</output>
                      <button type="button" :aria-label="t('ordering.increaseQuantity')" :disabled="productInteractionDisabled(product.id)" @click.stop="queueProductAddition(product.id)">
                        <Plus :size="21" aria-hidden="true" />
                      </button>
                    </div>
                    <button v-else type="button" class="table-ordering-product__add" :aria-label="t('ordering.addOneAsPending')" :disabled="productInteractionDisabled(product.id)" @click.stop="queueProductAddition(product.id)">
                      <Plus :size="23" aria-hidden="true" />
                    </button>
                  </div>
                </article>
              </div>
            </div>

            <footer
              v-if="!mobileOrderingLayout"
              class="table-ordering-pagination"
              :aria-label="t('ordering.pagination')"
              data-testid="table-ordering-pagination"
            >
              <button
                type="button"
                :aria-label="t('ordering.previousPage')"
                :disabled="currentPage <= 1"
                data-testid="ordering-previous-page"
                @click="goToPage(currentPage - 1)"
              ><ChevronLeft :size="20" aria-hidden="true" /></button>
              <output aria-live="polite">{{ t('ordering.pageStatus', { current: currentPage, total: totalPages }) }}</output>
              <button
                type="button"
                :aria-label="t('ordering.nextPage')"
                :disabled="currentPage >= totalPages"
                data-testid="ordering-next-page"
                @click="goToPage(currentPage + 1)"
              ><ChevronRight :size="20" aria-hidden="true" /></button>
            </footer>
          </div>
        </div>

        <aside v-if="!embedded" class="table-ordering-current-order" data-testid="ordering-current-order">
          <slot name="current-order" />
        </aside>
      </div>
      <Transition name="mobile-v2-order-dock">
        <footer v-if="mobileV2Menu && selectedServingCount > 0" class="table-ordering-mobile-v2-dock">
          <button type="button" class="table-ordering-mobile-v2-reset" :disabled="disabled || mutationLocked" @click="emit('resetSelection')">
            {{ t('cashierV2.reselect') }}
          </button>
          <button type="button" class="table-ordering-mobile-v2-view-order" :disabled="disabled || mutationLocked" @click="emit('viewOrder')">
            <span>{{ t('cashierV2.viewOrder') }}</span>
            <b>{{ selectedServingCount }}</b>
          </button>
        </footer>
      </Transition>
    </section>
  </Teleport>
</template>
