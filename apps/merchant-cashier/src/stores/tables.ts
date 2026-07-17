import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  apiErrorTranslationKey,
  CashierApiError,
  closeTableSession,
  getTableSessionDetail,
  listDiningTables,
  listOpenTableSessions,
  messageFromApiError,
} from '@/api';
import { usePollingTask } from '@/composables';
import { cashierConfig } from '@/config';
import { buildTableCards, canCloseTableSession } from '@/domain';
import type {
  DiningTable,
  TableCardView,
  TableSessionDetail,
  TableSessionSummary,
} from '@/types';

export const useTablesStore = defineStore('cashier-tables', () => {
  const tables = ref<DiningTable[]>([]);
  const openSessions = ref<TableSessionSummary[]>([]);
  const selectedTableId = ref('');
  const selectedSessionDetail = ref<TableSessionDetail | null>(null);
  const loading = ref(false);
  const detailLoading = ref(false);
  const closing = ref(false);
  const error = ref('');
  const errorKey = ref('');
  const lastRefreshAt = ref<string | null>(null);
  let fetchRequest: Promise<TableCardView[]> | null = null;
  let detailRequestSequence = 0;
  let dataGeneration = 0;
  let queryRevision = 0;

  const tableCards = computed(() => buildTableCards(tables.value, openSessions.value));
  const selectedTable = computed(
    () => tableCards.value.find((table) => table.id === selectedTableId.value) ?? null,
  );
  const canCloseSelectedSession = computed(() => canCloseTableSession(selectedSessionDetail.value));

  function fetchTables(options: { force?: boolean } = {}) {
    if (options.force) invalidateTableRequests();
    if (fetchRequest) return fetchRequest;
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
    selectedSessionDetail.value = null;
    if (!table.currentSession) return null;
    detailLoading.value = true;
    error.value = '';
    errorKey.value = '';
    try {
      const detail = await getTableSessionDetail(table.currentSession.id);
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
    if (changedSession) selectedSessionDetail.value = null;
    detailLoading.value = true;
    try {
      const detail = await getTableSessionDetail(sessionId);
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
    invalidateTableRequests();
    detailRequestSequence += 1;
    detailLoading.value = false;
    openSessions.value = session.status === 'OPEN'
      ? [...openSessions.value.filter((candidate) => candidate.id !== session.id), session]
      : openSessions.value.filter((candidate) => candidate.id !== session.id);
    if (selectedTableId.value === session.tableId) selectedSessionDetail.value = session;
  }

  function clear() {
    dataGeneration += 1;
    invalidateTableRequests();
    tables.value = [];
    openSessions.value = [];
    clearSelection();
    error.value = '';
    errorKey.value = '';
    loading.value = false;
    closing.value = false;
    lastRefreshAt.value = null;
    livePolling.stop();
  }

  function invalidateTableRequests() {
    queryRevision += 1;
    fetchRequest = null;
    loading.value = false;
  }

  const livePolling = usePollingTask(async () => {
    await fetchTables();
  }, {
    intervalMs: cashierConfig.livePollingIntervalMs,
    runWhenHidden: false,
    runWhenOffline: false,
  });
  const startLivePolling = () => livePolling.start(true);
  const stopLivePolling = () => livePolling.stop();

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
    error,
    errorKey,
    lastRefreshAt,
    polling: livePolling.started,
    canCloseSelectedSession,
    fetchTables,
    selectTable,
    closeSelectedSession,
    applySessionSnapshot,
    startLivePolling,
    stopLivePolling,
    clearSelection,
    clear,
  };
});
