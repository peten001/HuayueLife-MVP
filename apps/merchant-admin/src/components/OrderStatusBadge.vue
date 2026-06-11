<script setup lang="ts">
import type { OrderStatus } from '@/types/api';

defineProps<{ status: OrderStatus }>();

const labels: Record<OrderStatus, string> = {
  PENDING_ACCEPTANCE: '待接单',
  ACCEPTED: '已接单',
  PREPARING: '制作中',
  READY: '制作完成',
  DELIVERING: '商家配送中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};
</script>

<template>
  <span :class="['badge', `order-${status.toLowerCase()}`]">
    {{ labels[status] }}
  </span>
</template>
