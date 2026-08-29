<script setup lang="ts">
import { ChevronLeft, ChevronRight, ImageIcon, Search, X } from '@lucide/vue';
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
}>();

const emit = defineEmits<{
  close: [];
  addProduct: [productId: string];
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
let previouslyFocused: HTMLElement | null = null;
const DESKTOP_PAGE_SIZE = 20;

// Mobile V6 renders four 116px cards per row with a 17px row gap. The fixed
// header/search/category/footer chrome leaves innerHeight - 196px for products.
// This derives the eager window from the same measured 430/390/375 geometry.
const initialMobileImageCount = computed(() => {
  if (!mobileOrderingLayout.value || typeof window === 'undefined') return 0;
  const visibleProductHeight = Math.max(0, window.innerHeight - 196);
  return 4 * Math.max(1, Math.ceil(visibleProductHeight / 133));
});

const activeCategories = computed(() => categories.value.filter((category) => category.isActive));
const categoryIds = computed(() => new Set(activeCategories.value.map((category) => category.id)));
const orderableProducts = computed(() => products.value.filter((product) =>
  product.status === 'ON_SALE' && categoryIds.value.has(product.categoryId),
));
const filteredProducts = computed(() => orderableProducts.value.filter((product) =>
  (activeCategoryId.value === 'ALL' || product.categoryId === activeCategoryId.value)
  && productMatchesQuery(product, query.value),
));
const totalPages = computed(() => Math.max(1, Math.ceil(filteredProducts.value.length / DESKTOP_PAGE_SIZE)));
const visiblePageProducts = computed(() => {
  if (mobileOrderingLayout.value) return filteredProducts.value;
  const start = (currentPage.value - 1) * DESKTOP_PAGE_SIZE;
  return filteredProducts.value.slice(start, start + DESKTOP_PAGE_SIZE);
});
const catalogIdentity = computed(() => [
  ...activeCategories.value.map((category) => `category:${category.id}`),
  ...orderableProducts.value.map((product) => `product:${product.id}:${product.categoryId}:${product.status}`),
].join('|'));

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

watch(catalogIdentity, () => {
  currentPage.value = 1;
  activeResultIndex.value = -1;
  productCards.value = [];
});

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
  return Boolean(props.disabled || loading.value || !orderableProducts.value.some((product) => product.id === productId));
}

function queueProductAddition(productId: string) {
  if (!props.open || productInteractionDisabled(productId)) return false;
  emit('addProduct', productId);
  return true;
}

function resetWorkspaceView() {
  activeCategoryId.value = 'ALL';
  query.value = '';
  loadErrorKey.value = '';
  currentPage.value = 1;
  activeResultIndex.value = -1;
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
    searchInput.value?.focus();
    return;
  }
  if (event.key === '/' && !isTyping) {
    event.preventDefault();
    searchInput.value?.focus();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    if (query.value) {
      query.value = '';
      activeResultIndex.value = -1;
      searchInput.value?.focus();
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
    searchInput.value?.focus();
  } else if (event.key === '/' && !isTyping) {
    event.preventDefault();
    searchInput.value?.focus();
  }
}

function onProductCardKeydown(productId: string, event: KeyboardEvent) {
  if (!['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  queueProductAddition(productId);
}

onMounted(() => document.addEventListener('keydown', onDocumentKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onDocumentKeydown));

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
      :class="{ 'table-ordering-workspace--embedded': embedded }"
      data-testid="table-ordering-workspace"
      :data-session-id="sessionId"
      :role="embedded ? 'region' : 'dialog'"
      :aria-modal="embedded ? undefined : 'true'"
      :aria-label="t('ordering.title')"
      @keydown="onKeydown"
    >
      <header class="table-ordering-header">
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
              <div v-else class="table-ordering-product-grid">
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
                  :tabindex="embedded ? 0 : activeResultIndex === index ? 0 : -1"
                  role="button"
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
                    <b class="table-ordering-product__price">
                      {{ formatItemPrice(product.priceVnd, locale) }}<small v-if="product.unit">/{{ product.unit }}</small>
                    </b>
                    <div v-if="canonicalQuantityForProduct(product.id) > 0" class="table-ordering-product__quick-add" aria-live="polite">
                      <output>X{{ canonicalQuantityForProduct(product.id) }}</output>
                    </div>
                  </span>
                  <div class="table-ordering-product__content">
                    <strong>{{ productName(product) }}</strong>
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
    </section>
  </Teleport>
</template>
