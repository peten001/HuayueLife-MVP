<script setup lang="ts">
import { Minus, Plus, RotateCcw, TriangleAlert } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from '@/i18n';
import { resolveLocalizedOrderItemName } from '@/domain';
import type { CashierOrderItemView } from '@/components/common/view-models';

const props = defineProps<{
  open: boolean;
  item?: CashierOrderItemView | null;
  loading?: boolean;
  disabled?: boolean;
  outcomeUncertain?: boolean;
  fixedQuantity?: number | null;
  lastOrderItem?: boolean;
  lastTableItem?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [quantity: number];
}>();

const { t, locale } = useI18n();
const quantity = ref(1);
const returnsFullQuantity = computed(() =>
  Boolean(props.item) && quantity.value === Number(props.item?.quantity || 0),
);
const dangerousFullReturn = computed(() =>
  Boolean(props.lastOrderItem) && returnsFullQuantity.value,
);

watch(
  () => [props.open, props.item?.id, props.fixedQuantity] as const,
  ([open, , fixedQuantity]) => {
    if (open) quantity.value = fixedQuantity ?? 1;
  },
  { immediate: true },
);

function itemName() {
  if (!props.item) return t('order.itemNameFallback');
  return resolveLocalizedOrderItemName(props.item, locale.value, t('order.itemNameFallback'));
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
      :class="{ 'item-return-dialog--danger': dangerousFullReturn }"
      role="alertdialog"
      aria-modal="true"
      :aria-label="t(dangerousFullReturn ? 'itemAdjustment.lastItemReturnTitle' : 'itemAdjustment.returnTitle', { name: itemName() })"
      data-testid="return-item-dialog"
    >
      <span class="confirm-dialog__icon" aria-hidden="true">
        <TriangleAlert v-if="dangerousFullReturn" :size="26" />
        <RotateCcw v-else :size="26" />
      </span>
      <div>
        <h3>{{ t(dangerousFullReturn ? 'itemAdjustment.lastItemReturnTitle' : 'itemAdjustment.returnTitle', { name: itemName() }) }}</h3>
        <p
          v-if="dangerousFullReturn"
          class="item-return-danger-description"
          data-testid="last-item-return-danger"
        >{{ t(lastTableItem ? 'itemAdjustment.lastTableItemReturnDescription' : 'itemAdjustment.lastItemReturnDescription') }}</p>
        <p v-else>{{ t('itemAdjustment.returnConfirm') }}</p>
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
