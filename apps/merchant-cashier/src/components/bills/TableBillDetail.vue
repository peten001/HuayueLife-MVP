<script setup lang="ts">
import { BriefcaseBusiness, Clock3, Users } from '@lucide/vue';
import { computed } from 'vue';
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

defineEmits<{
  closeSession: [];
}>();

const { t, locale } = useI18n();
const canClose = computed(
  () => props.session?.status === 'OPEN' && Number(props.session.unfinishedOrderCount || 0) === 0,
);
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
        <span :title="t('table.guestCountUnknown')"><Users :size="16" aria-hidden="true" />—</span>
        <i aria-hidden="true">|</i>
        <span>{{ t('table.openedAtValue', { time: formatVietnamTime(session.openedAt, locale) }) }}</span>
        <i aria-hidden="true">|</i>
        <span><Clock3 :size="16" aria-hidden="true" />{{ durationLabel }}</span>
      </p>
    </header>

    <section class="detail-section table-bill-orders">
      <div class="detail-section__heading">
        <h4>{{ t('bill.orders') }}</h4>
        <span>{{ t('bill.orderCountShort', { count: session.orderCount || 0 }) }}</span>
      </div>
      <div class="bill-order-list">
        <article v-for="order in session.orders || []" :key="order.id" class="bill-order-row">
          <div class="bill-order-row__heading">
            <strong>#{{ order.orderNo || t('order.numberFallback') }}</strong>
            <OrderStatusBadge :status="order.status" />
          </div>
          <div class="bill-order-row__meta">
            <span>{{ formatVietnamTime(order.createdAt, locale) }}</span>
            <b>{{ formatVnd(order.totalAmountVnd, locale) }}</b>
            <span>{{ t('table.itemCount', { count: orderItemCount(order) }) }}</span>
          </div>
        </article>

        <section v-if="itemSummary.length" class="table-bill-item-summary">
          <div class="table-bill-item-summary__heading">
            <strong>{{ t('bill.itemSummary') }}</strong>
            <span>{{ t('order.itemKinds', { count: itemSummary.length }) }}</span>
          </div>
          <ul>
            <li v-for="item in itemSummary" :key="item.name">
              <span>{{ item.name }} × {{ item.quantity }}</span>
              <b>{{ formatVnd(item.subtotalVnd, locale) }}</b>
            </li>
          </ul>
        </section>
      </div>
    </section>

    <BillSummary :item-amount="session.totalAmountVnd" :total-amount="session.totalAmountVnd" />

    <PrintJobActions :table-session-id="session.id" :disabled="actionsDisabled" />

    <p v-if="Number(session.unfinishedOrderCount || 0) > 0" class="detail-notice">
      {{ t('table.closeBlocked', { count: session.unfinishedOrderCount || 0 }) }}
    </p>

    <div class="detail-action-stack">
      <button
        type="button"
        class="primary-action table-close-action"
        :disabled="!canClose || closing || actionsDisabled"
        @click="$emit('closeSession')"
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
