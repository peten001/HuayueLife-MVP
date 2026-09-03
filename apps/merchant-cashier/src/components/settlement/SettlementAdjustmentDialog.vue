<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  formatDiscountAmountInput,
  formatDiscountPercentageFromAmount,
  formatDiscountPercentageInput,
  normalizeDiscountAmountInput,
  parseDiscountAmountInput,
  parseDiscountPercentageInput,
  previewSettlementAdjustment,
  type DiscountInputMode,
} from '@/domain/settlement-adjustment';
import { formatVnd } from '@/domain';
import { useI18n } from '@/i18n';
import type { SettlementAdjustmentInput } from '@/types';

const props = defineProps<{
  open: boolean;
  itemAmountVnd: string;
  nonDiscountableFeeVnd?: string;
  discountPayableRateBps?: number | null;
  discountAmountVnd?: string;
  roundingEnabled?: boolean;
  showDeliveryFee?: boolean;
  loading?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [input: SettlementAdjustmentInput];
}>();

const { t, locale } = useI18n();
const discountInput = ref<HTMLInputElement | null>(null);
const discountMode = ref<DiscountInputMode>('PERCENTAGE');
const percentageInput = ref('0');
const amountInput = ref('0');
const draftRoundingEnabled = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const persistedAmount = BigInt(props.discountAmountVnd ?? '0');
    const fixedAmountApplied = props.discountPayableRateBps == null && persistedAmount > 0n;
    discountMode.value = fixedAmountApplied ? 'FIXED_AMOUNT' : 'PERCENTAGE';
    percentageInput.value = fixedAmountApplied
      ? formatDiscountPercentageFromAmount(props.itemAmountVnd, persistedAmount)
      : formatDiscountPercentageInput(props.discountPayableRateBps);
    amountInput.value = formatDiscountAmountInput(persistedAmount);
    draftRoundingEnabled.value = Boolean(props.roundingEnabled);
  },
  { immediate: true },
);

const parsedPercentage = computed(() => parseDiscountPercentageInput(percentageInput.value));
const parsedAmount = computed(() => parseDiscountAmountInput(amountInput.value, props.itemAmountVnd));
const hasPersistedAdjustment = computed(() => (
  props.discountPayableRateBps != null
  || BigInt(props.discountAmountVnd ?? '0') > 0n
  || Boolean(props.roundingEnabled)
));
const errorKey = computed(() => {
  const parsed = discountMode.value === 'PERCENTAGE'
    ? parsedPercentage.value
    : parsedAmount.value;
  if (parsed.ok) return '';
  if (discountMode.value === 'FIXED_AMOUNT') {
    if (parsed.error === 'REQUIRED') return 'discount.amountRequired';
    if (parsed.error === 'RANGE') return 'discount.amountRange';
    return 'discount.amountFormat';
  }
  if (parsed.error === 'REQUIRED') return 'discount.percentRequired';
  if (parsed.error === 'RANGE') return 'discount.percentRange';
  return 'discount.percentFormat';
});
const preview = computed(() => {
  const percentage = parsedPercentage.value;
  const amount = parsedAmount.value;
  return previewSettlementAdjustment({
    itemAmountVnd: props.itemAmountVnd,
    nonDiscountableFeeVnd: props.nonDiscountableFeeVnd ?? '0',
    discountPayableRateBps: discountMode.value === 'PERCENTAGE' && percentage.ok
      ? percentage.discountPayableRateBps
      : null,
    discountAmountVnd: discountMode.value === 'FIXED_AMOUNT' && amount.ok
      ? amount.discountAmountVnd
      : undefined,
    roundingEnabled: draftRoundingEnabled.value,
  });
});
const activeInputValue = computed(() => (
  discountMode.value === 'PERCENTAGE' ? percentageInput.value : amountInput.value
));

function handleDiscountInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (discountMode.value === 'PERCENTAGE') {
    percentageInput.value = value;
    return;
  }
  amountInput.value = normalizeDiscountAmountInput(value);
}

function selectMode(mode: DiscountInputMode) {
  if (props.loading || discountMode.value === mode) return;
  if (mode === 'FIXED_AMOUNT') {
    amountInput.value = formatDiscountAmountInput(preview.value.discountAmountVnd);
  } else if (parsedAmount.value.ok) {
    percentageInput.value = formatDiscountPercentageFromAmount(
      props.itemAmountVnd,
      parsedAmount.value.discountAmountVnd,
    );
  }
  discountMode.value = mode;
  void nextTick(() => {
    discountInput.value?.focus();
    discountInput.value?.select();
  });
}

function confirm() {
  if (props.loading || errorKey.value) return;
  if (discountMode.value === 'FIXED_AMOUNT') {
    const parsed = parsedAmount.value;
    if (!parsed.ok) return;
    emit('confirm', {
      discountPayableRateBps: null,
      ...(parsed.discountAmountVnd === '0'
        ? {}
        : { discountAmountVnd: parsed.discountAmountVnd }),
      roundingEnabled: draftRoundingEnabled.value,
    });
    return;
  }
  const parsed = parsedPercentage.value;
  if (!parsed.ok) return;
  emit('confirm', {
    discountPayableRateBps: parsed.discountPayableRateBps,
    roundingEnabled: draftRoundingEnabled.value,
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
  <div
    v-if="open"
    class="dialog-backdrop settlement-adjustment-dialog-backdrop"
    role="presentation"
    @click.self="cancel"
  >
    <section
      class="settlement-adjustment-dialog settlement-adjustment-dialog--dark"
      :class="{ 'is-error': Boolean(errorKey), 'is-loading': loading }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settlement-adjustment-title"
      :aria-busy="loading"
    >
      <header class="settlement-adjustment-dialog__header">
        <h3 id="settlement-adjustment-title">{{ t('discount.title') }}</h3>
        <button
          type="button"
          class="settlement-adjustment-dialog__close"
          :aria-label="t('common.close')"
          :disabled="loading"
          @click="cancel"
        >×</button>
      </header>

      <div class="settlement-adjustment-dialog__controls" data-testid="discount-controls">
        <label class="settlement-adjustment-dialog__control-label" for="discount-value-input">
          {{ t('discount.inputLabel') }}
        </label>
        <div class="settlement-adjustment-dialog__input-shell" :class="{ 'is-invalid': Boolean(errorKey) }">
          <div class="settlement-adjustment-dialog__mode-switch" role="group" :aria-label="t('discount.modeLabel')">
            <button
              type="button"
              :class="{ 'is-selected': discountMode === 'FIXED_AMOUNT' }"
              :aria-pressed="discountMode === 'FIXED_AMOUNT'"
              :disabled="loading"
              data-testid="discount-mode-amount"
              @click="selectMode('FIXED_AMOUNT')"
            >VND</button>
            <button
              type="button"
              :class="{ 'is-selected': discountMode === 'PERCENTAGE' }"
              :aria-pressed="discountMode === 'PERCENTAGE'"
              :disabled="loading"
              data-testid="discount-mode-percentage"
              @click="selectMode('PERCENTAGE')"
            >%</button>
          </div>
          <input
            id="discount-value-input"
            ref="discountInput"
            :value="activeInputValue"
            :inputmode="discountMode === 'PERCENTAGE' ? 'decimal' : 'numeric'"
            autocomplete="off"
            :aria-invalid="Boolean(errorKey)"
            :aria-describedby="errorKey ? 'discount-input-message' : undefined"
            :disabled="loading"
            @input="handleDiscountInput"
            @keydown.enter.prevent="confirm"
          />
        </div>
        <small
          id="discount-input-message"
          class="settlement-adjustment-dialog__message"
          :class="{ 'is-visible': Boolean(errorKey) }"
          aria-live="polite"
        >{{ errorKey ? t(errorKey) : '\u00a0' }}</small>

        <div class="settlement-adjustment-dialog__rounding-row">
          <div>
            <strong id="discount-rounding-label">{{ t('table.rounding') }}</strong>
            <span>{{ t('discount.roundingHint') }}</span>
          </div>
          <label class="settlement-adjustment-dialog__switch">
            <input
              v-model="draftRoundingEnabled"
              type="checkbox"
              role="switch"
              aria-labelledby="discount-rounding-label"
              :disabled="loading"
            />
            <span aria-hidden="true" class="settlement-adjustment-dialog__switch-track" />
          </label>
        </div>
      </div>

      <dl class="settlement-adjustment-dialog__summary" aria-live="polite">
        <div><dt>{{ t('discount.dialogOriginal') }}</dt><dd>{{ formatVnd(preview.itemAmountVnd, locale) }}</dd></div>
        <div><dt>{{ t('discount.dialogAmount') }}</dt><dd class="is-deduction">-{{ formatVnd(preview.discountAmountVnd, locale) }}</dd></div>
        <div v-if="showDeliveryFee && BigInt(preview.nonDiscountableFeeVnd) > 0n"><dt>{{ t('bill.deliveryFee') }}</dt><dd>{{ formatVnd(preview.nonDiscountableFeeVnd, locale) }}</dd></div>
        <div v-if="BigInt(preview.roundingAmountVnd) > 0n"><dt>{{ t('discount.dialogRounding') }}</dt><dd class="is-deduction">-{{ formatVnd(preview.roundingAmountVnd, locale) }}</dd></div>
        <div class="is-payable"><dt>{{ t('discount.dialogPayable') }}</dt><dd>{{ formatVnd(preview.payableAmountVnd, locale) }}</dd></div>
      </dl>

      <footer class="settlement-adjustment-dialog__actions">
        <button
          type="button"
          class="settlement-adjustment-dialog__clear"
          data-testid="discount-clear"
          :disabled="loading || !hasPersistedAdjustment"
          @click="clearAdjustment"
        >{{ t('discount.clear') }}</button>
        <button
          type="button"
          class="settlement-adjustment-dialog__cancel"
          data-testid="discount-cancel"
          :disabled="loading"
          @click="cancel"
        >{{ t('common.cancel') }}</button>
        <button
          type="button"
          class="settlement-adjustment-dialog__confirm"
          data-testid="discount-confirm"
          :disabled="loading || Boolean(errorKey)"
          @click="confirm"
        >{{ loading ? t('common.processing') : t('discount.confirm') }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
/* finesse · component: settlement-adjustment-dialog · register=product
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * tokens: inherited (apps/merchant-cashier/src/styles/tokens.css) */
.settlement-adjustment-dialog-backdrop { background: var(--cashier-scrim-68); }
.settlement-adjustment-dialog {
  --settlement-dialog-bg: var(--cashier-shell-850);
  --settlement-dialog-border: var(--cashier-shell-border);
  --settlement-field-bg: var(--cashier-shell-800);
  --settlement-control-bg: var(--cashier-white-alpha-05);
  --settlement-control-hover-bg: var(--cashier-white-alpha-08);
  --settlement-close-bg: var(--cashier-white-alpha-03);
  --settlement-close-border: var(--cashier-white-alpha-07);
  --settlement-border: var(--cashier-white-alpha-14);
  --settlement-divider: var(--cashier-shell-border);
  --settlement-text: var(--cashier-shell-text);
  --settlement-muted: var(--cashier-shell-muted);
  --settlement-accent: var(--cashier-green);
  --settlement-accent-strong: var(--cashier-green-strong);
  --settlement-accent-soft: var(--cashier-green-alpha-13);
  --settlement-focus: var(--cashier-green-alpha-35);
  --settlement-danger: var(--cashier-danger-action-text);
  --settlement-danger-border: var(--cashier-danger);
  --settlement-danger-soft: var(--cashier-red-alpha-08);
  --settlement-danger-hover-border: var(--cashier-red-alpha-45);
  --settlement-danger-hover-bg: var(--cashier-red-alpha-10);
  --settlement-switch-bg: var(--cashier-white-alpha-14);
  --settlement-switch-thumb: var(--cashier-shell-text);
  --settlement-confirm-text: var(--cashier-shell-950);
  width: min(500px, calc(100vw - 32px));
  max-width: 500px;
  padding: 22px;
  border: 1px solid var(--settlement-dialog-border);
  border-radius: var(--cashier-radius);
  color: var(--settlement-text);
  background: var(--settlement-dialog-bg);
  box-shadow: var(--cashier-shadow-strong);
  font-family: inherit;
}
.settlement-adjustment-dialog__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.settlement-adjustment-dialog h3 { margin: 0; color: var(--settlement-text); font-size: 22px; font-weight: 750; line-height: 1.25; }
.settlement-adjustment-dialog__close {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  place-items: center;
  padding: 0;
  border: 1px solid var(--settlement-close-border);
  border-radius: var(--cashier-radius-sm);
  color: var(--settlement-muted);
  background: var(--settlement-close-bg);
  font-size: 27px;
  font-weight: 400;
  line-height: 1;
}
.settlement-adjustment-dialog__controls { display: grid; gap: 8px; margin-top: 18px; }
.settlement-adjustment-dialog__control-label { margin: 0; color: var(--settlement-text); font-size: 14px; font-weight: 650; line-height: 1.35; }
.settlement-adjustment-dialog__input-shell {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  min-height: 58px;
  padding: 5px;
  border: 1px solid var(--settlement-border);
  border-radius: 12px;
  background: var(--settlement-field-bg);
  outline: 2px solid transparent;
  outline-offset: 2px;
  transition: border-color 120ms ease, background-color 120ms ease;
}
.settlement-adjustment-dialog__input-shell:focus-within { border-color: var(--settlement-accent); outline-color: var(--settlement-focus); }
.settlement-adjustment-dialog__input-shell.is-invalid { border-color: var(--settlement-danger-border); background: var(--settlement-danger-soft); }
.settlement-adjustment-dialog__mode-switch { display: grid; grid-template-columns: 1fr 1fr; padding: 3px; border-radius: 9px; background: var(--settlement-control-bg); }
.settlement-adjustment-dialog__mode-switch button {
  min-width: 60px;
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--settlement-muted);
  background: transparent;
  font-size: 14px;
  font-weight: 750;
  white-space: nowrap;
}
.settlement-adjustment-dialog__mode-switch button.is-selected { border-color: var(--settlement-focus); color: var(--settlement-accent); background: var(--settlement-accent-soft); }
.settlement-adjustment-dialog__input-shell > input {
  width: 100%;
  min-width: 0;
  height: 46px;
  padding: 0 13px;
  border: 0;
  outline: 0;
  color: var(--settlement-text);
  background: transparent;
  font: inherit;
  font-size: 25px;
  font-variant-numeric: tabular-nums;
  font-weight: 750;
  text-align: right;
}
.settlement-adjustment-dialog__input-shell > input:disabled { opacity: .5; cursor: not-allowed; }
.settlement-adjustment-dialog__message { min-height: 1.4em; color: transparent; font-size: 13px; font-weight: 550; line-height: 1.4; }
.settlement-adjustment-dialog__message.is-visible { color: var(--settlement-danger); }
.settlement-adjustment-dialog__rounding-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-top: 4px;
  padding: 12px 0;
  border-top: 1px solid var(--settlement-divider);
  border-bottom: 1px solid var(--settlement-divider);
}
.settlement-adjustment-dialog__rounding-row > div { display: grid; gap: 3px; min-width: 0; }
.settlement-adjustment-dialog__rounding-row strong { color: var(--settlement-text); font-size: 14px; font-weight: 650; }
.settlement-adjustment-dialog__rounding-row span { color: var(--settlement-muted); font-size: 12px; line-height: 1.35; }
.settlement-adjustment-dialog__switch { position: relative; display: inline-flex; width: 48px; height: 28px; flex: 0 0 48px; }
.settlement-adjustment-dialog__switch input { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
.settlement-adjustment-dialog__switch-track { position: relative; display: block; width: 48px; height: 28px; border-radius: 999px; background: var(--settlement-switch-bg); cursor: pointer; transition: background-color 140ms ease; }
.settlement-adjustment-dialog__switch-track::after { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: var(--settlement-switch-thumb); box-shadow: var(--cashier-shadow-sm); content: ''; transition: transform 140ms ease; }
.settlement-adjustment-dialog__switch input:checked + .settlement-adjustment-dialog__switch-track { background: var(--settlement-accent); }
.settlement-adjustment-dialog__switch input:checked + .settlement-adjustment-dialog__switch-track::after { transform: translateX(20px); }
.settlement-adjustment-dialog__switch input:focus-visible + .settlement-adjustment-dialog__switch-track { outline: 2px solid var(--settlement-accent); outline-offset: 3px; }
.settlement-adjustment-dialog__switch input:disabled + .settlement-adjustment-dialog__switch-track { opacity: .5; cursor: not-allowed; }
.settlement-adjustment-dialog__summary { display: grid; grid-template-columns: minmax(0, 1fr) max-content; column-gap: 16px; row-gap: 8px; margin: 16px 0 0; }
.settlement-adjustment-dialog__summary div { display: contents; }
.settlement-adjustment-dialog__summary dt { min-width: 0; color: var(--settlement-muted); font-size: 14px; font-weight: 500; line-height: 1.45; }
.settlement-adjustment-dialog__summary dd { margin: 0; color: var(--settlement-text); font-size: 15px; font-variant-numeric: tabular-nums; font-weight: 650; line-height: 1.45; white-space: nowrap; }
.settlement-adjustment-dialog__summary .is-deduction { color: var(--settlement-danger); font-weight: 700; }
.settlement-adjustment-dialog__summary .is-payable dt,
.settlement-adjustment-dialog__summary .is-payable dd { margin-top: 3px; padding-top: 11px; border-top: 1px solid var(--settlement-divider); }
.settlement-adjustment-dialog__summary .is-payable dt { color: var(--settlement-text); font-size: 15px; font-weight: 650; }
.settlement-adjustment-dialog__summary .is-payable dd { color: var(--settlement-accent); font-size: 21px; font-weight: 750; }
.settlement-adjustment-dialog__actions { display: grid; grid-template-columns: auto 1fr 1.18fr; align-items: stretch; gap: 10px; margin-top: 20px; }
.settlement-adjustment-dialog__actions button {
  min-width: 0;
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid var(--settlement-border);
  border-radius: var(--cashier-radius-sm);
  outline: 2px solid transparent;
  outline-offset: 2px;
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
  transition: border-color 120ms ease, background-color 120ms ease, color 120ms ease, transform 80ms ease;
}
.settlement-adjustment-dialog button:focus-visible { outline-color: var(--settlement-accent); }
.settlement-adjustment-dialog button:active:not(:disabled) { transform: translateY(1px); }
.settlement-adjustment-dialog button:disabled { opacity: .5; cursor: not-allowed; }
.settlement-adjustment-dialog__cancel { color: var(--settlement-text); background: var(--settlement-control-bg); }
.settlement-adjustment-dialog__clear { color: var(--settlement-danger); background: var(--settlement-danger-soft); }
.settlement-adjustment-dialog__confirm { border-color: var(--settlement-accent); color: var(--settlement-confirm-text); background: var(--settlement-accent); }
.settlement-adjustment-dialog.is-loading .settlement-adjustment-dialog__confirm { cursor: wait; }
@media (hover: hover) {
  .settlement-adjustment-dialog__close:hover:not(:disabled),
  .settlement-adjustment-dialog__cancel:hover:not(:disabled) { color: var(--settlement-text); background: var(--settlement-control-hover-bg); }
  .settlement-adjustment-dialog__mode-switch button:hover:not(:disabled):not(.is-selected) { color: var(--settlement-text); background: var(--settlement-control-bg); }
  .settlement-adjustment-dialog__clear:hover:not(:disabled) { border-color: var(--settlement-danger-hover-border); background: var(--settlement-danger-hover-bg); }
  .settlement-adjustment-dialog__confirm:hover:not(:disabled) { background: var(--settlement-accent-strong); }
}
@media (max-width: 899px) {
  .settlement-adjustment-dialog-backdrop { background: var(--cashier-scrim-48); }
  .settlement-adjustment-dialog {
    --settlement-dialog-bg: var(--mobile-v2-surface, var(--cashier-surface));
    --settlement-dialog-border: var(--mobile-v2-line, var(--cashier-border));
    --settlement-field-bg: var(--mobile-v2-surface-raised, var(--cashier-surface-soft));
    --settlement-control-bg: var(--mobile-v2-surface-muted, var(--cashier-surface-muted));
    --settlement-control-hover-bg: var(--mobile-v2-surface-pressed, var(--cashier-border));
    --settlement-close-bg: var(--mobile-v2-surface-muted, var(--cashier-surface-muted));
    --settlement-close-border: var(--mobile-v2-line, var(--cashier-border));
    --settlement-border: var(--mobile-v2-line, var(--cashier-border));
    --settlement-divider: var(--mobile-v2-line, var(--cashier-border));
    --settlement-text: var(--mobile-v2-text, var(--cashier-text));
    --settlement-muted: var(--mobile-v2-muted, var(--cashier-text-secondary));
    --settlement-accent: var(--mobile-v2-green, var(--cashier-action-primary));
    --settlement-accent-strong: var(--mobile-v2-green-strong, var(--cashier-action-primary-hover));
    --settlement-accent-soft: var(--mobile-v2-green-soft, var(--cashier-green-soft));
    --settlement-focus: var(--mobile-v2-focus, var(--cashier-green-glow));
    --settlement-danger: var(--mobile-v2-red, var(--cashier-action-danger));
    --settlement-danger-border: var(--mobile-v2-red, var(--cashier-action-danger));
    --settlement-danger-soft: var(--mobile-v2-red-soft, var(--cashier-action-danger-soft));
    --settlement-danger-hover-border: var(--mobile-v2-red, var(--cashier-action-danger));
    --settlement-danger-hover-bg: var(--mobile-v2-red-soft, var(--cashier-action-danger-soft));
    --settlement-switch-bg: var(--mobile-v2-line-strong, var(--cashier-border-strong));
    --settlement-switch-thumb: var(--cashier-white);
    --settlement-confirm-text: var(--cashier-white);
    border-radius: var(--mobile-v2-radius-card, var(--cashier-radius));
    box-shadow: var(--mobile-v2-shadow-float, var(--cashier-shadow-strong));
    color-scheme: light;
  }
}
@media (max-width: 460px) {
  .settlement-adjustment-dialog { width: calc(100vw - 24px); max-height: calc(100dvh - 24px); padding: 18px; overflow-y: auto; }
  .settlement-adjustment-dialog__input-shell { grid-template-columns: auto minmax(0, 1fr); }
  .settlement-adjustment-dialog__mode-switch button { min-width: 54px; padding-inline: 9px; }
  .settlement-adjustment-dialog__input-shell > input { padding-inline: 10px; font-size: 22px; }
  .settlement-adjustment-dialog__actions { grid-template-columns: 1fr 1fr; }
  .settlement-adjustment-dialog__clear { grid-column: 1 / -1; grid-row: 2; }
}
@media (prefers-reduced-motion: reduce) {
  .settlement-adjustment-dialog *,
  .settlement-adjustment-dialog *::before,
  .settlement-adjustment-dialog *::after { transition-duration: .01ms !important; }
}
</style>
