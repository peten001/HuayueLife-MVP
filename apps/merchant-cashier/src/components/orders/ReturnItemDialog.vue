<script setup lang="ts">
import { Minus, Plus, RotateCcw } from '@lucide/vue';
import { ref, watch } from 'vue';
import { useI18n } from '@/i18n';
import type { CashierOrderItemView } from '@/components/common/view-models';

const props = defineProps<{
  open: boolean;
  item?: CashierOrderItemView | null;
  loading?: boolean;
  disabled?: boolean;
  outcomeUncertain?: boolean;
  fixedQuantity?: number | null;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [quantity: number];
}>();

const { t, locale } = useI18n();
const quantity = ref(1);

watch(
  () => [props.open, props.item?.id, props.fixedQuantity] as const,
  ([open, , fixedQuantity]) => {
    if (open) quantity.value = fixedQuantity ?? 1;
  },
  { immediate: true },
);

function itemName() {
  if (!props.item) return t('order.itemNameFallback');
  if (locale.value === 'vi') {
    return props.item.productNameViSnapshot || props.item.productNameZhSnapshot || t('order.itemNameFallback');
  }
  if (locale.value === 'en') {
    return props.item.productNameEnSnapshot || props.item.productNameZhSnapshot || t('order.itemNameFallback');
  }
  return props.item.productNameZhSnapshot || t('order.itemNameFallback');
}

function update(delta: number) {
  if (props.loading || props.disabled || props.outcomeUncertain) return;
  const max = Math.max(1, Number(props.item?.quantity || 1));
  quantity.value = Math.max(1, Math.min(max, quantity.value + delta));
}

function cancel() {
  if (props.loading || props.outcomeUncertain) return;
  emit('cancel');
}
</script>

<template>
  <div v-if="open && item" class="dialog-backdrop" role="presentation" @click.self="cancel">
    <section
      class="confirm-dialog item-return-dialog"
      role="alertdialog"
      aria-modal="true"
      :aria-label="t('itemAdjustment.returnTitle', { name: itemName() })"
      data-testid="return-item-dialog"
    >
      <span class="confirm-dialog__icon" aria-hidden="true"><RotateCcw :size="26" /></span>
      <div>
        <h3>{{ t('itemAdjustment.returnTitle', { name: itemName() }) }}</h3>
        <p>{{ t('itemAdjustment.returnConfirm') }}</p>
        <p
          v-if="outcomeUncertain"
          class="mutation-outcome-warning"
          data-testid="return-outcome-uncertain"
          role="alert"
        >{{ t('mutation.outcomeUncertain') }}</p>
        <div class="item-return-quantity" :aria-label="t('itemAdjustment.returnQuantity')">
          <button
            type="button"
            :aria-label="t('ordering.decreaseQuantity')"
            :disabled="loading || disabled || outcomeUncertain || quantity <= 1"
            @click="update(-1)"
          ><Minus :size="20" aria-hidden="true" /></button>
          <output>{{ quantity }}</output>
          <button
            type="button"
            :aria-label="t('ordering.increaseQuantity')"
            :disabled="loading || disabled || outcomeUncertain || quantity >= Number(item.quantity || 0)"
            @click="update(1)"
          ><Plus :size="20" aria-hidden="true" /></button>
        </div>
      </div>
      <footer>
        <button
          type="button"
          class="secondary-action"
          :disabled="loading || outcomeUncertain"
          @click="cancel"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          type="button"
          class="primary-action"
          :disabled="loading || disabled"
          @click="emit('confirm', quantity)"
        >{{ loading
          ? t('common.processing')
          : outcomeUncertain
            ? t('mutation.retrySameRequest')
            : t('itemAdjustment.confirmReturn') }}</button>
      </footer>
    </section>
  </div>
</template>
