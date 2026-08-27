<script setup lang="ts">
import { ImageIcon, Search, X } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  apiErrorTranslationKey,
  CashierApiError,
  createMerchantTableOrder,
  isDefinitiveMutationRejection,
  isMutationOutcomeUncertain,
  listCashierMenuCategories,
  listCashierMenuProducts,
} from '@/api';
import {
  createMutationKey,
  formatItemPrice,
  productDirectMergeKey,
  productMatchesQuery,
  resolveMediaUrl,
} from '@/domain';
import { useI18n } from '@/i18n';
import { useUiStore } from '@/stores';
import { useMediaQuery } from '@/composables';
import type {
  CashierMenuCategory,
  CashierMenuProduct,
  CashierOrderingDraftLine,
  CreateMerchantTableOrderInput,
  MerchantOrderMutationResult,
} from '@/types';
import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import LoadingState from '@/components/common/LoadingState.vue';

interface DirectAddAction {
  tableId: string;
  tableLabel: string;
  productId: string;
  lineId: string;
  mergeKey: string;
  firstAddedAt: string;
  firstAddedSequence: number;
  sourceItemId?: string;
  remark?: string;
  payload: CreateMerchantTableOrderInput;
}

const props = defineProps<{
  open: boolean;
  tableId: string;
  tableLabel: string;
  sessionId: string;
  disabled?: boolean;
  topDialogOpen?: boolean;
  embedded?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  created: [result: MerchantOrderMutationResult];
  failed: [error: unknown];
  mutationLockChanged: [locked: boolean];
  draftChanged: [lines: CashierOrderingDraftLine[]];
}>();

const { t, locale } = useI18n();
const uiStore = useUiStore();
const mobileOrderingLayout = useMediaQuery('(max-width: 899px)');
const categories = ref<CashierMenuCategory[]>([]);
const products = ref<CashierMenuProduct[]>([]);
const activeCategoryId = ref('ALL');
const query = ref('');
const loading = ref(false);
const processing = ref(false);
const loadErrorKey = ref('');
const directAddQueue = ref<DirectAddAction[]>([]);
const pendingOpenPayload = ref<CreateMerchantTableOrderInput | null>(null);
const effectiveSessionId = ref(props.sessionId);
const submittedPayload = ref<CreateMerchantTableOrderInput | null>(null);
const submittedContext = ref<{ tableId: string; tableLabel: string } | null>(null);
const outcomeUncertain = ref(false);
const workspace = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const activeResultIndex = ref(-1);
const productCards = ref<HTMLElement[]>([]);
let previouslyFocused: HTMLElement | null = null;
let nextDirectAddSequence = 0;

const activeCategories = computed(() => categories.value.filter((category) => category.isActive));
const categoryIds = computed(() => new Set(activeCategories.value.map((category) => category.id)));
const orderableProducts = computed(() => products.value.filter((product) =>
  product.status === 'ON_SALE' && categoryIds.value.has(product.categoryId),
));
const filteredProducts = computed(() => orderableProducts.value.filter((product) =>
  (activeCategoryId.value === 'ALL' || product.categoryId === activeCategoryId.value)
  && productMatchesQuery(product, query.value),
));
const productById = computed(() => new Map(orderableProducts.value.map((product) => [product.id, product])));
const pendingAdditions = computed(() => directAddQueue.value.reduce((lines, action) => {
  const current = lines.get(action.mergeKey);
  if (current) {
    current.quantity += 1;
    if (!current.sourceItemId && action.sourceItemId) current.sourceItemId = action.sourceItemId;
  }
  else lines.set(action.mergeKey, {
    lineId: action.lineId,
    mergeKey: action.mergeKey,
    productId: action.productId,
    quantity: 1,
    firstAddedAt: action.firstAddedAt,
    firstAddedSequence: action.firstAddedSequence,
    ...(action.sourceItemId ? { sourceItemId: action.sourceItemId } : {}),
    ...(action.remark ? { remark: action.remark } : {}),
  });
  return lines;
}, new Map<string, { lineId: string; mergeKey: string; productId: string; quantity: number; firstAddedAt: string; firstAddedSequence: number; sourceItemId?: string; remark?: string }>));
const draftLines = computed<CashierOrderingDraftLine[]>(() => [...pendingAdditions.value.values()].flatMap((line) => {
  const product = productById.value.get(line.productId);
  return product ? [{
    lineId: line.lineId,
    mergeKey: line.mergeKey,
    product,
    quantity: line.quantity,
    firstAddedAt: line.firstAddedAt,
    firstAddedSequence: line.firstAddedSequence,
    ...(line.sourceItemId ? { sourceItemId: line.sourceItemId } : {}),
    ...(line.remark ? { remark: line.remark } : {}),
  }] : [];
}));
const mutationLocked = computed(() => Boolean(
  processing.value
  || submittedPayload.value
  || directAddQueue.value.length,
));
watch(mutationLocked, (locked) => emit('mutationLockChanged', locked), {
  immediate: true,
  flush: 'sync',
});

watch(draftLines, (lines) => emit('draftChanged', lines), {
  immediate: true,
  deep: true,
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

watch(() => props.sessionId, (sessionId) => {
  if (sessionId) effectiveSessionId.value = sessionId;
});

watch([query, activeCategoryId], () => {
  activeResultIndex.value = -1;
  productCards.value = [];
});

function productName(product: CashierMenuProduct) {
  if (locale.value === 'vi') return product.nameVi || product.nameZh;
  if (locale.value === 'en') return product.nameEn || product.nameZh;
  return product.nameZh;
}

function categoryName(category: CashierMenuCategory) {
  if (locale.value === 'vi') return category.nameVi || category.nameZh;
  if (locale.value === 'en') return category.nameEn || category.nameZh;
  return category.nameZh;
}

function productDirectLineId(productId: string) {
  return `product:${productId}`;
}

function pendingQuantityForProduct(productId: string) {
  return directAddQueue.value.reduce(
    (quantity, action) => quantity + (action.productId === productId ? 1 : 0),
    0,
  );
}

function productInteractionDisabled(productId: string) {
  if (props.disabled || loading.value) return true;
  return outcomeUncertain.value && directAddQueue.value[0]?.productId !== productId;
}

function queueProductAddition(
  productId: string,
  lineId = productDirectLineId(productId),
  sourceItemId?: string,
  mergeKey = productDirectMergeKey(productId),
  remark?: string,
) {
  if (!props.open || props.disabled || loading.value) return false;
  if (outcomeUncertain.value) {
    if (directAddQueue.value[0]?.productId !== productId) return false;
    void drainDirectAddQueue();
    return false;
  }
  if (!productById.value.has(productId)) return false;
  const firstAddedAt = new Date().toISOString();
  directAddQueue.value.push({
    tableId: props.tableId,
    tableLabel: props.tableLabel,
    productId,
    lineId,
    mergeKey,
    firstAddedAt,
    firstAddedSequence: nextDirectAddSequence++,
    ...(sourceItemId ? { sourceItemId } : {}),
    ...(remark ? { remark } : {}),
    payload: {
      idempotencyKey: createMutationKey('add'),
      items: [{ productId, quantity: 1, ...(remark ? { remark } : {}) }],
    },
  });
  void drainDirectAddQueue();
  return true;
}

defineExpose({ queueProductAddition, retryPendingDirectAdd: drainDirectAddQueue });

function resetWorkspaceView() {
  activeCategoryId.value = 'ALL';
  query.value = '';
  loadErrorKey.value = '';
  activeResultIndex.value = -1;
}

async function loadCatalog() {
  if (!props.open || loading.value) return;
  loading.value = true;
  loadErrorKey.value = '';
  try {
    const [nextCategories, nextProducts] = await Promise.all([
      listCashierMenuCategories(),
      listCashierMenuProducts(),
    ]);
    if (!props.open) return;
    categories.value = nextCategories;
    products.value = nextProducts;
  } catch (error) {
    loadErrorKey.value = apiErrorTranslationKey(error, 'ordering.loadFailed');
  } finally {
    loading.value = false;
  }
}

function notifyMutationFailure(error: unknown) {
  uiStore.pushToast(t(
    isMutationOutcomeUncertain(error)
      ? 'mutation.outcomeUncertain'
      : apiErrorTranslationKey(error, 'ordering.createFailed'),
  ), isMutationOutcomeUncertain(error) ? 'warning' : 'error');
  emit('failed', error);
}

function clearSubmittedMutation() {
  submittedPayload.value = null;
  submittedContext.value = null;
}

async function ensureTableSession(action: DirectAddAction) {
  if (effectiveSessionId.value) return true;
  pendingOpenPayload.value ??= {
    idempotencyKey: createMutationKey('add'),
    items: [],
  };
  submittedPayload.value = pendingOpenPayload.value;
  submittedContext.value = { tableId: action.tableId, tableLabel: action.tableLabel };
  try {
    const result = await createMerchantTableOrder(action.tableId, pendingOpenPayload.value);
    effectiveSessionId.value = result.session.id;
    pendingOpenPayload.value = null;
    clearSubmittedMutation();
    emit('created', result);
    return true;
  } catch (error) {
    if (error instanceof CashierApiError && error.code === 'TABLE_ALREADY_OPEN') {
      effectiveSessionId.value = 'OPEN_SESSION_CONFIRMED_BY_SERVER';
      pendingOpenPayload.value = null;
      clearSubmittedMutation();
      return true;
    }
    notifyMutationFailure(error);
    if (isDefinitiveMutationRejection(error)) {
      pendingOpenPayload.value = null;
      directAddQueue.value.shift();
      clearSubmittedMutation();
    } else {
      outcomeUncertain.value = true;
    }
    return false;
  }
}

async function drainDirectAddQueue() {
  if (processing.value || !directAddQueue.value.length) return;
  processing.value = true;
  outcomeUncertain.value = false;
  try {
    while (directAddQueue.value.length) {
      const action = directAddQueue.value[0]!;
      if (!(await ensureTableSession(action))) break;
      submittedPayload.value = submittedPayload.value ?? action.payload;
      submittedContext.value ??= { tableId: action.tableId, tableLabel: action.tableLabel };
      try {
        const result = await createMerchantTableOrder(
          submittedContext.value.tableId,
          submittedPayload.value,
        );
        effectiveSessionId.value = result.session.id;
        directAddQueue.value.shift();
        clearSubmittedMutation();
        emit('created', result);
      } catch (error) {
        notifyMutationFailure(error);
        if (isDefinitiveMutationRejection(error)) {
          directAddQueue.value.shift();
          clearSubmittedMutation();
          if (apiErrorTranslationKey(error) === 'ordering.productUnavailable') await loadCatalog();
          continue;
        }
        outcomeUncertain.value = true;
        break;
      }
    }
  } finally {
    processing.value = false;
  }
}

function requestClose() {
  if (mutationLocked.value) {
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
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && query.value.trim() && filteredProducts.value.length) {
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const next = activeResultIndex.value < 0
      ? direction > 0 ? 0 : filteredProducts.value.length - 1
      : (activeResultIndex.value + direction + filteredProducts.value.length) % filteredProducts.value.length;
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
    const selected = filteredProducts.value[activeResultIndex.value];
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

function hideBrokenImage(event: Event) {
  (event.currentTarget as HTMLImageElement).hidden = true;
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
      :data-session-id="effectiveSessionId"
      :role="embedded ? 'region' : 'dialog'"
      :aria-modal="embedded ? undefined : 'true'"
      :aria-label="t('ordering.title')"
      @keydown="onKeydown"
    >
      <header class="table-ordering-header">
        <div v-if="!embedded">
          <span>{{ t('ordering.tableContext', { table: submittedContext?.tableLabel || tableLabel }) }}</span>
          <h2>{{ t('ordering.title') }}</h2>
        </div>
        <Teleport to="#cashier-toolbar-menu-search" :disabled="!embedded || mobileOrderingLayout">
          <label class="table-ordering-search" data-testid="table-ordering-search">
            <Search :size="18" aria-hidden="true" />
            <input
              ref="searchInput"
              v-model="query"
              type="search"
              :placeholder="t('ordering.searchPlaceholder')"
              :aria-label="t('ordering.searchLabel')"
              :aria-activedescendant="activeResultIndex >= 0 ? `ordering-product-${filteredProducts[activeResultIndex]?.id}` : undefined"
              autocomplete="off"
              @keydown.stop="onKeydown"
            />
            <kbd>{{ t('ordering.searchShortcut') }}</kbd>
          </label>
        </Teleport>
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
          <button type="button" :class="{ 'is-active': activeCategoryId === 'ALL' }" @click="activeCategoryId = 'ALL'">
            {{ t('common.all') }}
          </button>
          <button
            v-for="category in activeCategories"
            :key="category.id"
            type="button"
            :class="{ 'is-active': activeCategoryId === category.id }"
            @click="activeCategoryId = category.id"
          >{{ categoryName(category) }}</button>
        </nav>

        <div class="table-ordering-products">
          <div class="table-ordering-products__scroller" data-testid="table-ordering-products-scroller">
            <nav class="table-ordering-category-strip" :aria-label="t('ordering.categories')" data-testid="table-ordering-category-strip">
              <button type="button" :class="{ 'is-active': activeCategoryId === 'ALL' }" @click="activeCategoryId = 'ALL'">
                {{ t('common.all') }}
              </button>
              <button
                v-for="category in activeCategories"
                :key="`strip-${category.id}`"
                type="button"
                :class="{ 'is-active': activeCategoryId === category.id }"
                @click="activeCategoryId = category.id"
              >{{ categoryName(category) }}</button>
            </nav>

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
                v-for="(product, index) in filteredProducts"
                :key="product.id"
                :id="`ordering-product-${product.id}`"
                :ref="(element) => setProductCardRef(element as Element | null, index)"
                class="table-ordering-product"
                :class="{
                  'is-selected': pendingQuantityForProduct(product.id) > 0,
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
                  <img
                    v-if="resolveMediaUrl(product.imageUrl)"
                    v-bind="{ src: resolveMediaUrl(product.imageUrl) }"
                    alt=""
                    loading="lazy"
                    @error="hideBrokenImage"
                  />
                  <ImageIcon :size="24" aria-hidden="true" />
                  <b class="table-ordering-product__price">{{ formatItemPrice(product.priceVnd, locale) }}</b>
                  <div v-if="pendingQuantityForProduct(product.id) > 0" class="table-ordering-product__quick-add" aria-live="polite">
                    <output>×{{ pendingQuantityForProduct(product.id) }}</output>
                  </div>
                </span>
                <div class="table-ordering-product__content">
                  <strong>{{ productName(product) }}</strong>
                </div>
              </article>
            </div>
          </div>
        </div>

        <aside v-if="!embedded" class="table-ordering-current-order" data-testid="ordering-current-order">
          <slot name="current-order" />
        </aside>
      </div>
    </section>
  </Teleport>
</template>
