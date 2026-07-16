<script setup lang="ts">
import { CheckCheck, ChefHat, CookingPot, Truck, XCircle } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import type {
  CashierOrderAction,
  CashierOrderView,
} from '@/components/common/view-models';
import { availableOrderActions } from './order-actions';

const props = defineProps<{
  order?: CashierOrderView | null;
  loading?: boolean;
  disabled?: boolean;
}>();

defineEmits<{
  action: [action: CashierOrderAction];
}>();

const { t } = useI18n();
const actions = computed(() => availableOrderActions(props.order));
const layoutClass = computed(() => {
  if (actions.value.length >= 2) return 'order-action-bar--paired';
  if (actions.value.length === 1) return 'order-action-bar--single';
  return 'order-action-bar--print-only';
});

function iconFor(action: CashierOrderAction) {
  if (action === 'accept') return CheckCheck;
  if (action === 'reject') return XCircle;
  if (action === 'start-preparing') return CookingPot;
  if (action === 'ready') return ChefHat;
  if (action === 'start-delivery') return Truck;
  return CheckCheck;
}
</script>

<template>
  <div :class="['order-action-bar', layoutClass]" data-testid="order-detail-actions">
    <button
      v-for="item in actions"
      :key="item.action"
      type="button"
      :class="item.tone === 'danger' ? 'secondary-action secondary-action--danger' : `primary-action primary-action--${item.tone}`"
      :data-order-action="item.action"
      :disabled="loading || disabled"
      @click="$emit('action', item.action)"
    >
      <component :is="iconFor(item.action)" :size="20" aria-hidden="true" />
      {{ loading ? t('common.processing') : t(item.labelKey) }}
    </button>
    <slot name="print" />
  </div>
</template>
