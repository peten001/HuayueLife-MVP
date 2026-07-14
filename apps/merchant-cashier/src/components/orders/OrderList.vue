<script setup lang="ts">
import EmptyState from '@/components/common/EmptyState.vue';
import OrderCard from './OrderCard.vue';
import type { CashierOrderView } from '@/components/common/view-models';

defineProps<{
  orders: CashierOrderView[];
  selectedOrderId?: string;
  emptyTitle: string;
  emptyDescription: string;
  emphasize?: boolean;
}>();

defineEmits<{
  select: [orderId: string];
}>();
</script>

<template>
  <div v-if="orders.length" class="order-list">
    <OrderCard
      v-for="order in orders"
      :key="order.id"
      :order="order"
      :selected="order.id === selectedOrderId"
      :emphasize="emphasize"
      @select="$emit('select', $event)"
    />
  </div>
  <EmptyState v-else :title="emptyTitle" :description="emptyDescription" />
</template>
