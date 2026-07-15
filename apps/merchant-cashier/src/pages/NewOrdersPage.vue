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
const { pendingOrders, selectedOrder, pendingLoading, pendingErrorKey } = storeToRefs(ordersStore);
const query = ref('');
const activeStatus = ref('ALL');
const statusOptions = [
  { value: 'ALL', labelKey: 'common.all' },
  { value: 'PENDING_ACCEPTANCE', labelKey: 'order.status.pendingAcceptance' },
];
const filteredOrders = computed(() => filterOrders(pendingOrders.value, query.value, activeStatus.value));

async function refresh(showToast = true) {
  try {
    await ordersStore.fetchPending();
  } catch {
    if (showToast && pendingOrders.value.length) uiStore.pushToast(t('error.refreshFailed'), 'error');
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
  <CashierWorkspace :title="t('orders.newTitle')" :description="t('orders.newDescription')" :eyebrow="t('orders.eyebrow')">
    <template #actions>
      <button type="button" class="workspace-action-button" :disabled="pendingLoading" @click="refresh()">
        <RefreshCw :size="18" :class="{ spinning: pendingLoading }" aria-hidden="true" />{{ t('common.refresh') }}
      </button>
    </template>
    <SearchFilterBar
      v-model:query="query"
      v-model:active-status="activeStatus"
      :status-options="statusOptions"
      placeholder-key="orders.searchPlaceholder"
    />
    <LoadingState v-if="pendingLoading && !pendingOrders.length" :label="t('orders.loading')" />
    <ErrorState
      v-else-if="pendingErrorKey && !pendingOrders.length"
      :title="t('error.title')"
      :description="t(pendingErrorKey || 'error.description')"
      :retry-label="t('common.retry')"
      :loading="pendingLoading"
      @retry="refresh(false)"
    />
    <OrderList
      v-else
      :orders="filteredOrders"
      :selected-order-id="selectedOrder?.id"
      :empty-title="t('orders.newEmptyTitle')"
      :empty-description="t('orders.newEmptyDescription')"
      emphasize
      @select="selectOrder"
    />
  </CashierWorkspace>
</template>
