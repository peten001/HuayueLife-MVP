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
  getOrCreatePendingDecreaseMutation,
  getOrCreatePendingReturnMutation,
  canCheckoutTableSession,
  canReturnOrderItems,
  buildCanonicalTableBillLines,
  createMutationKey,
  hasUnresolvedCashierMutation,
  shouldBlockCashierMutationNavigation,
  type PendingDecreaseMutation,
  type PendingReturnMutation,
} from '@/domain';
import { useI18n } from '@/i18n';
import { useAuthStore, useNetworkStore, useOrdersStore, useTablesStore, useUiStore } from '@/stores';
import type { CashierOrderingDraftLine, MerchantOrderMutationResult, OrderItem, PaymentMethod, TableSessionOrder, TransferTableSessionInput } from '@/types';
import type { CashierOrderItemView } from '@/components/common/view-models';
import { networkWritesDisabled } from '@/layouts/network-write-guard';
import LoadingState from '@/components/common/LoadingState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';
import CheckoutPaymentDialog from '@/components/settlement/CheckoutPaymentDialog.vue';
import TableOrderingWorkspace from '@/components/ordering/TableOrderingWorkspace.vue';
import ReturnItemDialog from '@/components/orders/ReturnItemDialog.vue';
import PendingDecreaseRecovery from '@/components/orders/PendingDecreaseRecovery.vue';
import TableBillDetail from '@/components/bills/TableBillDetail.vue';
import TableGrid from '@/components/tables/TableGrid.vue';
import TableTransferDialog from '@/components/tables/TableTransferDialog.vue';
import SettlementAdjustmentDialog from '@/components/settlement/SettlementAdjustmentDialog.vue';
import { useMediaQuery } from '@/composables';
import { resolveTableSelectionView } from '@/components/tables/table-selection-view';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const authStore = useAuthStore();
const networkStore = useNetworkStore();
const ordersStore = useOrdersStore();
const tablesStore = useTablesStore();
const uiStore = useUiStore();
const isMobile = useMediaQuery('(max-width: 899px)');
const { online, apiReachable } = storeToRefs(networkStore);
const { tableCards, selectedTableId, selectedTable, selectedSessionDetail, loading, detailLoading, checkingOut, errorKey } = storeToRefs(tablesStore);
const { selectedOrder } = storeToRefs(ordersStore);
const checkoutConfirmOpen = ref(false);
const adjustmentOpen = ref(false);
const settlementAdjustmentLoading = ref(false);
const activeMainTab = computed<'TABLES' | 'MENU'>(() => route.query.view === 'menu' ? 'MENU' : 'TABLES');
const orderingWorkspace = ref<{
  queueProductAddition: (
    productId: string,
    lineId?: string,
    sourceItemId?: string,
    mergeKey?: string,
    remark?: string,
  ) => boolean;
} | null>(null);
const orderingDraftLines = ref<CashierOrderingDraftLine[]>([]);
const orderingMutationLocked = ref(false);
const adjustmentLoadingId = ref('');
const pendingDecreaseMutation = ref<PendingDecreaseMutation | null>(null);
const returnDialogItem = ref<CashierOrderItemView | null>(null);
const returnDialogOrderId = ref('');
const returnDialogLastOrderItem = ref(false);
const returnDialogLastTableItem = ref(false);
const pendingReturnMutation = ref<PendingReturnMutation | null>(null);
const directReturnInFlight = ref(false);
const pendingDecreaseConfirm = ref<{ item: OrderItem; order: TableSessionOrder } | null>(null);
const transferOpen = ref(false);
const transferLoading = ref(false);
const transferError = ref('');
const pendingTransfer = ref<TransferTableSessionInput | null>(null);
let routeSequence = 0;

const writeDisabled = computed(() => !authStore.demoMode && networkWritesDisabled(online.value, apiReachable.value));
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
const orderingProductQuantities = computed<Record<string, number>>(() =>
  buildCanonicalTableBillLines(session.value?.orders || [], orderingDraftLines.value)
    .reduce<Record<string, number>>((quantities, line) => {
      const productId = line.item?.productId || line.product?.id;
      if (productId) quantities[productId] = (quantities[productId] || 0) + line.quantity;
      return quantities;
    }, {}),
);
const dineInOrder = computed(() => {
  const order = selectedOrder.value;
  if (!order || order.orderType !== 'DINE_IN') return null;
  if (order.status === 'COMPLETED') return null;
  if (order.tableId !== selectedTableId.value || order.tableSessionId !== session.value?.id) return null;
  return order;
});
const canCheckout = computed(() => canCheckoutTableSession(session.value));
const unresolvedMutation = computed(() => hasUnresolvedCashierMutation({
  orderingLocked: orderingMutationLocked.value,
  pendingDecrease: pendingDecreaseMutation.value,
  pendingReturn: pendingReturnMutation.value,
}) || Boolean(pendingTransfer.value));
const transferTargets = computed(() => tableCards.value.filter((table) =>
  table.id !== selectedTableId.value
  && table.status === 'ACTIVE'
  && table.operationalStatus === 'AVAILABLE'
  && !table.currentSession,
));
const topOrderingDialogOpen = computed(() => Boolean(
  checkoutConfirmOpen.value
  || adjustmentOpen.value
  || returnDialogItem.value
  || pendingDecreaseConfirm.value
  || transferOpen.value
  || (pendingDecreaseMutation.value && !adjustmentLoadingId.value),
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

function openSettlementAdjustment() {
  if (!session.value || writeDisabled.value) return;
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
  if (!tableCards.value.length) await tablesStore.fetchTables();
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
  if (!canCheckout.value || writeDisabled.value || checkingOut.value) return;
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
  if (
    result.session.status === 'CLOSED'
    || result.order?.status === 'CANCELLED'
  ) {
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

async function handleTableOrderCreated(result: MerchantOrderMutationResult) {
  applyItemMutation(result);
  if (result.order && selectedTableId.value) {
    await router.replace({ name: 'tables', params: { tableId: selectedTableId.value }, query: { ...route.query, order: result.order.id } });
  }
}

async function increaseCommittedItem(item: OrderItem, _order: TableSessionOrder, mergeKey: string) {
  if (!item.productId || !selectedTableId.value || writeDisabled.value || orderingMutationLocked.value) return;
  orderingWorkspace.value?.queueProductAddition(
    item.productId,
    `canonical:${mergeKey}`,
    item.id,
    mergeKey,
    item.remark || undefined,
  );
}

function handleDraftChanged(lines: CashierOrderingDraftLine[]) {
  orderingDraftLines.value = lines;
}

function openTransfer() {
  if (!session.value || writeDisabled.value) return;
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

async function handleOrderingFailure(caught: unknown) {
  await refreshAdjustmentContext(isMutationOutcomeUncertain(caught) || shouldRefreshAfterItemAdjustmentError(caught));
  if (caught instanceof CashierApiError && ['TABLE_SESSION_NOT_OPEN', 'TABLE_ALREADY_OPEN', 'TABLE_SESSION_CLOSED', 'TABLE_NOT_AVAILABLE', 'TABLE_NOT_FOUND'].includes(caught.code)) void replaceMainTab('TABLES');
}

async function decreaseItem(item: OrderItem, sourceOrder?: TableSessionOrder) {
  const order = sourceOrder || dineInOrder.value;
  if (!order || adjustmentLoadingId.value || writeDisabled.value) return;
  const mutation = getOrCreatePendingDecreaseMutation(pendingDecreaseMutation.value, {
    orderId: order.id,
    itemId: item.id,
    expectedQuantity: Number(item.quantity || 0),
  });
  if (!mutation) {
    uiStore.pushToast(t('itemAdjustment.pendingOtherItem'), 'warning');
    return;
  }
  pendingDecreaseMutation.value = mutation;
  await executeDecrease(mutation);
}

async function executeDecrease(mutation: PendingDecreaseMutation) {
  adjustmentLoadingId.value = mutation.itemId;
  try {
    const result = await decreaseMerchantOrderItem(mutation.orderId, mutation.itemId, {
      requestKey: mutation.requestKey,
      expectedQuantity: mutation.expectedQuantity,
      targetQuantity: mutation.targetQuantity,
    });
    applyItemMutation(result);
    pendingDecreaseMutation.value = null;
  } catch (caught) {
    if (!isDefinitiveMutationRejection(caught)) {
      await refreshAdjustmentContext(true);
      uiStore.pushToast(t('mutation.outcomeUncertain'), 'warning');
    } else {
      pendingDecreaseMutation.value = null;
      uiStore.pushToast(t(apiErrorTranslationKey(caught, 'itemAdjustment.decreaseFailed')), 'error');
      if (shouldRefreshAfterItemAdjustmentError(caught)) await refreshAdjustmentContext(true);
    }
  } finally {
    adjustmentLoadingId.value = '';
  }
}

function returnContext(order: TableSessionOrder) {
  return {
    orderType: 'DINE_IN' as const,
    tableSessionId: session.value?.id,
    status: order.status,
  };
}

async function handleCommittedDecrease(item: OrderItem, order: TableSessionOrder, canonicalQuantity: number) {
  if (canonicalQuantity <= 0 || Number(item.quantity || 0) <= 0) return;
  if (canonicalQuantity === 1) {
    if (canReturnOrderItems(returnContext(order))) requestReturn(item, order);
    else pendingDecreaseConfirm.value = { item, order };
    return;
  }
  if (!canReturnOrderItems(returnContext(order))) {
    await decreaseItem(item, order);
    return;
  }
  requestReturn(item, order);
  if (returnDialogItem.value?.id !== item.id) return;
  directReturnInFlight.value = true;
  try {
    await confirmReturn(1);
  } finally {
    directReturnInFlight.value = false;
  }
}

function cancelPendingDecreaseConfirm() {
  if (adjustmentLoadingId.value) return;
  pendingDecreaseConfirm.value = null;
}

async function confirmPendingDecrease() {
  const target = pendingDecreaseConfirm.value;
  if (!target || adjustmentLoadingId.value) return;
  pendingDecreaseConfirm.value = null;
  await decreaseItem(target.item, target.order);
}

function requestReturn(item: OrderItem, sourceOrder?: TableSessionOrder) {
  if (writeDisabled.value || pendingDecreaseMutation.value) return;
  if (Number(item.quantity || 0) <= 0) {
    uiStore.pushToast(t('itemAdjustment.noReturnableQuantity'), 'error');
    return;
  }
  const targetOrder = sourceOrder || dineInOrder.value;
  if (!targetOrder) return;
  const effectiveOrderItems = targetOrder.items.filter(
    (candidate) => Number(candidate.quantity || 0) > 0,
  );
  returnDialogLastOrderItem.value =
    effectiveOrderItems.length === 1
    && effectiveOrderItems[0]?.id === item.id;
  const effectiveTableQuantity = (selectedSessionDetail.value?.orders || [])
    .filter((order) => order.status !== 'CANCELLED')
    .flatMap((order) => order.items)
    .reduce((sum, candidate) => sum + Number(candidate.quantity || 0), 0);
  returnDialogLastTableItem.value =
    returnDialogLastOrderItem.value
    && effectiveTableQuantity === Number(item.quantity || 0);
  returnDialogItem.value = item;
  returnDialogOrderId.value = targetOrder.id;
  pendingReturnMutation.value = null;
}

function clearReturnDialog() {
  returnDialogItem.value = null;
  returnDialogOrderId.value = '';
  returnDialogLastOrderItem.value = false;
  returnDialogLastTableItem.value = false;
}

function cancelReturn() {
  if (adjustmentLoadingId.value) return;
  if (pendingReturnMutation.value) {
    uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
    return;
  }
  clearReturnDialog();
}

async function confirmReturn(returnQuantity: number) {
  const orderId = returnDialogOrderId.value || dineInOrder.value?.id;
  const item = returnDialogItem.value;
  if (!orderId || !item || adjustmentLoadingId.value || writeDisabled.value) return;
  const mutation = getOrCreatePendingReturnMutation(pendingReturnMutation.value, {
    orderId,
    itemId: item.id,
    expectedQuantity: Number(item.quantity || 0),
    returnQuantity,
  });
  if (!mutation) return;
  pendingReturnMutation.value = mutation;
  adjustmentLoadingId.value = item.id;
  try {
    const result = await returnMerchantOrderItem(orderId, item.id, {
      requestKey: mutation.requestKey,
      expectedQuantity: mutation.expectedQuantity,
      returnQuantity: mutation.returnQuantity,
    });
    applyItemMutation(result);
    clearReturnDialog();
    pendingReturnMutation.value = null;
  } catch (caught) {
    if (!isDefinitiveMutationRejection(caught)) {
      await refreshAdjustmentContext(true);
      uiStore.pushToast(t('mutation.outcomeUncertain'), 'warning');
    } else {
      uiStore.pushToast(t(apiErrorTranslationKey(caught, 'itemAdjustment.returnFailed')), 'error');
      clearReturnDialog();
      pendingReturnMutation.value = null;
    }
  } finally {
    adjustmentLoadingId.value = '';
  }
}

function protectUnload(event: BeforeUnloadEvent) {
  if (!unresolvedMutation.value) return;
  event.preventDefault();
  event.returnValue = '';
}

function guardMutationNavigation(destinationName: string | symbol | null | undefined) {
  const blocked = shouldBlockCashierMutationNavigation({
    unresolvedMutation: unresolvedMutation.value,
    authenticated: authStore.isAuthenticated,
    destinationName,
  });
  if (!blocked) return true;
  uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
  return false;
}

onBeforeRouteUpdate((to) => guardMutationNavigation(to.name));
onBeforeRouteLeave((to) => guardMutationNavigation(to.name));

watch(() => [route.params.tableId, route.query.order], () => void syncRouteSelection(), { immediate: true });
watch(selectedTableId, () => {
  orderingDraftLines.value = [];
  pendingDecreaseConfirm.value = null;
});
onMounted(() => {
  window.addEventListener('beforeunload', protectUnload);
  void refresh(false);
});
onBeforeUnmount(() => window.removeEventListener('beforeunload', protectUnload));
</script>

<template>
  <section
    class="cashier-workspace cashier-workspace--table-overview table-overview-route"
    :class="{
      'has-selection': Boolean(selectedTableId),
      'is-menu-tab': activeMainTab === 'MENU',
    }"
    data-page="TableOverviewPage"
    data-testid="table-overview-workspace"
  >
    <div class="cashier-workspace__content cashier-workspace__content--table-overview">
      <header v-if="activeMainTab === 'TABLES'" class="table-main-toolbar">
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
          v-if="selectedTable && selectedTable.status !== 'DISABLED'"
          :key="selectedTable.id"
          ref="orderingWorkspace"
          open
          embedded
          :table-id="selectedTable.id"
          :table-label="session?.tableNo || selectedTable.tableNo || t('table.numberFallback')"
          :session-id="session?.id || ''"
          :disabled="writeDisabled"
          :top-dialog-open="topOrderingDialogOpen"
          :product-quantities="orderingProductQuantities"
          @close="closeOrdering"
          @created="handleTableOrderCreated"
          @failed="handleOrderingFailure"
          @mutation-lock-changed="orderingMutationLocked = $event"
          @draft-changed="handleDraftChanged"
        />
        <EmptyState v-else :title="t('cashierV2.menuNeedsTableTitle')" :description="t('cashierV2.menuNeedsTableDescription')" />
      </div>
    </div>

    <aside class="table-route-detail" :class="{ 'table-route-detail--open': Boolean(selectedTableId) && activeMainTab === 'TABLES' }" data-testid="table-route-detail">
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
        :actions-disabled="writeDisabled || orderingMutationLocked || Boolean(adjustmentLoadingId) || settlementAdjustmentLoading"
        :adjustment-loading-id="adjustmentLoadingId"
        :pending-adjustment-item-id="pendingDecreaseMutation?.itemId"
        :adjustment-applied="Boolean(session?.discountPayableRateBps != null || session?.roundingApplied)"
        :payable-amount="session?.payableAmountVnd || session?.totalAmountVnd || '0'"
        :transfer-disabled="!session || !transferTargets.length"
        :draft-lines="orderingDraftLines"
        @order-items="openOrdering"
        @decrease-item="handleCommittedDecrease"
        @increase-item="increaseCommittedItem"
        @transfer="openTransfer"
        @checkout="checkoutConfirmOpen = true"
        @adjustment="openSettlementAdjustment"
      />
    </aside>
    <PendingDecreaseRecovery :open="Boolean(pendingDecreaseMutation) && !adjustmentLoadingId" :loading="Boolean(adjustmentLoadingId)" :disabled="writeDisabled" @retry="pendingDecreaseMutation && executeDecrease(pendingDecreaseMutation)" />
    <ConfirmDialog
      :open="Boolean(pendingDecreaseConfirm)"
      :title="t('itemAdjustment.removeLastTitle')"
      :description="t('itemAdjustment.removeLastDescription')"
      :cancel-label="t('common.cancel')"
      :confirm-label="t('itemAdjustment.removeLastConfirm')"
      :loading="Boolean(adjustmentLoadingId)"
      @cancel="cancelPendingDecreaseConfirm"
      @confirm="confirmPendingDecrease"
    />
    <ReturnItemDialog :open="Boolean(returnDialogItem) && !directReturnInFlight" :item="returnDialogItem" :loading="Boolean(adjustmentLoadingId)" :disabled="writeDisabled" :outcome-uncertain="Boolean(pendingReturnMutation) && !adjustmentLoadingId" :fixed-quantity="pendingReturnMutation?.returnQuantity" :last-order-item="returnDialogLastOrderItem" :last-table-item="returnDialogLastTableItem" @cancel="cancelReturn" @confirm="confirmReturn" />
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
