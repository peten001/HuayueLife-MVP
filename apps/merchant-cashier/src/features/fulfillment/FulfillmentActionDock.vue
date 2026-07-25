<script setup lang="ts">
import { CheckCheck, ChefHat, Truck } from '@lucide/vue';
import { computed } from 'vue';
import {
  nextFulfillmentAction,
  type FulfillmentWorkflowAction,
} from '@/domain';
import { useI18n } from '@/i18n';
import type { MerchantOrder } from '@/types';
import PrintJobActions from '@/components/printing/PrintJobActions.vue';

const props = defineProps<{
  order: MerchantOrder;
  loading?: boolean;
  disabled?: boolean;
}>();
defineEmits<{ action: [action: FulfillmentWorkflowAction] }>();
const { t } = useI18n();
const action = computed(() => nextFulfillmentAction(props.order));
const labelKey = computed(() => {
  if (action.value === 'accept') return 'order.action.accept';
  if (action.value === 'finish-preparing') return 'order.action.markReady';
  if (action.value === 'start-delivery') return 'order.action.startDelivery';
  if (action.value === 'complete' && props.order.orderType === 'PICKUP') return 'order.action.confirmPickup';
  if (action.value === 'complete' && props.order.orderType === 'DELIVERY') return 'order.action.completeDelivery';
  return 'order.action.complete';
});
const icon = computed(() => {
  if (action.value === 'accept') return CheckCheck;
  if (action.value === 'finish-preparing') return ChefHat;
  if (action.value === 'start-delivery') return Truck;
  return CheckCheck;
});
</script>

<template>
  <footer class="fulfillment-action-dock">
    <PrintJobActions compact :order-id="order.id" />
    <slot name="secondary" />
    <button
      v-if="action"
      type="button"
      class="primary-action"
      :disabled="loading || disabled"
      @click="$emit('action', action)"
    >
      <component :is="icon" :size="20" aria-hidden="true" />
      {{ loading ? t('common.processing') : t(labelKey) }}
    </button>
    <span v-else class="fulfillment-action-dock__done">{{ t('fulfillment.noPendingAction') }}</span>
  </footer>
</template>
