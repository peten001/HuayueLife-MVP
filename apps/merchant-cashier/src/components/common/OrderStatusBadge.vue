<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import type { CashierOrderStatus } from './view-models';

const props = defineProps<{
  status?: CashierOrderStatus;
}>();

const { t } = useI18n();

const label = computed(() => {
  const keys: Record<CashierOrderStatus, string> = {
    PENDING_ACCEPTANCE: 'order.status.pendingAcceptance',
    ACCEPTED: 'order.status.accepted',
    PREPARING: 'order.status.preparing',
    READY: 'order.status.ready',
    DELIVERING: 'order.status.delivering',
    COMPLETED: 'order.status.completed',
    CANCELLED: 'order.status.cancelled',
  };
  return t(props.status ? keys[props.status] : 'order.status.unknown');
});

const tone = computed(() => props.status?.toLowerCase().split('_').join('-') ?? 'unknown');
</script>

<template>
  <span class="status-badge" :class="`status-badge--${tone}`">
    {{ label }}
  </span>
</template>
