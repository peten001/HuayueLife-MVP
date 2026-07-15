<script setup lang="ts">
import { RefreshCw } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from '@/i18n';
import { useOrdersStore, useUiStore } from '@/stores';
import CashierWorkspace from '@/components/shell/CashierWorkspace.vue';
import LoadingState from '@/components/common/LoadingState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import SearchFilterBar from '@/components/common/SearchFilterBar.vue';
import OrderList from '@/components/orders/OrderList.vue';
import { filterOrders } from '@/components/orders/filter-orders';

const { t } = useI18n();
const ordersStore = useOrdersStore();
const uiStore = useUiStore();
const { activeOrders, selectedOrder, activeLoading, activeErrorKey } = storeToRefs(ordersStore);
const query = ref('');
const activeStatus = ref('ALL');
const statusOptions = [
  { value: 'ALL', labelKey: 'common.all' },
  { value: 'ACCEPTED', labelKey: 'order.status.accepted' },
  { value: 'PREPARING', labelKey: 'order.status.preparing' },
  { value: 'READY', labelKey: 'order.status.ready' },
  { value: 'DELIVERING', labelKey: 'order.status.delivering' },
];
const filteredOrders = computed(() => filterOrders(activeOrders.value, query.value, activeStatus.value));

async function refresh(showToast = true) {
  try {
    await ordersStore.fetchActive();
  } catch {
    if (showToast && activeOrders.value.length) uiStore.pushToast(t('error.refreshFailed'), 'error');
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

onMounted(() => refresh(false));
</script>

<template>
  <CashierWorkspace :title="t('orders.activeTitle')" :description="t('orders.activeDescription')" :eyebrow="t('orders.eyebrow')">
    <template #actions>
      <span class="workspace-stat-chips__accent">{{ t('orders.activeCount', { count: activeOrders.length }) }}</span>
      <button type="button" class="workspace-action-button" :disabled="activeLoading" @click="refresh()">
        <RefreshCw :size="18" :class="{ spinning: activeLoading }" aria-hidden="true" />{{ t('common.refresh') }}
      </button>
    </template>
    <SearchFilterBar
      v-model:query="query"
      v-model:active-status="activeStatus"
      :status-options="statusOptions"
      placeholder-key="orders.searchPlaceholder"
    />
    <LoadingState v-if="activeLoading && !activeOrders.length" :label="t('orders.loading')" />
    <ErrorState
      v-else-if="activeErrorKey && !activeOrders.length"
      :title="t('error.title')"
      :description="t(activeErrorKey || 'error.description')"
      :retry-label="t('common.retry')"
      :loading="activeLoading"
      @retry="refresh(false)"
    />
    <OrderList
      v-else
      :orders="filteredOrders"
      :selected-order-id="selectedOrder?.id"
      :empty-title="t('orders.activeEmptyTitle')"
      :empty-description="t('orders.activeEmptyDescription')"
      @select="selectOrder"
    />
  </CashierWorkspace>
</template>
