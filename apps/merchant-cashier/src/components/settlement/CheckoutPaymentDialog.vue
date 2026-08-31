<script setup lang="ts">
import { Banknote, Landmark, X } from '@lucide/vue';
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { formatVnd } from '@/domain';
import { useI18n } from '@/i18n';
import type { PaymentMethod } from '@/types';

const props = defineProps<{
  open: boolean;
  amountVnd: string | number;
  loading?: boolean;
  error?: string;
  showDescription?: boolean;
}>();
const emit = defineEmits<{ cancel: []; confirm: [paymentMethod: PaymentMethod] }>();
const { locale, t } = useI18n();
const selected = ref<PaymentMethod | ''>('');
const dialog = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

watch(() => props.open, (open) => {
  if (open) {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    selected.value = '';
    void nextTick(() => dialog.value?.focus());
  } else {
    previouslyFocused?.focus();
    previouslyFocused = null;
  }
});

function cancel() {
  if (!props.loading) emit('cancel');
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) cancel();
  if (event.key !== 'Tab' || !props.open || !dialog.value) return;
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function confirm() {
  if (selected.value) emit('confirm', selected.value);
}

window.addEventListener('keydown', onKeydown);
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div v-if="open" class="dialog-backdrop payment-dialog-backdrop" role="presentation" @click.self="cancel">
    <section ref="dialog" class="payment-dialog" role="dialog" aria-modal="true" :aria-label="t('payment.title')" tabindex="-1">
      <header>
        <div>
          <h3>{{ t('payment.title') }}</h3>
          <p v-if="showDescription !== false">{{ t('payment.description') }}</p>
        </div>
        <button type="button" class="payment-dialog__close" :aria-label="t('common.cancel')" :disabled="loading" @click="cancel">
          <X :size="20" aria-hidden="true" />
        </button>
      </header>

      <div class="payment-dialog__amount">
        <span>{{ t('payment.amount') }}</span>
        <strong>{{ formatVnd(amountVnd, locale) }}</strong>
      </div>

      <fieldset class="payment-options">
        <legend>{{ t('payment.method') }}</legend>
        <label :class="['payment-option', { 'is-selected': selected === 'CASH' }]">
          <input v-model="selected" type="radio" name="checkout-payment-method" value="CASH" />
          <span class="payment-option__icon"><Banknote :size="22" aria-hidden="true" /></span>
          <span><strong>{{ t('payment.cash') }}</strong><small>{{ t('payment.cashHint') }}</small></span>
        </label>
        <label :class="['payment-option', { 'is-selected': selected === 'BANK_TRANSFER' }]">
          <input v-model="selected" type="radio" name="checkout-payment-method" value="BANK_TRANSFER" />
          <span class="payment-option__icon"><Landmark :size="22" aria-hidden="true" /></span>
          <span><strong>{{ t('payment.bankTransfer') }}</strong><small>{{ t('payment.bankTransferHint') }}</small></span>
        </label>
      </fieldset>

      <p v-if="error" class="payment-dialog__error" role="alert">{{ error }}</p>

      <footer>
        <button type="button" class="secondary-action" :disabled="loading" @click="cancel">{{ t('common.cancel') }}</button>
        <button type="button" class="primary-action" :disabled="loading || !selected" @click="confirm">
          {{ loading ? t('payment.confirming') : t('payment.confirm') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.payment-dialog-backdrop {
  padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
  background: rgb(2 13 22 / 56%);
}
.payment-dialog {
  width: min(440px, 100%);
  max-height: calc(100dvh - 32px);
  overflow: auto;
  border: 1px solid var(--cashier-shell-border);
  border-radius: 16px;
  padding: 20px 22px;
  color: var(--cashier-shell-text);
  background: var(--cashier-shell-850);
  box-shadow: 0 18px 48px rgb(0 0 0 / 38%);
}
.payment-dialog header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.payment-dialog h3 { margin: 0; color: var(--cashier-shell-text); font-size: 20px; font-weight: 700; line-height: 1.25; }
.payment-dialog header p { margin: 5px 0 0; color: var(--cashier-shell-muted); font-size: 13px; line-height: 1.5; }
.payment-dialog__close {
  display: grid;
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 0;
  border-radius: 10px;
  color: var(--cashier-shell-text);
  background: var(--cashier-white-alpha-08);
  cursor: pointer;
}
.payment-dialog__close:hover:not(:disabled) { color: var(--cashier-white); background: var(--cashier-white-alpha-14); }
.payment-dialog:focus { outline: none; }
.payment-dialog__error { margin: 12px 0 0; color: #ff7a84; font-size: 13px; text-align: center; }
.payment-dialog__amount {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 18px 0;
  padding: 16px;
  border: 1px solid var(--cashier-shell-border);
  border-radius: 12px;
  background: var(--cashier-shell-800);
}
.payment-dialog__amount span { color: var(--cashier-shell-muted); font-size: 13px; font-weight: 700; }
.payment-dialog__amount strong {
  color: var(--cashier-shell-text);
  font-size: 24px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.payment-options { display: grid; gap: 10px; margin: 0; padding: 0; border: 0; }
.payment-options legend { margin-bottom: 9px; color: var(--cashier-shell-muted); font-size: 13px; font-weight: 800; }
.payment-option {
  display: grid;
  grid-template-columns: auto 42px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 64px;
  padding: 10px 13px;
  border: 1px solid var(--cashier-white-alpha-14);
  border-radius: 12px;
  background: var(--cashier-shell-800);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
}
.payment-option:hover { border-color: var(--cashier-shell-border); }
.payment-option.is-selected {
  border-color: var(--cashier-green);
  background: rgb(25 195 125 / 10%);
  box-shadow: 0 0 0 1px var(--cashier-green) inset;
}
.payment-option input { width: 18px; height: 18px; accent-color: var(--cashier-green); }
.payment-option__icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 10px;
  color: var(--cashier-green);
  background: var(--cashier-white-alpha-08);
}
.payment-option span:last-child { display: grid; gap: 3px; min-width: 0; }
.payment-option strong { color: var(--cashier-shell-text); font-size: 15px; }
.payment-option small { color: var(--cashier-shell-muted); font-size: 12px; line-height: 1.35; }
.payment-dialog footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 10px;
  margin-top: 20px;
}
.payment-dialog footer button { min-height: 48px; white-space: nowrap; border-radius: 10px; }
.payment-dialog footer .secondary-action {
  border: 1px solid #405568;
  color: #c5d0da;
  background: transparent;
}
.payment-dialog footer .secondary-action:hover:not(:disabled) {
  color: var(--cashier-white);
  background: var(--cashier-shell-800);
}
.payment-dialog footer .primary-action { border: 0; background: var(--cashier-green); }
.payment-dialog footer .primary-action:hover:not(:disabled) { background: var(--cashier-green-strong); }
.payment-dialog footer button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.payment-dialog button:focus-visible,
.payment-option:focus-within {
  outline: 2px solid var(--cashier-green);
  outline-offset: 2px;
}
@media (max-width: 520px) {
  .payment-dialog-backdrop { align-items: end; padding-left: 0; padding-right: 0; padding-bottom: 0; }
  .payment-dialog {
    width: 100%;
    max-height: 88dvh;
    border-radius: 20px 20px 0 0;
    padding: 18px 16px max(18px, env(safe-area-inset-bottom));
  }
  .payment-dialog__amount strong { font-size: 21px; }
  .payment-dialog footer {
    position: sticky;
    bottom: 0;
    margin: 18px -4px -4px;
    padding: 8px 4px 4px;
    background: var(--cashier-shell-850);
  }
}
</style>
