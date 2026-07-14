<script setup lang="ts">
import { RefreshCw } from '@lucide/vue';
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { todayInVietnam } from '@/domain';
import { useI18n } from '@/i18n';
import { useOrdersStore, useUiStore } from '@/stores';
import type { OrderStatus, OrderType } from '@/types';
import CashierWorkspace from '@/components/shell/CashierWorkspace.vue';
import LoadingState from '@/components/common/LoadingState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import SearchFilterBar from '@/components/common/SearchFilterBar.vue';
import OrderList from '@/components/orders/OrderList.vue';
import { filterOrders } from '@/components/orders/filter-orders';

const { t } = useI18n();
const ordersStore = useOrdersStore();
const uiStore = useUiStore();
const { historyOrders, selectedOrder, historyLoading, error } = storeToRefs(ordersStore);
const query = ref('');
const activeStatus = ref('ALL');
const date = ref(todayInVietnam());
const orderType = ref('');
const initialized = ref(false);
const statusOptions = [
  { value: 'ALL', labelKey: 'common.all' },
  { value: 'COMPLETED', labelKey: 'order.status.completed' },
  { value: 'CANCELLED', labelKey: 'order.status.cancelled' },
];
const filteredOrders = computed(() => filterOrders(historyOrders.value, query.value, activeStatus.value));

async function refresh(showToast = true) {
  try {
    await ordersStore.fetchHistory({
      date: date.value,
      status: activeStatus.value === 'ALL' ? undefined : activeStatus.value as OrderStatus,
      orderType: orderType.value ? orderType.value as OrderType : undefined,
    });
  } catch {
    if (showToast && historyOrders.value.length) uiStore.pushToast(t('error.refreshFailed'), 'error');
  }
}

async function selectOrder(orderId: string) {
  try {
    await ordersStore.selectOrder(orderId);
    uiStore.openDetail('order', orderId);
  } catch {
    uiStore.pushToast(t('error.operationFailed'), 'error');
  }
}

watch([date, orderType, activeStatus], () => {
  if (initialized.value) void refresh(false);
});

onMounted(async () => {
  await refresh(false);
  initialized.value = true;
});
</script>

<template>
  <CashierWorkspace :title="t('orders.historyTitle')" :description="t('orders.historyDescription')" :eyebrow="t('orders.eyebrow')">
    <template #actions>
      <button type="button" class="workspace-action-button" :disabled="historyLoading" @click="refresh()">
        <RefreshCw :size="18" :class="{ spinning: historyLoading }" aria-hidden="true" />{{ t('common.refresh') }}
      </button>
    </template>
    <SearchFilterBar
      v-model:query="query"
      v-model:active-status="activeStatus"
      v-model:date="date"
      v-model:order-type="orderType"
      :status-options="statusOptions"
      placeholder-key="orders.searchPlaceholder"
      show-history-filters
    />
    <LoadingState v-if="historyLoading && !historyOrders.length" :label="t('orders.loading')" />
    <ErrorState
      v-else-if="error && !historyOrders.length"
      :title="t('error.title')"
      :description="error || t('error.description')"
      :retry-label="t('common.retry')"
      :loading="historyLoading"
      @retry="refresh(false)"
    />
    <OrderList
      v-else
      :orders="filteredOrders"
      :selected-order-id="selectedOrder?.id"
      :empty-title="t('orders.historyEmptyTitle')"
      :empty-description="t('orders.historyEmptyDescription')"
      @select="selectOrder"
    />
  </CashierWorkspace>
</template>
