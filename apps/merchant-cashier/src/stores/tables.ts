import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
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
  const lastRefreshAt = ref<string | null>(null);
  let fetchRequest: Promise<TableCardView[]> | null = null;
  let detailRequestSequence = 0;

  const tableCards = computed(() => buildTableCards(tables.value, openSessions.value));
  const selectedTable = computed(
    () => tableCards.value.find((table) => table.id === selectedTableId.value) ?? null,
  );
  const canCloseSelectedSession = computed(() => canCloseTableSession(selectedSessionDetail.value));

  function fetchTables() {
    if (fetchRequest) return fetchRequest;
    loading.value = true;
    error.value = '';
    fetchRequest = Promise.all([listDiningTables(), listOpenTableSessions()])
      .then(([nextTables, nextSessions]) => {
        tables.value = nextTables;
        openSessions.value = nextSessions;
        lastRefreshAt.value = new Date().toISOString();
        return tableCards.value;
      })
      .catch((caught) => {
        error.value = messageFromApiError(caught);
        throw caught;
      })
      .finally(() => {
        loading.value = false;
        fetchRequest = null;
      });
    return fetchRequest;
  }

  async function selectTable(tableOrId: TableCardView | string | null) {
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
    try {
      const detail = await getTableSessionDetail(table.currentSession.id);
      if (requestSequence === detailRequestSequence) selectedSessionDetail.value = detail;
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

  async function closeSelectedSession() {
    const session = selectedSessionDetail.value;
    if (!session) throw new Error('No table session selected');
    if (!canCloseTableSession(session)) {
      throw new Error('Table session still has unfinished orders');
    }
    closing.value = true;
    error.value = '';
    try {
      const closed = await closeTableSession(session.id);
      selectedSessionDetail.value = closed;
      await fetchTables();
      return closed;
    } catch (caught) {
      error.value = messageFromApiError(caught);
      throw caught;
    } finally {
      closing.value = false;
    }
  }

  function clearSelection() {
    detailRequestSequence += 1;
    selectedTableId.value = '';
    selectedSessionDetail.value = null;
    detailLoading.value = false;
  }

  function clear() {
    tables.value = [];
    openSessions.value = [];
    clearSelection();
    error.value = '';
    livePolling.stop();
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
    lastRefreshAt,
    polling: livePolling.started,
    canCloseSelectedSession,
    fetchTables,
    selectTable,
    closeSelectedSession,
    startLivePolling,
    stopLivePolling,
    clearSelection,
    clear,
  };
});
