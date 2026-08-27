<script setup lang="ts">
import { Clock3, ReceiptText } from '@lucide/vue';
import { computed } from 'vue';
import { formatVnd } from '@/domain';
import { useI18n } from '@/i18n';
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
// A table can be disabled administratively while an already-open session still
// owns it. Keep that session reachable so the cashier can print, accept and
// checkout; once released, the disabled table becomes non-interactive again.
const disabled = computed(() => status.value === 'DISABLED' && !props.table.currentSession);
const duration = computed(() => elapsedDuration(props.table.currentSession?.openedAt));
const stateLabel = computed(() => {
  if (status.value === 'DISABLED') return t('table.status.disabled');
  if (status.value === 'IN_USE') return t('table.status.inUse');
  return t('table.status.available');
});
const durationLabel = computed(() => {
  if (!duration.value) return '';
  if (duration.value.abnormal) return t('table.timeAbnormal');
  if (!duration.value.hours) return t('table.durationMinutesCompact', { minutes: duration.value.minutes });
  return t('table.durationHoursMinutesCompact', { hours: duration.value.hours, minutes: duration.value.minutes });
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
    :data-testid="`table-card-${table.id}`"
    :data-status="status"
    :disabled="disabled"
    @click="$emit('select', table.id)"
  >
    <span class="table-card__topline">
      <strong>{{ table.tableNo || t('table.numberFallback') }}</strong>
      <span class="table-card__state">{{ stateLabel }}</span>
    </span>

    <span v-if="table.currentSession" class="table-card__meta">
      <span v-if="durationLabel" :class="{ 'is-abnormal': duration?.abnormal }">
        <Clock3 :size="17" :stroke-width="1.9" aria-hidden="true" />{{ durationLabel || '—' }}
      </span>
      <span class="table-card__orders">
        <ReceiptText :size="17" :stroke-width="1.9" aria-hidden="true" />
        {{ t('table.orderDishCountCompact', {
          orders: table.currentSession.orderCount || 0,
          dishes: table.currentSession.itemCount || 0,
        }) }}
      </span>
    </span>
    <span v-if="table.currentSession" class="table-card__amount">{{ formatVnd(table.currentSession.totalAmountVnd || '0', locale) }}</span>
    <span v-else-if="disabled" class="table-card__disabled-hint">
      {{ t('table.disabledHint') }}
    </span>
  </button>
</template>
