<script setup lang="ts">
import CashierNavigation from './CashierNavigation.vue';

defineProps<{
  newOrderCount: number;
  activeOrderCount: number;
  occupiedTableCount: number;
}>();
</script>

<template>
  <aside class="cashier-sidebar">
    <CashierNavigation
      :new-order-count="newOrderCount"
      :active-order-count="activeOrderCount"
      :occupied-table-count="occupiedTableCount"
    />
  </aside>
</template>
