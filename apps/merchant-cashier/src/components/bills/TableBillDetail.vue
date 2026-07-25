<script setup lang="ts">
import { Minus, RotateCcw, UtensilsCrossed } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { canDecreaseOrderItems, canReturnOrderItems, formatVietnamTime, formatVnd, summarizeTableSessionItems } from '@/domain';
import { useI18n } from '@/i18n';
import type { MerchantOrder, OrderItem, TableCardView, TableSessionDetail, TableSessionOrder } from '@/types';
import EmptyState from '@/components/common/EmptyState.vue';
import OrderStatusBadge from '@/components/common/OrderStatusBadge.vue';
import DineInActionDock from '@/features/dine-in/DineInActionDock.vue';

const props = defineProps<{
  table?: TableCardView | null;
  session?: TableSessionDetail | null;
  order?: MerchantOrder | null;
  accepting?: boolean;
  checkingOut?: boolean;
  acceptDisabled?: boolean;
  checkoutDisabled?: boolean;
  actionsDisabled?: boolean;
  adjustmentLoadingId?: string;
  pendingAdjustmentItemId?: string;
  roundingApplied?: boolean;
  roundingAmount?: string;
  payableAmount?: string;
}>();

const emit = defineEmits<{
  orderItems: [];
  openOrder: [order: TableSessionOrder];
  decreaseItem: [item: OrderItem];
  returnItem: [item: OrderItem];
  accept: [];
  checkout: [];
  rounding: [];
}>();

const { t, locale } = useI18n();
const activeTab = ref<'items' | 'orders'>(props.order ? 'orders' : 'items');
const itemSummary = computed(() => summarizeTableSessionItems(props.session));
const pendingCount = computed(() => Number(props.session?.pendingOrderCount || 0));
const originalAmount = computed(() => props.session?.originalAmountVnd || props.session?.totalAmountVnd || '0');
const roundingAmount = computed(() => props.roundingApplied
  ? props.roundingAmount || props.session?.roundingAmountVnd || '0'
  : '0');
const receivedAmount = computed(() => props.payableAmount || props.session?.payableAmountVnd || originalAmount.value);
const canOrderItems = computed(() => props.session
  ? props.session.status === 'OPEN' && props.table?.status !== 'DISABLED'
  : props.table?.status === 'ACTIVE');
const canDecrease = computed(() => Boolean(props.order && canDecreaseOrderItems(props.order)));
const canReturn = computed(() => Boolean(props.order && canReturnOrderItems(props.order)));
const tableStatus = computed(() => props.table?.operationalStatus || 'IN_USE');
const tableStatusLabel = computed(() => {
  if (tableStatus.value === 'DISABLED') return t('table.status.disabled');
  if (tableStatus.value === 'AVAILABLE') return t('table.status.available');
  return t('table.status.inUse');
});

watch(() => props.session?.id, () => {
  activeTab.value = props.order ? 'orders' : 'items';
});
watch(() => props.order?.id, (orderId) => {
  if (orderId) activeTab.value = 'orders';
});

function orderItemCount(order: TableSessionOrder) {
  return (order.items || []).reduce((total, item) => total + Number(item.quantity || 0), 0);
}

function itemName(item: OrderItem) {
  if (locale.value === 'vi') return item.productNameViSnapshot || item.productNameZhSnapshot || t('order.itemNameFallback');
  if (locale.value === 'en') return item.productNameEnSnapshot || item.productNameZhSnapshot || t('order.itemNameFallback');
  return item.productNameZhSnapshot || t('order.itemNameFallback');
}

function adjustmentDisabled(itemId: string) {
  return Boolean(
    props.actionsDisabled
    || props.adjustmentLoadingId
    || (props.pendingAdjustmentItemId && props.pendingAdjustmentItemId !== itemId),
  );
}
</script>

<template>
  <div v-if="session" class="detail-panel-content table-bill-detail" data-testid="table-detail">
    <header class="table-detail-header">
      <div class="table-detail-header__line">
        <h3>{{ session.tableNo || table?.tableNo || t('table.numberFallback') }}</h3>
        <span :class="`table-detail-state table-detail-state--${tableStatus.toLowerCase().replace(/_/g, '-')}`">
          {{ tableStatusLabel }}
        </span>
        <span class="table-detail-header__meta">{{ t('table.openedAtValue', { time: formatVietnamTime(session.openedAt, locale) }) }} | {{ t('table.orderCountCompact', { count: session.orderCount || 0 }) }}</span>
      </div>
    </header>

    <section class="detail-section table-bill-content">
      <div class="table-detail-tabs" role="tablist" :aria-label="t('bill.tableBill')" data-testid="table-detail-tabs">
        <button type="button" role="tab" data-testid="table-summary-tab" :aria-selected="activeTab === 'items'" :class="{ 'is-active': activeTab === 'items' }" @click="activeTab = 'items'">
          {{ t('bill.itemSummary') }}
        </button>
        <button type="button" role="tab" data-testid="table-orders-tab" :aria-selected="activeTab === 'orders'" :class="{ 'is-active': activeTab === 'orders' }" @click="activeTab = 'orders'">
          {{ t('bill.orderDetails') }}
        </button>
      </div>

      <div class="table-bill-scroll" data-testid="table-bill-scroll">
        <div v-if="activeTab === 'items'" class="table-item-summary-list" data-testid="table-item-summary">
          <article v-for="item in itemSummary" :key="item.name" class="table-item-summary-row">
            <strong>{{ item.name }}</strong>
            <span>{{ t('order.quantity', { count: item.quantity }) }}</span>
            <b>{{ formatVnd(item.subtotalVnd, locale) }}</b>
          </article>
          <p v-if="!itemSummary.length" class="table-detail-empty">{{ t('bill.itemSummaryEmpty') }}</p>
        </div>

        <div v-else class="table-order-browser" data-testid="table-order-details">
          <div class="bill-order-list">
            <button
              v-for="sessionOrder in session.orders || []"
              :key="sessionOrder.id"
              type="button"
              class="bill-order-row"
              :class="{ 'is-selected': sessionOrder.id === order?.id }"
              @click="emit('openOrder', sessionOrder)"
            >
              <div class="bill-order-row__heading">
                <strong>#{{ sessionOrder.orderNo || t('order.numberFallback') }}</strong>
                <OrderStatusBadge :status="sessionOrder.status" />
              </div>
              <div class="bill-order-row__meta">
                <span>{{ formatVietnamTime(sessionOrder.createdAt, locale) }}</span>
                <b>{{ formatVnd(sessionOrder.totalAmountVnd, locale) }}</b>
                <span>{{ t('table.itemCount', { count: orderItemCount(sessionOrder) }) }}</span>
              </div>
            </button>
          </div>

          <section v-if="order" class="table-selected-order" data-testid="table-selected-order">
            <header>
              <div>
                <span>{{ t('table.orderDetail') }}</span>
                <strong>#{{ order.orderNo }}</strong>
                <small class="table-selected-order__source">
                  {{ order.createdByStaffId ? t('table.orderSource.staff') : t('table.orderSource.qr') }}
                </small>
              </div>
              <OrderStatusBadge :status="order.status" />
            </header>
            <p v-if="order.customerRemark" class="detail-remark">{{ t('order.customerRemark') }}：{{ order.customerRemark }}</p>
            <div class="table-selected-order__items">
              <article v-for="item in order.items" :key="item.id" class="table-selected-order__item">
                <div>
                  <strong>{{ itemName(item) }}</strong>
                  <small v-if="item.remark">{{ t('order.itemRemark', { remark: item.remark }) }}</small>
                </div>
                <span>{{ t('order.quantity', { count: item.quantity }) }}</span>
                <span>{{ formatVnd(item.unitPriceVnd || '0', locale) }}</span>
                <b>{{ formatVnd(item.subtotalVnd, locale) }}</b>
                <button
                  v-if="canDecrease || pendingAdjustmentItemId === item.id"
                  type="button"
                  class="order-item-adjustment order-item-adjustment--decrease"
                  data-testid="decrease-order-item"
                  :disabled="adjustmentDisabled(item.id)"
                  @click="emit('decreaseItem', item)"
                ><Minus :size="14" aria-hidden="true" />{{ pendingAdjustmentItemId === item.id && !adjustmentLoadingId ? t('mutation.retrySameRequest') : t('itemAdjustment.decrease') }}</button>
                <button
                  v-else-if="canReturn"
                  type="button"
                  class="order-item-adjustment order-item-adjustment--return"
                  data-testid="return-order-item"
                  :disabled="adjustmentDisabled(item.id)"
                  @click="emit('returnItem', item)"
                ><RotateCcw :size="14" aria-hidden="true" />{{ t('itemAdjustment.return') }}</button>
              </article>
            </div>
          </section>
        </div>
      </div>
    </section>

    <dl class="table-settlement-summary" data-testid="table-settlement-summary">
      <div><dt>{{ t('table.originalAmount') }}</dt><dd>{{ formatVnd(originalAmount, locale) }}</dd></div>
      <div><dt>{{ t('table.roundingAmount') }}</dt><dd>{{ formatVnd(roundingAmount, locale) }}</dd></div>
      <div><dt>{{ t('table.receivedAmount') }}</dt><dd>{{ formatVnd(receivedAmount, locale) }}</dd></div>
    </dl>
    <p class="table-rounding-rule" data-testid="table-rounding-rule">{{ t('table.roundingRule') }}</p>

    <div class="table-bill-total-row">
      <button v-if="canOrderItems" type="button" class="secondary-action" data-testid="table-order-items" :disabled="actionsDisabled" @click="emit('orderItems')">
        <UtensilsCrossed :size="15" aria-hidden="true" />{{ t('table.addItems') }}
      </button>
      <button type="button" class="secondary-action" data-testid="table-rounding" :disabled="actionsDisabled" @click="emit('rounding')">
        {{ props.roundingApplied ? t('table.cancelRounding') : t('table.rounding') }}
      </button>
      <strong>{{ t('table.total') }} {{ formatVnd(receivedAmount, locale) }}</strong>
    </div>

    <p v-if="pendingCount" class="detail-notice dinein-checkout-notice">
      {{ t('table.checkoutBlocked', { count: pendingCount }) }}
    </p>

    <DineInActionDock
      :session-id="session.id"
      :accept-disabled="acceptDisabled"
      :checkout-disabled="checkoutDisabled"
      :accepting="accepting"
      :checking-out="checkingOut"
      :actions-disabled="actionsDisabled"
      @accept="emit('accept')"
      @checkout="emit('checkout')"
    />
  </div>

  <div v-else-if="table" class="detail-panel-content table-empty-detail" data-testid="table-detail">
    <header class="table-detail-header">
      <div class="table-detail-header__line">
        <h3>{{ table.tableNo || t('table.numberFallback') }}</h3>
        <span class="table-detail-state table-detail-state--available">{{ t('table.status.available') }}</span>
      </div>
    </header>
    <EmptyState :title="t('table.selectedEmptyTitle')" :description="t('table.selectedEmptyDescription')" />
    <div v-if="canOrderItems" class="detail-action-stack table-detail-actions">
      <button type="button" class="secondary-action table-order-items-action" data-testid="table-order-items" :disabled="actionsDisabled" @click="emit('orderItems')">
        <UtensilsCrossed :size="18" aria-hidden="true" />{{ t('table.openTable') }}
      </button>
    </div>
  </div>

  <EmptyState v-else :title="t('table.detailEmptyTitle')" :description="t('table.detailEmptyDescription')" />
</template>
