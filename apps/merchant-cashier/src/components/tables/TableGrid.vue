<script setup lang="ts">
import { useI18n } from '@/i18n';
import EmptyState from '@/components/common/EmptyState.vue';
import TableCard from './TableCard.vue';
import type { CashierTableView } from '@/components/common/view-models';
import type { ArrivalReservation } from '@huayue-life/shared';

defineProps<{
  tables: CashierTableView[];
  selectedTableId?: string;
  reservationsByTable?: Record<string, ArrivalReservation[]>;
}>();

defineEmits<{
  select: [tableId: string];
}>();

const { t } = useI18n();
</script>

<template>
  <div v-if="tables.length" class="table-grid" :class="{ 'table-grid--reservations': tables.some(table => reservationsByTable?.[table.id]?.length) }" data-testid="table-grid">
    <TableCard
      v-for="table in tables"
      :key="table.id"
      :table="table"
      :selected="table.id === selectedTableId"
      :reservations="reservationsByTable?.[table.id]"
      @select="$emit('select', $event)"
    />
  </div>
  <EmptyState
    v-else
    :title="t('table.emptyTitle')"
    :description="t('table.emptyDescription')"
  />
</template>

<style scoped>
.table-grid.table-grid--reservations { grid-auto-rows: minmax(126px, auto); }
</style>
