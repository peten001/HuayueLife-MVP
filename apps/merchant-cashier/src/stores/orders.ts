import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
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
  const lastLiveRefreshAt = ref<string | null>(null);
  const lastHistoryRefreshAt = ref<string | null>(null);
  const historyFilters = ref<MerchantOrderFilters>({ date: todayInVietnam() });
  let pendingRequest: Promise<MerchantOrder[]> | null = null;
  let activeRequest: Promise<MerchantOrder[]> | null = null;
  let liveRequest: Promise<void> | null = null;
  let detailRequestSequence = 0;

  const loading = computed(
    () => pendingLoading.value || activeLoading.value || historyLoading.value || detailLoading.value,
  );
  const liveOrders = computed(() => mergeOrders(pendingOrders.value, activeOrders.value));

  function fetchPending() {
    if (pendingRequest) return pendingRequest;
    pendingLoading.value = true;
    error.value = '';
    pendingRequest = listMerchantOrders({ status: 'PENDING_ACCEPTANCE' })
      .then((result) => {
        pendingOrders.value = mergeOrders(result);
        notifyPendingSnapshot();
        return pendingOrders.value;
      })
      .catch((caught) => {
        error.value = messageFromApiError(caught);
        throw caught;
      })
      .finally(() => {
        pendingLoading.value = false;
        pendingRequest = null;
      });
    return pendingRequest;
  }

  function fetchActive() {
    if (activeRequest) return activeRequest;
    activeLoading.value = true;
    error.value = '';
    activeRequest = Promise.all(
        ACTIVE_ORDER_STATUSES.map((status) => listMerchantOrders({ status })),
      )
      .then((groups) => {
        activeOrders.value = mergeOrders(...groups);
        return activeOrders.value;
      })
      .catch((caught) => {
        error.value = messageFromApiError(caught);
        throw caught;
      })
      .finally(() => {
        activeLoading.value = false;
        activeRequest = null;
      });
    return activeRequest;
  }

  function refreshLiveOrders() {
    if (liveRequest) return liveRequest;
    liveRequest = Promise.all([fetchPending(), fetchActive()])
      .then(() => {
        lastLiveRefreshAt.value = new Date().toISOString();
      })
      .finally(() => {
        liveRequest = null;
      });
    return liveRequest;
  }

  async function fetchHistory(filters: MerchantOrderFilters = historyFilters.value) {
    historyLoading.value = true;
    error.value = '';
    historyFilters.value = { ...filters };
    try {
      const groups = filters.status
        ? [await listMerchantOrders(filters)]
        : await Promise.all(
            HISTORY_ORDER_STATUSES.map((status) =>
              listMerchantOrders({ ...filters, status }),
            ),
          );
      historyOrders.value = mergeOrders(...groups);
      lastHistoryRefreshAt.value = new Date().toISOString();
      return historyOrders.value;
    } catch (caught) {
      error.value = messageFromApiError(caught);
      throw caught;
    } finally {
      historyLoading.value = false;
    }
  }

  async function selectOrder(orderOrId: MerchantOrder | string | null) {
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
    try {
      const detail = await getMerchantOrder(id);
      if (requestSequence === detailRequestSequence) selectedOrder.value = detail;
      updateCachedOrder(detail);
      return detail;
    } catch (caught) {
      if (requestSequence === detailRequestSequence) {
        error.value = messageFromApiError(caught);
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
    actionLoadingId.value = id;
    error.value = '';
    try {
      const updated = await runMerchantOrderAction(id, action, reason);
      selectedOrder.value = updated;
      updateCachedOrder(updated);
      return updated;
    } catch (caught) {
      error.value = messageFromApiError(caught);
      try {
        await selectOrder(id);
      } catch {
        // Preserve the action error; a best-effort refresh must not mask it.
      }
      throw caught;
    } finally {
      actionLoadingId.value = '';
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

  function clear() {
    pendingOrders.value = [];
    activeOrders.value = [];
    historyOrders.value = [];
    detailRequestSequence += 1;
    selectedOrder.value = null;
    detailLoading.value = false;
    error.value = '';
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
