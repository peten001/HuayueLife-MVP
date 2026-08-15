<script setup lang="ts">
import { ArrowLeft, CalendarDays, ClipboardList, RefreshCw } from '@lucide/vue';
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { formatVietnamDateFilter, formatVietnamDateFilterAria, formatVietnamDateTime, formatVnd } from '@/domain';
import { getBusinessDaySummary, messageFromApiError, printBusinessDaySummary } from '@/api';
import { resolveOrderLocation } from '@/domain/order-location';
import { useI18n } from '@/i18n';
import { useOrdersStore, useUiStore } from '@/stores';
import type { BusinessDaySummary, MerchantOrder, OrderStatus, OrderType } from '@/types';
import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import LoadingState from '@/components/common/LoadingState.vue';
import OrderStatusBadge from '@/components/common/OrderStatusBadge.vue';
import BillSummary from '@/components/bills/BillSummary.vue';
import PrintJobActions from '@/components/printing/PrintJobActions.vue';
import FulfillmentProgressRail from '@/features/fulfillment/FulfillmentProgressRail.vue';
import WaitDuration from '@/features/fulfillment/WaitDuration.vue';
import DeliveryContactPanel from '@/features/delivery/DeliveryContactPanel.vue';
import OrderItemsSection from '@/features/fulfillment/OrderItemsSection.vue';
import BusinessDaySummaryDialog from '@/components/reports/BusinessDaySummaryDialog.vue';

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const ordersStore = useOrdersStore();
const uiStore = useUiStore();
const { historyOrders, selectedOrder, historyLoading, detailLoading, historyErrorKey } = storeToRefs(ordersStore);
const status = ref<'ALL' | 'COMPLETED' | 'CANCELLED'>('ALL');
const orderType = ref<'' | OrderType>('');
const date = ref('');
const dateInput = ref<HTMLInputElement | null>(null);
const initialized = ref(false);
const summaryOpen = ref(false);
const summaryLoading = ref(false);
const summaryPrinting = ref(false);
const summaryError = ref('');
const summaryStatus = ref('');
const summaryDate = ref('');
const businessSummary = ref<BusinessDaySummary | null>(null);
let routeSequence = 0;

const dateFilterLabel = computed(() => formatVietnamDateFilter(date.value, locale.value));
const dateFilterAriaLabel = computed(() => `${t('orders.filterDate')} ${formatVietnamDateFilterAria(date.value, locale.value)}`);

function openDatePicker(event: MouseEvent) {
  const input = dateInput.value;
  if (!input || typeof input.showPicker !== 'function') return;
  event.preventDefault();
  try {
    input.focus({ preventScroll: true });
    input.showPicker();
  } catch {
    // WebView 83 has no showPicker(); native click fallback remains available.
  }
}

const filtered = computed(() => historyOrders.value.filter((order) => {
  if (status.value !== 'ALL' && order.status !== status.value) return false;
  if (orderType.value && order.orderType !== orderType.value) return false;
  return true;
}));
const order = computed(() => selectedOrder.value && ['COMPLETED', 'CANCELLED'].includes(selectedOrder.value.status) ? selectedOrder.value : null);
const checkoutSettlement = computed(() => {
  const metadata = order.value?.statusLogs?.find((log) => log.action === 'TABLE_SESSION_CHECKOUT')?.metadata;
  if (!metadata?.originalAmountVnd || !metadata.roundingAmountVnd || !metadata.payableAmountVnd) return null;
  return metadata;
});
const orderPayableAmount = computed(() => order.value?.payableAmountVnd || order.value?.totalAmountVnd || '0');

function orderTypeKey(orderTypeValue: OrderType) {
  return orderTypeValue === 'DINE_IN' ? 'dineIn' : orderTypeValue.toLowerCase();
}

function orderItemCount(itemOrder: MerchantOrder) {
  return itemOrder.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function orderPrimaryLabel(itemOrder: MerchantOrder) {
  if (itemOrder.orderType === 'PICKUP') return itemOrder.pickupCode || itemOrder.orderNo;
  if (itemOrder.orderType === 'DINE_IN') return itemOrder.tableNoSnapshot || itemOrder.orderNo;
  return `#${itemOrder.orderNo}`;
}

function orderContext(itemOrder: MerchantOrder) {
  if (itemOrder.orderType === 'DINE_IN') return itemOrder.tableNoSnapshot || t('order.type.dineIn');
  if (itemOrder.orderType === 'PICKUP') return itemOrder.contactName || t('order.customerFallback');
  return itemOrder.deliveryAddress || t('order.deliveryAddressMissing');
}

function orderHistoryTime(itemOrder: MerchantOrder) {
  return itemOrder.completedAt || itemOrder.cancelledAt || itemOrder.updatedAt || itemOrder.createdAt;
}

async function refresh(showToast = true) {
  if (!date.value) return;
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

async function loadBusinessSummary(businessDate?: string) {
  if (businessDate) summaryDate.value = businessDate;
  summaryLoading.value = true;
  summaryError.value = '';
  summaryStatus.value = '';
  try {
    businessSummary.value = await getBusinessDaySummary(businessDate);
    summaryDate.value = businessSummary.value.businessDate;
    return businessSummary.value;
  } catch (caught) {
    summaryError.value = messageFromApiError(caught);
    return null;
  } finally {
    summaryLoading.value = false;
  }
}

async function openBusinessSummary() {
  summaryOpen.value = true;
  summaryDate.value = date.value;
  await loadBusinessSummary(date.value || undefined);
}

async function changeSummaryDate(businessDate: string) {
  summaryDate.value = businessDate;
  if (businessDate) await loadBusinessSummary(businessDate);
}

async function printSummary() {
  if (!businessSummary.value || summaryPrinting.value) return;
  summaryPrinting.value = true;
  summaryError.value = '';
  try {
    const randomPart = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await printBusinessDaySummary(
      businessSummary.value.businessDate,
      `cashier.business-summary.${randomPart}`,
    );
    summaryStatus.value = t('summary.printSuccess');
  } catch (caught) {
    summaryError.value = messageFromApiError(caught);
  } finally {
    summaryPrinting.value = false;
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
onMounted(async () => {
  const initialSummary = await loadBusinessSummary();
  date.value = initialSummary?.businessDate ?? new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  await refresh(false);
  initialized.value = true;
});
</script>

<template>
  <section class="history-page" :class="{ 'has-selection': Boolean(order) }">
    <div class="history-workspace">
      <aside class="history-queue">
        <div class="history-toolbar">
          <div class="history-mobile-filter-row--date">
            <label class="history-date-control" @click="openDatePicker">
              <CalendarDays :size="16" aria-hidden="true" />
              <span>{{ dateFilterLabel }}</span>
              <input ref="dateInput" v-model="date" type="date" :aria-label="dateFilterAriaLabel" />
            </label>
            <button type="button" class="workflow-refresh-button" :disabled="historyLoading" :aria-label="t('common.refresh')" :title="t('common.refresh')" @click="refresh()"><RefreshCw :size="17" :class="{ spinning: historyLoading }" aria-hidden="true" /></button>
            <button type="button" class="summary-open-button" @click="openBusinessSummary"><ClipboardList :size="17" aria-hidden="true" />{{ t('summary.open') }}</button>
          </div>
          <div class="history-mobile-filter-row--selects">
            <label><select v-model="orderType" :aria-label="t('orders.filterType')"><option value="">{{ t('filter.orderTypeAll') }}</option><option value="DINE_IN">{{ t('order.type.dineIn') }}</option><option value="PICKUP">{{ t('order.type.pickup') }}</option><option value="DELIVERY">{{ t('order.type.delivery') }}</option></select></label>
            <label><select v-model="status" :aria-label="t('orders.filterStatus')" :title="t('filter.orderStatusAll')"><option value="ALL">{{ t('filter.orderStatusAll') }}</option><option value="COMPLETED">{{ t('order.status.completed') }}</option><option value="CANCELLED">{{ t('order.status.cancelled') }}</option></select></label>
          </div>
        </div>
        <LoadingState v-if="historyLoading && !historyOrders.length" :label="t('orders.loading')" />
        <ErrorState v-else-if="historyErrorKey && !historyOrders.length" :title="t('error.title')" :description="t(historyErrorKey)" :retry-label="t('common.retry')" @retry="refresh(false)" />
        <div v-else-if="filtered.length" class="history-queue__list">
          <button v-for="item in filtered" :key="item.id" type="button" class="history-order-card" :class="{ 'is-selected': item.id === order?.id }" @click="selectOrder(item.id)">
            <div class="history-order-card__top"><strong>{{ orderPrimaryLabel(item) }}</strong><OrderStatusBadge :status="item.status" /><b>{{ formatVnd(item.payableAmountVnd || item.totalAmountVnd, locale) }}</b></div>
            <div class="history-order-card__context"><span>{{ t(`order.type.${orderTypeKey(item.orderType)}`) }}</span><span>{{ orderContext(item) }}</span></div>
            <div class="history-order-card__footer"><span>{{ t('table.itemCount', { count: orderItemCount(item) }) }}</span><small>{{ formatVietnamDateTime(orderHistoryTime(item), locale) }}</small></div>
          </button>
        </div>
        <EmptyState v-else :title="t('orders.historyEmptyTitle')" :description="t('orders.historyEmptyDescription')" />
      </aside>
      <main class="history-detail">
        <button type="button" class="mobile-workspace-back" @click="router.push('/orders/history')"><ArrowLeft :size="18" aria-hidden="true" />{{ t('fulfillment.backToList') }}</button>
        <LoadingState v-if="detailLoading" :label="t('orders.loading')" />
        <article v-else-if="order" class="history-detail__content">
          <header class="history-detail__identity"><strong>#{{ order.orderNo }}</strong><span>{{ t(`order.type.${orderTypeKey(order.orderType)}`) }}</span><OrderStatusBadge :status="order.status" /></header>
          <dl class="history-detail__facts">
            <div><dt>{{ t('fulfillment.duration') }}</dt><dd><WaitDuration :created-at="order.createdAt" :end-at="(order.status === 'COMPLETED' ? order.completedAt : order.cancelledAt) ?? undefined" compact /></dd></div>
            <div><dt>{{ t('order.createdAt') }}</dt><dd>{{ formatVietnamDateTime(order.createdAt, locale) }}</dd></div>
            <div v-if="order.status === 'COMPLETED' || order.status === 'CANCELLED'"><dt>{{ order.status === 'COMPLETED' ? t('order.status.completed') : t('order.status.cancelled') }}</dt><dd>{{ formatVietnamDateTime(orderHistoryTime(order), locale) }}</dd></div>
          </dl>
          <FulfillmentProgressRail v-if="order.orderType !== 'DINE_IN'" :order="order" show-current-status />
          <DeliveryContactPanel v-if="order.orderType === 'DELIVERY'" :order="order" />
          <OrderItemsSection :order="order" />
          <section v-if="order.customerRemark" class="workflow-section"><h3>{{ t('order.customerRemark') }}</h3><p>{{ order.customerRemark }}</p></section>
          <BillSummary :item-amount="order.itemAmountVnd" :delivery-fee="order.deliveryFeeVnd" :total-amount="orderPayableAmount" />
          <section v-if="BigInt(order.discountAmountVnd || '0') > 0n || order.roundingApplied" class="workflow-section order-checkout-settlement" data-testid="order-settlement-adjustment">
            <h3>{{ t('table.checkoutSettlement') }}</h3>
            <dl>
              <div><dt>{{ t('table.originalAmount') }}</dt><dd>{{ formatVnd(order.originalAmountVnd || order.totalAmountVnd, locale) }}</dd></div>
              <div v-if="BigInt(order.discountAmountVnd || '0') > 0n"><dt>{{ t('discount.amount') }}</dt><dd>-{{ formatVnd(order.discountAmountVnd || '0', locale) }}</dd></div>
              <div v-if="BigInt(order.roundingAmountVnd || '0') > 0n"><dt>{{ t('table.roundingAmount') }}</dt><dd>-{{ formatVnd(order.roundingAmountVnd || '0', locale) }}</dd></div>
              <div><dt>{{ t('discount.finalPayable') }}</dt><dd>{{ formatVnd(orderPayableAmount, locale) }}</dd></div>
            </dl>
          </section>
          <section v-if="checkoutSettlement" class="workflow-section order-checkout-settlement" data-testid="order-checkout-settlement">
            <h3>{{ t('table.checkoutSettlement') }}</h3>
            <dl>
              <div><dt>{{ t('table.originalAmount') }}</dt><dd>{{ formatVnd(checkoutSettlement.originalAmountVnd, locale) }}</dd></div>
              <div v-if="BigInt(checkoutSettlement.discountAmountVnd || '0') > 0n"><dt>{{ t('discount.amount') }}</dt><dd>-{{ formatVnd(checkoutSettlement.discountAmountVnd || '0', locale) }}</dd></div>
              <div v-if="BigInt(checkoutSettlement.roundingAmountVnd || '0') > 0n"><dt>{{ t('table.roundingAmount') }}</dt><dd>-{{ formatVnd(checkoutSettlement.roundingAmountVnd, locale) }}</dd></div>
              <div><dt>{{ t('discount.finalPayable') }}</dt><dd>{{ formatVnd(checkoutSettlement.finalPayableAmountVnd || checkoutSettlement.payableAmountVnd, locale) }}</dd></div>
            </dl>
          </section>
          <PrintJobActions compact :order-id="order.id" />
        </article>
        <EmptyState v-else :title="t('order.detailEmptyTitle')" :description="t('order.detailEmptyDescription')" />
      </main>
    </div>
    <BusinessDaySummaryDialog
      :open="summaryOpen"
      :business-date="summaryDate"
      :summary="businessSummary"
      :loading="summaryLoading"
      :printing="summaryPrinting"
      :error="summaryError"
      :status="summaryStatus"
      @cancel="summaryOpen = false"
      @date-change="changeSummaryDate"
      @print="printSummary"
    />
  </section>
</template>

<style scoped>
.summary-open-button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;gap:7px;border:1px solid var(--cashier-border);border-radius:11px;padding:0 13px;background:var(--cashier-surface);color:var(--cashier-action-primary);font:inherit;font-size:13px;font-weight:800;white-space:nowrap;cursor:pointer}
.summary-open-button:focus-visible{outline:3px solid var(--cashier-green-alpha-35);outline-offset:2px}
@media(max-width:700px){.summary-open-button{width:100%}}
</style>
