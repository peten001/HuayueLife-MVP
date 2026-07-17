<script setup lang="ts">
import { BriefcaseBusiness, Clock3, ListOrdered, UtensilsCrossed } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from '@/i18n';
import EmptyState from '@/components/common/EmptyState.vue';
import OrderStatusBadge from '@/components/common/OrderStatusBadge.vue';
import BillSummary from './BillSummary.vue';
import PrintJobActions from '@/components/printing/PrintJobActions.vue';
import { formatVietnamTime, formatVnd, summarizeTableSessionItems } from '@/domain';
import {
  elapsedDuration,
} from '@/components/common/view-models';
import type { TableCardView, TableSessionDetail, TableSessionOrder } from '@/types';

const props = defineProps<{
  table?: TableCardView | null;
  session?: TableSessionDetail | null;
  closing?: boolean;
  actionsDisabled?: boolean;
}>();

const emit = defineEmits<{
  closeSession: [];
  openOrder: [order: TableSessionOrder];
  orderItems: [];
}>();

const { t, locale } = useI18n();
const activeTab = ref<'items' | 'orders'>('items');
const canClose = computed(
  () => props.session?.status === 'OPEN' && Number(props.session.unfinishedOrderCount || 0) === 0,
);
const canOrderItems = computed(() => props.session?.status === 'OPEN');
const duration = computed(() => elapsedDuration(props.session?.openedAt));
const itemSummary = computed(() => summarizeTableSessionItems(props.session));
const durationLabel = computed(() => {
  if (!duration.value) return t('common.notAvailable');
  if (duration.value.abnormal) return t('table.timeAbnormal');
  return duration.value.hours
    ? t('table.durationHoursMinutes', { hours: duration.value.hours, minutes: duration.value.minutes })
    : t('table.durationMinutes', { minutes: duration.value.minutes });
});
const tableStatus = computed(() => props.table?.operationalStatus || 'IN_USE');
const tableStatusLabel = computed(() => {
  if (tableStatus.value === 'DISABLED') return t('table.status.disabled');
  if (tableStatus.value === 'AVAILABLE') return t('table.status.available');
  return t('table.status.inUse');
});

function orderItemCount(order: TableSessionOrder) {
  return (order.items || []).reduce((total, item) => total + Number(item.quantity || 0), 0);
}

watch(
  () => props.session?.id,
  () => {
    activeTab.value = 'items';
  },
);
</script>

<template>
  <div v-if="session" class="detail-panel-content table-bill-detail" data-testid="table-detail">
    <header class="table-detail-header">
      <span>{{ t('table.currentTable') }}</span>
      <div class="table-detail-header__title">
        <h3>{{ session.tableNo || table?.tableNo || t('table.numberFallback') }}</h3>
        <span :class="`table-detail-state table-detail-state--${tableStatus.toLowerCase().replace(/_/g, '-')}`">
          {{ tableStatusLabel }}
        </span>
      </div>
      <p>
        <span>{{ t('table.openedAtValue', { time: formatVietnamTime(session.openedAt, locale) }) }}</span>
        <i aria-hidden="true">|</i>
        <span><Clock3 :size="16" aria-hidden="true" />{{ durationLabel }}</span>
        <i aria-hidden="true">|</i>
        <span><ListOrdered :size="16" aria-hidden="true" />{{ t('table.orderCount', { count: session.orderCount || 0 }) }}</span>
      </p>
    </header>

    <section class="detail-section table-bill-content">
      <div class="table-detail-tabs" role="tablist" :aria-label="t('bill.tableBill')" data-testid="table-detail-tabs">
        <button
          type="button"
          role="tab"
          data-testid="table-summary-tab"
          :aria-selected="activeTab === 'items'"
          :class="{ 'is-active': activeTab === 'items' }"
          @click="activeTab = 'items'"
        >
          {{ t('bill.itemSummary') }}
        </button>
        <button
          type="button"
          role="tab"
          data-testid="table-orders-tab"
          :aria-selected="activeTab === 'orders'"
          :class="{ 'is-active': activeTab === 'orders' }"
          @click="activeTab = 'orders'"
        >
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

        <div v-else class="bill-order-list" data-testid="table-order-details">
          <button
            v-for="order in session.orders || []"
            :key="order.id"
            type="button"
            class="bill-order-row"
            @click="$emit('openOrder', order)"
          >
          <div class="bill-order-row__heading">
            <strong>#{{ order.orderNo || t('order.numberFallback') }}</strong>
            <OrderStatusBadge :status="order.status" />
          </div>
          <div class="bill-order-row__meta">
            <span>{{ formatVietnamTime(order.createdAt, locale) }}</span>
            <b>{{ formatVnd(order.totalAmountVnd, locale) }}</b>
            <span>{{ t('table.itemCount', { count: orderItemCount(order) }) }}</span>
          </div>
          </button>
        </div>
      </div>
    </section>

    <BillSummary :item-amount="session.totalAmountVnd" :total-amount="session.totalAmountVnd" />

    <p v-if="Number(session.unfinishedOrderCount || 0) > 0" class="detail-notice">
      {{ t('table.closeBlocked', { count: session.unfinishedOrderCount || 0 }) }}
    </p>

    <div class="detail-action-stack table-detail-actions" data-testid="table-detail-actions">
      <button
        v-if="canOrderItems"
        type="button"
        class="secondary-action table-order-items-action"
        data-testid="table-order-items"
        :disabled="actionsDisabled"
        @click="emit('orderItems')"
      >
        <UtensilsCrossed :size="18" aria-hidden="true" />
        {{ t('ordering.action') }}
      </button>
      <PrintJobActions compact :table-session-id="session.id" :disabled="actionsDisabled" />
      <button
        type="button"
        class="primary-action table-close-action"
        :disabled="!canClose || closing || actionsDisabled"
        @click="emit('closeSession')"
      >
        <BriefcaseBusiness :size="20" :stroke-width="1.9" aria-hidden="true" />
        {{ closing ? t('table.closingSession') : t('table.closeSession') }}
      </button>
    </div>
  </div>

  <div v-else-if="table" class="detail-panel-content table-empty-detail">
    <header class="table-detail-header">
      <span>{{ t('table.currentTable') }}</span>
      <div class="table-detail-header__title">
        <h3>{{ table.tableNo || t('table.numberFallback') }}</h3>
        <span class="table-detail-state table-detail-state--available">{{ t('table.status.available') }}</span>
      </div>
    </header>
    <EmptyState
      :title="t('table.selectedEmptyTitle')"
      :description="t('table.selectedEmptyDescription')"
    />
  </div>

  <EmptyState
    v-else
    :title="t('table.detailEmptyTitle')"
    :description="t('table.detailEmptyDescription')"
  />
</template>
