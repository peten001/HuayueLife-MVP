<script setup lang="ts">
import { RefreshCw } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from '@/i18n';
import { useTablesStore, useUiStore } from '@/stores';
import LoadingState from '@/components/common/LoadingState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import SearchFilterBar from '@/components/common/SearchFilterBar.vue';
import TableGrid from '@/components/tables/TableGrid.vue';
import CashierWorkspace from '@/components/shell/CashierWorkspace.vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const tablesStore = useTablesStore();
const uiStore = useUiStore();
const { tableCards, selectedTableId, loading, error } = storeToRefs(tablesStore);
const query = ref('');
const activeStatus = ref('ALL');
const statusOptions = [
  { value: 'ALL', labelKey: 'common.all' },
  { value: 'AVAILABLE', labelKey: 'table.status.available' },
  { value: 'IN_USE', labelKey: 'table.status.inUse' },
  { value: 'READY_TO_CLOSE', labelKey: 'table.status.readyToClose' },
  { value: 'DISABLED', labelKey: 'table.status.disabled' },
];

const occupiedCount = computed(() => tableCards.value.filter((table) => Boolean(table.currentSession)).length);
const availableCount = computed(() => tableCards.value.filter((table) => table.operationalStatus === 'AVAILABLE').length);
const filteredTables = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase();
  return tableCards.value.filter((table) => {
    if (activeStatus.value !== 'ALL' && table.operationalStatus !== activeStatus.value) return false;
    return !keyword || `${table.tableNo} ${table.tableName || ''}`.toLocaleLowerCase().includes(keyword);
  });
});

async function refresh(showToast = true) {
  try {
    await tablesStore.fetchTables();
  } catch {
    if (showToast && tableCards.value.length) uiStore.pushToast(t('error.refreshFailed'), 'error');
  }
}

async function selectTable(tableId: string, updateUrl = true) {
  try {
    await tablesStore.selectTable(tableId);
    if (updateUrl) await router.replace({ path: '/tables', query: { table: tableId } });
    uiStore.openDetail('table', tableId);
  } catch {
    uiStore.pushToast(t('error.operationFailed'), 'error');
  }
}

onMounted(async () => {
  await refresh(false);
  const requestedTable = typeof route.query.table === 'string' ? route.query.table : '';
  if (requestedTable && tableCards.value.some((table) => table.id === requestedTable)) {
    await selectTable(requestedTable, false);
  }
});
</script>

<template>
  <CashierWorkspace :title="t('table.overviewTitle')" :description="t('table.overviewDescription')" :eyebrow="t('table.eyebrow')">
    <template #actions>
      <div class="workspace-stat-chips">
        <span>{{ t('table.availableCount', { count: availableCount }) }}</span>
        <span class="workspace-stat-chips__accent">{{ t('table.occupiedCount', { count: occupiedCount }) }}</span>
      </div>
      <button type="button" class="workspace-action-button" :disabled="loading" @click="refresh()">
        <RefreshCw :size="18" :class="{ spinning: loading }" aria-hidden="true" />{{ t('common.refresh') }}
      </button>
    </template>

    <SearchFilterBar
      v-model:query="query"
      v-model:active-status="activeStatus"
      :status-options="statusOptions"
      show-area
    />
    <LoadingState v-if="loading && !tableCards.length" :label="t('table.loading')" />
    <ErrorState
      v-else-if="error && !tableCards.length"
      :title="t('error.title')"
      :description="error || t('error.description')"
      :retry-label="t('common.retry')"
      :loading="loading"
      @retry="refresh(false)"
    />
    <TableGrid v-else :tables="filteredTables" :selected-table-id="selectedTableId" @select="selectTable" />
  </CashierWorkspace>
</template>
