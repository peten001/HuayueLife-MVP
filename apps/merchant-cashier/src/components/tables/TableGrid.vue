<script setup lang="ts">
import { useI18n } from '@/i18n';
import EmptyState from '@/components/common/EmptyState.vue';
import TableCard from './TableCard.vue';
import type { CashierTableView } from '@/components/common/view-models';

defineProps<{
  tables: CashierTableView[];
  selectedTableId?: string;
}>();

defineEmits<{
  select: [tableId: string];
}>();

const { t } = useI18n();
</script>

<template>
  <div v-if="tables.length" class="table-grid" data-testid="table-grid">
    <TableCard
      v-for="table in tables"
      :key="table.id"
      :table="table"
      :selected="table.id === selectedTableId"
      @select="$emit('select', $event)"
    />
  </div>
  <EmptyState
    v-else
    :title="t('table.emptyTitle')"
    :description="t('table.emptyDescription')"
  />
</template>
