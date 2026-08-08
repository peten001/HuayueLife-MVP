<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  formatDiscountRateInput,
  parseDiscountRateInput,
  previewSettlementAdjustment,
} from '@/domain/settlement-adjustment';
import { formatVnd } from '@/domain';
import { useI18n } from '@/i18n';

const props = defineProps<{
  open: boolean;
  itemAmountVnd: string;
  nonDiscountableFeeVnd?: string;
  discountPayableRateBps?: number | null;
  roundingEnabled?: boolean;
  showDeliveryFee?: boolean;
  loading?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [input: { discountPayableRateBps: number | null; roundingEnabled: boolean }];
}>();

const { t, locale } = useI18n();
const rateInput = ref('10');
const roundingEnabled = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    rateInput.value = formatDiscountRateInput(props.discountPayableRateBps);
    roundingEnabled.value = Boolean(props.roundingEnabled);
  },
  { immediate: true },
);

const parsedRate = computed(() => parseDiscountRateInput(rateInput.value));
const hasPersistedAdjustment = computed(() => (
  props.discountPayableRateBps != null || Boolean(props.roundingEnabled)
));
const errorKey = computed(() => {
  const parsed = parsedRate.value;
  if (parsed.ok) return '';
  if (parsed.error === 'REQUIRED') return 'discount.rateRequired';
  if (parsed.error === 'RANGE') return 'discount.rateRange';
  return 'discount.rateFormat';
});
const preview = computed(() => previewSettlementAdjustment({
  itemAmountVnd: props.itemAmountVnd,
  nonDiscountableFeeVnd: props.nonDiscountableFeeVnd ?? '0',
  discountPayableRateBps: parsedRate.value.ok
    ? parsedRate.value.discountPayableRateBps
    : null,
  roundingEnabled: roundingEnabled.value,
}));

function confirm() {
  const parsed = parsedRate.value;
  if (!parsed.ok || props.loading) return;
  emit('confirm', {
    discountPayableRateBps: parsed.discountPayableRateBps,
    roundingEnabled: roundingEnabled.value,
  });
}

function cancel() {
  if (props.loading) return;
  emit('cancel');
}

function clearAdjustment() {
  if (props.loading || !hasPersistedAdjustment.value) return;
  emit('confirm', {
    discountPayableRateBps: null,
    roundingEnabled: false,
  });
}
</script>

<template>
  <div v-if="open" class="dialog-backdrop settlement-adjustment-dialog-backdrop" role="presentation" @click.self="cancel">
    <section class="settlement-adjustment-dialog settlement-adjustment-dialog--dark" role="dialog" aria-modal="true" :aria-labelledby="'settlement-adjustment-title'" :aria-busy="loading">
      <header>
        <h3 id="settlement-adjustment-title">{{ t('discount.title') }}</h3>
      </header>

      <div class="settlement-adjustment-dialog__controls" data-testid="discount-controls">
        <label id="discount-rate-label" class="settlement-adjustment-dialog__control-label" for="discount-rate-input">{{ t('discount.wholeOrderRate') }}</label>
        <span class="settlement-adjustment-dialog__rate-input">
          <input id="discount-rate-input" v-model="rateInput" inputmode="decimal" autocomplete="off" :aria-invalid="Boolean(errorKey)" :aria-describedby="errorKey ? 'discount-rate-error' : undefined" />
          <b>{{ t('discount.rateUnit') }}</b>
        </span>
        <strong id="discount-rounding-label" class="settlement-adjustment-dialog__control-label">{{ t('table.rounding') }}</strong>
        <label class="settlement-adjustment-dialog__switch">
          <input v-model="roundingEnabled" type="checkbox" role="switch" aria-labelledby="discount-rounding-label" />
          <span aria-hidden="true" class="settlement-adjustment-dialog__switch-track" />
        </label>
        <small v-if="errorKey" id="discount-rate-error" class="settlement-adjustment-dialog__error">{{ t(errorKey) }}</small>
      </div>

      <dl class="settlement-adjustment-dialog__summary" aria-live="polite">
        <div><dt>{{ t('discount.dialogOriginal') }}</dt><dd>{{ formatVnd(preview.itemAmountVnd, locale) }}</dd></div>
        <div v-if="BigInt(preview.discountAmountVnd) > 0n"><dt>{{ t('discount.dialogAmount') }}</dt><dd class="is-deduction">-{{ formatVnd(preview.discountAmountVnd, locale) }}</dd></div>
        <div v-if="showDeliveryFee && BigInt(preview.nonDiscountableFeeVnd) > 0n"><dt>{{ t('bill.deliveryFee') }}</dt><dd>{{ formatVnd(preview.nonDiscountableFeeVnd, locale) }}</dd></div>
        <div v-if="BigInt(preview.roundingAmountVnd) > 0n"><dt>{{ t('discount.dialogRounding') }}</dt><dd class="is-deduction">-{{ formatVnd(preview.roundingAmountVnd, locale) }}</dd></div>
        <div class="is-payable"><dt>{{ t('discount.dialogPayable') }}</dt><dd>{{ formatVnd(preview.payableAmountVnd, locale) }}</dd></div>
      </dl>

      <footer class="settlement-adjustment-dialog__actions">
        <button type="button" class="settlement-adjustment-dialog__cancel" data-testid="discount-cancel" :disabled="loading" @click="cancel">{{ t('common.cancel') }}</button>
        <button type="button" class="settlement-adjustment-dialog__clear" data-testid="discount-clear" :disabled="loading || !hasPersistedAdjustment" @click="clearAdjustment">{{ t('discount.clear') }}</button>
        <button type="button" class="settlement-adjustment-dialog__confirm" data-testid="discount-confirm" :disabled="loading || Boolean(errorKey)" @click="confirm">{{ loading ? t('common.processing') : t('discount.confirm') }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.settlement-adjustment-dialog-backdrop {
  background: rgb(2 13 22 / 56%);
}
.settlement-adjustment-dialog {
  width: min(420px, calc(100vw - 32px));
  max-width: 420px;
  padding: 20px 22px;
  border: 1px solid var(--cashier-shell-border);
  border-radius: 16px;
  color: var(--cashier-shell-text);
  background: var(--cashier-shell-850);
  box-shadow: 0 18px 48px rgb(0 0 0 / 38%);
  font-family: inherit;
}
.settlement-adjustment-dialog > header { display: block; }
.settlement-adjustment-dialog h3 { margin: 0; color: var(--cashier-shell-text); font-size: 22px; font-weight: 700; line-height: 1.25; }
.settlement-adjustment-dialog__controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.settlement-adjustment-dialog__control-label { min-width: max-content; margin: 0; color: #e7edf3; font-size: 14px; font-weight: 600; line-height: 1.3; }
.settlement-adjustment-dialog__rate-input { display: flex; align-items: center; flex: 0 0 124px; gap: 8px; width: 124px; min-width: 118px; max-width: 128px; height: 40px; padding: 0 11px; border: 1px solid var(--cashier-white-alpha-14); border-radius: 9px; background: var(--cashier-shell-800); transition: border-color 120ms ease, box-shadow 120ms ease; }
.settlement-adjustment-dialog__rate-input:focus-within { border-color: var(--cashier-green); box-shadow: 0 0 0 3px rgb(25 195 125 / 15%); }
.settlement-adjustment-dialog__rate-input input { width: 100%; min-width: 0; padding: 0; border: 0; outline: 0; color: var(--cashier-shell-text); font: inherit; font-size: 20px; font-variant-numeric: tabular-nums; font-weight: 700; background: transparent; }
.settlement-adjustment-dialog__rate-input b { color: var(--cashier-shell-muted); font-size: 14px; font-weight: 600; }
.settlement-adjustment-dialog__error { flex: 0 0 100%; color: #ff7a84; font-size: 13px; font-weight: 500; line-height: 1.4; }
.settlement-adjustment-dialog__switch { position: relative; display: inline-flex; width: 44px; height: 24px; }
.settlement-adjustment-dialog__switch input { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
.settlement-adjustment-dialog__switch-track { position: relative; display: block; width: 44px; height: 24px; border-radius: 999px; background: #405568; cursor: pointer; transition: background 140ms ease, box-shadow 140ms ease; }
.settlement-adjustment-dialog__switch-track::after { position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: var(--cashier-white); box-shadow: var(--cashier-shadow-sm); content: ''; transition: transform 140ms ease; }
.settlement-adjustment-dialog__switch input:checked + .settlement-adjustment-dialog__switch-track { background: var(--cashier-green); }
.settlement-adjustment-dialog__switch input:checked + .settlement-adjustment-dialog__switch-track::after { transform: translateX(20px); }
.settlement-adjustment-dialog__switch input:focus-visible + .settlement-adjustment-dialog__switch-track { box-shadow: 0 0 0 3px rgb(25 195 125 / 18%); }
.settlement-adjustment-dialog__summary { display: grid; grid-template-columns: max-content max-content; column-gap: 10px; row-gap: 7px; justify-content: start; margin: 16px 0 0; padding-top: 16px; border-top: 1px solid var(--cashier-shell-border); }
.settlement-adjustment-dialog__summary div { display: contents; }
.settlement-adjustment-dialog__summary dt { color: var(--cashier-shell-muted); font-size: 14px; font-weight: 500; line-height: 1.45; }
.settlement-adjustment-dialog__summary dd { margin: 0; color: var(--cashier-shell-text); font-size: 15px; font-variant-numeric: tabular-nums; font-weight: 600; line-height: 1.45; overflow: visible; text-overflow: clip; white-space: nowrap; }
.settlement-adjustment-dialog__summary .is-deduction { color: #ff5a67; font-weight: 700; }
.settlement-adjustment-dialog__summary .is-payable dt,
.settlement-adjustment-dialog__summary .is-payable dd { margin-top: 2px; padding-top: 10px; border-top: 1px solid var(--cashier-shell-border); }
.settlement-adjustment-dialog__summary .is-payable dt { color: var(--cashier-shell-text); font-size: 15px; font-weight: 600; }
.settlement-adjustment-dialog__summary .is-payable dd { color: #35d67a; font-size: 19px; font-weight: 700; }
.settlement-adjustment-dialog__actions { display: grid; grid-template-columns: 1fr 1.15fr 1.15fr; align-items: stretch; width: 100%; gap: 10px; margin-top: 20px; }
.settlement-adjustment-dialog__actions button { min-width: 0; min-height: 42px; height: 42px; padding: 0 10px; border-radius: 9px; font-size: 14px; font-weight: 600; white-space: nowrap; transition: border-color 120ms ease, background 120ms ease, color 120ms ease; }
.settlement-adjustment-dialog__actions button:disabled { border-color: var(--cashier-shell-border); color: #718496; background: var(--cashier-white-alpha-03); opacity: 0.5; cursor: not-allowed; }
.settlement-adjustment-dialog__actions button:focus-visible { outline: 0; box-shadow: 0 0 0 3px rgb(25 195 125 / 18%); }
.settlement-adjustment-dialog__cancel { border: 1px solid #405568; color: #c5d0da; background: transparent; }
.settlement-adjustment-dialog__cancel:hover:not(:disabled) { color: var(--cashier-white); background: var(--cashier-shell-800); }
.settlement-adjustment-dialog__clear { border: 1px solid rgb(255 90 103 / 52%); color: #ff6b76; background: rgb(240 68 84 / 8%); }
.settlement-adjustment-dialog__clear:hover:not(:disabled) { background: rgb(240 68 84 / 14%); }
.settlement-adjustment-dialog__confirm { border: 0; color: var(--cashier-white); background: var(--cashier-green); }
.settlement-adjustment-dialog__confirm:hover:not(:disabled) { background: #17b772; }
@media (max-width: 460px) {
  .settlement-adjustment-dialog { width: calc(100vw - 24px); max-height: calc(100vh - 24px); padding: 18px; overflow-y: auto; }
  .settlement-adjustment-dialog__controls { row-gap: 10px; }
  .settlement-adjustment-dialog__actions { grid-template-columns: 0.9fr 1.1fr 1.1fr; gap: 8px; }
  .settlement-adjustment-dialog__actions button { padding-inline: 8px; font-size: 13px; }
}
</style>
