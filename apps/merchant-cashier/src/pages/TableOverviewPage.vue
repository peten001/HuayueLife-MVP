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

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const tablesStore = useTablesStore();
const uiStore = useUiStore();
const { tableCards, selectedTableId, loading, error } = storeToRefs(tablesStore);
const query = ref('');
const activeStatus = ref('ALL');
const refreshing = ref(false);
const statusOptions = [
  { value: 'ALL', labelKey: 'common.all' },
  { value: 'AVAILABLE', labelKey: 'table.status.available' },
  { value: 'IN_USE', labelKey: 'table.status.inUse' },
  { value: 'READY_TO_CLOSE', labelKey: 'table.status.readyToClose' },
  { value: 'DISABLED', labelKey: 'table.status.disabled' },
];

const filteredTables = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase();
  return tableCards.value.filter((table) => {
    if (activeStatus.value !== 'ALL' && table.operationalStatus !== activeStatus.value) return false;
    return !keyword || `${table.tableNo} ${table.tableName || ''}`.toLocaleLowerCase().includes(keyword);
  });
});

async function refresh(showToast = true) {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await tablesStore.fetchTables();
  } catch {
    if (showToast && tableCards.value.length) uiStore.pushToast(t('error.refreshFailed'), 'error');
  } finally {
    refreshing.value = false;
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
  <section
    class="cashier-workspace cashier-workspace--table-overview"
    data-testid="table-overview-workspace"
  >
    <div class="cashier-workspace__content cashier-workspace__content--table-overview">
      <SearchFilterBar
        v-model:query="query"
        v-model:active-status="activeStatus"
        :status-options="statusOptions"
        table-toolbar
      >
        <template #actions>
          <button
            type="button"
            class="table-toolbar__refresh"
            data-testid="table-toolbar-refresh"
            :title="t('common.refresh')"
            :aria-label="t('common.refresh')"
            :aria-busy="refreshing"
            :disabled="loading || refreshing"
            @click="refresh()"
          >
            <RefreshCw :size="18" :class="{ spinning: refreshing }" aria-hidden="true" />
          </button>
        </template>
      </SearchFilterBar>
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
    </div>
  </section>
</template>
