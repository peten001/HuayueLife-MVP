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
  setTableSessionSettlementAdjustment,
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
import SettlementAdjustmentDialog from '@/components/settlement/SettlementAdjustmentDialog.vue';

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
const { selectedOrder } = storeToRefs(ordersStore);
const checkoutConfirmOpen = ref(false);
const adjustmentOpen = ref(false);
const settlementAdjustmentLoading = ref(false);
const orderingOpen = ref(false);
const orderingMutationLocked = ref(false);
const adjustmentLoadingId = ref('');
const pendingDecreaseMutation = ref<PendingDecreaseMutation | null>(null);
const returnDialogItem = ref<CashierOrderItemView | null>(null);
const returnDialogOrderId = ref('');
const returnDialogLastOrderItem = ref(false);
const returnDialogLastTableItem = ref(false);
const pendingReturnMutation = ref<PendingReturnMutation | null>(null);
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

async function checkout() {
  if (!canCheckout.value || writeDisabled.value || checkingOut.value) return;
  try {
    const result = await tablesStore.checkoutSelectedSession();
    result.orders.forEach((order) => ordersStore.applyOrderSnapshot(order));
    checkoutConfirmOpen.value = false;
    tablesStore.clearSelection();
    await ordersStore.selectOrder(null);
    await router.replace('/tables');
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
  orderingOpen.value = false;
  if (result.order && selectedTableId.value) {
    await router.replace({ name: 'tables', params: { tableId: selectedTableId.value }, query: { order: result.order.id } });
  }
}

async function refreshAdjustmentContext(force = false) {
  await Promise.allSettled([ordersStore.refreshLiveOrders({ force }), tablesStore.fetchTables({ force })]);
}

async function handleOrderingFailure(caught: unknown) {
  await refreshAdjustmentContext(isMutationOutcomeUncertain(caught) || shouldRefreshAfterItemAdjustmentError(caught));
  if (caught instanceof CashierApiError && ['TABLE_SESSION_NOT_OPEN', 'TABLE_ALREADY_OPEN', 'TABLE_SESSION_CLOSED', 'TABLE_NOT_AVAILABLE', 'TABLE_NOT_FOUND'].includes(caught.code)) orderingOpen.value = false;
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
    data-page="TableOverviewPage"
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
      <LoadingState v-if="detailLoading && !selectedSessionDetail" :label="t('table.loading')" />
      <TableBillDetail
        v-else
        :table="selectedTable"
        :session="session"
        :checkout-disabled="!canCheckout"
        :checking-out="checkingOut"
        :actions-disabled="writeDisabled || Boolean(adjustmentLoadingId) || settlementAdjustmentLoading"
        :adjustment-loading-id="adjustmentLoadingId"
        :pending-adjustment-item-id="pendingDecreaseMutation?.itemId"
        :adjustment-applied="Boolean(session?.discountPayableRateBps != null || session?.roundingApplied)"
        :payable-amount="session?.payableAmountVnd || session?.totalAmountVnd || '0'"
        @order-items="openOrdering"
        @decrease-item="decreaseItem"
        @return-item="requestReturn"
        @checkout="checkoutConfirmOpen = true"
        @adjustment="openSettlementAdjustment"
      />
    </aside>

    <TableOrderingWorkspace :open="orderingOpen" :table-id="selectedTable?.id || ''" :table-label="session?.tableNo || selectedTable?.tableNo || t('table.numberFallback')" :session-id="session?.id || ''" :disabled="writeDisabled" @close="closeOrdering" @created="handleTableOrderCreated" @failed="handleOrderingFailure" @mutation-lock-changed="orderingMutationLocked = $event" />
    <PendingDecreaseRecovery :open="Boolean(pendingDecreaseMutation) && !adjustmentLoadingId" :loading="Boolean(adjustmentLoadingId)" :disabled="writeDisabled" @retry="pendingDecreaseMutation && executeDecrease(pendingDecreaseMutation)" />
    <ReturnItemDialog :open="Boolean(returnDialogItem)" :item="returnDialogItem" :loading="Boolean(adjustmentLoadingId)" :disabled="writeDisabled" :outcome-uncertain="Boolean(pendingReturnMutation) && !adjustmentLoadingId" :fixed-quantity="pendingReturnMutation?.returnQuantity" :last-order-item="returnDialogLastOrderItem" :last-table-item="returnDialogLastTableItem" @cancel="cancelReturn" @confirm="confirmReturn" />
    <ConfirmDialog :open="checkoutConfirmOpen" :title="t('table.checkoutConfirmTitle')" :description="t('table.checkoutConfirmDescription')" :cancel-label="t('common.cancel')" :confirm-label="t('table.checkout')" :loading="checkingOut" :confirm-disabled="writeDisabled || !canCheckout" @cancel="checkoutConfirmOpen = false" @confirm="checkout" />
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
  </section>
</template>
