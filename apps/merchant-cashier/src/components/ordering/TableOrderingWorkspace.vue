<script setup lang="ts">
import { ImageIcon, Minus, Plus, Search, ShoppingBasket, X } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  apiErrorTranslationKey,
  createMerchantTableOrder,
  isDefinitiveMutationRejection,
  isMutationOutcomeUncertain,
  listCashierMenuCategories,
  listCashierMenuProducts,
} from '@/api';
import { createMutationKey, formatVnd, resolveMediaUrl } from '@/domain';
import { useI18n } from '@/i18n';
import { useUiStore } from '@/stores';
import type {
  CashierMenuCategory,
  CashierMenuProduct,
  CreateMerchantTableOrderInput,
  MerchantOrderMutationResult,
} from '@/types';
import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import LoadingState from '@/components/common/LoadingState.vue';

interface Selection {
  quantity: number;
  remark: string;
}

const props = defineProps<{
  open: boolean;
  tableId: string;
  tableLabel: string;
  sessionId: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  created: [result: MerchantOrderMutationResult];
  failed: [error: unknown];
  mutationLockChanged: [locked: boolean];
}>();

const { t, locale } = useI18n();
const uiStore = useUiStore();
const categories = ref<CashierMenuCategory[]>([]);
const products = ref<CashierMenuProduct[]>([]);
const activeCategoryId = ref('ALL');
const query = ref('');
const selections = ref<Record<string, Selection>>({});
const loading = ref(false);
const submitting = ref(false);
const loadErrorKey = ref('');
const idempotencyKey = ref('');
const submittedPayload = ref<CreateMerchantTableOrderInput | null>(null);
const mutationLocked = computed(() => Boolean(submittedPayload.value));
const outcomeUncertain = computed(() => mutationLocked.value && !submitting.value);
const submittedContext = ref<{
  tableId: string;
  sessionId: string;
  tableLabel: string;
} | null>(null);
const targetTableLabel = computed(() => submittedContext.value?.tableLabel ?? props.tableLabel);

const activeCategories = computed(() => categories.value.filter((category) => category.isActive));
const categoryIds = computed(() => new Set(activeCategories.value.map((category) => category.id)));
const orderableProducts = computed(() => products.value.filter((product) =>
  product.status === 'ON_SALE' && categoryIds.value.has(product.categoryId),
));
const filteredProducts = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase();
  return orderableProducts.value.filter((product) =>
    (activeCategoryId.value === 'ALL' || product.categoryId === activeCategoryId.value)
    && (!keyword || [product.nameZh, product.nameVi, product.description]
      .some((value) => value?.toLocaleLowerCase().includes(keyword))),
  );
});
const selectedLines = computed(() => orderableProducts.value.flatMap((product) => {
  const selection = selections.value[product.id];
  return selection?.quantity > 0 ? [{ product, ...selection }] : [];
}));
const selectedQuantity = computed(() => selectedLines.value.reduce(
  (total, line) => total + line.quantity,
  0,
));
const hasOpenSession = computed(() => Boolean(props.sessionId));
const selectedTotal = computed(() => selectedLines.value.reduce(
  (total, line) => total + BigInt(line.product.priceVnd) * BigInt(line.quantity),
  0n,
).toString());
const canSubmit = computed(() =>
  (!hasOpenSession.value || selectedQuantity.value > 0)
  && !props.disabled
  && !loading.value
  && !submitting.value,
);
const submitLabel = computed(() => {
  if (outcomeUncertain.value) return t('mutation.retrySameRequest');
  if (selectedQuantity.value === 0) return t('ordering.openTableOnly');
  return t('ordering.openTableAndAddItems');
});

watch(mutationLocked, (locked) => emit('mutationLockChanged', locked), {
  immediate: true,
  flush: 'sync',
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    if (submittedPayload.value) return;
    resetWorkspace();
    void loadCatalog();
  },
  { immediate: true },
);

function productName(product: CashierMenuProduct) {
  return locale.value === 'vi' ? product.nameVi || product.nameZh : product.nameZh;
}

function categoryName(category: CashierMenuCategory) {
  return locale.value === 'vi' ? category.nameVi || category.nameZh : category.nameZh;
}

function selectionFor(productId: string): Selection {
  return selections.value[productId] ?? { quantity: 0, remark: '' };
}

function changeQuantity(productId: string, delta: number) {
  if (props.disabled || submitting.value || submittedPayload.value) return;
  const current = selectionFor(productId);
  const quantity = Math.max(0, Math.min(99, current.quantity + delta));
  selections.value = {
    ...selections.value,
    [productId]: { ...current, quantity },
  };
}

function updateRemark(productId: string, value: string) {
  if (submittedPayload.value) return;
  const current = selectionFor(productId);
  selections.value = {
    ...selections.value,
    [productId]: { ...current, remark: value },
  };
}

function resetWorkspace() {
  activeCategoryId.value = 'ALL';
  query.value = '';
  selections.value = {};
  loadErrorKey.value = '';
  idempotencyKey.value = createMutationKey('add');
  submittedPayload.value = null;
  submittedContext.value = null;
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

async function submit() {
  if (!canSubmit.value || !idempotencyKey.value) return;
  submitting.value = true;
  try {
    const payload = submittedPayload.value ?? {
      idempotencyKey: idempotencyKey.value,
      items: selectedLines.value.map(({ product, quantity, remark }) => ({
        productId: product.id,
        quantity,
        ...(remark.trim() ? { remark: remark.trim() } : {}),
      })),
    };
    submittedPayload.value = payload;
    submittedContext.value ??= {
      tableId: props.tableId,
      sessionId: props.sessionId,
      tableLabel: props.tableLabel,
    };
    const result = await createMerchantTableOrder(submittedContext.value.tableId, payload);
    submittedPayload.value = null;
    submittedContext.value = null;
    emit('created', result);
  } catch (error) {
    if (isDefinitiveMutationRejection(error)) {
      submittedPayload.value = null;
      submittedContext.value = null;
      idempotencyKey.value = createMutationKey('add');
    }
    uiStore.pushToast(t(
      isMutationOutcomeUncertain(error)
        ? 'mutation.outcomeUncertain'
        : apiErrorTranslationKey(error, 'ordering.createFailed'),
    ), isMutationOutcomeUncertain(error) ? 'warning' : 'error');
    emit('failed', error);
    if (isDefinitiveMutationRejection(error)
      && apiErrorTranslationKey(error) === 'ordering.productUnavailable') {
      await loadCatalog();
    }
  } finally {
    submitting.value = false;
  }
}

function requestClose() {
  if (submitting.value) return;
  if (outcomeUncertain.value) {
    uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
    return;
  }
  emit('close');
}

function onKeydown(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape') requestClose();
}

function hideBrokenImage(event: Event) {
  (event.currentTarget as HTMLImageElement).hidden = true;
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="mutationLocked"
      class="table-ordering-navigation-guard"
      data-testid="ordering-navigation-guard"
      aria-hidden="true"
    />
    <section
      v-if="open"
      class="table-ordering-workspace"
      data-testid="table-ordering-workspace"
      :data-session-id="sessionId"
      role="dialog"
      aria-modal="true"
      :aria-label="t('ordering.title')"
    >
      <header class="table-ordering-header">
        <div>
          <span>{{ t('ordering.tableContext', { table: targetTableLabel }) }}</span>
          <h2>{{ t('ordering.title') }}</h2>
        </div>
        <label class="table-ordering-search">
          <Search :size="18" aria-hidden="true" />
          <input v-model="query" type="search" :placeholder="t('ordering.searchPlaceholder')" />
        </label>
        <button
          type="button"
          class="table-ordering-close"
          :aria-label="t('common.cancel')"
          :disabled="submitting || outcomeUncertain"
          @click="requestClose"
        ><X :size="22" aria-hidden="true" /></button>
      </header>

      <div class="table-ordering-body">
        <nav class="table-ordering-categories" :aria-label="t('ordering.categories')">
          <button
            type="button"
            :class="{ 'is-active': activeCategoryId === 'ALL' }"
            @click="activeCategoryId = 'ALL'"
          >{{ t('common.all') }}</button>
          <button
            v-for="category in activeCategories"
            :key="category.id"
            type="button"
            :class="{ 'is-active': activeCategoryId === category.id }"
            @click="activeCategoryId = category.id"
          >{{ categoryName(category) }}</button>
        </nav>

        <div class="table-ordering-products">
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
              v-for="product in filteredProducts"
              :key="product.id"
              class="table-ordering-product"
              :class="{ 'is-selected': selectionFor(product.id).quantity > 0 }"
              :data-product-id="product.id"
            >
              <span class="table-ordering-product__image" aria-hidden="true">
                <img
                  v-if="resolveMediaUrl(product.imageUrl)"
                  :src="resolveMediaUrl(product.imageUrl)"
                  alt=""
                  loading="lazy"
                  @error="hideBrokenImage"
                />
                <ImageIcon :size="24" />
              </span>
              <div class="table-ordering-product__copy">
                <strong>{{ productName(product) }}</strong>
                <small v-if="product.description">{{ product.description }}</small>
                <b>{{ formatVnd(product.priceVnd, locale) }}</b>
              </div>
              <div class="table-ordering-quantity" :aria-label="t('ordering.quantityFor', { name: productName(product) })">
                <button
                  type="button"
                  :aria-label="t('ordering.decreaseQuantity')"
                  :disabled="selectionFor(product.id).quantity === 0 || disabled || submitting || Boolean(submittedPayload)"
                  @click="changeQuantity(product.id, -1)"
                ><Minus :size="18" aria-hidden="true" /></button>
                <output>{{ selectionFor(product.id).quantity }}</output>
                <button
                  type="button"
                  :aria-label="t('ordering.increaseQuantity')"
                  :disabled="disabled || submitting || Boolean(submittedPayload) || selectionFor(product.id).quantity >= 99"
                  @click="changeQuantity(product.id, 1)"
                ><Plus :size="18" aria-hidden="true" /></button>
              </div>
              <input
                v-if="selectionFor(product.id).quantity > 0"
                class="table-ordering-product__remark"
                :value="selectionFor(product.id).remark"
                maxlength="200"
                :placeholder="t('ordering.remarkPlaceholder')"
                :disabled="disabled || submitting || Boolean(submittedPayload)"
                @input="updateRemark(product.id, ($event.target as HTMLInputElement).value)"
              />
            </article>
          </div>
        </div>
      </div>

      <footer class="table-ordering-footer">
        <div class="table-ordering-summary">
          <ShoppingBasket :size="22" aria-hidden="true" />
          <span>{{ t('ordering.selected', { count: selectedQuantity }) }}</span>
          <strong>{{ formatVnd(selectedTotal, locale) }}</strong>
          <small v-if="outcomeUncertain" data-testid="ordering-outcome-uncertain" role="alert">
            {{ t('mutation.outcomeUncertain') }}
          </small>
        </div>
        <button
          type="button"
          class="secondary-action"
          :disabled="submitting || outcomeUncertain"
          @click="requestClose"
        >
          {{ t('common.cancel') }}
        </button>
    <button
      type="button"
      class="primary-action"
      data-testid="confirm-table-order"
      :disabled="!canSubmit"
      @click="submit"
    >{{ submitting
      ? t('ordering.submitting')
      : submitLabel }}</button>
  </footer>
  </section>
  </Teleport>
</template>
