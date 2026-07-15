import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  apiErrorTranslationKey,
  CashierApiError,
  getMerchantOrder,
  listMerchantOrders,
  messageFromApiError,
  runMerchantOrderAction,
} from '@/api';
import { cashierConfig } from '@/config';
import {
  ACTIVE_ORDER_STATUSES,
  HISTORY_ORDER_STATUSES,
  canRunOrderAction,
  mergeOrders,
  replaceOrder,
  todayInVietnam,
} from '@/domain';
import { usePollingTask } from '@/composables';
import type {
  MerchantOrder,
  MerchantOrderAction,
  MerchantOrderFilters,
} from '@/types';
import { useAuthStore } from './auth';
import { useSoundStore } from './sound';

export const useOrdersStore = defineStore('cashier-orders', () => {
  const pendingOrders = ref<MerchantOrder[]>([]);
  const activeOrders = ref<MerchantOrder[]>([]);
  const historyOrders = ref<MerchantOrder[]>([]);
  const selectedOrder = ref<MerchantOrder | null>(null);
  const pendingLoading = ref(false);
  const activeLoading = ref(false);
  const historyLoading = ref(false);
  const detailLoading = ref(false);
  const actionLoadingId = ref('');
  const error = ref('');
  const pendingErrorKey = ref('');
  const activeErrorKey = ref('');
  const historyErrorKey = ref('');
  const detailErrorKey = ref('');
  const lastLiveRefreshAt = ref<string | null>(null);
  const lastHistoryRefreshAt = ref<string | null>(null);
  const historyFilters = ref<MerchantOrderFilters>({ date: todayInVietnam() });
  let pendingRequest: Promise<MerchantOrder[]> | null = null;
  let activeRequest: Promise<MerchantOrder[]> | null = null;
  let liveRequest: Promise<void> | null = null;
  let detailRequestSequence = 0;
  let historyRequestSequence = 0;
  let dataGeneration = 0;
  let liveQueryRevision = 0;

  const loading = computed(
    () => pendingLoading.value || activeLoading.value || historyLoading.value || detailLoading.value,
  );
  const liveOrders = computed(() => mergeOrders(pendingOrders.value, activeOrders.value));

  function fetchPending() {
    if (pendingRequest) return pendingRequest;
    const generation = dataGeneration;
    const revision = liveQueryRevision;
    pendingLoading.value = true;
    error.value = '';
    pendingErrorKey.value = '';
    const request = listMerchantOrders({ status: 'PENDING_ACCEPTANCE' })
      .then((result) => {
        const nextOrders = mergeOrders(result);
        if (generation === dataGeneration && revision === liveQueryRevision) {
          pendingOrders.value = nextOrders;
          notifyPendingSnapshot();
        }
        return nextOrders;
      })
      .catch((caught) => {
        if (generation === dataGeneration && revision === liveQueryRevision) {
          error.value = messageFromApiError(caught);
          pendingErrorKey.value = apiErrorTranslationKey(caught, 'error.description');
        }
        throw caught;
      })
      .finally(() => {
        if (pendingRequest === request) pendingRequest = null;
        if (generation === dataGeneration && revision === liveQueryRevision) {
          pendingLoading.value = false;
        }
      });
    pendingRequest = request;
    return request;
  }

  function fetchActive() {
    if (activeRequest) return activeRequest;
    const generation = dataGeneration;
    const revision = liveQueryRevision;
    activeLoading.value = true;
    error.value = '';
    activeErrorKey.value = '';
    const request = Promise.all(
        ACTIVE_ORDER_STATUSES.map((status) => listMerchantOrders({ status })),
      )
      .then((groups) => {
        const nextOrders = mergeOrders(...groups);
        if (generation === dataGeneration && revision === liveQueryRevision) {
          activeOrders.value = nextOrders;
        }
        return nextOrders;
      })
      .catch((caught) => {
        if (generation === dataGeneration && revision === liveQueryRevision) {
          error.value = messageFromApiError(caught);
          activeErrorKey.value = apiErrorTranslationKey(caught, 'error.description');
        }
        throw caught;
      })
      .finally(() => {
        if (activeRequest === request) activeRequest = null;
        if (generation === dataGeneration && revision === liveQueryRevision) {
          activeLoading.value = false;
        }
      });
    activeRequest = request;
    return request;
  }

  function refreshLiveOrders() {
    if (liveRequest) return liveRequest;
    const generation = dataGeneration;
    const revision = liveQueryRevision;
    const request = Promise.all([fetchPending(), fetchActive()])
      .then(async () => {
        if (generation !== dataGeneration || revision !== liveQueryRevision) return;
        lastLiveRefreshAt.value = new Date().toISOString();
        await refreshSelectedOrder();
      })
      .finally(() => {
        if (liveRequest === request) liveRequest = null;
      });
    liveRequest = request;
    return request;
  }

  async function fetchHistory(filters: MerchantOrderFilters = historyFilters.value) {
    const requestSequence = ++historyRequestSequence;
    historyLoading.value = true;
    error.value = '';
    historyErrorKey.value = '';
    historyFilters.value = { ...filters };
    try {
      const groups = filters.status
        ? [await listMerchantOrders(filters)]
        : await Promise.all(
            HISTORY_ORDER_STATUSES.map((status) =>
              listMerchantOrders({ ...filters, status }),
            ),
          );
      const nextOrders = mergeOrders(...groups);
      if (requestSequence === historyRequestSequence) {
        historyOrders.value = nextOrders;
        lastHistoryRefreshAt.value = new Date().toISOString();
      }
      return nextOrders;
    } catch (caught) {
      if (requestSequence === historyRequestSequence) {
        error.value = messageFromApiError(caught);
        historyErrorKey.value = apiErrorTranslationKey(caught, 'error.description');
      }
      throw caught;
    } finally {
      if (requestSequence === historyRequestSequence) historyLoading.value = false;
    }
  }

  async function selectOrder(orderOrId: MerchantOrder | string | null) {
    const generation = dataGeneration;
    const requestSequence = ++detailRequestSequence;
    if (!orderOrId) {
      selectedOrder.value = null;
      detailLoading.value = false;
      return null;
    }
    const id = typeof orderOrId === 'string' ? orderOrId : orderOrId.id;
    selectedOrder.value =
      typeof orderOrId === 'string'
        ? findCachedOrder(id) ?? null
        : orderOrId;
    detailLoading.value = true;
    detailErrorKey.value = '';
    try {
      const detail = await getMerchantOrder(id);
      if (generation === dataGeneration && requestSequence === detailRequestSequence) {
        selectedOrder.value = detail;
        updateCachedOrder(detail);
      }
      return detail;
    } catch (caught) {
      if (generation === dataGeneration && requestSequence === detailRequestSequence) {
        error.value = messageFromApiError(caught);
        detailErrorKey.value = apiErrorTranslationKey(caught, 'error.description');
      }
      throw caught;
    } finally {
      if (requestSequence === detailRequestSequence) detailLoading.value = false;
    }
  }

  async function runAction(
    id: string,
    action: MerchantOrderAction,
    reason?: string,
  ) {
    const order = findCachedOrder(id) ?? selectedOrder.value;
    if (!order || order.id !== id) throw new Error('Order not loaded');
    if (!canRunOrderAction(order, action)) {
      throw new Error(`Action ${action} is not allowed from ${order.status}`);
    }
    const generation = dataGeneration;
    invalidateLiveRequests();
    detailRequestSequence += 1;
    actionLoadingId.value = id;
    error.value = '';
    try {
      const updated = await runMerchantOrderAction(id, action, reason);
      if (generation === dataGeneration) {
        selectedOrder.value = updated;
        updateCachedOrder(updated);
      }
      return updated;
    } catch (caught) {
      if (generation === dataGeneration) {
        error.value = messageFromApiError(caught);
        try {
          await selectOrder(id);
        } catch {
          // Preserve the action error; a best-effort refresh must not mask it.
        }
      }
      throw caught;
    } finally {
      if (generation === dataGeneration) actionLoadingId.value = '';
    }
  }

  async function refreshSelectedOrder() {
    const id = selectedOrder.value?.id;
    if (!id) return null;
    const generation = dataGeneration;
    const requestSequence = ++detailRequestSequence;
    try {
      const detail = await getMerchantOrder(id);
      if (
        generation === dataGeneration
        && requestSequence === detailRequestSequence
        && selectedOrder.value?.id === id
      ) {
        selectedOrder.value = detail;
        updateCachedOrder(detail);
      }
      return detail;
    } catch (caught) {
      if (generation === dataGeneration && requestSequence === detailRequestSequence) {
        error.value = messageFromApiError(caught);
        detailErrorKey.value = apiErrorTranslationKey(caught, 'error.description');
        if (caught instanceof CashierApiError && caught.status === 404) {
          selectedOrder.value = null;
        }
      }
      // Live list data is still valid even when the selected detail disappeared.
      return null;
    }
  }

  function updateCachedOrder(order: MerchantOrder) {
    pendingOrders.value = order.status === 'PENDING_ACCEPTANCE'
      ? mergeOrders(pendingOrders.value.filter((item) => item.id !== order.id), [order])
      : pendingOrders.value.filter((item) => item.id !== order.id);
    activeOrders.value = ACTIVE_ORDER_STATUSES.includes(order.status)
      ? mergeOrders(activeOrders.value.filter((item) => item.id !== order.id), [order])
      : activeOrders.value.filter((item) => item.id !== order.id);
    if (HISTORY_ORDER_STATUSES.includes(order.status)) {
      historyOrders.value = replaceOrder(
        historyOrders.value.some((item) => item.id === order.id)
          ? historyOrders.value
          : [...historyOrders.value, order],
        order,
      );
    }
    notifyPendingSnapshot();
  }

  function notifyPendingSnapshot() {
    const auth = useAuthStore();
    const merchantId = auth.merchant?.id ?? pendingOrders.value[0]?.merchantId;
    if (merchantId) {
      useSoundStore().notifyNewOrders(
        pendingOrders.value.map((order) => order.id),
        merchantId,
      );
    }
  }

  function findCachedOrder(id: string) {
    return mergeOrders(
      pendingOrders.value,
      activeOrders.value,
      historyOrders.value,
    ).find((order) => order.id === id);
  }

  function invalidateLiveRequests() {
    liveQueryRevision += 1;
    pendingRequest = null;
    activeRequest = null;
    liveRequest = null;
    pendingLoading.value = false;
    activeLoading.value = false;
  }

  function clear() {
    dataGeneration += 1;
    invalidateLiveRequests();
    historyRequestSequence += 1;
    pendingOrders.value = [];
    activeOrders.value = [];
    historyOrders.value = [];
    detailRequestSequence += 1;
    selectedOrder.value = null;
    pendingLoading.value = false;
    activeLoading.value = false;
    historyLoading.value = false;
    detailLoading.value = false;
    actionLoadingId.value = '';
    error.value = '';
    pendingErrorKey.value = '';
    activeErrorKey.value = '';
    historyErrorKey.value = '';
    detailErrorKey.value = '';
    lastLiveRefreshAt.value = null;
    lastHistoryRefreshAt.value = null;
    livePolling.stop();
  }

  const livePolling = usePollingTask(refreshLiveOrders, {
    intervalMs: cashierConfig.livePollingIntervalMs,
    runWhenHidden: false,
    runWhenOffline: false,
  });
  const startLivePolling = () => livePolling.start(true);
  const stopLivePolling = () => livePolling.stop();

  return {
    pendingOrders,
    activeOrders,
    historyOrders,
    selectedOrder,
    pendingLoading,
    activeLoading,
    historyLoading,
    detailLoading,
    actionLoadingId,
    error,
    pendingErrorKey,
    activeErrorKey,
    historyErrorKey,
    detailErrorKey,
    lastLiveRefreshAt,
    lastHistoryRefreshAt,
    historyFilters,
    loading,
    liveOrders,
    polling: livePolling.started,
    fetchPending,
    fetchActive,
    refreshLiveOrders,
    fetchHistory,
    selectOrder,
    runAction,
    startLivePolling,
    stopLivePolling,
    clear,
  };
});
