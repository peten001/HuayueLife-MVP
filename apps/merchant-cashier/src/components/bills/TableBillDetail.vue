<script setup lang="ts">
import { Clock3, DoorClosed, ReceiptText, Table2 } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import EmptyState from '@/components/common/EmptyState.vue';
import OrderStatusBadge from '@/components/common/OrderStatusBadge.vue';
import BillSummary from './BillSummary.vue';
import { formatVietnamDateTime, formatVnd } from '@/domain';
import {
  elapsedDuration,
  type CashierTableSessionDetailView,
  type CashierTableView,
} from '@/components/common/view-models';

const props = defineProps<{
  table?: CashierTableView | null;
  session?: CashierTableSessionDetailView | null;
  closing?: boolean;
}>();

defineEmits<{
  closeSession: [];
}>();

const { t, locale } = useI18n();
const canClose = computed(
  () => props.session?.status === 'OPEN' && Number(props.session.unfinishedOrderCount || 0) === 0,
);
const duration = computed(() => elapsedDuration(props.session?.openedAt));
const durationLabel = computed(() => {
  if (!duration.value) return t('common.notAvailable');
  if (duration.value.abnormal) return t('table.timeAbnormal');
  return duration.value.hours
    ? t('table.durationHoursMinutes', { hours: duration.value.hours, minutes: duration.value.minutes })
    : t('table.durationMinutes', { minutes: duration.value.minutes });
});
</script>

<template>
  <div v-if="session" class="detail-panel-content table-bill-detail">
    <header class="detail-panel-header">
      <span class="detail-panel-header__icon" aria-hidden="true"><ReceiptText :size="23" /></span>
      <div>
        <span>{{ t('bill.tableBill') }}</span>
        <h3>{{ table?.tableName || t('table.displayName', { number: session.tableNo || t('table.numberFallback') }) }}</h3>
      </div>
    </header>

    <dl class="detail-facts detail-facts--grid">
      <div><dt>{{ t('table.sessionNo') }}</dt><dd>{{ session.sessionNo || t('common.notAvailable') }}</dd></div>
      <div><dt>{{ t('table.openedAt') }}</dt><dd>{{ formatVietnamDateTime(session.openedAt, locale) }}</dd></div>
      <div><dt>{{ t('table.elapsed') }}</dt><dd><Clock3 :size="14" aria-hidden="true" />{{ durationLabel }}</dd></div>
      <div><dt>{{ t('table.itemCountLabel') }}</dt><dd>{{ t('table.itemCount', { count: session.itemCount || 0 }) }}</dd></div>
    </dl>

    <section class="detail-section detail-section--scrollable">
      <div class="detail-section__heading">
        <h4>{{ t('bill.orders') }}</h4>
        <span>{{ t('table.orderCount', { count: session.orderCount || 0 }) }}</span>
      </div>
      <div class="bill-order-list">
        <article v-for="order in session.orders || []" :key="order.id" class="bill-order-row">
          <div>
            <strong>{{ order.orderNo || t('order.numberFallback') }}</strong>
            <small>{{ formatVietnamDateTime(order.createdAt, locale) }}</small>
          </div>
          <OrderStatusBadge :status="order.status" />
          <b>{{ formatVnd(order.totalAmountVnd, locale) }}</b>
        </article>
      </div>
    </section>

    <BillSummary :item-amount="session.totalAmountVnd" :total-amount="session.totalAmountVnd" />

    <p v-if="!canClose" class="detail-notice">
      {{ t('table.closeBlocked', { count: session.unfinishedOrderCount || 0 }) }}
    </p>

    <div class="detail-action-stack">
      <button
        type="button"
        class="primary-action"
        :disabled="!canClose || closing"
        @click="$emit('closeSession')"
      >
        <DoorClosed :size="19" aria-hidden="true" />
        {{ closing ? t('table.closingSession') : t('table.closeSession') }}
      </button>
    </div>
  </div>

  <div v-else-if="table" class="detail-panel-content table-empty-detail">
    <header class="detail-panel-header">
      <span class="detail-panel-header__icon" aria-hidden="true"><Table2 :size="23" /></span>
      <div>
        <span>{{ t('table.detailTitle') }}</span>
        <h3>{{ table.tableName || t('table.displayName', { number: table.tableNo || t('table.numberFallback') }) }}</h3>
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
