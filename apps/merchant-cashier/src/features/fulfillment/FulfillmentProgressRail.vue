<script setup lang="ts">
import { Check } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import type { MerchantOrder, OrderStatus } from '@/types';

const props = defineProps<{ order: MerchantOrder }>();
const { t } = useI18n();
const pickupSteps: OrderStatus[] = ['PENDING_ACCEPTANCE', 'PREPARING', 'READY', 'COMPLETED'];
const deliverySteps: OrderStatus[] = ['PENDING_ACCEPTANCE', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED'];
const steps = computed(() => props.order.orderType === 'DELIVERY' ? deliverySteps : pickupSteps);
const visibleStatus = computed<OrderStatus>(() => props.order.status === 'ACCEPTED'
  ? 'PREPARING'
  : props.order.status);
const currentIndex = computed(() => visibleStatus.value === 'CANCELLED' ? -1 : steps.value.indexOf(visibleStatus.value));

function label(status: OrderStatus) {
  if (status === 'PENDING_ACCEPTANCE') return t('order.status.pendingAcceptance');
  if (status === 'PREPARING') return t('order.status.preparing');
  if (status === 'READY') return props.order.orderType === 'PICKUP' ? t('fulfillment.pickupReady') : t('fulfillment.deliveryReady');
  if (status === 'DELIVERING') return t('order.status.delivering');
  return t('order.status.completed');
}
</script>

<template>
  <section class="workflow-section fulfillment-progress">
    <header><h3>{{ t('fulfillment.progress') }}</h3></header>
    <p v-if="order.status === 'CANCELLED'" class="fulfillment-progress__cancelled">{{ t('order.status.cancelled') }}</p>
    <ol v-else>
      <li v-for="(step, index) in steps" :key="step" :class="{ 'is-current': index === currentIndex, 'is-complete': index < currentIndex }">
        <span><Check v-if="index < currentIndex" :size="13" aria-hidden="true" /><template v-else>{{ index + 1 }}</template></span>
        <strong>{{ label(step) }}</strong>
      </li>
    </ol>
  </section>
</template>
