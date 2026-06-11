<script setup lang="ts">
import { useI18n, type TranslationKey } from '@/i18n';
import type { OrderStatus } from '@/types/api';

defineProps<{ status: OrderStatus }>();

const { t } = useI18n();
const labels: Record<OrderStatus, TranslationKey> = {
  PENDING_ACCEPTANCE: 'pendingAcceptance',
  ACCEPTED: 'accepted',
  PREPARING: 'preparing',
  READY: 'ready',
  DELIVERING: 'delivering',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};
</script>

<template>
  <span :class="['badge', `order-${status.toLowerCase()}`]">
    {{ t(labels[status]) }}
  </span>
</template>
