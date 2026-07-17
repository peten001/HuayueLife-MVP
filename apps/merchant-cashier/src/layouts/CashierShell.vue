<script setup lang="ts">
import { X } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { useI18n } from '@/i18n';
import {
  currentBusinessHoursRange,
  getOrCreatePendingDecreaseMutation,
  getOrCreatePendingReturnMutation,
  hasUnresolvedCashierMutation,
  isPendingDecreaseInlineRetryReachable,
  isWithinBusinessHours,
  resolveMediaUrl,
  shouldBlockCashierMutationNavigation,
  type PendingDecreaseMutation,
  type PendingReturnMutation,
} from '@/domain';
import {
  apiErrorTranslationKey,
  CashierApiError,
  decreaseMerchantOrderItem,
  isDefinitiveMutationRejection,
  isMutationOutcomeUncertain,
  returnMerchantOrderItem,
  shouldRefreshAfterItemAdjustmentError,
} from '@/api';
import {
  useAuthStore,
  useNetworkStore,
  useOrdersStore,
  usePrintingStore,
  useSoundStore,
  useTablesStore,
  useUiStore,
} from '@/stores';
import type {
  CashierOrderAction,
  CashierOrderItemView,
} from '@/components/common/view-models';
import type { MerchantOrderMutationResult, TableSessionOrder } from '@/types';
import CashierSidebar from '@/components/shell/CashierSidebar.vue';
import CashierHeader from '@/components/shell/CashierHeader.vue';
import CashierMobileNavigation from '@/components/shell/CashierMobileNavigation.vue';
import OrientationNotice from '@/components/shell/OrientationNotice.vue';
import OrderDetailPanel from '@/components/orders/OrderDetailPanel.vue';
import PendingDecreaseRecovery from '@/components/orders/PendingDecreaseRecovery.vue';
import TableBillDetail from '@/components/bills/TableBillDetail.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';
import ToastRegion from '@/components/common/ToastRegion.vue';
import TableOrderingWorkspace from '@/components/ordering/TableOrderingWorkspace.vue';
import ReturnItemDialog from '@/components/orders/ReturnItemDialog.vue';
import { guardNetworkWrite, networkWritesDisabled } from './network-write-guard';

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const authStore = useAuthStore();
const ordersStore = useOrdersStore();
const printingStore = usePrintingStore();
const tablesStore = useTablesStore();
const networkStore = useNetworkStore();
const soundStore = useSoundStore();
const uiStore = useUiStore();
const { session, profile, isAuthenticated, demoMode } = storeToRefs(authStore);
const { pendingOrders, activeOrders, selectedOrder, actionLoadingId } = storeToRefs(ordersStore);
const { tableCards, selectedTable, selectedSessionDetail } = storeToRefs(tablesStore);
const { online, apiReachable } = storeToRefs(networkStore);
const { enabled: soundEnabled, supported: soundSupported, lastError: soundError } = storeToRefs(soundStore);
const { availability: printingAvailability } = storeToRefs(printingStore);
const { detailOpen } = storeToRefs(uiStore);
const loggingOut = ref(false);
const closingSession = ref(false);
const closeDialogOpen = ref(false);
const pendingOrderAction = ref<CashierOrderAction | null>(null);
const orderingOpen = ref(false);
const orderingMutationLocked = ref(false);
const adjustmentLoadingId = ref('');
const pendingDecreaseMutation = ref<PendingDecreaseMutation | null>(null);
const returnDialogItem = ref<CashierOrderItemView | null>(null);
const pendingReturnMutation = ref<PendingReturnMutation | null>(null);
let printingStatusTimer: number | undefined;

const identity = computed(() => ({
  merchantName:
    (locale.value === 'vi' ? profile.value?.nameVi : locale.value === 'en' ? profile.value?.nameEn : profile.value?.nameZh)
    || profile.value?.nameZh
    || session.value?.merchant.nameZh
    || '',
  role: session.value?.role,
  merchantLogoUrl: resolveMediaUrl(profile.value?.logoUrl),
}));
const availableTableCount = computed(
  () => tableCards.value.filter((table) => table.operationalStatus === 'AVAILABLE').length,
);
const inUseTableCount = computed(
  () => tableCards.value.filter((table) => table.operationalStatus === 'IN_USE').length,
);
const disabledTableCount = computed(
  () => tableCards.value.filter((table) => table.operationalStatus === 'DISABLED').length,
);
const showingTableDetail = computed(() => route.path === '/tables');
const plannedHoursRange = computed(() => currentBusinessHoursRange(profile.value?.businessHours));
const plannedBusinessOpen = computed<boolean | null>(() =>
  profile.value ? isWithinBusinessHours(profile.value.businessHours) : null,
);
const writeActionsDisabled = computed(() =>
  !demoMode.value && networkWritesDisabled(online.value, apiReachable.value),
);
const returnOutcomeUncertain = computed(() =>
  Boolean(pendingReturnMutation.value) && !adjustmentLoadingId.value,
);
const decreaseOutcomeUncertain = computed(() =>
  Boolean(pendingDecreaseMutation.value) && !adjustmentLoadingId.value,
);
const decreaseInlineRetryReachable = computed(() => {
  if (!decreaseOutcomeUncertain.value) return false;
  return isPendingDecreaseInlineRetryReachable({
    pending: pendingDecreaseMutation.value,
    selectedOrder: selectedOrder.value,
    detailOpen: detailOpen.value,
    showingTableDetail: showingTableDetail.value,
  });
});
const showPendingDecreaseRecovery = computed(() =>
  decreaseOutcomeUncertain.value && !decreaseInlineRetryReachable.value,
);
const mutationNavigationBlocked = computed(() =>
  hasUnresolvedCashierMutation({
    orderingLocked: orderingMutationLocked.value,
    pendingDecrease: pendingDecreaseMutation.value,
    pendingReturn: pendingReturnMutation.value,
  }),
);
const businessHoursLabel = computed(() => {
  if (!profile.value) return t('shell.businessHoursUnknown');
  if (!plannedHoursRange.value) return t('shell.businessClosed');
  return `${t(plannedBusinessOpen.value ? 'shell.businessOpen' : 'shell.businessClosed')} · ${plannedHoursRange.value}`;
});
const confirmationTitle = computed(() => {
  if (closeDialogOpen.value) return t('table.closeConfirmTitle');
  return t(pendingOrderAction.value === 'reject' ? 'order.rejectConfirmTitle' : 'order.completeConfirmTitle');
});
const confirmationDescription = computed(() => {
  if (closeDialogOpen.value) return t('table.closeConfirmDescription');
  return t(pendingOrderAction.value === 'reject' ? 'order.rejectConfirmDescription' : 'order.completeConfirmDescription');
});

async function logout() {
  if (loggingOut.value) return;
  if (mutationNavigationBlocked.value) {
    uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
    return;
  }
  loggingOut.value = true;
  try {
    ordersStore.stopLivePolling();
    tablesStore.stopLivePolling();
    ordersStore.clear();
    tablesStore.clear();
    printingStore.clear();
    uiStore.closeDetail();
    orderingOpen.value = false;
    pendingDecreaseMutation.value = null;
    returnDialogItem.value = null;
    pendingReturnMutation.value = null;
    await authStore.logout();
    await router.replace('/login');
  } finally {
    loggingOut.value = false;
  }
}

function openOrdering() {
  if (!networkWriteAvailable()) return;
  if (!selectedTable.value || selectedSessionDetail.value?.status !== 'OPEN') {
    uiStore.pushToast(t('itemAdjustment.tableSessionClosed'), 'error');
    void tablesStore.fetchTables();
    return;
  }
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
  ordersStore.applyOrderSnapshot(result.order);
  tablesStore.applySessionSnapshot(result.session);
}

async function handleTableOrderCreated(result: MerchantOrderMutationResult) {
  applyItemMutation(result);
  orderingOpen.value = false;
  await router.push('/orders/new');
  ordersStore.applyOrderSnapshot(result.order, true);
  uiStore.openDetail('order', result.order.id);
  uiStore.pushToast(t('ordering.success'), 'success');
  void refreshAdjustmentContext();
}

async function refreshAdjustmentContext(force = false) {
  await Promise.allSettled([
    ordersStore.refreshLiveOrders({ force }),
    tablesStore.fetchTables({ force }),
  ]);
}

async function handleOrderingFailure(error: unknown) {
  await refreshAdjustmentContext(
    isMutationOutcomeUncertain(error) || shouldRefreshAfterItemAdjustmentError(error),
  );
  if (error instanceof CashierApiError && [
    'TABLE_SESSION_NOT_OPEN',
    'TABLE_SESSION_CLOSED',
    'TABLE_NOT_AVAILABLE',
    'TABLE_NOT_FOUND',
  ].includes(error.code)) {
    orderingOpen.value = false;
  }
}

async function decreaseItem(item: CashierOrderItemView) {
  const order = selectedOrder.value;
  const expectedQuantity = Number(item.quantity || 0);
  if (!order || adjustmentLoadingId.value || expectedQuantity < 1) return;
  if (!networkWriteAvailable()) return;
  const mutation = getOrCreatePendingDecreaseMutation(pendingDecreaseMutation.value, {
    orderId: order.id,
    itemId: item.id,
    expectedQuantity,
  });
  if (!mutation) {
    uiStore.pushToast(t('itemAdjustment.pendingOtherItem'), 'warning');
    return;
  }
  pendingDecreaseMutation.value = mutation;
  await executePendingDecrease(mutation);
}

async function retryPendingDecrease() {
  const mutation = pendingDecreaseMutation.value;
  if (!mutation || adjustmentLoadingId.value) return;
  if (!networkWriteAvailable()) return;
  await executePendingDecrease(mutation);
}

async function executePendingDecrease(mutation: PendingDecreaseMutation) {
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
  } catch (error) {
    if (!isDefinitiveMutationRejection(error)) {
      await refreshAdjustmentContext(true);
      uiStore.pushToast(t('mutation.outcomeUncertain'), 'warning');
    } else {
      pendingDecreaseMutation.value = null;
      uiStore.pushToast(t(apiErrorTranslationKey(error, 'itemAdjustment.decreaseFailed')), 'error');
      if (shouldRefreshAfterItemAdjustmentError(error)) await refreshAdjustmentContext(true);
    }
  } finally {
    adjustmentLoadingId.value = '';
  }
}

function requestReturnItem(item: CashierOrderItemView) {
  if (!networkWriteAvailable()) return;
  if (pendingDecreaseMutation.value) {
    uiStore.pushToast(t('itemAdjustment.pendingOtherItem'), 'warning');
    return;
  }
  returnDialogItem.value = item;
  pendingReturnMutation.value = null;
}

function cancelReturnItem() {
  if (adjustmentLoadingId.value) return;
  if (pendingReturnMutation.value) {
    uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
    return;
  }
  returnDialogItem.value = null;
}

async function confirmReturnItem(returnQuantity: number) {
  const order = selectedOrder.value;
  const item = returnDialogItem.value;
  const expectedQuantity = Number(item?.quantity || 0);
  if (!order || !item || adjustmentLoadingId.value || expectedQuantity < 1) return;
  if (!networkWriteAvailable()) return;
  const mutation = getOrCreatePendingReturnMutation(pendingReturnMutation.value, {
    orderId: order.id,
    itemId: item.id,
    expectedQuantity,
    returnQuantity,
  });
  if (!mutation) {
    uiStore.pushToast(t('itemAdjustment.pendingOtherItem'), 'warning');
    return;
  }
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
  } catch (error) {
    if (!isDefinitiveMutationRejection(error)) {
      await refreshAdjustmentContext(true);
      uiStore.pushToast(t('mutation.outcomeUncertain'), 'warning');
    } else {
      uiStore.pushToast(t(apiErrorTranslationKey(error, 'itemAdjustment.returnFailed')), 'error');
      if (shouldRefreshAfterItemAdjustmentError(error)) await refreshAdjustmentContext(true);
      returnDialogItem.value = null;
      pendingReturnMutation.value = null;
    }
  } finally {
    adjustmentLoadingId.value = '';
  }
}

async function toggleSound() {
  if (soundEnabled.value) {
    soundStore.disable();
    return;
  }
  await soundStore.enable();
}

function networkWriteAvailable() {
  if (demoMode.value) return true;
  return guardNetworkWrite(online.value, apiReachable.value, () => {
    uiStore.pushToast(t('error.network'), 'error');
  });
}

function requestOrderAction(action: CashierOrderAction) {
  if (!networkWriteAvailable()) return;
  if (action === 'reject' || action === 'complete') {
    pendingOrderAction.value = action;
    return;
  }
  void executeOrderAction(action);
}

async function executeOrderAction(action: CashierOrderAction) {
  if (!selectedOrder.value || actionLoadingId.value) return;
  if (!networkWriteAvailable()) return;
  try {
    await ordersStore.runAction(selectedOrder.value.id, action);
    await Promise.allSettled([ordersStore.refreshLiveOrders(), tablesStore.fetchTables()]);
    uiStore.pushToast(t('order.actionSuccess'), 'success');
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'order.actionFailed')), 'error');
  } finally {
    pendingOrderAction.value = null;
  }
}

function requestCloseSession() {
  if (!networkWriteAvailable()) return;
  closeDialogOpen.value = true;
}

async function closeSession() {
  if (closingSession.value) return;
  if (!networkWriteAvailable()) return;
  closingSession.value = true;
  try {
    await tablesStore.closeSelectedSession();
    closeDialogOpen.value = false;
    tablesStore.clearSelection();
    uiStore.closeDetail();
    await router.replace({ path: '/tables', query: {} });
    uiStore.pushToast(t('table.closeSuccess'), 'success');
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'table.closeFailed')), 'error');
  } finally {
    closingSession.value = false;
  }
}

async function confirmCurrentAction() {
  if (closeDialogOpen.value) await closeSession();
  else if (pendingOrderAction.value) await executeOrderAction(pendingOrderAction.value);
}

function cancelConfirmation() {
  closeDialogOpen.value = false;
  pendingOrderAction.value = null;
}

async function openNewOrders() {
  await router.push('/orders/new');
}

async function openTableOrder(order: TableSessionOrder) {
  const path = order.status === 'PENDING_ACCEPTANCE'
    ? '/orders/new'
    : ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'].includes(order.status)
      ? '/orders/active'
      : '/orders/history';
  await router.push(path);
  try {
    await ordersStore.selectOrder(order.id);
    uiStore.openDetail('order', order.id);
  } catch {
    uiStore.pushToast(t('error.operationFailed'), 'error');
  }
}

async function recoverData() {
  await Promise.allSettled([
    ...(profile.value ? [] : [authStore.refreshProfile()]),
    ordersStore.refreshLiveOrders(),
    tablesStore.fetchTables(),
    printingStore.refreshStatus(),
  ]);
}

function protectUnresolvedMutation(event: BeforeUnloadEvent) {
  if (!mutationNavigationBlocked.value) return;
  event.preventDefault();
  event.returnValue = '';
}

watch(isAuthenticated, async (authenticated) => {
  if (!authenticated && !loggingOut.value) {
    ordersStore.clear();
    tablesStore.clear();
    uiStore.closeDetail();
    await router.replace({ path: '/login', query: { expired: '1' } });
  }
});

watch(
  () => [online.value, apiReachable.value] as const,
  ([nextOnline, nextApi], previous) => {
    const recovered = nextOnline && nextApi !== false && previous && (!previous[0] || previous[1] === false);
    if (recovered) void recoverData();
  },
);

function guardUnresolvedMutationNavigation(destinationName: string | symbol | null | undefined) {
  const blocked = shouldBlockCashierMutationNavigation({
    unresolvedMutation: mutationNavigationBlocked.value,
    authenticated: isAuthenticated.value,
    destinationName,
  });
  if (!blocked) return true;
  uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
  return false;
}

onBeforeRouteUpdate((to) => guardUnresolvedMutationNavigation(to.name));
onBeforeRouteLeave((to) => guardUnresolvedMutationNavigation(to.name));

watch(soundError, (error) => {
  if (error) uiStore.pushToast(t('sound.unlockFailed'), 'warning');
});

watch(
  () => route.path,
  (nextPath, previousPath) => {
    if (nextPath === previousPath) return;
    uiStore.closeDetail();
    if (nextPath !== '/tables') void ordersStore.selectOrder(null);
    if (nextPath !== '/tables') orderingOpen.value = false;
  },
);

onMounted(async () => {
  window.addEventListener('beforeunload', protectUnresolvedMutation);
  networkStore.start();
  ordersStore.startLivePolling();
  tablesStore.startLivePolling();
  await Promise.allSettled([
    ordersStore.refreshLiveOrders(),
    ordersStore.fetchHistory(),
    printingStore.refreshStatus(),
  ]);
  printingStatusTimer = window.setInterval(() => {
    if (online.value) void printingStore.refreshStatus().catch(() => undefined);
  }, 15_000);
});

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', protectUnresolvedMutation);
  ordersStore.stopLivePolling();
  tablesStore.stopLivePolling();
  networkStore.stop();
  if (printingStatusTimer !== undefined) window.clearInterval(printingStatusTimer);
});
</script>

<template>
  <div class="cashier-shell">
    <CashierSidebar
      :merchant-name="identity.merchantName"
      :merchant-logo-url="identity.merchantLogoUrl"
      :business-open="plannedBusinessOpen"
      :business-hours-label="businessHoursLabel"
      :demo-mode="demoMode"
      :role="identity.role"
      :logging-out="loggingOut"
      :new-order-count="pendingOrders.length"
      :active-order-count="activeOrders.length"
      @logout="logout"
    />

    <CashierHeader
      :total-table-count="tableCards.length"
      :available-table-count="availableTableCount"
      :in-use-table-count="inUseTableCount"
      :disabled-table-count="disabledTableCount"
      :new-order-count="pendingOrders.length"
      :online="online"
      :api-reachable="apiReachable"
      :reconnecting="online && apiReachable === null"
      :sound-enabled="soundEnabled"
      :sound-supported="soundSupported"
      :printing-availability="printingAvailability"
      @open-new-orders="openNewOrders"
      @toggle-sound="toggleSound"
      @fullscreen-error="uiStore.pushToast(t('error.operationFailed'), 'warning')"
    />

    <main class="cashier-shell__route">
      <OrientationNotice />
      <RouterView />
    </main>

    <aside class="cashier-shell__detail" :class="{ 'cashier-shell__detail--open': detailOpen }">
      <button
        v-if="detailOpen"
        type="button"
        class="shell-detail-scrim"
        :aria-label="t('common.closeDetail')"
        @click="uiStore.closeDetail()"
      />
      <div class="cashier-shell__detail-panel">
        <button
          type="button"
          class="detail-close-button shell-detail-close"
          :aria-label="t('common.closeDetail')"
          @click="uiStore.closeDetail()"
        ><X :size="18" aria-hidden="true" /></button>
        <TableBillDetail
          v-if="showingTableDetail"
          :table="selectedTable"
          :session="selectedSessionDetail"
          :closing="closingSession"
          :actions-disabled="writeActionsDisabled"
          @close-session="requestCloseSession"
          @open-order="openTableOrder"
          @order-items="openOrdering"
        />
        <OrderDetailPanel
          v-else-if="selectedOrder"
          :order="selectedOrder"
          :action-loading="actionLoadingId === selectedOrder.id"
          :actions-disabled="writeActionsDisabled"
          :adjustment-loading-id="adjustmentLoadingId"
          :pending-adjustment-item-id="pendingDecreaseMutation?.itemId"
          @action="requestOrderAction"
          @decrease-item="decreaseItem"
          @return-item="requestReturnItem"
        />
        <EmptyState
          v-else
          :title="t('common.detailEmptyTitle')"
          :description="t('common.detailEmptyDescription')"
        />
      </div>
    </aside>

    <CashierMobileNavigation />

    <ToastRegion />

    <PendingDecreaseRecovery
      :open="showPendingDecreaseRecovery"
      :loading="Boolean(adjustmentLoadingId)"
      :disabled="writeActionsDisabled"
      @retry="retryPendingDecrease"
    />

    <TableOrderingWorkspace
      :open="orderingOpen"
      :table-id="selectedTable?.id || ''"
      :table-label="selectedSessionDetail?.tableNo || selectedTable?.tableNo || t('table.numberFallback')"
      :session-id="selectedSessionDetail?.id || ''"
      :disabled="writeActionsDisabled"
      @close="closeOrdering"
      @created="handleTableOrderCreated"
      @failed="handleOrderingFailure"
      @mutation-lock-changed="orderingMutationLocked = $event"
    />

    <ReturnItemDialog
      :open="Boolean(returnDialogItem)"
      :item="returnDialogItem"
      :loading="Boolean(adjustmentLoadingId)"
      :disabled="writeActionsDisabled"
      :outcome-uncertain="returnOutcomeUncertain"
      :fixed-quantity="pendingReturnMutation?.returnQuantity"
      @cancel="cancelReturnItem"
      @confirm="confirmReturnItem"
    />

    <ConfirmDialog
      :open="closeDialogOpen || Boolean(pendingOrderAction)"
      :title="confirmationTitle"
      :description="confirmationDescription"
      :cancel-label="t('common.cancel')"
      :confirm-label="t('common.confirm')"
      :loading="closingSession || Boolean(actionLoadingId)"
      :confirm-disabled="writeActionsDisabled"
      @cancel="cancelConfirmation"
      @confirm="confirmCurrentAction"
    />
  </div>
</template>
