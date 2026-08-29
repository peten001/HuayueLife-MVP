<script setup lang="ts">
import { ArrowLeft, RefreshCw } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import {
  apiErrorTranslationKey,
  CashierApiError,
  decreaseMerchantOrderItem,
  isDefinitiveMutationRejection,
  isMutationOutcomeUncertain,
  returnMerchantOrderItem,
  setTableSessionSettlementAdjustment,
  transferTableSession,
  shouldRefreshAfterItemAdjustmentError,
} from '@/api';
import {
  canCheckoutTableSession,
  buildCanonicalTableBillLines,
  createMutationKey,
  canDecreaseOrderItems,
  canReturnOrderItems,
  resolveCommittedDecreaseExecutionPath,
  shouldBlockCashierMutationNavigation,
  shouldExitMenuAfterItemMutation,
} from '@/domain';
import { useI18n } from '@/i18n';
import { useAuthStore, useCatalogStore, useNetworkStore, useOrdersStore, useTablesStore, useUiStore } from '@/stores';
import type { MerchantOrderMutationResult, PaymentMethod, TableSessionOrder, TransferTableSessionInput } from '@/types';
import { networkWritesDisabled } from '@/layouts/network-write-guard';
import LoadingState from '@/components/common/LoadingState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import CheckoutPaymentDialog from '@/components/settlement/CheckoutPaymentDialog.vue';
import TableOrderingWorkspace from '@/components/ordering/TableOrderingWorkspace.vue';
import PendingDecreaseRecovery from '@/components/orders/PendingDecreaseRecovery.vue';
import TableBillDetail from '@/components/bills/TableBillDetail.vue';
import TableGrid from '@/components/tables/TableGrid.vue';
import TableTransferDialog from '@/components/tables/TableTransferDialog.vue';
import SettlementAdjustmentDialog from '@/components/settlement/SettlementAdjustmentDialog.vue';
import { useMediaQuery, useTableOrderMutationController, type TableOrderDecreaseExecution, type TableOrderMutationIntent } from '@/composables';
import { resolveTableSelectionView } from '@/components/tables/table-selection-view';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const authStore = useAuthStore();
const networkStore = useNetworkStore();
const ordersStore = useOrdersStore();
const tablesStore = useTablesStore();
const uiStore = useUiStore();
const catalogStore = useCatalogStore();
const isMobile = useMediaQuery('(max-width: 899px)');
const { online, apiReachable } = storeToRefs(networkStore);
const { tableCards, selectedTableId, selectedTable, selectedSessionDetail, loading, detailLoading, checkingOut, errorKey } = storeToRefs(tablesStore);
const checkoutConfirmOpen = ref(false);
const adjustmentOpen = ref(false);
const settlementAdjustmentLoading = ref(false);
const activeMainTab = computed<'TABLES' | 'MENU'>(() => route.query.view === 'menu' ? 'MENU' : 'TABLES');
const transferOpen = ref(false);
const transferLoading = ref(false);
const transferError = ref('');
const pendingTransfer = ref<TransferTableSessionInput | null>(null);
let routeSequence = 0;

const writeDisabled = computed(() => !authStore.demoMode && networkWritesDisabled(online.value, apiReachable.value));
const routeTableId = computed(() => typeof route.params.tableId === 'string' ? route.params.tableId : '');
const session = computed(() => {
  const current = selectedSessionDetail.value;
  if (!current) return null;
  return {
    ...current,
    orders: current.orders.filter((order) =>
      !['COMPLETED', 'CANCELLED'].includes(order.status),
    ),
  };
});
const activeCatalogCategoryIds = computed(() => new Set(
  catalogStore.categories.filter((category) => category.isActive).map((category) => category.id),
));
const orderableProducts = computed(() => catalogStore.products.filter((product) =>
  product.status === 'ON_SALE' && activeCatalogCategoryIds.value.has(product.categoryId),
));
const orderableProductIds = computed(() => new Set(orderableProducts.value.map((product) => product.id)));
const orderingController = useTableOrderMutationController({
  tableId: () => selectedTableId.value || '',
  sessionId: () => session.value?.id || '',
  disabled: () => writeDisabled.value,
  orderableProducts: () => orderableProducts.value,
  executeDecrease: executeQueuedDecrease,
  onResult: (result) => applyItemMutation(result),
  onFailure: handleSharedMutationFailure,
  onBackpressure: () => uiStore.pushToast(t('ordering.pendingLimit'), 'warning'),
});
const orderingDraftLines = orderingController.draftLines;
const orderingMutationPending = orderingController.mutationPending;
const orderingMutationLocked = orderingController.mutationLocked;
const orderingProductQuantities = computed<Record<string, number>>(() =>
  buildCanonicalTableBillLines(session.value?.orders || [], orderingDraftLines.value)
    .reduce<Record<string, number>>((quantities, line) => {
      const productId = line.item?.productId || line.product?.id;
      if (productId) {
        quantities[productId] = (quantities[productId] || 0)
          + Math.max(0, line.quantity - (orderingController.pendingDecreaseQuantities.value[line.mergeKey] || 0));
      }
      return quantities;
    }, {}),
);
const canCheckout = computed(() => canCheckoutTableSession(session.value));
const unresolvedMutation = computed(() => orderingMutationLocked.value || Boolean(pendingTransfer.value));
const transferTargets = computed(() => tableCards.value.filter((table) =>
  table.id !== selectedTableId.value
  && table.status === 'ACTIVE'
  && table.operationalStatus === 'AVAILABLE'
  && !table.currentSession,
));
const topOrderingDialogOpen = computed(() => Boolean(
  checkoutConfirmOpen.value
  || adjustmentOpen.value
  || transferOpen.value
  || orderingController.uncertainDecreaseIntent.value,
));
const activeStatus = computed(() => {
  const status = route.query.status;
  return status === 'AVAILABLE' || status === 'IN_USE' ? status : 'ALL';
});
const availableTableCount = computed(() => tableCards.value.filter((table) => table.operationalStatus === 'AVAILABLE').length);
const inUseTableCount = computed(() => tableCards.value.filter((table) => table.operationalStatus === 'IN_USE').length);
const filteredTables = computed(() => {
  return tableCards.value.filter((table) => {
    if (activeStatus.value !== 'ALL' && table.operationalStatus !== activeStatus.value) return false;
    return true;
  });
});

async function reconcilePendingOrderingMutations() {
  if (!orderingMutationPending.value) return true;
  const settled = await orderingController.flush();
  if (settled) return true;
  uiStore.pushToast(t('mutation.outcomeUncertain'), 'warning');
  return false;
}

async function openSettlementAdjustment() {
  if (!session.value || writeDisabled.value) return;
  if (!(await reconcilePendingOrderingMutations())) return;
  adjustmentOpen.value = true;
}

async function saveSettlementAdjustment(input: { discountPayableRateBps: number | null; roundingEnabled: boolean }) {
  if (!session.value || writeDisabled.value || settlementAdjustmentLoading.value) return;
  settlementAdjustmentLoading.value = true;
  try {
    const updated = await setTableSessionSettlementAdjustment(session.value.id, input);
    tablesStore.applySessionSnapshot(updated);
    adjustmentOpen.value = false;
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'table.checkoutFailed')), 'error');
  } finally {
    settlementAdjustmentLoading.value = false;
  }
}

async function refresh(showToast = true) {
  try {
    await Promise.all([tablesStore.fetchTables({ force: true }), ordersStore.refreshLiveOrders({ force: true })]);
  } catch {
    if (showToast && tableCards.value.length) uiStore.pushToast(t('error.refreshFailed'), 'error');
  }
}

async function selectTable(tableId: string) {
  const card = tableCards.value.find((table) => table.id === tableId);
  if (!card) return;
  if (!(await reconcilePendingOrderingMutations())) return;
  const view = resolveTableSelectionView(isMobile.value, card.operationalStatus);
  await router.push({
    name: 'tables',
    params: { tableId },
    query: view ? { view } : {},
  });
}

async function selectTableFilter(status: 'ALL' | 'IN_USE' | 'AVAILABLE') {
  const query = { ...route.query };
  delete query.status;
  if (status !== 'ALL') query.status = status;
  await router.replace({
    name: 'tables',
    params: route.params,
    query,
  });
}

async function selectSessionOrder(order: TableSessionOrder) {
  if (!selectedTableId.value) return;
  await router.replace({ name: 'tables', params: { tableId: selectedTableId.value }, query: { ...route.query, order: order.id } });
}

async function syncRouteSelection() {
  const sequence = ++routeSequence;
  if (!tableCards.value.length) return;
  const tableId = typeof route.params.tableId === 'string' ? route.params.tableId : '';
  const orderId = typeof route.query.order === 'string' ? route.query.order : '';
  if (!tableId) {
    tablesStore.clearSelection();
    await ordersStore.selectOrder(null);
    return;
  }
  if (!tableCards.value.some((table) => table.id === tableId)) {
    await router.replace('/tables');
    return;
  }
  if (selectedTableId.value !== tableId || selectedSessionDetail.value?.tableId !== tableId) {
    await tablesStore.selectTable(tableId);
  }
  if (sequence !== routeSequence) return;
  const fallbackOrder = selectedSessionDetail.value?.orders.find((order) => order.status === 'PENDING_ACCEPTANCE')
    || selectedSessionDetail.value?.orders[0];
  if (!orderId) {
    await ordersStore.selectOrder(null);
    return;
  }
  const requestedId = orderId;
  try {
    const loaded = await ordersStore.selectOrder(requestedId);
    if (sequence !== routeSequence) return;
    if (!loaded || loaded.orderType !== 'DINE_IN' || loaded.tableId !== tableId) {
      if (fallbackOrder && fallbackOrder.id !== requestedId) await selectSessionOrder(fallbackOrder);
      else await ordersStore.selectOrder(null);
    }
  } catch {
    if (sequence === routeSequence && fallbackOrder && fallbackOrder.id !== requestedId) await selectSessionOrder(fallbackOrder);
  }
}

async function checkout(paymentMethod: PaymentMethod) {
  if (writeDisabled.value || checkingOut.value) return;
  if (!(await reconcilePendingOrderingMutations()) || !canCheckout.value) return;
  try {
    const result = await tablesStore.checkoutSelectedSession(paymentMethod);
    result.orders.forEach((order) => ordersStore.applyOrderSnapshot(order));
    checkoutConfirmOpen.value = false;
    tablesStore.clearSelection();
    await ordersStore.selectOrder(null);
    await router.replace('/tables');
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'table.checkoutFailed')), 'error');
  }
}

async function openCheckout() {
  if (writeDisabled.value || checkingOut.value) return;
  if (!(await reconcilePendingOrderingMutations()) || !canCheckout.value) return;
  checkoutConfirmOpen.value = true;
}

function replaceMainTab(tab: 'TABLES' | 'MENU') {
  const query = { ...route.query };
  if (tab === 'MENU') query.view = 'menu';
  else delete query.view;
  return router.replace({ name: 'tables', params: route.params, query });
}

function openOrdering() {
  if (writeDisabled.value || !selectedTable.value || selectedTable.value.status === 'DISABLED') return;
  void replaceMainTab('MENU');
}

function closeOrdering() {
  if (orderingMutationLocked.value) {
    uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
    return;
  }
  void replaceMainTab('TABLES');
}

function applyItemMutation(result: MerchantOrderMutationResult) {
  if (result.order) ordersStore.applyOrderSnapshot(result.order, true);
  tablesStore.applySessionSnapshot(result.session);
  if (shouldExitMenuAfterItemMutation(result)) {
    void ordersStore.selectOrder(null);
    if (selectedTableId.value) {
      void router.replace({
        name: 'tables',
        params: { tableId: selectedTableId.value },
        query: {},
      }).catch(() => undefined);
    }
  }
}

function increaseCommittedItem(
  itemOrProductId: { id: string; productId?: string | null; remark?: string | null } | string,
  _orderOrSourceItemId: TableSessionOrder | undefined,
  remarkOrMergeKey: string,
  draftMergeKey?: string,
) {
  const productId = typeof itemOrProductId === 'string' ? itemOrProductId : itemOrProductId.productId;
  const sourceItemId = typeof itemOrProductId === 'string' ? undefined : itemOrProductId.id;
  const remark = typeof itemOrProductId === 'string' ? remarkOrMergeKey : itemOrProductId.remark || '';
  const mergeKey = typeof itemOrProductId === 'string' ? draftMergeKey : remarkOrMergeKey;
  if (!productId || !selectedTableId.value || writeDisabled.value) return;
  orderingController.addProduct(
    productId,
    `canonical:${mergeKey}`,
    sourceItemId,
    mergeKey,
    remark || undefined,
  );
}

function addMenuProduct(productId: string) {
  orderingController.addProduct(productId);
}

async function openTransfer() {
  if (!session.value || writeDisabled.value) return;
  if (!(await reconcilePendingOrderingMutations())) return;
  transferError.value = '';
  transferOpen.value = true;
}

function cancelTransfer() {
  if (transferLoading.value) return;
  if (pendingTransfer.value) {
    uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
    return;
  }
  transferOpen.value = false;
  transferError.value = '';
}

async function confirmTransfer(targetTableId: string) {
  if (!session.value || transferLoading.value || writeDisabled.value) return;
  if (pendingTransfer.value && pendingTransfer.value.targetTableId !== targetTableId) {
    transferError.value = t('tableTransfer.pendingOtherTarget');
    return;
  }
  pendingTransfer.value ??= {
    targetTableId,
    expectedSourceTableId: session.value.tableId,
    requestKey: createMutationKey('transfer'),
  };
  transferLoading.value = true;
  transferError.value = '';
  try {
    const updated = await transferTableSession(session.value.id, pendingTransfer.value);
    pendingTransfer.value = null;
    tablesStore.applySessionSnapshot(updated);
    transferOpen.value = false;
    await router.replace({ name: 'tables', params: { tableId: updated.tableId }, query: {} });
  } catch (caught) {
    if (isDefinitiveMutationRejection(caught)) pendingTransfer.value = null;
    transferError.value = isMutationOutcomeUncertain(caught)
      ? t('mutation.outcomeUncertain')
      : t(apiErrorTranslationKey(caught, 'tableTransfer.failed'));
    await refreshAdjustmentContext(true);
  } finally {
    transferLoading.value = false;
  }
}

async function refreshAdjustmentContext(force = false) {
  await Promise.allSettled([ordersStore.refreshLiveOrders({ force }), tablesStore.fetchTables({ force })]);
}

function returnContext(order: TableSessionOrder) {
  return {
    orderType: 'DINE_IN' as const,
    tableSessionId: session.value?.id,
    status: order.status,
  };
}

function handleCommittedDecrease(
  itemOrProductId: { productId?: string | null } | string,
  orderOrMergeKey: TableSessionOrder | string,
  _canonicalQuantity?: number,
  committedMergeKey?: string,
) {
  const productId = typeof itemOrProductId === 'string' ? itemOrProductId : itemOrProductId.productId;
  const mergeKey = typeof orderOrMergeKey === 'string' ? orderOrMergeKey : committedMergeKey;
  if (!productId || writeDisabled.value) return;
  if (mergeKey) orderingController.decreaseProduct(productId, mergeKey);
}

async function executeQueuedDecrease(input: TableOrderDecreaseExecution) {
  const line = buildCanonicalTableBillLines(session.value?.orders || [], [])
    .find((candidate) => candidate.mergeKey === input.mergeKey);
  const target = [...(line?.committedEntries || [])].reverse().find(({ item, order }) => {
    if (Number(item.quantity || 0) <= 0) return false;
    return canDecreaseOrderItems(returnContext(order)) || canReturnOrderItems(returnContext(order));
  });
  if (!line || !target || line.committedQuantity <= 0) {
    throw new CashierApiError({
      message: 'The selected order item is no longer adjustable.',
      status: 409,
      code: 'ORDER_ITEM_NOT_FOUND',
    });
  }
  const expectedQuantity = Number(target.item.quantity || 0);
  const appliedQuantity = Math.min(input.quantity, expectedQuantity);
  const executionPath = resolveCommittedDecreaseExecutionPath(
    returnContext(target.order),
    line.committedQuantity,
    expectedQuantity,
  );
  if (executionPath === 'DECREASE') {
    return {
      result: await decreaseMerchantOrderItem(target.order.id, target.item.id, {
      requestKey: input.requestKey,
      expectedQuantity,
      targetQuantity: expectedQuantity - appliedQuantity,
      }),
      appliedQuantity,
    };
  }
  if (executionPath === 'RETURN') {
    return {
      result: await returnMerchantOrderItem(target.order.id, target.item.id, {
      requestKey: input.requestKey,
      expectedQuantity,
      returnQuantity: appliedQuantity,
      }),
      appliedQuantity,
    };
  }
  throw new CashierApiError({
    message: 'The order status no longer permits item adjustment.',
    status: 409,
    code: 'ORDER_STATUS_CHANGED',
  });
}

async function handleSharedMutationFailure(caught: unknown, intent: TableOrderMutationIntent | null) {
  const uncertain = isMutationOutcomeUncertain(caught);
  const fallback = intent?.kind === 'DECREASE'
    ? 'itemAdjustment.decreaseFailed'
    : 'ordering.createFailed';
  uiStore.pushToast(t(uncertain ? 'mutation.outcomeUncertain' : apiErrorTranslationKey(caught, fallback)), uncertain ? 'warning' : 'error');
  if (!uncertain && shouldRefreshAfterItemAdjustmentError(caught)) {
    await refreshAdjustmentContext(true);
  }
  if (caught instanceof CashierApiError && ['TABLE_SESSION_NOT_OPEN', 'TABLE_ALREADY_OPEN', 'TABLE_SESSION_CLOSED', 'TABLE_NOT_AVAILABLE', 'TABLE_NOT_FOUND'].includes(caught.code)) {
    await refreshAdjustmentContext(true);
    if (!selectedSessionDetail.value || selectedSessionDetail.value.status === 'CLOSED') {
      void replaceMainTab('TABLES');
    }
  }
  if (!uncertain && intent?.kind === 'ADD' && apiErrorTranslationKey(caught) === 'ordering.productUnavailable') {
    await catalogStore.loadCatalog({ force: true });
  }
}

function protectUnload(event: BeforeUnloadEvent) {
  if (!unresolvedMutation.value) return;
  event.preventDefault();
  event.returnValue = '';
}

async function guardMutationNavigation(to: { name?: string | symbol | null; params: Record<string, unknown> }) {
  const blocked = shouldBlockCashierMutationNavigation({
    unresolvedMutation: unresolvedMutation.value,
    authenticated: authStore.isAuthenticated,
    destinationName: to.name,
  });
  if (blocked) {
    uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
    return false;
  }
  const destinationTableId = typeof to.params.tableId === 'string' ? to.params.tableId : '';
  const changingTable = destinationTableId !== routeTableId.value;
  const leavingTableWorkspace = to.name !== 'tables';
  if (orderingMutationPending.value && (changingTable || leavingTableWorkspace)) {
    return reconcilePendingOrderingMutations();
  }
  return true;
}

onBeforeRouteUpdate((to) => guardMutationNavigation(to));
onBeforeRouteLeave((to) => guardMutationNavigation(to));

watch(
  () => [route.params.tableId, route.query.order, tableCards.value.length],
  () => void syncRouteSelection(),
  { immediate: true },
);
onMounted(() => window.addEventListener('beforeunload', protectUnload));
onBeforeUnmount(() => window.removeEventListener('beforeunload', protectUnload));
</script>

<template>
  <section
    class="cashier-workspace cashier-workspace--table-overview table-overview-route"
    :class="{
      'has-selection': Boolean(routeTableId),
      'is-menu-tab': activeMainTab === 'MENU',
    }"
    data-page="TableOverviewPage"
    data-testid="table-overview-workspace"
  >
    <div class="cashier-workspace__content cashier-workspace__content--table-overview">
      <header v-if="activeMainTab === 'TABLES' && !isMobile" class="table-main-toolbar">
        <div class="table-filter-chips" :aria-label="t('stats.title')">
          <button type="button" data-testid="table-filter-all" :class="{ 'is-active': activeStatus === 'ALL' }" :aria-pressed="activeStatus === 'ALL'" @click="selectTableFilter('ALL')">
            {{ t('common.all') }} <b>{{ tableCards.length }}</b>
          </button>
          <button type="button" data-testid="table-filter-in-use" :class="{ 'is-active': activeStatus === 'IN_USE' }" :aria-pressed="activeStatus === 'IN_USE'" @click="selectTableFilter('IN_USE')">
            {{ t('table.status.inUse') }} <b>{{ inUseTableCount }}</b>
          </button>
          <button type="button" data-testid="table-filter-available" :class="{ 'is-active': activeStatus === 'AVAILABLE' }" :aria-pressed="activeStatus === 'AVAILABLE'" @click="selectTableFilter('AVAILABLE')">
            {{ t('table.status.available') }} <b>{{ availableTableCount }}</b>
          </button>
          <button type="button" class="table-main-refresh" data-testid="table-main-refresh" :aria-label="t('common.refresh')" :title="t('common.refresh')" :disabled="loading" @click="refresh(true)">
            <RefreshCw :size="18" :class="{ spinning: loading }" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div v-show="activeMainTab === 'TABLES'" class="table-main-pane table-main-pane--tables">
        <LoadingState v-if="loading && !tableCards.length" :label="t('table.loading')" />
        <ErrorState v-else-if="errorKey && !tableCards.length" :title="t('error.title')" :description="t(errorKey)" :retry-label="t('common.retry')" @retry="refresh(false)" />
        <TableGrid v-else :tables="filteredTables" :selected-table-id="selectedTableId" @select="selectTable" />
      </div>

      <div v-show="activeMainTab === 'MENU'" class="table-main-pane table-main-pane--menu">
        <TableOrderingWorkspace
          v-if="activeMainTab === 'MENU' && selectedTable && selectedTable.status !== 'DISABLED'"
          :key="selectedTable.id"
          open
          embedded
          :table-id="selectedTable.id"
          :table-label="session?.tableNo || selectedTable.tableNo || t('table.numberFallback')"
          :session-id="session?.id || ''"
          :disabled="writeDisabled"
          :top-dialog-open="topOrderingDialogOpen"
          :product-quantities="orderingProductQuantities"
          :pending-add-quantities="orderingController.pendingAddQuantities.value"
          :mutation-locked="orderingMutationLocked"
          @close="closeOrdering"
          @add-product="addMenuProduct"
        />
        <EmptyState v-else-if="activeMainTab === 'MENU'" :title="t('cashierV2.menuNeedsTableTitle')" :description="t('cashierV2.menuNeedsTableDescription')" />
      </div>
    </div>

    <aside class="table-route-detail" :class="{ 'table-route-detail--open': Boolean(routeTableId) && activeMainTab === 'TABLES' }" data-testid="table-route-detail">
      <button
        v-if="selectedTableId && !isMobile"
        type="button"
        class="table-route-detail__back"
        :aria-label="t('fulfillment.backToTables')"
        @click="router.push('/tables')"
      ><ArrowLeft :size="20" aria-hidden="true" /></button>
      <LoadingState v-if="detailLoading && !selectedSessionDetail" :label="t('table.loading')" />
      <TableBillDetail
        v-else
        :table="selectedTable"
        :session="session"
        :checkout-disabled="!canCheckout"
        :checking-out="checkingOut"
        :actions-disabled="writeDisabled || orderingMutationLocked || settlementAdjustmentLoading"
        :item-actions-disabled="writeDisabled || settlementAdjustmentLoading"
        :pending-decrease-merge-keys="orderingController.uncertainDecreaseMergeKeys.value"
        :pending-decrease-quantities="orderingController.pendingDecreaseQuantities.value"
        :orderable-product-ids="orderableProductIds"
        :adjustment-applied="Boolean(session?.discountPayableRateBps != null || session?.roundingApplied)"
        :payable-amount="session?.payableAmountVnd || session?.totalAmountVnd || '0'"
        :transfer-disabled="!session || !transferTargets.length"
        :draft-lines="orderingDraftLines"
        @order-items="openOrdering"
        @decrease-item="handleCommittedDecrease"
        @increase-item="increaseCommittedItem"
        @transfer="openTransfer"
        @checkout="openCheckout"
        @adjustment="openSettlementAdjustment"
      />
    </aside>
    <PendingDecreaseRecovery :open="Boolean(orderingController.uncertainDecreaseIntent.value)" :loading="false" :disabled="writeDisabled" @retry="orderingController.uncertainDecreaseIntent.value && orderingController.retryIntent(orderingController.uncertainDecreaseIntent.value.id)" />
    <CheckoutPaymentDialog
      :open="checkoutConfirmOpen"
      :amount-vnd="session?.payableAmountVnd ?? session?.totalAmountVnd ?? '0'"
      :loading="checkingOut"
      @cancel="checkoutConfirmOpen = false"
      @confirm="checkout"
    />
    <SettlementAdjustmentDialog
      v-if="session"
      :open="adjustmentOpen"
      :item-amount-vnd="session.originalAmountVnd || session.totalAmountVnd"
      :discount-payable-rate-bps="session.discountPayableRateBps"
      :rounding-enabled="session.roundingApplied"
      :loading="settlementAdjustmentLoading"
      @cancel="adjustmentOpen = false"
      @confirm="saveSettlementAdjustment"
    />
    <TableTransferDialog
      :open="transferOpen"
      :source-label="session?.tableNo || selectedTable?.tableNo || t('table.numberFallback')"
      :targets="transferTargets"
      :loading="transferLoading"
      :error="transferError"
      @cancel="cancelTransfer"
      @confirm="confirmTransfer"
    />
  </section>
</template>
