<script setup lang="ts">
import { ArrowLeft, RefreshCw, Search } from '@lucide/vue';
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { formatVietnamDateTime, formatVnd, todayInVietnam } from '@/domain';
import { resolveOrderLocation } from '@/domain/order-location';
import { useI18n } from '@/i18n';
import { useOrdersStore, useUiStore } from '@/stores';
import type { OrderStatus, OrderType } from '@/types';
import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import LoadingState from '@/components/common/LoadingState.vue';
import OrderStatusBadge from '@/components/common/OrderStatusBadge.vue';
import BillSummary from '@/components/bills/BillSummary.vue';
import PrintJobActions from '@/components/printing/PrintJobActions.vue';
import OrderItemsSection from '@/features/fulfillment/OrderItemsSection.vue';

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const ordersStore = useOrdersStore();
const uiStore = useUiStore();
const { historyOrders, selectedOrder, historyLoading, detailLoading, historyErrorKey } = storeToRefs(ordersStore);
const query = ref('');
const status = ref<'ALL' | 'COMPLETED' | 'CANCELLED'>('ALL');
const orderType = ref<'' | OrderType>('');
const date = ref(todayInVietnam());
const initialized = ref(false);
let routeSequence = 0;

const filtered = computed(() => historyOrders.value.filter((order) => {
  const keyword = query.value.trim().toLocaleLowerCase();
  if (status.value !== 'ALL' && order.status !== status.value) return false;
  if (orderType.value && order.orderType !== orderType.value) return false;
  return !keyword || `${order.orderNo} ${order.contactName || ''} ${order.tableNoSnapshot || ''}`.toLocaleLowerCase().includes(keyword);
}));
const order = computed(() => selectedOrder.value && ['COMPLETED', 'CANCELLED'].includes(selectedOrder.value.status) ? selectedOrder.value : null);
const checkoutSettlement = computed(() => {
  const metadata = order.value?.statusLogs?.find((log) => log.action === 'TABLE_SESSION_CHECKOUT')?.metadata;
  if (!metadata?.originalAmountVnd || !metadata.roundingAmountVnd || !metadata.payableAmountVnd) return null;
  return metadata;
});

async function refresh(showToast = true) {
  try {
    await ordersStore.fetchHistory({
      date: date.value,
      status: status.value === 'ALL' ? undefined : status.value as OrderStatus,
      orderType: orderType.value || undefined,
    });
  } catch {
    if (showToast && historyOrders.value.length) uiStore.pushToast(t('error.refreshFailed'), 'error');
  }
}

async function selectOrder(id: string) {
  await router.push({ name: 'order-history', params: { orderId: id } });
}

watch([date, status, orderType], () => { if (initialized.value) void refresh(false); });
watch(
  () => route.params.orderId,
  async (value) => {
    const sequence = ++routeSequence;
    const id = typeof value === 'string' ? value : '';
    if (!id) {
      await ordersStore.selectOrder(null);
      return;
    }
    try {
      const loaded = await ordersStore.selectOrder(id);
      if (sequence !== routeSequence || !loaded) return;
      if (!['COMPLETED', 'CANCELLED'].includes(loaded.status)) await router.replace(resolveOrderLocation(loaded));
    } catch {
      if (sequence === routeSequence) uiStore.pushToast(t('error.operationFailed'), 'error');
    }
  },
  { immediate: true },
);
onMounted(async () => { await refresh(false); initialized.value = true; });
</script>

<template>
  <section class="history-page" :class="{ 'has-selection': Boolean(order) }">
    <header class="workflow-page-header">
      <div><span>{{ t('orders.eyebrow') }}</span><h1>{{ t('orders.historyTitle') }}</h1><p>{{ t('orders.historyDescription') }}</p></div>
      <button type="button" class="workspace-action-button" :disabled="historyLoading" @click="refresh()"><RefreshCw :size="18" :class="{ spinning: historyLoading }" aria-hidden="true" />{{ t('common.refresh') }}</button>
    </header>
    <div class="history-workspace">
      <aside class="history-queue">
        <label class="workflow-search"><Search :size="17" aria-hidden="true" /><input v-model="query" :placeholder="t('orders.searchPlaceholder')" /></label>
        <div class="history-filters">
          <input v-model="date" type="date" :aria-label="t('orders.filterDate')" />
          <select v-model="status" :aria-label="t('orders.filterStatus')"><option value="ALL">{{ t('common.all') }}</option><option value="COMPLETED">{{ t('order.status.completed') }}</option><option value="CANCELLED">{{ t('order.status.cancelled') }}</option></select>
          <select v-model="orderType" :aria-label="t('orders.filterType')"><option value="">{{ t('filter.orderTypeAll') }}</option><option value="DINE_IN">{{ t('order.type.dineIn') }}</option><option value="PICKUP">{{ t('order.type.pickup') }}</option><option value="DELIVERY">{{ t('order.type.delivery') }}</option></select>
        </div>
        <LoadingState v-if="historyLoading && !historyOrders.length" :label="t('orders.loading')" />
        <ErrorState v-else-if="historyErrorKey && !historyOrders.length" :title="t('error.title')" :description="t(historyErrorKey)" :retry-label="t('common.retry')" @retry="refresh(false)" />
        <div v-else-if="filtered.length" class="history-queue__list">
          <button v-for="item in filtered" :key="item.id" type="button" :class="{ 'is-selected': item.id === order?.id }" @click="selectOrder(item.id)"><div><strong>#{{ item.orderNo }}</strong><OrderStatusBadge :status="item.status" /></div><span>{{ t(`order.type.${item.orderType === 'DINE_IN' ? 'dineIn' : item.orderType.toLowerCase()}`) }}</span><small>{{ formatVietnamDateTime(item.createdAt, locale) }}</small></button>
        </div>
        <EmptyState v-else :title="t('orders.historyEmptyTitle')" :description="t('orders.historyEmptyDescription')" />
      </aside>
      <main class="history-detail">
        <button type="button" class="mobile-workspace-back" @click="router.push('/orders/history')"><ArrowLeft :size="18" aria-hidden="true" />{{ t('fulfillment.backToList') }}</button>
        <LoadingState v-if="detailLoading" :label="t('orders.loading')" />
        <article v-else-if="order" class="history-detail__content">
          <header><div><span>{{ t(`order.type.${order.orderType === 'DINE_IN' ? 'dineIn' : order.orderType.toLowerCase()}`) }}</span><h2>#{{ order.orderNo }}</h2><p>{{ formatVietnamDateTime(order.createdAt, locale) }}</p></div><OrderStatusBadge :status="order.status" /></header>
          <OrderItemsSection :order="order" />
          <section v-if="order.customerRemark" class="workflow-section"><h3>{{ t('order.customerRemark') }}</h3><p>{{ order.customerRemark }}</p></section>
          <BillSummary :item-amount="order.itemAmountVnd" :delivery-fee="order.deliveryFeeVnd" :total-amount="order.totalAmountVnd" />
          <section v-if="checkoutSettlement" class="workflow-section order-checkout-settlement" data-testid="order-checkout-settlement">
            <h3>{{ t('table.checkoutSettlement') }}</h3>
            <dl>
              <div><dt>{{ t('table.originalAmount') }}</dt><dd>{{ formatVnd(checkoutSettlement.originalAmountVnd, locale) }}</dd></div>
              <div><dt>{{ t('table.roundingAmount') }}</dt><dd>{{ formatVnd(checkoutSettlement.roundingAmountVnd, locale) }}</dd></div>
              <div><dt>{{ t('table.receivedAmount') }}</dt><dd>{{ formatVnd(checkoutSettlement.payableAmountVnd, locale) }}</dd></div>
            </dl>
          </section>
          <PrintJobActions compact :order-id="order.id" />
        </article>
        <EmptyState v-else :title="t('order.detailEmptyTitle')" :description="t('order.detailEmptyDescription')" />
      </main>
    </div>
  </section>
</template>
