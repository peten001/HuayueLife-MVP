<script setup lang="ts">
import { Clock3, PackageOpen } from '@lucide/vue';
import { computed } from 'vue';
import { formatVietnamDateTime, formatVnd } from '@/domain';
import { useI18n } from '@/i18n';
import type { MerchantOrder } from '@/types';
import WaitDuration from './WaitDuration.vue';

const props = withDefaults(defineProps<{
  order: MerchantOrder;
  showWait?: boolean;
}>(), {
  showWait: false,
});
const { locale, t } = useI18n();

const totalQuantity = computed(() => props.order.items
  .reduce((sum, item) => sum + Number(item.quantity || 0), 0));
</script>

<template>
  <div class="fulfillment-order-card__summary">
    <p>
      <PackageOpen :size="15" aria-hidden="true" />
      {{ t('fulfillment.itemCount', { count: totalQuantity }) }}
      <strong>{{ formatVnd(order.payableAmountVnd || order.totalAmountVnd, locale) }}</strong>
    </p>
    <div>
      <span><Clock3 :size="15" aria-hidden="true" />{{ t('fulfillment.orderedAt', { time: formatVietnamDateTime(order.createdAt, locale) }) }}</span>
      <WaitDuration v-if="showWait" :created-at="order.createdAt" />
    </div>
  </div>
</template>
