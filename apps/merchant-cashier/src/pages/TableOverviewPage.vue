<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue';
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
  setTableSessionRounding,
  shouldRefreshAfterItemAdjustmentError,
} from '@/api';
import {
  getOrCreatePendingDecreaseMutation,
  getOrCreatePendingReturnMutation,
  canCheckoutTableSession,
  hasUnresolvedCashierMutation,
  shouldBlockCashierMutationNavigation,
  type PendingDecreaseMutation,
  type PendingReturnMutation,
} from '@/domain';
import { useI18n } from '@/i18n';
import { useAuthStore, useNetworkStore, useOrdersStore, useTablesStore, useUiStore } from '@/stores';
import type { MerchantOrderMutationResult, OrderItem, TableSessionOrder } from '@/types';
import type { CashierOrderItemView } from '@/components/common/view-models';
import { networkWritesDisabled } from '@/layouts/network-write-guard';
import LoadingState from '@/components/common/LoadingState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';
import TableOrderingWorkspace from '@/components/ordering/TableOrderingWorkspace.vue';
import ReturnItemDialog from '@/components/orders/ReturnItemDialog.vue';
import PendingDecreaseRecovery from '@/components/orders/PendingDecreaseRecovery.vue';
import TableBillDetail from '@/components/bills/TableBillDetail.vue';
import TableGrid from '@/components/tables/TableGrid.vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const authStore = useAuthStore();
const networkStore = useNetworkStore();
const ordersStore = useOrdersStore();
const tablesStore = useTablesStore();
const uiStore = useUiStore();
const { online, apiReachable } = storeToRefs(networkStore);
const { tableCards, selectedTableId, selectedTable, selectedSessionDetail, loading, detailLoading, checkingOut, errorKey } = storeToRefs(tablesStore);
const { selectedOrder, actionLoadingId } = storeToRefs(ordersStore);
const checkoutConfirmOpen = ref(false);
const orderingOpen = ref(false);
const orderingMutationLocked = ref(false);
const adjustmentLoadingId = ref('');
const pendingDecreaseMutation = ref<PendingDecreaseMutation | null>(null);
const returnDialogItem = ref<CashierOrderItemView | null>(null);
const pendingReturnMutation = ref<PendingReturnMutation | null>(null);
let routeSequence = 0;

const writeDisabled = computed(() => !authStore.demoMode && networkWritesDisabled(online.value, apiReachable.value));
const session = computed(() => selectedSessionDetail.value);
const dineInOrder = computed(() => {
  const order = selectedOrder.value;
  if (!order || order.orderType !== 'DINE_IN') return null;
  if (order.tableId !== selectedTableId.value || order.tableSessionId !== session.value?.id) return null;
  return order;
});
const sessionOrders = computed(() => session.value?.orders || []);
const pendingSessionOrders = computed(() => sessionOrders.value.filter((order) => order.status === 'PENDING_ACCEPTANCE'));
const canCheckout = computed(() => canCheckoutTableSession(session.value));
const unresolvedMutation = computed(() => hasUnresolvedCashierMutation({
  orderingLocked: orderingMutationLocked.value,
  pendingDecrease: pendingDecreaseMutation.value,
  pendingReturn: pendingReturnMutation.value,
}));
const activeStatus = computed(() => {
  const status = route.query.status;
  return status === 'AVAILABLE' || status === 'IN_USE' || status === 'DISABLED' ? status : 'ALL';
});
const filteredTables = computed(() => {
  return tableCards.value.filter((table) => {
    if (activeStatus.value !== 'ALL' && table.operationalStatus !== activeStatus.value) return false;
    return true;
  });
});

async function toggleRounding() {
  if (!session.value || writeDisabled.value) return;
  try {
    const updated = await setTableSessionRounding(session.value.id, !session.value.roundingApplied);
    tablesStore.applySessionSnapshot(updated);
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'table.checkoutFailed')), 'error');
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
  await router.push({
    name: 'tables',
    params: { tableId },
    query: {},
  });
}

async function selectSessionOrder(order: TableSessionOrder) {
  if (!selectedTableId.value) return;
  await router.replace({ name: 'tables', params: { tableId: selectedTableId.value }, query: { order: order.id } });
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

async function acceptNextOrder() {
  if (writeDisabled.value || actionLoadingId.value) return;
  try {
    const target = dineInOrder.value?.status === 'PENDING_ACCEPTANCE'
      ? dineInOrder.value
      : pendingSessionOrders.value[0]
        ? await ordersStore.ensureOrder(pendingSessionOrders.value[0].id)
        : null;
    if (!target) return;
    await ordersStore.runAction(target.id, 'accept');
    await Promise.all([tablesStore.fetchTables({ force: true }), ordersStore.refreshLiveOrders({ force: true })]);
    const next = selectedSessionDetail.value?.orders.find((order) => order.status === 'PENDING_ACCEPTANCE');
    if (next) await selectSessionOrder(next);
    else {
      const current = selectedSessionDetail.value?.orders.find((order) => order.id === target.id) || selectedSessionDetail.value?.orders[0];
      if (current) await selectSessionOrder(current);
    }
    uiStore.pushToast(t('table.acceptSuccess'), 'success');
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'order.actionFailed')), 'error');
  }
}

async function checkout() {
  if (!canCheckout.value || writeDisabled.value || checkingOut.value) return;
  try {
    const result = await tablesStore.checkoutSelectedSession();
    result.orders.forEach((order) => ordersStore.applyOrderSnapshot(order));
    checkoutConfirmOpen.value = false;
    tablesStore.clearSelection();
    await ordersStore.selectOrder(null);
    await router.replace('/tables');
    uiStore.pushToast(t('table.checkoutSuccess'), 'success');
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'table.checkoutFailed')), 'error');
  }
}

function openOrdering() {
  if (writeDisabled.value || !selectedTable.value || selectedTable.value.status === 'DISABLED') return;
  orderingOpen.value = true;
}

function closeOrdering() {
  if (orderingMutationLocked.value) {
    uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
    return;
  }
  orderingOpen.value = false;
}

function applyItemMutation(result: MerchantOrderMutationResult) {
  if (result.order) ordersStore.applyOrderSnapshot(result.order, true);
  tablesStore.applySessionSnapshot(result.session);
}

async function handleTableOrderCreated(result: MerchantOrderMutationResult) {
  applyItemMutation(result);
  orderingOpen.value = false;
  if (result.order && selectedTableId.value) {
    await router.replace({ name: 'tables', params: { tableId: selectedTableId.value }, query: { order: result.order.id } });
  }
  uiStore.pushToast(t(result.order ? 'ordering.openTableAndOrderSuccess' : 'ordering.openSuccess'), 'success');
}

async function refreshAdjustmentContext(force = false) {
  await Promise.allSettled([ordersStore.refreshLiveOrders({ force }), tablesStore.fetchTables({ force })]);
}

async function handleOrderingFailure(caught: unknown) {
  await refreshAdjustmentContext(isMutationOutcomeUncertain(caught) || shouldRefreshAfterItemAdjustmentError(caught));
  if (caught instanceof CashierApiError && ['TABLE_SESSION_NOT_OPEN', 'TABLE_ALREADY_OPEN', 'TABLE_SESSION_CLOSED', 'TABLE_NOT_AVAILABLE', 'TABLE_NOT_FOUND'].includes(caught.code)) orderingOpen.value = false;
}

async function decreaseItem(item: OrderItem) {
  if (!dineInOrder.value || adjustmentLoadingId.value || writeDisabled.value) return;
  const mutation = getOrCreatePendingDecreaseMutation(pendingDecreaseMutation.value, {
    orderId: dineInOrder.value.id,
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
    uiStore.pushToast(t('itemAdjustment.decreaseSuccess'), 'success');
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

function requestReturn(item: OrderItem) {
  if (writeDisabled.value || pendingDecreaseMutation.value) return;
  returnDialogItem.value = item;
  pendingReturnMutation.value = null;
}

function cancelReturn() {
  if (adjustmentLoadingId.value) return;
  if (pendingReturnMutation.value) {
    uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
    return;
  }
  returnDialogItem.value = null;
}

async function confirmReturn(returnQuantity: number) {
  const order = dineInOrder.value;
  const item = returnDialogItem.value;
  if (!order || !item || adjustmentLoadingId.value || writeDisabled.value) return;
  const mutation = getOrCreatePendingReturnMutation(pendingReturnMutation.value, {
    orderId: order.id,
    itemId: item.id,
    expectedQuantity: Number(item.quantity || 0),
    returnQuantity,
  });
  if (!mutation) return;
  pendingReturnMutation.value = mutation;
  adjustmentLoadingId.value = item.id;
  try {
    const result = await returnMerchantOrderItem(order.id, item.id, {
      requestKey: mutation.requestKey,
      expectedQuantity: mutation.expectedQuantity,
      returnQuantity: mutation.returnQuantity,
    });
    applyItemMutation(result);
    returnDialogItem.value = null;
    pendingReturnMutation.value = null;
    uiStore.pushToast(t('itemAdjustment.returnSuccess'), 'success');
  } catch (caught) {
    if (!isDefinitiveMutationRejection(caught)) {
      await refreshAdjustmentContext(true);
      uiStore.pushToast(t('mutation.outcomeUncertain'), 'warning');
    } else {
      uiStore.pushToast(t(apiErrorTranslationKey(caught, 'itemAdjustment.returnFailed')), 'error');
      returnDialogItem.value = null;
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
onMounted(() => {
  window.addEventListener('beforeunload', protectUnload);
  void refresh(false);
});
onBeforeUnmount(() => window.removeEventListener('beforeunload', protectUnload));
</script>

<template>
  <section
    class="cashier-workspace cashier-workspace--table-overview table-overview-route"
    :class="{ 'has-selection': Boolean(selectedTableId) }"
    data-testid="table-overview-workspace"
  >
    <div class="cashier-workspace__content cashier-workspace__content--table-overview">
      <LoadingState v-if="loading && !tableCards.length" :label="t('table.loading')" />
      <ErrorState v-else-if="errorKey && !tableCards.length" :title="t('error.title')" :description="t(errorKey)" :retry-label="t('common.retry')" @retry="refresh(false)" />
      <TableGrid v-else :tables="filteredTables" :selected-table-id="selectedTableId" @select="selectTable" />
    </div>

    <aside class="table-route-detail" :class="{ 'table-route-detail--open': Boolean(selectedTableId) }" data-testid="table-route-detail">
      <button
        v-if="selectedTableId"
        type="button"
        class="table-route-detail__back"
        :aria-label="t('fulfillment.backToTables')"
        @click="router.push('/tables')"
      ><ArrowLeft :size="20" aria-hidden="true" /></button>
      <LoadingState v-if="detailLoading" :label="t('table.loading')" />
      <TableBillDetail
        v-else
        :table="selectedTable"
        :session="session"
        :order="dineInOrder"
        :accept-disabled="!pendingSessionOrders.length"
        :checkout-disabled="!canCheckout"
        :accepting="Boolean(actionLoadingId)"
        :checking-out="checkingOut"
        :actions-disabled="writeDisabled || Boolean(adjustmentLoadingId)"
        :adjustment-loading-id="adjustmentLoadingId"
        :pending-adjustment-item-id="pendingDecreaseMutation?.itemId"
        :rounding-applied="session?.roundingApplied"
        :rounding-amount="session?.roundingAmountVnd || '0'"
        :payable-amount="session?.payableAmountVnd || session?.totalAmountVnd || '0'"
        @order-items="openOrdering"
        @open-order="selectSessionOrder"
        @decrease-item="decreaseItem"
        @return-item="requestReturn"
        @accept="acceptNextOrder"
        @checkout="checkoutConfirmOpen = true"
        @rounding="toggleRounding"
      />
    </aside>

    <TableOrderingWorkspace :open="orderingOpen" :table-id="selectedTable?.id || ''" :table-label="session?.tableNo || selectedTable?.tableNo || t('table.numberFallback')" :session-id="session?.id || ''" :disabled="writeDisabled" @close="closeOrdering" @created="handleTableOrderCreated" @failed="handleOrderingFailure" @mutation-lock-changed="orderingMutationLocked = $event" />
    <PendingDecreaseRecovery :open="Boolean(pendingDecreaseMutation) && !adjustmentLoadingId" :loading="Boolean(adjustmentLoadingId)" :disabled="writeDisabled" @retry="pendingDecreaseMutation && executeDecrease(pendingDecreaseMutation)" />
    <ReturnItemDialog :open="Boolean(returnDialogItem)" :item="returnDialogItem" :loading="Boolean(adjustmentLoadingId)" :disabled="writeDisabled" :outcome-uncertain="Boolean(pendingReturnMutation) && !adjustmentLoadingId" :fixed-quantity="pendingReturnMutation?.returnQuantity" @cancel="cancelReturn" @confirm="confirmReturn" />
    <ConfirmDialog :open="checkoutConfirmOpen" :title="t('table.checkoutConfirmTitle')" :description="t('table.checkoutConfirmDescription')" :cancel-label="t('common.cancel')" :confirm-label="t('table.checkout')" :loading="checkingOut" :confirm-disabled="writeDisabled || !canCheckout" @cancel="checkoutConfirmOpen = false" @confirm="checkout" />
  </section>
</template>
