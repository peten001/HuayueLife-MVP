<script setup lang="ts">
import { ArrowLeft, RefreshCw } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import {
  apiErrorTranslationKey,
  createMerchantTableOrder,
  isDefinitiveMutationRejection,
  isMutationOutcomeUncertain,
  notifyTableSessionProduction,
  setTableSessionSettlementAdjustment,
  transferTableSession,
} from '@/api';
import { createMutationKey, shouldBlockCashierMutationNavigation } from '@/domain';
import { useI18n } from '@/i18n';
import { useAuthStore, useCatalogStore, useNetworkStore, useOrdersStore, useTablesStore, useUiStore } from '@/stores';
import type { CreateMerchantTableOrderInput, PaymentMethod, TableSessionOrder, TransferTableSessionInput } from '@/types';
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
import { beginImmediateTableSelectionTransition } from '@/components/tables/table-selection-transition';
import {
  canonicalCashierRouteName,
  resolveCashierPresentationLocation,
} from '@/mobile-v2/navigation';

const props = withDefaults(defineProps<{
  mobileV2Presentation?: boolean;
}>(), {
  mobileV2Presentation: false,
});

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
const mobileV2PreviewRoute = computed(() => import.meta.env.DEV && route.meta.mobileV2Preview === true);
const mobileV2Presentation = computed(() => (
  props.mobileV2Presentation
  || mobileV2PreviewRoute.value
  || (isMobile.value && route.meta.mobileV2Enabled === true)
));
const { online, apiReachable } = storeToRefs(networkStore);
const { tableCards, selectedTableId, selectedTable, selectedSessionDetail, loading, detailLoading, checkingOut, errorKey } = storeToRefs(tablesStore);
const checkoutConfirmOpen = ref(false);
const adjustmentOpen = ref(false);
const settlementAdjustmentLoading = ref(false);
const productionNotificationLoading = ref(false);
const activeMainTab = computed<'TABLES' | 'MENU'>(() => route.query.view === 'menu' ? 'MENU' : 'TABLES');
const transferOpen = ref(false);
const transferLoading = ref(false);
const transferError = ref('');
const pendingTransfer = ref<TransferTableSessionInput | null>(null);
const retainedCheckout = ref<{ sessionId: string; paymentMethod: PaymentMethod; expectedRevision: string; requestKey: string } | null>(null);
const retainedProductionNotification = ref<{ sessionId: string; requestKey: string } | null>(null);
const pendingInitialItems = ref(new Map<string, number>());
const pendingInitialTableId = ref('');
const retainedInitialBatch = ref<{ tableId: string; input: CreateMerchantTableOrderInput } | null>(null);
const initialBatchSyncing = ref(false);
const resettingMenuSelection = ref(false);
const openingCurrentOrder = ref(false);
let initialBatchTimer: ReturnType<typeof setTimeout> | null = null;
let initialBatchRequest: Promise<void> | null = null;
let canonicalPollTimer: number | null = null;
let routeSequence = 0;
let sessionSequence = 0;

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
  onCommitted: (state) => {
    tablesStore.applyCanonicalTableSnapshot(state);
    if (
      state.tableId === selectedTableId.value
      && state.sessionStatus === 'CLOSED'
      && state.releasedBecause === 'EMPTY_AFTER_RECONCILE'
    ) {
      if (mobileV2Presentation.value && activeMainTab.value === 'MENU') return;
      window.setTimeout(() => {
        void router.replace(resolveCashierPresentationLocation(mobileV2PreviewRoute.value, '/tables'));
      }, 0);
    }
  },
  onFailure: (caught) => {
    const uncertain = isMutationOutcomeUncertain(caught);
    uiStore.pushToast(t(uncertain ? 'mutation.outcomeUncertain' : apiErrorTranslationKey(caught, 'error.operationFailed')), uncertain ? 'warning' : 'error');
  },
});
const presentedCanonicalState = computed(() => {
  const state = canonicalController.presentedState.value;
  return state?.tableId === selectedTableId.value ? state : null;
});
const orderingMutationPending = computed(() => canonicalController.mutationPending.value || pendingInitialItems.value.size > 0 || initialBatchSyncing.value);
const orderingMutationLocked = computed(() => (
  canonicalController.mutationLocked.value
  || Boolean(retainedInitialBatch.value)
  || Boolean(
    canonicalController.canonicalState.value
    && canonicalController.canonicalState.value.tableId !== selectedTableId.value
  )
  || Boolean(
    pendingInitialItems.value.size
    && pendingInitialTableId.value
    && pendingInitialTableId.value !== selectedTableId.value
  )
));
const orderingProductQuantities = computed(() => {
  const quantities = canonicalController.canonicalState.value?.tableId === selectedTableId.value
    ? { ...canonicalController.productQuantities.value }
    : {};
  if (pendingInitialTableId.value === selectedTableId.value) {
    for (const [productId, quantity] of pendingInitialItems.value) {
      quantities[productId] = (quantities[productId] ?? 0) + quantity;
    }
  }
  return quantities;
});
const canCheckout = computed(() => Boolean(
  session.value?.status === 'OPEN'
  && presentedCanonicalState.value
  && presentedCanonicalState.value.items.length > 0
  && BigInt(presentedCanonicalState.value.totals.payableAmountVnd) > 0n
  && presentedCanonicalState.value.blockers.length === 0,
));
const unresolvedMutation = computed(() => (
  canonicalController.mutationLocked.value
  || Boolean(retainedInitialBatch.value)
  || Boolean(pendingTransfer.value)
  || Boolean(retainedCheckout.value)
));
const unfinishedMutation = computed(() => unresolvedMutation.value || orderingMutationPending.value);
const transferTargets = computed(() => tableCards.value.filter((table) => table.id !== selectedTableId.value && table.status === 'ACTIVE' && table.operationalStatus === 'AVAILABLE' && !table.currentSession));
const topOrderingDialogOpen = computed(() => Boolean(checkoutConfirmOpen.value || adjustmentOpen.value || transferOpen.value || canonicalController.uncertainBatch.value || retainedInitialBatch.value));
const activeStatus = computed(() => route.query.status === 'AVAILABLE' || route.query.status === 'IN_USE' ? route.query.status : 'ALL');
const availableTableCount = computed(() => tableCards.value.filter((table) => table.operationalStatus === 'AVAILABLE').length);
const inUseTableCount = computed(() => tableCards.value.filter((table) => table.operationalStatus === 'IN_USE').length);
const filteredTables = computed(() => tableCards.value.filter((table) => activeStatus.value === 'ALL' || table.operationalStatus === activeStatus.value));

async function reconcilePendingOrderingMutations() {
  if (initialBatchTimer) {
    clearTimeout(initialBatchTimer);
    initialBatchTimer = null;
    await syncInitialBatch();
  }
  if (initialBatchRequest) await initialBatchRequest;
  if (retainedInitialBatch.value) return false;
  if (!orderingMutationPending.value) return !orderingMutationLocked.value;
  const settled = await canonicalController.flush();
  if (settled) return true;
  uiStore.pushToast(t('mutation.outcomeUncertain'), 'warning');
  return false;
}

async function addMenuProduct(productId: string) {
  if (writeDisabled.value || orderingMutationLocked.value) return;
  if (!session.value) {
    pendingInitialTableId.value ||= selectedTableId.value;
    const next = new Map(pendingInitialItems.value);
    next.set(productId, Math.min(999, (next.get(productId) ?? 0) + 1));
    pendingInitialItems.value = next;
    scheduleInitialBatch();
    return;
  }
  try {
    if (!canonicalController.canonicalState.value) await canonicalController.load(true);
    canonicalController.addProduct(productId);
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'ordering.createFailed')), 'error');
    await refreshAdjustmentContext(true);
  }
}

function decreaseMenuProduct(productId: string) {
  if (writeDisabled.value || orderingMutationLocked.value) return;
  const pendingQuantity = pendingInitialItems.value.get(productId) ?? 0;
  if (pendingQuantity > 0) {
    const next = new Map(pendingInitialItems.value);
    if (pendingQuantity > 1) next.set(productId, pendingQuantity - 1);
    else next.delete(productId);
    pendingInitialItems.value = next;
    if (!next.size) {
      pendingInitialTableId.value = '';
      if (initialBatchTimer) {
        clearTimeout(initialBatchTimer);
        initialBatchTimer = null;
      }
    }
    return;
  }
  const line = presentedCanonicalState.value?.items.find((item) => (
    item.productId === productId && item.quantity > item.lockedQuantity
  ));
  if (line) canonicalController.decreaseLine(line);
}

async function resetMenuSelection() {
  if (writeDisabled.value || orderingMutationLocked.value || resettingMenuSelection.value) return;
  resettingMenuSelection.value = true;
  try {
    if (initialBatchTimer) {
      clearTimeout(initialBatchTimer);
      initialBatchTimer = null;
    }
    pendingInitialItems.value = new Map();
    pendingInitialTableId.value = '';
    if (initialBatchRequest) await initialBatchRequest;
    if (!session.value) return;
    if (!presentedCanonicalState.value) await canonicalController.load(true);
    const adjustableLines = [...(presentedCanonicalState.value?.items ?? [])];
    for (const initialLine of adjustableLines) {
      for (let remaining = initialLine.adjustableQuantity; remaining > 0; remaining -= 1) {
        const current = presentedCanonicalState.value?.items.find((item) => item.lineKey === initialLine.lineKey);
        if (!current || current.quantity <= current.lockedQuantity) break;
        canonicalController.decreaseLine(current);
      }
    }
  } finally {
    resettingMenuSelection.value = false;
  }
}

async function viewCurrentOrder() {
  if (openingCurrentOrder.value || orderingMutationLocked.value) return;
  openingCurrentOrder.value = true;
  try {
    if (!(await reconcilePendingOrderingMutations())) return;
    await replaceMainTab('TABLES');
  } finally {
    openingCurrentOrder.value = false;
  }
}

function scheduleInitialBatch() {
  if (initialBatchTimer || initialBatchRequest || retainedInitialBatch.value) return;
  initialBatchTimer = setTimeout(() => {
    initialBatchTimer = null;
    void syncInitialBatch();
  }, 180);
}

async function syncInitialBatch(retry = retainedInitialBatch.value) {
  if (initialBatchRequest || writeDisabled.value) return;
  const tableId = retry?.tableId || pendingInitialTableId.value || selectedTableId.value;
  const input = retry?.input ?? {
    idempotencyKey: createMutationKey('add'),
    items: [...pendingInitialItems.value]
      .filter(([, quantity]) => quantity > 0)
      .map(([productId, quantity]) => ({ productId, quantity })),
  };
  if (!tableId || input.items.length === 0) return;
  const batch = { tableId, input };
  initialBatchSyncing.value = true;
  initialBatchRequest = (async () => {
    try {
      const result = await createMerchantTableOrder(batch.tableId, batch.input);
      retainedInitialBatch.value = null;
      const remaining = new Map(pendingInitialItems.value);
      for (const sent of batch.input.items) {
        const quantity = Math.max(0, (remaining.get(sent.productId) ?? 0) - sent.quantity);
        if (quantity) remaining.set(sent.productId, quantity); else remaining.delete(sent.productId);
      }
      tablesStore.applySessionSnapshot(result.session);
      if (selectedTableId.value === batch.tableId) {
        const canonicalState = await canonicalController.load(true);
        if (canonicalState) canonicalController.adoptCommittedState(canonicalState);
        pendingInitialItems.value = new Map();
        pendingInitialTableId.value = '';
        for (const [productId, quantity] of remaining) {
          for (let index = 0; index < quantity; index += 1) canonicalController.addProduct(productId);
        }
      } else {
        pendingInitialItems.value = remaining;
        pendingInitialTableId.value = remaining.size ? batch.tableId : '';
      }
    } catch (caught) {
      if (isMutationOutcomeUncertain(caught)) {
        retainedInitialBatch.value = batch;
        uiStore.pushToast(t('mutation.outcomeUncertain'), 'warning');
      } else {
        const remaining = new Map(pendingInitialItems.value);
        for (const sent of batch.input.items) {
          const quantity = Math.max(0, (remaining.get(sent.productId) ?? 0) - sent.quantity);
          if (quantity) remaining.set(sent.productId, quantity); else remaining.delete(sent.productId);
        }
        pendingInitialItems.value = remaining;
        if (!remaining.size) pendingInitialTableId.value = '';
        uiStore.pushToast(t(apiErrorTranslationKey(caught, 'ordering.createFailed')), 'error');
        await refreshAdjustmentContext(true);
      }
    }
  })().finally(() => {
    initialBatchRequest = null;
    initialBatchSyncing.value = false;
    if (
      !retainedInitialBatch.value
      && pendingInitialItems.value.size > 0
      && (pendingInitialTableId.value !== selectedTableId.value || !session.value)
    ) scheduleInitialBatch();
  });
  await initialBatchRequest;
}

async function retryUncertainOrderingMutation() {
  if (retainedInitialBatch.value) {
    await syncInitialBatch(retainedInitialBatch.value);
    return;
  }
  const currentSessionId = session.value?.id || '';
  const settled = await canonicalController.retryUncertain();
  if (
    settled
    && currentSessionId
    && canonicalController.canonicalState.value?.sessionId !== currentSessionId
  ) {
    canonicalController.reset();
    await canonicalController.load(true).catch(() => uiStore.pushToast(t('error.refreshFailed'), 'error'));
  }
}

async function openSettlementAdjustment() {
  if (!session.value || writeDisabled.value) return;
  if (!(await reconcilePendingOrderingMutations())) return;
  adjustmentOpen.value = true;
}

async function saveSettlementAdjustment(input: { discountPayableRateBps: number | null; discountAmountVnd?: string; roundingEnabled: boolean }) {
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

function selectTable(tableId: string) {
  const card = tableCards.value.find((table) => table.id === tableId);
  if (!card) return;
  if (unresolvedMutation.value) {
    uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
    return;
  }
  const view = resolveTableSelectionView(isMobile.value, card.operationalStatus);
  const navigation = beginImmediateTableSelectionTransition({
    primeSelection: () => tablesStore.primeTableSelection(card),
    navigate: () => router.push(resolveCashierPresentationLocation(mobileV2PreviewRoute.value, {
      name: 'tables',
      params: { tableId },
      query: view ? { view } : {},
    })),
    afterDomCommit: () => orderingMutationPending.value
      ? reconcilePendingOrderingMutations().then(() => undefined)
      : undefined,
  });
  void navigation
    .catch(() => {
      if (selectedTableId.value === tableId) void syncRouteSelection();
      uiStore.pushToast(t('error.refreshFailed'), 'error');
    });
}

async function selectTableFilter(status: 'ALL' | 'IN_USE' | 'AVAILABLE') {
  const query = { ...route.query };
  delete query.status;
  if (status !== 'ALL') query.status = status;
  await router.replace(resolveCashierPresentationLocation(mobileV2PreviewRoute.value, { name: 'tables', params: route.params, query }));
}

async function selectSessionOrder(order: TableSessionOrder) {
  if (selectedTableId.value) {
    await router.replace(resolveCashierPresentationLocation(mobileV2PreviewRoute.value, {
      name: 'tables',
      params: { tableId: selectedTableId.value },
      query: { ...route.query, order: order.id },
    }));
  }
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
    await router.replace(resolveCashierPresentationLocation(mobileV2PreviewRoute.value, '/tables'));
    return;
  }
  if (selectedTableId.value !== tableId) tablesStore.primeTableSelection(tableId);
  await nextTick();
  if (sequence !== routeSequence || selectedTableId.value !== tableId) return;
  await tablesStore.hydrateTableSelection(tableId).catch(() => undefined);
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
    await router.replace(resolveCashierPresentationLocation(mobileV2PreviewRoute.value, '/tables'));
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

async function notifyProduction() {
  if (
    writeDisabled.value
    || productionNotificationLoading.value
    || !session.value
  ) return;
  if (!(await reconcilePendingOrderingMutations())) return;
  const currentSession = session.value;
  const currentState = canonicalController.canonicalState.value;
  if (
    !currentState
    || currentState.sessionId !== currentSession.id
    || currentState.productionNotification?.status !== 'READY'
    || currentState.productionNotification.pendingItemQuantity <= 0
  ) return;
  if (retainedProductionNotification.value?.sessionId !== currentSession.id) {
    retainedProductionNotification.value = {
      sessionId: currentSession.id,
      requestKey: createMutationKey('notify'),
    };
  }
  const intent = retainedProductionNotification.value;
  productionNotificationLoading.value = true;
  try {
    const result = await notifyTableSessionProduction(
      intent.sessionId,
      intent.requestKey,
    );
    retainedProductionNotification.value = null;
    const committed = canonicalController.canonicalState.value;
    if (committed?.sessionId === intent.sessionId) {
      canonicalController.adoptCommittedState({
        ...committed,
        productionNotification: result.notification,
      });
    }
    uiStore.pushToast(t('productionNotification.success'), 'success', 3_000);
  } catch (caught) {
    if (isDefinitiveMutationRejection(caught)) {
      retainedProductionNotification.value = null;
    }
    const uncertain = isMutationOutcomeUncertain(caught);
    uiStore.pushToast(
      t(uncertain
        ? 'mutation.outcomeUncertain'
        : apiErrorTranslationKey(caught, 'productionNotification.failed')),
      uncertain ? 'warning' : 'error',
    );
    if (!uncertain) await canonicalController.load(true).catch(() => undefined);
  } finally {
    productionNotificationLoading.value = false;
  }
}

function replaceMainTab(tab: 'TABLES' | 'MENU') {
  const query = { ...route.query };
  if (tab === 'MENU') query.view = 'menu'; else delete query.view;
  return router.replace(resolveCashierPresentationLocation(mobileV2PreviewRoute.value, { name: 'tables', params: route.params, query }));
}
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
    await router.replace(resolveCashierPresentationLocation(mobileV2PreviewRoute.value, {
      name: 'tables',
      params: { tableId: updated.tableId },
      query: {},
    }));
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
function protectUnload(event: BeforeUnloadEvent) { if (unfinishedMutation.value) { event.preventDefault(); event.returnValue = ''; } }
function guardMutationNavigation(to: { name?: string | symbol | null; params: Record<string, unknown> }) {
  const destinationName = canonicalCashierRouteName(to.name);
  if (shouldBlockCashierMutationNavigation({ unresolvedMutation: unresolvedMutation.value, authenticated: authStore.isAuthenticated, destinationName })) {
    uiStore.pushToast(t('mutation.closeBlocked'), 'warning');
    return false;
  }
  const destinationTableId = typeof to.params.tableId === 'string' ? to.params.tableId : '';
  if (orderingMutationPending.value && destinationTableId !== routeTableId.value && destinationName === 'tables') {
    return true;
  }
  if (orderingMutationPending.value && destinationName !== 'tables') return reconcilePendingOrderingMutations();
  return true;
}

function backToTables() {
  return router.push(resolveCashierPresentationLocation(mobileV2PreviewRoute.value, '/tables'));
}

onBeforeRouteUpdate((to) => guardMutationNavigation(to));
onBeforeRouteLeave((to) => guardMutationNavigation(to));
watch(() => [route.params.tableId, route.query.order, tableCards.value.length], () => void syncRouteSelection(), { immediate: true });
watch(() => [session.value?.id || '', routeTableId.value] as const, async ([sessionId, currentRouteTableId], previous) => {
  const sequence = ++sessionSequence;
  if (
    sessionId === previous?.[0]
    && currentRouteTableId === previous?.[1]
  ) return;
  if (currentRouteTableId !== selectedTableId.value) return;
  if (sessionId && canonicalController.canonicalState.value?.sessionId === sessionId) return;
  if (orderingMutationPending.value && !(await reconcilePendingOrderingMutations())) return;
  if (
    sequence !== sessionSequence
    || canonicalController.mutationLocked.value
    || Boolean(retainedInitialBatch.value)
  ) return;
  canonicalController.reset();
  retainedCheckout.value = null;
  retainedProductionNotification.value = null;
  if (sessionId) await canonicalController.load(true).catch(() => uiStore.pushToast(t('error.refreshFailed'), 'error'));
}, { flush: 'post' });
watch(presentedCanonicalState, (state) => {
  if (state) tablesStore.applyCanonicalTableSnapshot(state);
}, { deep: true });
onMounted(() => {
  window.addEventListener('beforeunload', protectUnload);
  canonicalPollTimer = window.setInterval(() => {
    if (session.value && !orderingMutationPending.value && !orderingMutationLocked.value) void canonicalController.load(true).catch(() => undefined);
  }, 10_000);
});
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', protectUnload);
  if (initialBatchTimer) clearTimeout(initialBatchTimer);
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
        <TableOrderingWorkspace
          v-if="activeMainTab === 'MENU' && selectedTable && selectedTable.status !== 'DISABLED'"
          :key="selectedTable.id"
          open
          embedded
          :table-id="selectedTable.id"
          :table-label="session?.tableNo || selectedTable.tableNo || t('table.numberFallback')"
          :table-secondary-label="session?.tableName || selectedTable.tableName || ''"
          :session-id="session?.id || ''"
          :disabled="writeDisabled || resettingMenuSelection || openingCurrentOrder"
          :top-dialog-open="topOrderingDialogOpen"
          :product-quantities="orderingProductQuantities"
          :mutation-locked="orderingMutationLocked"
          :mobile-v2-presentation="mobileV2Presentation"
          @close="mobileV2Presentation ? backToTables() : closeOrdering()"
          @add-product="addMenuProduct"
          @remove-product="decreaseMenuProduct"
          @reset-selection="resetMenuSelection"
          @view-order="viewCurrentOrder"
        />
        <EmptyState v-else-if="activeMainTab === 'MENU'" :title="t('cashierV2.menuNeedsTableTitle')" :description="t('cashierV2.menuNeedsTableDescription')" />
      </div>
    </div>

    <aside class="table-route-detail" :class="{ 'table-route-detail--open': Boolean(routeTableId) && activeMainTab === 'TABLES' }" data-testid="table-route-detail">
      <button v-if="selectedTableId && !mobileV2Presentation && !isMobile" type="button" class="table-route-detail__back" :aria-label="t('fulfillment.backToTables')" @click="backToTables"><ArrowLeft :size="20" aria-hidden="true" /></button>
      <LoadingState v-if="detailLoading && !selectedSessionDetail" :label="t('table.loading')" />
      <TableBillDetail v-else :table="selectedTable" :session="session" :canonical-state="presentedCanonicalState" :checkout-disabled="!canCheckout" :checking-out="checkingOut" :notification-loading="productionNotificationLoading" :actions-disabled="writeDisabled || orderingMutationPending || orderingMutationLocked || settlementAdjustmentLoading || productionNotificationLoading" :item-actions-disabled="writeDisabled || orderingMutationLocked || settlementAdjustmentLoading || productionNotificationLoading" :orderable-product-ids="orderableProductIds" :adjustment-applied="Boolean(presentedCanonicalState?.totals.discountPayableRateBps != null || BigInt(presentedCanonicalState?.totals.discountAmountVnd || '0') > 0n || BigInt(presentedCanonicalState?.totals.roundingAmountVnd || '0') > 0n)" :transfer-disabled="!session || !transferTargets.length" :mobile-v2-presentation="mobileV2Presentation" @back="backToTables" @add-items="replaceMainTab('MENU')" @notify-production="notifyProduction" @decrease-line="canonicalController.decreaseLine" @increase-line="canonicalController.increaseLine" @transfer="openTransfer" @checkout="openCheckout" @adjustment="openSettlementAdjustment" />
    </aside>

    <PendingDecreaseRecovery :open="Boolean(canonicalController.uncertainBatch.value || retainedInitialBatch)" :loading="canonicalController.syncing.value || initialBatchSyncing" :disabled="writeDisabled" @retry="retryUncertainOrderingMutation" />
    <CheckoutPaymentDialog :open="checkoutConfirmOpen" :amount-vnd="presentedCanonicalState?.totals.payableAmountVnd || '0'" :loading="checkingOut" :show-description="!mobileV2Presentation" @cancel="checkoutConfirmOpen = false" @confirm="checkout" />
    <SettlementAdjustmentDialog v-if="session" :open="adjustmentOpen" :item-amount-vnd="presentedCanonicalState?.totals.originalAmountVnd || '0'" :discount-payable-rate-bps="presentedCanonicalState?.totals.discountPayableRateBps ?? null" :discount-amount-vnd="presentedCanonicalState?.totals.discountAmountVnd || '0'" :rounding-enabled="BigInt(presentedCanonicalState?.totals.roundingAmountVnd || '0') > 0n" :loading="settlementAdjustmentLoading" @cancel="adjustmentOpen = false" @confirm="saveSettlementAdjustment" />
    <TableTransferDialog :open="transferOpen" :source-label="session?.tableNo || selectedTable?.tableNo || t('table.numberFallback')" :targets="transferTargets" :loading="transferLoading" :error="transferError" @cancel="cancelTransfer" @confirm="confirmTransfer" />
  </section>
</template>
