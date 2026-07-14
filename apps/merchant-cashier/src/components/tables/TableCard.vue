<script setup lang="ts">
import { Clock3, ReceiptText, Utensils } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import { formatVnd } from '@/domain';
import { elapsedDuration, type CashierTableView } from '@/components/common/view-models';

const props = defineProps<{
  table: CashierTableView;
  selected?: boolean;
}>();

defineEmits<{
  select: [tableId: string];
}>();

const { t, locale } = useI18n();
const status = computed(() => props.table.operationalStatus ?? (
  props.table.status === 'DISABLED' ? 'DISABLED' : props.table.currentSession ? 'IN_USE' : 'AVAILABLE'
));
const disabled = computed(() => status.value === 'DISABLED');
const duration = computed(() => elapsedDuration(props.table.currentSession?.openedAt));
const stateLabel = computed(() => {
  if (status.value === 'DISABLED') return t('table.status.disabled');
  if (status.value === 'READY_TO_CLOSE') return t('table.status.readyToClose');
  if (status.value === 'IN_USE') return t('table.status.inUse');
  return t('table.status.available');
});
const durationLabel = computed(() => {
  if (!duration.value) return '';
  if (duration.value.abnormal) return t('table.timeAbnormal');
  if (!duration.value.hours) return t('table.durationMinutes', { minutes: duration.value.minutes });
  return t('table.durationHoursMinutes', { hours: duration.value.hours, minutes: duration.value.minutes });
});
</script>

<template>
  <button
    type="button"
    class="table-card"
    :class="[
      `table-card--${status.toLowerCase().replace(/_/g, '-')}`,
      { 'table-card--selected': selected },
    ]"
    :disabled="disabled"
    @click="$emit('select', table.id)"
  >
    <span class="table-card__topline">
      <strong>{{ table.tableName || t('table.displayName', { number: table.tableNo || t('table.numberFallback') }) }}</strong>
      <span class="table-card__state">{{ stateLabel }}</span>
    </span>
    <small class="table-card__number">{{ table.tableNo || t('table.numberFallback') }}</small>

    <template v-if="table.currentSession">
      <b class="table-card__amount">{{ formatVnd(table.currentSession.totalAmountVnd, locale) }}</b>
      <span class="table-card__meta">
        <span><ReceiptText :size="14" aria-hidden="true" />{{ t('table.orderCount', { count: table.currentSession.orderCount || 0 }) }}</span>
        <span :class="{ 'is-abnormal': duration?.abnormal }"><Clock3 :size="14" aria-hidden="true" />{{ durationLabel }}</span>
      </span>
    </template>
    <span v-else class="table-card__available-hint">
      <Utensils :size="15" aria-hidden="true" />
      {{ t('table.availableHint') }}
    </span>
  </button>
</template>
