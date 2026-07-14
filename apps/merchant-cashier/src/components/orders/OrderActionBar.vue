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
}>();

defineEmits<{
  action: [action: CashierOrderAction];
}>();

const { t } = useI18n();
const actions = computed(() => availableOrderActions(props.order));

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
  <div v-if="actions.length" class="order-action-bar">
    <button
      v-for="item in actions"
      :key="item.action"
      type="button"
      :class="item.tone === 'danger' ? 'secondary-action secondary-action--danger' : `primary-action primary-action--${item.tone}`"
      :disabled="loading"
      @click="$emit('action', item.action)"
    >
      <component :is="iconFor(item.action)" :size="20" aria-hidden="true" />
      {{ loading ? t('common.processing') : t(item.labelKey) }}
    </button>
  </div>
</template>
