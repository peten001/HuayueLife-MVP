import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  apiErrorTranslationKey,
  CashierApiError,
  checkoutTableSession,
  closeTableSession,
  getTableSessionDetail,
  listDiningTables,
  listOpenTableSessions,
  messageFromApiError,
} from '@/api';
import { buildTableCards, canCloseTableSession } from '@/domain';
import type {
  DiningTable,
  TableCardView,
  TableSessionDetail,
  TableSessionSummary,
} from '@/types';

export const TABLE_SESSION_DETAIL_TTL_MS = 10_000;

interface CachedSessionDetail {
  detail: TableSessionDetail;
  fetchedAt: number;
}

export const useTablesStore = defineStore('cashier-tables', () => {
  const tables = ref<DiningTable[]>([]);
  const openSessions = ref<TableSessionSummary[]>([]);
  const selectedTableId = ref('');
  const selectedSessionDetail = ref<TableSessionDetail | null>(null);
  const loading = ref(false);
  const detailLoading = ref(false);
  const closing = ref(false);
  const checkingOut = ref(false);
  const error = ref('');
  const errorKey = ref('');
  const lastRefreshAt = ref<string | null>(null);
  let fetchRequest: Promise<TableCardView[]> | null = null;
  let detailRequestSequence = 0;
  let dataGeneration = 0;
  let queryRevision = 0;
  const detailCache = new Map<string, CachedSessionDetail>();
  const detailRequests = new Map<string, Promise<TableSessionDetail>>();

  const tableCards = computed(() => buildTableCards(tables.value, openSessions.value));
  const selectedTable = computed(
    () => tableCards.value.find((table) => table.id === selectedTableId.value) ?? null,
  );
  const canCloseSelectedSession = computed(() => canCloseTableSession(selectedSessionDetail.value));

  function fetchTables(options: { force?: boolean } = {}) {
    if (fetchRequest) return fetchRequest;
    if (options.force) queryRevision += 1;
    const generation = dataGeneration;
    const revision = queryRevision;
    loading.value = true;
    error.value = '';
    errorKey.value = '';
    const request = Promise.all([listDiningTables(), listOpenTableSessions()])
      .then(async ([nextTables, nextSessions]) => {
        const nextCards = buildTableCards(nextTables, nextSessions);
        if (generation !== dataGeneration || revision !== queryRevision) return nextCards;
        tables.value = nextTables;
        openSessions.value = nextSessions;
        lastRefreshAt.value = new Date().toISOString();
        await refreshSelectedSession(revision);
        return nextCards;
      })
      .catch((caught) => {
        if (generation === dataGeneration && revision === queryRevision) {
          error.value = messageFromApiError(caught);
          errorKey.value = apiErrorTranslationKey(caught, 'error.description');
        }
        throw caught;
      })
      .finally(() => {
        if (fetchRequest === request) fetchRequest = null;
        if (generation === dataGeneration && revision === queryRevision) {
          loading.value = false;
        }
      });
    fetchRequest = request;
    return request;
  }

  async function selectTable(tableOrId: TableCardView | string | null) {
    const generation = dataGeneration;
    const requestSequence = ++detailRequestSequence;
    if (!tableOrId) {
      selectedTableId.value = '';
      selectedSessionDetail.value = null;
      detailLoading.value = false;
      return null;
    }
    const table = typeof tableOrId === 'string'
      ? tableCards.value.find((item) => item.id === tableOrId)
      : tableOrId;
    if (!table) throw new Error('Table not loaded');
    selectedTableId.value = table.id;
    if (!table.currentSession) {
      selectedSessionDetail.value = null;
      detailLoading.value = false;
      return null;
    }
    const sessionId = table.currentSession.id;
    const cached = detailCache.get(sessionId);
    if (cached) {
      selectedSessionDetail.value = cached.detail;
      detailLoading.value = false;
      if (Date.now() - cached.fetchedAt >= TABLE_SESSION_DETAIL_TTL_MS) {
        void refreshSelectedSession(queryRevision);
      }
      return cached.detail;
    }
    selectedSessionDetail.value = null;
    detailLoading.value = true;
    error.value = '';
    errorKey.value = '';
    try {
      const detail = await requestSessionDetail(sessionId);
      if (generation === dataGeneration && requestSequence === detailRequestSequence) {
        selectedSessionDetail.value = detail;
      }
      return detail;
    } catch (caught) {
      if (generation === dataGeneration && requestSequence === detailRequestSequence) {
        error.value = messageFromApiError(caught);
        errorKey.value = apiErrorTranslationKey(caught, 'error.description');
      }
      throw caught;
    } finally {
      if (requestSequence === detailRequestSequence) detailLoading.value = false;
    }
  }

  async function closeSelectedSession() {
    const session = selectedSessionDetail.value;
    if (!session) throw new Error('No table session selected');
    if (!canCloseTableSession(session)) {
      throw new Error('Table session still has unfinished orders');
    }
    const generation = dataGeneration;
    closing.value = true;
    error.value = '';
    errorKey.value = '';
    try {
      const closed = await closeTableSession(session.id);
      if (generation === dataGeneration) {
        selectedSessionDetail.value = closed;
        await fetchTables({ force: true });
      }
      return closed;
    } catch (caught) {
      if (generation === dataGeneration) {
        error.value = messageFromApiError(caught);
        errorKey.value = apiErrorTranslationKey(caught, 'table.closeFailed');
      }
      throw caught;
    } finally {
      if (generation === dataGeneration) closing.value = false;
    }
  }

  async function checkoutSelectedSession(
    paymentMethod: import('@/types').PaymentMethod,
    v2?: import('@/types').CheckoutTableSessionV2Input,
  ) {
    const session = selectedSessionDetail.value;
    if (!session) throw new Error('No table session selected');
    if (Number(session.pendingOrderCount || 0) > 0) {
      throw new Error('Table session still has unaccepted orders');
    }
    const generation = dataGeneration;
    checkingOut.value = true;
    error.value = '';
    errorKey.value = '';
    try {
      const result = v2
        ? await checkoutTableSession(session.id, paymentMethod, v2)
        : await checkoutTableSession(session.id, paymentMethod);
      if (generation === dataGeneration) {
        applySessionSnapshot(result.session);
        await fetchTables({ force: true });
      }
      return result;
    } catch (caught) {
      if (generation === dataGeneration) {
        error.value = messageFromApiError(caught);
        errorKey.value = apiErrorTranslationKey(caught, 'table.checkoutFailed');
      }
      throw caught;
    } finally {
      if (generation === dataGeneration) checkingOut.value = false;
    }
  }

  function clearSelection() {
    detailRequestSequence += 1;
    selectedTableId.value = '';
    selectedSessionDetail.value = null;
    detailLoading.value = false;
  }

  async function refreshSelectedSession(expectedRevision = queryRevision) {
    const tableId = selectedTableId.value;
    if (!tableId) return null;
    const table = tableCards.value.find((item) => item.id === tableId);
    if (!table) {
      clearSelection();
      return null;
    }
    if (!table.currentSession) {
      detailRequestSequence += 1;
      selectedSessionDetail.value = null;
      detailLoading.value = false;
      return null;
    }

    const sessionId = table.currentSession.id;
    const requestSequence = ++detailRequestSequence;
    const changedSession = selectedSessionDetail.value?.id !== sessionId;
    const cached = detailCache.get(sessionId);
    if (cached) {
      selectedSessionDetail.value = cached.detail;
      detailLoading.value = false;
      if (Date.now() - cached.fetchedAt < TABLE_SESSION_DETAIL_TTL_MS) {
        return cached.detail;
      }
      void refreshSessionDetailInBackground(
        sessionId,
        tableId,
        expectedRevision,
        requestSequence,
      );
      return cached.detail;
    }
    if (changedSession) selectedSessionDetail.value = null;
    detailLoading.value = true;
    try {
      const detail = await requestSessionDetail(sessionId);
      if (
        expectedRevision === queryRevision
        && requestSequence === detailRequestSequence
        && selectedTableId.value === tableId
      ) {
        selectedSessionDetail.value = detail;
      }
      return detail;
    } catch (caught) {
      if (expectedRevision === queryRevision && requestSequence === detailRequestSequence) {
        error.value = messageFromApiError(caught);
        errorKey.value = apiErrorTranslationKey(caught, 'error.description');
        if (caught instanceof CashierApiError && caught.code === 'TABLE_SESSION_NOT_FOUND') {
          selectedSessionDetail.value = null;
        }
      }
      // A list refresh remains useful even when the selected detail request fails.
      return null;
    } finally {
      if (expectedRevision === queryRevision && requestSequence === detailRequestSequence) {
        detailLoading.value = false;
      }
    }
  }

  function applySessionSnapshot(session: TableSessionDetail) {
    // Keep the mutation response authoritative over any older table/session
    // polling request that may still be in flight.
    invalidateTableSnapshot();
    detailRequestSequence += 1;
    detailLoading.value = false;
    openSessions.value = session.status === 'OPEN'
      ? [...openSessions.value.filter((candidate) => candidate.id !== session.id), session]
      : openSessions.value.filter((candidate) => candidate.id !== session.id);
    if (session.status === 'OPEN') {
      detailCache.set(session.id, { detail: session, fetchedAt: Date.now() });
    } else {
      detailCache.delete(session.id);
    }
    if (selectedSessionDetail.value?.id === session.id && session.status === 'OPEN') {
      selectedTableId.value = session.tableId;
      selectedSessionDetail.value = session;
    } else if (selectedTableId.value === session.tableId) {
      // An item return can close and release the table in the same mutation.
      // Keep the table selected while switching the right panel to its existing
      // idle/open-table state instead of retaining a stale closed bill.
      selectedSessionDetail.value = session.status === 'OPEN' ? session : null;
    }
  }

  function clear() {
    dataGeneration += 1;
    invalidateTableSnapshot();
    fetchRequest = null;
    detailRequests.clear();
    detailCache.clear();
    tables.value = [];
    openSessions.value = [];
    clearSelection();
    error.value = '';
    errorKey.value = '';
    loading.value = false;
    closing.value = false;
    checkingOut.value = false;
    lastRefreshAt.value = null;
  }

  function invalidateTableSnapshot() {
    queryRevision += 1;
    loading.value = false;
  }

  function requestSessionDetail(sessionId: string) {
    const existing = detailRequests.get(sessionId);
    if (existing) return existing;
    const generation = dataGeneration;
    const request = getTableSessionDetail(sessionId)
      .then((detail) => {
        if (generation === dataGeneration) {
          detailCache.set(sessionId, { detail, fetchedAt: Date.now() });
        }
        return detail;
      })
      .finally(() => {
        if (detailRequests.get(sessionId) === request) detailRequests.delete(sessionId);
      });
    detailRequests.set(sessionId, request);
    return request;
  }

  async function refreshSessionDetailInBackground(
    sessionId: string,
    tableId: string,
    expectedRevision: number,
    requestSequence: number,
  ) {
    try {
      const detail = await requestSessionDetail(sessionId);
      if (
        expectedRevision === queryRevision
        && requestSequence === detailRequestSequence
        && selectedTableId.value === tableId
      ) {
        selectedSessionDetail.value = detail;
      }
    } catch (caught) {
      if (expectedRevision === queryRevision && requestSequence === detailRequestSequence) {
        error.value = messageFromApiError(caught);
        errorKey.value = apiErrorTranslationKey(caught, 'error.description');
        if (caught instanceof CashierApiError && caught.code === 'TABLE_SESSION_NOT_FOUND') {
          selectedSessionDetail.value = null;
          detailCache.delete(sessionId);
        }
      }
    }
  }

  return {
    tables,
    openSessions,
    tableCards,
    selectedTableId,
    selectedTable,
    selectedSessionDetail,
    loading,
    detailLoading,
    closing,
    checkingOut,
    error,
    errorKey,
    lastRefreshAt,
    canCloseSelectedSession,
    fetchTables,
    selectTable,
    closeSelectedSession,
    checkoutSelectedSession,
    applySessionSnapshot,
    clearSelection,
    clear,
  };
});
