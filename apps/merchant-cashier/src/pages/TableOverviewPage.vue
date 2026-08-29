<script setup lang="ts">
import { ArrowLeft, RefreshCw } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import {
  apiErrorTranslationKey,
  createMerchantTableOrder,
  isDefinitiveMutationRejection,
  isMutationOutcomeUncertain,
  releaseEmptyTableSession,
  setTableSessionSettlementAdjustment,
  transferTableSession,
} from '@/api';
import { createMutationKey, shouldBlockCashierMutationNavigation } from '@/domain';
import { useI18n } from '@/i18n';
import { useAuthStore, useCatalogStore, useNetworkStore, useOrdersStore, useTablesStore, useUiStore } from '@/stores';
import type { PaymentMethod, TableSessionOrder, TransferTableSessionInput } from '@/types';
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
import { useDineInCanonicalStateController, useMediaQuery } from '@/composables';
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
const releasingEmpty = ref(false);
const retainedRelease = ref<{ sessionId: string; expectedRevision: string; requestKey: string } | null>(null);
const retainedCheckout = ref<{ sessionId: string; paymentMethod: PaymentMethod; expectedRevision: string; requestKey: string } | null>(null);
let openingSession: Promise<void> | null = null;
let canonicalPollTimer: number | null = null;
let routeSequence = 0;

const writeDisabled = computed(() => !authStore.demoMode && networkWritesDisabled(online.value, apiReachable.value));
const routeTableId = computed(() => typeof route.params.tableId === 'string' ? route.params.tableId : '');
const session = computed(() => selectedSessionDetail.value);
const activeCatalogCategoryIds = computed(() => new Set(catalogStore.categories.filter((category) => category.isActive).map((category) => category.id)));
const orderableProducts = computed(() => catalogStore.products.filter((product) => product.status === 'ON_SALE' && activeCatalogCategoryIds.value.has(product.categoryId)));
const orderableProductIds = computed(() => new Set(orderableProducts.value.map((product) => product.id)));
const canonicalController = useDineInCanonicalStateController({
  sessionId: () => session.value?.id || '',
  disabled: () => writeDisabled.value,
  products: () => orderableProducts.value,
  confirmSameLineConflict: () => window.confirm(t('canonical.sameLineConflict')),
  onFailure: (caught) => {
    const uncertain = isMutationOutcomeUncertain(caught);
    uiStore.pushToast(t(uncertain ? 'mutation.outcomeUncertain' : apiErrorTranslationKey(caught, 'error.operationFailed')), uncertain ? 'warning' : 'error');
  },
});
const presentedCanonicalState = canonicalController.presentedState;
const orderingMutationPending = canonicalController.mutationPending;
const orderingMutationLocked = canonicalController.mutationLocked;
const orderingProductQuantities = canonicalController.productQuantities;
const canCheckout = computed(() => Boolean(
  session.value?.status === 'OPEN'
  && presentedCanonicalState.value
  && presentedCanonicalState.value.items.length > 0
  && BigInt(presentedCanonicalState.value.totals.payableAmountVnd) > 0n
  && presentedCanonicalState.value.blockers.length === 0,
));
const releaseEligible = computed(() => Boolean(
  session.value?.status === 'OPEN'
  && presentedCanonicalState.value
  && presentedCanonicalState.value.items.length === 0
  && presentedCanonicalState.value.totals.originalAmountVnd === '0'
  && presentedCanonicalState.value.totals.payableAmountVnd === '0'
  && presentedCanonicalState.value.blockers.length === 0,
));
const unresolvedMutation = computed(() => orderingMutationLocked.value || Boolean(pendingTransfer.value) || Boolean(retainedRelease.value) || Boolean(retainedCheckout.value));
const transferTargets = computed(() => tableCards.value.filter((table) => table.id !== selectedTableId.value && table.status === 'ACTIVE' && table.operationalStatus === 'AVAILABLE' && !table.currentSession));
const topOrderingDialogOpen = computed(() => Boolean(checkoutConfirmOpen.value || adjustmentOpen.value || transferOpen.value || canonicalController.uncertainBatch.value));
const activeStatus = computed(() => route.query.status === 'AVAILABLE' || route.query.status === 'IN_USE' ? route.query.status : 'ALL');
const availableTableCount = computed(() => tableCards.value.filter((table) => table.operationalStatus === 'AVAILABLE').length);
const inUseTableCount = computed(() => tableCards.value.filter((table) => table.operationalStatus === 'IN_USE').length);
const filteredTables = computed(() => tableCards.value.filter((table) => activeStatus.value === 'ALL' || table.operationalStatus === activeStatus.value));

async function reconcilePendingOrderingMutations() {
  if (!orderingMutationPending.value) return !orderingMutationLocked.value;
  const settled = await canonicalController.flush();
  if (settled) return true;
  uiStore.pushToast(t('mutation.outcomeUncertain'), 'warning');
  return false;
}

async function ensureOpenCanonicalSession() {
  if (session.value) {
    if (!canonicalController.canonicalState.value) await canonicalController.load(true);
    return;
  }
  if (!selectedTableId.value) return;
  if (!openingSession) {
    openingSession = (async () => {
      const result = await createMerchantTableOrder(selectedTableId.value, {
        idempotencyKey: createMutationKey('add'),
        items: [],
      });
      tablesStore.applySessionSnapshot(result.session);
      await canonicalController.load(true);
    })().finally(() => { openingSession = null; });
  }
  await openingSession;
}

async function addMenuProduct(productId: string) {
  if (writeDisabled.value) return;
  try {
    await ensureOpenCanonicalSession();
    canonicalController.addProduct(productId);
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'ordering.createFailed')), 'error');
    await refreshAdjustmentContext(true);
  }
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
    await canonicalController.load(true);
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
    if (session.value) await canonicalController.load(true);
  } catch {
    if (showToast && tableCards.value.length) uiStore.pushToast(t('error.refreshFailed'), 'error');
  }
}

async function selectTable(tableId: string) {
  const card = tableCards.value.find((table) => table.id === tableId);
  if (!card || !(await reconcilePendingOrderingMutations())) return;
  const view = resolveTableSelectionView(isMobile.value, card.operationalStatus);
  await router.push({ name: 'tables', params: { tableId }, query: view ? { view } : {} });
}

async function selectTableFilter(status: 'ALL' | 'IN_USE' | 'AVAILABLE') {
  const query = { ...route.query };
  delete query.status;
  if (status !== 'ALL') query.status = status;
  await router.replace({ name: 'tables', params: route.params, query });
}

async function selectSessionOrder(order: TableSessionOrder) {
  if (selectedTableId.value) await router.replace({ name: 'tables', params: { tableId: selectedTableId.value }, query: { ...route.query, order: order.id } });
}

async function syncRouteSelection() {
  const sequence = ++routeSequence;
  if (!tableCards.value.length) return;
  const tableId = typeof route.params.tableId === 'string' ? route.params.tableId : '';
  const orderId = typeof route.query.order === 'string' ? route.query.order : '';
  if (!tableId) {
    tablesStore.clearSelection();
    canonicalController.reset();
    await ordersStore.selectOrder(null);
    return;
  }
  if (!tableCards.value.some((table) => table.id === tableId)) {
    await router.replace('/tables');
    return;
  }
  if (selectedTableId.value !== tableId || selectedSessionDetail.value?.tableId !== tableId) await tablesStore.selectTable(tableId);
  if (sequence !== routeSequence) return;
  const fallbackOrder = selectedSessionDetail.value?.orders.find((order) => order.status === 'PENDING_ACCEPTANCE') || selectedSessionDetail.value?.orders[0];
  if (!orderId) {
    await ordersStore.selectOrder(null);
    return;
  }
  try {
    const loaded = await ordersStore.selectOrder(orderId);
    if (sequence !== routeSequence) return;
    if (!loaded || loaded.orderType !== 'DINE_IN' || loaded.tableId !== tableId) {
      if (fallbackOrder && fallbackOrder.id !== orderId) await selectSessionOrder(fallbackOrder);
      else await ordersStore.selectOrder(null);
    }
  } catch {
    if (sequence === routeSequence && fallbackOrder && fallbackOrder.id !== orderId) await selectSessionOrder(fallbackOrder);
  }
}

async function checkout(paymentMethod: PaymentMethod) {
  if (writeDisabled.value || checkingOut.value || !session.value) return;
  if (!(await reconcilePendingOrderingMutations())) return;
  if (!retainedCheckout.value) {
    const exact = await canonicalController.load(true);
    if (!exact || exact.items.length === 0 || exact.blockers.length > 0) return;
    retainedCheckout.value = {
      sessionId: session.value.id,
      paymentMethod,
      expectedRevision: exact.revision,
      requestKey: createMutationKey('checkout'),
    };
  }
  const intent = retainedCheckout.value;
  try {
    const result = await tablesStore.checkoutSelectedSession(intent.paymentMethod, {
      expectedRevision: intent.expectedRevision,
      requestKey: intent.requestKey,
    });
    retainedCheckout.value = null;
    result.orders.forEach((order) => ordersStore.applyOrderSnapshot(order));
    checkoutConfirmOpen.value = false;
    canonicalController.reset();
    tablesStore.clearSelection();
    await ordersStore.selectOrder(null);
    await router.replace('/tables');
  } catch (caught) {
    if (isDefinitiveMutationRejection(caught)) retainedCheckout.value = null;
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'table.checkoutFailed')), 'error');
    if (!isMutationOutcomeUncertain(caught)) await canonicalController.load(true).catch(() => undefined);
  }
}

async function openCheckout() {
  if (writeDisabled.value || checkingOut.value || !session.value) return;
  if (!(await reconcilePendingOrderingMutations())) return;
  const exact = await canonicalController.load(true);
  if (!exact || exact.items.length === 0 || exact.blockers.length > 0 || BigInt(exact.totals.payableAmountVnd) <= 0n) return;
  checkoutConfirmOpen.value = true;
}

async function releaseEmpty() {
  if (!session.value || writeDisabled.value || releasingEmpty.value) return;
  if (!(await reconcilePendingOrderingMutations())) return;
  if (!retainedRelease.value) {
    const exact = await canonicalController.load(true);
    if (!exact || exact.items.length > 0 || exact.totals.payableAmountVnd !== '0' || exact.blockers.length > 0) return;
    if (!window.confirm(t('canonical.releaseConfirm'))) return;
    retainedRelease.value = { sessionId: session.value.id, expectedRevision: exact.revision, requestKey: createMutationKey('release') };
  }
  releasingEmpty.value = true;
  try {
    const closed = await releaseEmptyTableSession(session.value.id, retainedRelease.value);
    retainedRelease.value = null;
    canonicalController.reset();
    tablesStore.applySessionSnapshot(closed);
    await tablesStore.fetchTables({ force: true });
    await router.replace('/tables');
  } catch (caught) {
    if (isDefinitiveMutationRejection(caught)) retainedRelease.value = null;
    uiStore.pushToast(t(isMutationOutcomeUncertain(caught) ? 'mutation.outcomeUncertain' : 'canonical.releaseFailed'), isMutationOutcomeUncertain(caught) ? 'warning' : 'error');
    if (!isMutationOutcomeUncertain(caught)) await canonicalController.load(true).catch(() => undefined);
  } finally {
    releasingEmpty.value = false;
  }
}

function replaceMainTab(tab: 'TABLES' | 'MENU') {
  const query = { ...route.query };
  if (tab === 'MENU') query.view = 'menu'; else delete query.view;
  return router.replace({ name: 'tables', params: route.params, query });
}
function openOrdering() { if (!writeDisabled.value && selectedTable.value?.status !== 'DISABLED') void replaceMainTab('MENU'); }
function closeOrdering() { if (!orderingMutationLocked.value) void replaceMainTab('TABLES'); else uiStore.pushToast(t('mutation.closeBlocked'), 'warning'); }

async function openTransfer() {
  if (!session.value || writeDisabled.value || !(await reconcilePendingOrderingMutations())) return;
  transferError.value = '';
  transferOpen.value = true;
}
function cancelTransfer() {
  if (transferLoading.value) return;
  if (pendingTransfer.value) return void uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
  transferOpen.value = false;
  transferError.value = '';
}
async function confirmTransfer(targetTableId: string) {
  if (!session.value || transferLoading.value || writeDisabled.value) return;
  if (pendingTransfer.value && pendingTransfer.value.targetTableId !== targetTableId) return void (transferError.value = t('tableTransfer.pendingOtherTarget'));
  pendingTransfer.value ??= { targetTableId, expectedSourceTableId: session.value.tableId, requestKey: createMutationKey('transfer') };
  transferLoading.value = true;
  transferError.value = '';
  try {
    const updated = await transferTableSession(session.value.id, pendingTransfer.value);
    pendingTransfer.value = null;
    tablesStore.applySessionSnapshot(updated);
    await canonicalController.load(true);
    transferOpen.value = false;
    await router.replace({ name: 'tables', params: { tableId: updated.tableId }, query: {} });
  } catch (caught) {
    if (isDefinitiveMutationRejection(caught)) pendingTransfer.value = null;
    transferError.value = isMutationOutcomeUncertain(caught) ? t('mutation.outcomeUncertain') : t(apiErrorTranslationKey(caught, 'tableTransfer.failed'));
    await refreshAdjustmentContext(true);
  } finally { transferLoading.value = false; }
}

async function refreshAdjustmentContext(force = false) {
  await Promise.allSettled([ordersStore.refreshLiveOrders({ force }), tablesStore.fetchTables({ force })]);
  if (session.value) await canonicalController.load(true).catch(() => undefined);
}
function protectUnload(event: BeforeUnloadEvent) { if (unresolvedMutation.value) { event.preventDefault(); event.returnValue = ''; } }
async function guardMutationNavigation(to: { name?: string | symbol | null; params: Record<string, unknown> }) {
  if (shouldBlockCashierMutationNavigation({ unresolvedMutation: unresolvedMutation.value, authenticated: authStore.isAuthenticated, destinationName: to.name })) {
    uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
    return false;
  }
  const destinationTableId = typeof to.params.tableId === 'string' ? to.params.tableId : '';
  if (orderingMutationPending.value && (destinationTableId !== routeTableId.value || to.name !== 'tables')) return reconcilePendingOrderingMutations();
  return true;
}

onBeforeRouteUpdate((to) => guardMutationNavigation(to));
onBeforeRouteLeave((to) => guardMutationNavigation(to));
watch(() => [route.params.tableId, route.query.order, tableCards.value.length], () => void syncRouteSelection(), { immediate: true });
watch(() => session.value?.id || '', async (sessionId, previous) => {
  if (sessionId === previous) return;
  canonicalController.reset();
  retainedRelease.value = null;
  retainedCheckout.value = null;
  if (sessionId) await canonicalController.load(true).catch(() => uiStore.pushToast(t('error.refreshFailed'), 'error'));
});
onMounted(() => {
  window.addEventListener('beforeunload', protectUnload);
  canonicalPollTimer = window.setInterval(() => {
    if (session.value && !orderingMutationPending.value && !orderingMutationLocked.value) void canonicalController.load(true).catch(() => undefined);
  }, 10_000);
});
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', protectUnload);
  if (canonicalPollTimer !== null) window.clearInterval(canonicalPollTimer);
});
</script>

<template>
  <section class="cashier-workspace cashier-workspace--table-overview table-overview-route" :class="{ 'has-selection': Boolean(routeTableId), 'is-menu-tab': activeMainTab === 'MENU' }" data-page="TableOverviewPage" data-testid="table-overview-workspace">
    <div class="cashier-workspace__content cashier-workspace__content--table-overview">
      <header v-if="activeMainTab === 'TABLES' && !isMobile" class="table-main-toolbar">
        <div class="table-filter-chips" :aria-label="t('stats.title')">
          <button type="button" data-testid="table-filter-all" :class="{ 'is-active': activeStatus === 'ALL' }" :aria-pressed="activeStatus === 'ALL'" @click="selectTableFilter('ALL')">{{ t('common.all') }} <b>{{ tableCards.length }}</b></button>
          <button type="button" data-testid="table-filter-in-use" :class="{ 'is-active': activeStatus === 'IN_USE' }" :aria-pressed="activeStatus === 'IN_USE'" @click="selectTableFilter('IN_USE')">{{ t('table.status.inUse') }} <b>{{ inUseTableCount }}</b></button>
          <button type="button" data-testid="table-filter-available" :class="{ 'is-active': activeStatus === 'AVAILABLE' }" :aria-pressed="activeStatus === 'AVAILABLE'" @click="selectTableFilter('AVAILABLE')">{{ t('table.status.available') }} <b>{{ availableTableCount }}</b></button>
          <button type="button" class="table-main-refresh" data-testid="table-main-refresh" :aria-label="t('common.refresh')" :title="t('common.refresh')" :disabled="loading" @click="refresh(true)"><RefreshCw :size="18" :class="{ spinning: loading }" aria-hidden="true" /></button>
        </div>
      </header>

      <div v-show="activeMainTab === 'TABLES'" class="table-main-pane table-main-pane--tables">
        <LoadingState v-if="loading && !tableCards.length" :label="t('table.loading')" />
        <ErrorState v-else-if="errorKey && !tableCards.length" :title="t('error.title')" :description="t(errorKey)" :retry-label="t('common.retry')" @retry="refresh(false)" />
        <TableGrid v-else :tables="filteredTables" :selected-table-id="selectedTableId" @select="selectTable" />
      </div>

      <div v-show="activeMainTab === 'MENU'" class="table-main-pane table-main-pane--menu">
        <TableOrderingWorkspace v-if="activeMainTab === 'MENU' && selectedTable && selectedTable.status !== 'DISABLED'" :key="selectedTable.id" open embedded :table-id="selectedTable.id" :table-label="session?.tableNo || selectedTable.tableNo || t('table.numberFallback')" :session-id="session?.id || ''" :disabled="writeDisabled" :top-dialog-open="topOrderingDialogOpen" :product-quantities="orderingProductQuantities" :mutation-locked="orderingMutationLocked" @close="closeOrdering" @add-product="addMenuProduct" />
        <EmptyState v-else-if="activeMainTab === 'MENU'" :title="t('cashierV2.menuNeedsTableTitle')" :description="t('cashierV2.menuNeedsTableDescription')" />
      </div>
    </div>

    <aside class="table-route-detail" :class="{ 'table-route-detail--open': Boolean(routeTableId) && activeMainTab === 'TABLES' }" data-testid="table-route-detail">
      <button v-if="selectedTableId && !isMobile" type="button" class="table-route-detail__back" :aria-label="t('fulfillment.backToTables')" @click="router.push('/tables')"><ArrowLeft :size="20" aria-hidden="true" /></button>
      <LoadingState v-if="detailLoading && !selectedSessionDetail" :label="t('table.loading')" />
      <TableBillDetail v-else :table="selectedTable" :session="session" :canonical-state="presentedCanonicalState" :checkout-disabled="!canCheckout" :checking-out="checkingOut" :actions-disabled="writeDisabled || orderingMutationLocked || settlementAdjustmentLoading" :item-actions-disabled="writeDisabled || orderingMutationLocked || settlementAdjustmentLoading" :orderable-product-ids="orderableProductIds" :adjustment-applied="Boolean(presentedCanonicalState?.totals.discountPayableRateBps != null || BigInt(presentedCanonicalState?.totals.roundingAmountVnd || '0') > 0n)" :transfer-disabled="!session || !transferTargets.length" :release-eligible="releaseEligible" :releasing="releasingEmpty" @order-items="openOrdering" @decrease-line="canonicalController.decreaseLine" @increase-line="canonicalController.increaseLine" @transfer="openTransfer" @checkout="openCheckout" @adjustment="openSettlementAdjustment" @release-empty="releaseEmpty" />
    </aside>

    <PendingDecreaseRecovery :open="Boolean(canonicalController.uncertainBatch.value)" :loading="canonicalController.syncing.value" :disabled="writeDisabled" @retry="canonicalController.retryUncertain" />
    <CheckoutPaymentDialog :open="checkoutConfirmOpen" :amount-vnd="presentedCanonicalState?.totals.payableAmountVnd || '0'" :loading="checkingOut" @cancel="checkoutConfirmOpen = false" @confirm="checkout" />
    <SettlementAdjustmentDialog v-if="session" :open="adjustmentOpen" :item-amount-vnd="presentedCanonicalState?.totals.originalAmountVnd || '0'" :discount-payable-rate-bps="presentedCanonicalState?.totals.discountPayableRateBps ?? null" :rounding-enabled="BigInt(presentedCanonicalState?.totals.roundingAmountVnd || '0') > 0n" :loading="settlementAdjustmentLoading" @cancel="adjustmentOpen = false" @confirm="saveSettlementAdjustment" />
    <TableTransferDialog :open="transferOpen" :source-label="session?.tableNo || selectedTable?.tableNo || t('table.numberFallback')" :targets="transferTargets" :loading="transferLoading" :error="transferError" @cancel="cancelTransfer" @confirm="confirmTransfer" />
  </section>
</template>
