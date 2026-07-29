<script setup lang="ts">
import { Minus, UtensilsCrossed } from '@lucide/vue';
import { computed } from 'vue';
import { canDecreaseOrderItems, canReturnOrderItems, formatVietnamTime, formatVnd, resolveLocalizedOrderItemName } from '@/domain';
import { useI18n } from '@/i18n';
import type { OrderItem, TableCardView, TableSessionDetail, TableSessionOrder } from '@/types';
import EmptyState from '@/components/common/EmptyState.vue';
import DineInActionDock from '@/features/dine-in/DineInActionDock.vue';

const props = defineProps<{
  table?: TableCardView | null;
  session?: TableSessionDetail | null;
  checkingOut?: boolean;
  checkoutDisabled?: boolean;
  actionsDisabled?: boolean;
  adjustmentLoadingId?: string;
  pendingAdjustmentItemId?: string;
  roundingApplied?: boolean;
  payableAmount?: string;
}>();

const emit = defineEmits<{
  orderItems: [];
  decreaseItem: [item: OrderItem, order: TableSessionOrder];
  returnItem: [item: OrderItem, order: TableSessionOrder];
  checkout: [];
  rounding: [];
}>();

const { t, locale } = useI18n();
const receivedAmount = computed(() => props.payableAmount || props.session?.payableAmountVnd || props.session?.totalAmountVnd || '0');
const sessionItems = computed(() => (props.session?.orders || []).flatMap((order) => order.items.map((item) => ({ item, order }))));
const totalDishQuantity = computed(() => sessionItems.value.reduce((total, { item }) => total + Number(item.quantity || 0), 0));
const dishCountLabel = computed(() => t(totalDishQuantity.value === 1 ? 'table.dishCountOne' : 'table.dishCount', { count: totalDishQuantity.value }));
const canOrderItems = computed(() => props.session
  ? props.session.status === 'OPEN' && props.table?.status !== 'DISABLED'
  : props.table?.status === 'ACTIVE');
const tableStatus = computed(() => props.table?.operationalStatus || 'IN_USE');
const tableStatusLabel = computed(() => {
  if (tableStatus.value === 'DISABLED') return t('table.status.disabled');
  if (tableStatus.value === 'AVAILABLE') return t('table.status.available');
  return t('table.status.inUse');
});

function adjustmentDisabled(itemId: string) {
  return Boolean(
    props.actionsDisabled
    || props.adjustmentLoadingId
    || (props.pendingAdjustmentItemId && props.pendingAdjustmentItemId !== itemId),
  );
}

function sourceLabel(order: TableSessionOrder) {
  return order.createdByStaffId ? t('table.orderSource.staffShort') : t('table.orderSource.qrShort');
}

function sourceDescription(order: TableSessionOrder) {
  return order.createdByStaffId ? t('table.orderSource.staff') : t('table.orderSource.qr');
}

function itemName(item: OrderItem) {
  return resolveLocalizedOrderItemName(item, locale.value, t('order.itemNameFallback'));
}

function canAdjust(item: OrderItem, order: TableSessionOrder) {
  if (props.session?.status !== 'OPEN') return false;
  if (Number(item.quantity || 0) <= 0) return false;
  const context = { orderType: 'DINE_IN' as const, tableSessionId: props.session.id, status: order.status };
  return canDecreaseOrderItems(context) || canReturnOrderItems(context);
}

function adjustmentTitle(item: OrderItem, order: TableSessionOrder) {
  if (Number(item.quantity || 0) <= 0) return t('itemAdjustment.noReturnableQuantity');
  return canAdjust(item, order)
    ? t('itemAdjustment.decrease')
    : t('itemAdjustment.unavailable');
}

function emitItemAdjustment(item: OrderItem, order: TableSessionOrder) {
  if (!canAdjust(item, order) || !props.session) return;
  if (canReturnOrderItems({ orderType: 'DINE_IN', tableSessionId: props.session.id, status: order.status })) {
    emit('returnItem', item, order);
    return;
  }
  emit('decreaseItem', item, order);
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
        <span class="table-detail-header__meta">{{ t('table.openedAtValue', { time: formatVietnamTime(session.openedAt, locale) }) }} | {{ dishCountLabel }}</span>
      </div>
    </header>

    <section class="detail-section table-bill-content">
      <div class="table-bill-scroll" data-testid="table-bill-scroll">
        <div class="table-item-summary-list" data-testid="table-item-summary">
          <article v-for="entry in sessionItems" :key="`${entry.order.id}-${entry.item.id}`" class="table-item-summary-row">
            <span class="table-item-summary-row__source" :title="sourceDescription(entry.order)" :aria-label="sourceDescription(entry.order)">{{ sourceLabel(entry.order) }}</span>
            <strong :title="itemName(entry.item)">{{ itemName(entry.item) }}</strong>
            <span>{{ t('order.quantity', { count: entry.item.quantity }) }}</span>
            <b>{{ formatVnd(entry.item.subtotalVnd, locale) }}</b>
            <button
              type="button"
              class="order-item-adjustment order-item-adjustment--decrease"
              data-testid="decrease-order-item"
              :aria-label="`${t('itemAdjustment.decrease')} ${itemName(entry.item)}`"
              :disabled="adjustmentDisabled(entry.item.id) || !canAdjust(entry.item, entry.order)"
              :title="adjustmentTitle(entry.item, entry.order)"
              @click="emitItemAdjustment(entry.item, entry.order)"
            ><Minus :size="14" aria-hidden="true" />{{ t('itemAdjustment.decrease') }}</button>
          </article>
          <p v-if="!sessionItems.length" class="table-detail-empty">{{ t('bill.itemSummaryEmpty') }}</p>
        </div>
      </div>
    </section>

    <div class="table-bill-total-row dinein-summary-row">
      <button v-if="canOrderItems" type="button" class="secondary-action dinein-action-button" data-testid="table-order-items" :disabled="actionsDisabled" @click="emit('orderItems')">
        <UtensilsCrossed :size="18" aria-hidden="true" />{{ t('table.addItems') }}
      </button>
      <strong :title="formatVnd(receivedAmount, locale)">{{ t('table.total') }} {{ formatVnd(receivedAmount, locale) }}</strong>
    </div>

    <DineInActionDock
      :session-id="session.id"
      :checkout-disabled="checkoutDisabled"
      :checking-out="checkingOut"
      :actions-disabled="actionsDisabled"
      :rounding-applied="roundingApplied"
      @rounding="emit('rounding')"
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
