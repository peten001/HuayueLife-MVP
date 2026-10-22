<script setup lang="ts">
import { CheckCheck, ChefHat, CircleDollarSign, LoaderCircle, Truck } from '@lucide/vue';
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
  adjustmentLoading?: boolean;
  adjustmentDisabled?: boolean;
  adjustmentDisabledReason?: string;
}>();
const emit = defineEmits<{
  action: [action: FulfillmentWorkflowAction];
  adjustment: [];
}>();
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
  <footer class="fulfillment-action-dock" :class="{ 'fulfillment-action-dock--pickup': ['PICKUP', 'DELIVERY'].includes(order.orderType) }">
    <template v-if="['PICKUP', 'DELIVERY'].includes(order.orderType)">
      <slot v-if="order.status === 'PENDING_ACCEPTANCE'" name="secondary" />
      <PrintJobActions compact :order-id="order.id" />
      <slot v-if="order.status !== 'PENDING_ACCEPTANCE'" name="secondary" />
    </template>
    <template v-else>
      <PrintJobActions compact :order-id="order.id" />
      <slot name="secondary" />
    </template>
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
    <span v-else-if="!['PICKUP', 'DELIVERY'].includes(order.orderType)" class="fulfillment-action-dock__done">{{ t('fulfillment.noPendingAction') }}</span>
    <button
      v-if="['PICKUP', 'DELIVERY'].includes(order.orderType)"
      type="button"
      class="secondary-action fulfillment-action-dock__rounding"
      data-testid="order-settlement-adjustment"
      :class="{ 'is-applied': order.discountPayableRateBps != null || BigInt(order.discountAmountVnd || '0') > 0n || order.roundingApplied }"
      :disabled="adjustmentLoading || disabled || adjustmentDisabled"
      :title="adjustmentDisabledReason"
      @click="emit('adjustment')"
    >
      <LoaderCircle v-if="adjustmentLoading" :size="18" class="spinning" aria-hidden="true" />
      <CircleDollarSign v-else :size="18" aria-hidden="true" />
      {{ adjustmentLoading ? t('common.processing') : t('discount.entry') }}
    </button>
  </footer>
</template>
