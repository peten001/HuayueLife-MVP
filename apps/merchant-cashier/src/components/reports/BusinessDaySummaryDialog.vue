<script setup lang="ts">
import { Printer, X } from '@lucide/vue';
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { formatVnd } from '@/domain';
import { useI18n } from '@/i18n';
import type { BusinessDaySummary } from '@/types';

const props = defineProps<{
  open: boolean;
  businessDate: string;
  summary: BusinessDaySummary | null;
  loading?: boolean;
  printing?: boolean;
  error?: string;
  status?: string;
}>();
const emit = defineEmits<{ cancel: []; dateChange: [businessDate: string]; print: [] }>();
const { locale, t } = useI18n();
const dialog = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

function bilingualDishName(item: { nameZh: string; nameVi?: string | null }): string {
  const vi = item.nameVi?.trim() ?? '';
  const zh = item.nameZh?.trim() ?? '';
  if (!vi) return zh;
  if (!zh || vi === zh) return vi;
  return `${vi} ${zh}`;
}

watch(() => props.open, (open) => {
  if (open) {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void nextTick(() => dialog.value?.focus());
  } else {
    previouslyFocused?.focus();
    previouslyFocused = null;
  }
});
function cancel() {
  if (!props.printing) emit('cancel');
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
window.addEventListener('keydown', onKeydown);
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div v-if="open" class="dialog-backdrop summary-backdrop" role="presentation" @click.self="cancel">
    <section ref="dialog" class="business-summary-dialog" role="dialog" aria-modal="true" :aria-label="t('summary.title')" tabindex="-1">
      <header>
        <div><h3>{{ t('summary.title') }}</h3><p>{{ t('summary.description') }}</p></div>
        <button type="button" class="summary-close" :aria-label="t('common.cancel')" :disabled="printing" @click="cancel"><X :size="20" /></button>
      </header>

      <label class="summary-date">
        <span>{{ t('summary.businessDate') }}</span>
        <input :value="businessDate" type="date" :disabled="loading || printing" @change="$emit('dateChange', ($event.target as HTMLInputElement).value)" />
      </label>

      <div v-if="loading" class="summary-state">{{ t('summary.loading') }}</div>
      <p v-else-if="error" class="summary-error" role="alert">{{ error }}</p>
      <template v-else-if="summary">
        <section class="summary-section">
          <h4>{{ summary.merchant.nameZh }}</h4>
          <dl class="summary-segments">
            <div><dt>{{ t('summary.businessDate') }}</dt><dd>{{ summary.businessDate }}</dd></div>
            <div><dt>{{ t('summary.segments') }}</dt><dd><span v-for="segment in summary.segments" :key="`${segment.start}-${segment.end}`">{{ segment.start }}–{{ segment.crossesMidnight ? t('summary.nextDay') : '' }}{{ segment.end }}</span><span v-if="!summary.segments.length">{{ t('summary.closedDay') }}</span></dd></div>
          </dl>
        </section>

        <section class="summary-section">
          <div class="summary-section__title"><h4>{{ t('summary.items') }}</h4><span>{{ t('summary.orderCount', { count: summary.orderCount }) }}</span></div>
          <div v-if="summary.itemSummary.length" class="summary-items">
            <div v-for="item in summary.itemSummary" :key="`${item.nameZh}-${item.nameVi}`" class="summary-item">
              <span class="summary-item__name" :title="[item.nameZh, item.nameVi, item.nameEn].filter(Boolean).join(' / ')">{{ bilingualDishName(item) }}</span>
              <strong>× {{ item.quantity }}</strong>
            </div>
          </div>
          <p v-else class="summary-empty">{{ t('summary.empty') }}</p>
        </section>

        <section class="summary-section summary-money">
          <h4>{{ t('summary.amounts') }}</h4>
          <dl>
            <div><dt>{{ t('summary.discount') }}</dt><dd>{{ formatVnd(summary.discountAmountVnd, locale) }}</dd></div>
            <div><dt>{{ t('summary.rounding') }}</dt><dd>{{ formatVnd(summary.roundingAmountVnd, locale) }}</dd></div>
            <div class="is-total"><dt>{{ t('summary.total') }}</dt><dd>{{ formatVnd(summary.totalRevenueVnd, locale) }}</dd></div>
            <div><dt>{{ t('payment.cash') }}</dt><dd>{{ formatVnd(summary.cashRevenueVnd, locale) }}</dd></div>
            <div><dt>{{ t('payment.bankTransfer') }}</dt><dd>{{ formatVnd(summary.bankTransferRevenueVnd, locale) }}</dd></div>
            <div v-if="summary.unrecordedRevenueVnd !== '0'"><dt>{{ t('summary.unrecorded') }}</dt><dd>{{ formatVnd(summary.unrecordedRevenueVnd, locale) }}</dd></div>
          </dl>
        </section>
      </template>

      <p v-if="status" class="summary-status" role="status">{{ status }}</p>

      <footer>
        <button type="button" class="secondary-action" :disabled="printing" @click="cancel">{{ t('common.cancel') }}</button>
        <button type="button" class="primary-action" :disabled="loading || printing || !summary" @click="$emit('print')"><Printer :size="18" />{{ printing ? t('summary.printing') : t('summary.print') }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
/* finesse · component: business-day-summary-dialog · register=product
 * states: existing default / hover / focus-visible / active / disabled / loading / error / success
 * tokens: inherited; this change only contains mobile scrolling. */
.summary-backdrop{padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom))}
.business-summary-dialog{width:min(560px,100%);max-height:calc(100dvh - 32px);overflow:auto;border:1px solid var(--cashier-border);border-radius:18px;background:var(--cashier-surface);box-shadow:0 24px 70px rgba(18,42,29,.2);padding:20px}
.business-summary-dialog>header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.business-summary-dialog h3,.business-summary-dialog h4{margin:0;color:var(--cashier-text)}.business-summary-dialog header p{margin:5px 0 0;color:var(--cashier-text-muted);font-size:13px}.summary-close{display:grid;flex:0 0 44px;width:44px;height:44px;place-items:center;border:0;border-radius:11px;background:var(--cashier-surface-soft);color:var(--cashier-text)}
.summary-close:hover:not(:disabled){background:var(--cashier-surface-muted);color:var(--cashier-text)}
.summary-close:disabled{opacity:.5;cursor:not-allowed}
.summary-date{display:grid;grid-template-columns:auto minmax(0,180px);align-items:center;justify-content:space-between;gap:12px;margin:18px 0;color:var(--cashier-text);font-size:13px;font-weight:800}.summary-date input{min-height:44px;border:1px solid var(--cashier-border);border-radius:10px;padding:0 11px;background:var(--cashier-surface);color:var(--cashier-text);font:inherit}
.summary-state,.summary-error{padding:24px 10px;text-align:center}.summary-error{color:var(--cashier-form-error-text)}.summary-section{padding:15px 0;border-top:1px solid var(--cashier-border)}.summary-section__title{display:flex;justify-content:space-between;gap:12px}.summary-section__title span{color:var(--cashier-text-muted);font-size:12px}.summary-segments,.summary-money dl{display:grid;gap:9px;margin:12px 0 0}.summary-segments>div,.summary-money dl>div{display:grid;grid-template-columns:minmax(110px,.7fr) minmax(0,1.3fr);gap:12px}.summary-section dt{color:var(--cashier-text-secondary);font-size:12px}.summary-section dd{display:grid;gap:3px;margin:0;color:var(--cashier-text);font-size:13px;text-align:right}.summary-items{display:grid;gap:8px;margin-top:12px;max-height:220px;overflow:auto}.summary-items>div{display:flex;justify-content:space-between;gap:14px;min-height:28px}.summary-items span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--cashier-text)}.summary-items strong,.summary-money dd{font-variant-numeric:tabular-nums;white-space:nowrap}.summary-empty{margin:12px 0 0;color:var(--cashier-text-muted);font-size:13px}.summary-money .is-total{margin:3px 0;padding:10px 0;border-top:1px solid var(--cashier-border);border-bottom:1px solid var(--cashier-border)}.summary-money .is-total dt,.summary-money .is-total dd{color:var(--cashier-text);font-size:15px;font-weight:800}.business-summary-dialog>footer{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.45fr);gap:10px;position:sticky;bottom:-20px;margin:5px -4px -20px;padding:12px 4px max(20px,env(safe-area-inset-bottom));background:var(--cashier-surface)}.business-summary-dialog footer button{min-height:48px;white-space:nowrap}
.summary-item{display:flex;justify-content:space-between;align-items:center;gap:14px;min-height:28px}.summary-item+.summary-item{border-top:1px dashed var(--cashier-text);padding-top:8px;margin-top:1px}.summary-items .summary-item__name{min-width:0;flex:1 1 auto;color:var(--cashier-text);font-size:14px;font-weight:600;line-height:1.4;overflow-wrap:anywhere;white-space:normal;overflow:visible;text-overflow:clip}.summary-item strong{flex:0 0 auto;color:var(--cashier-text);font-size:14px;font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
.business-summary-dialog footer .secondary-action{border:1px solid var(--cashier-border-strong);color:var(--cashier-text);background:var(--cashier-surface-soft)}
.business-summary-dialog footer .secondary-action:hover:not(:disabled){border-color:var(--cashier-text-secondary);background:var(--cashier-surface-muted);color:var(--cashier-text)}
.business-summary-dialog footer .secondary-action:disabled,.business-summary-dialog footer .primary-action:disabled{opacity:.5;cursor:not-allowed}
.business-summary-dialog footer .primary-action{border:0;background:var(--cashier-green)}
.business-summary-dialog footer .primary-action:hover:not(:disabled){background:var(--cashier-green-strong)}
.business-summary-dialog:focus{outline:none}.summary-status{margin:8px 0;color:var(--cashier-action-primary);font-size:13px;font-weight:700;text-align:center}
.business-summary-dialog button:focus-visible,.summary-date input:focus-visible{outline:2px solid var(--cashier-green-strong);outline-offset:2px}
@media(max-width:600px){.summary-backdrop{align-items:end;padding:0}.business-summary-dialog{width:100%;max-height:92dvh;border-radius:20px 20px 0 0;padding:18px 16px max(18px,env(safe-area-inset-bottom))}.summary-date{grid-template-columns:1fr}.summary-date input{width:100%}.summary-segments>div,.summary-money dl>div{grid-template-columns:minmax(0,1fr) auto}.business-summary-dialog>footer{bottom:calc(-1 * max(18px,env(safe-area-inset-bottom)));margin-bottom:calc(-1 * max(18px,env(safe-area-inset-bottom)))}}

/* Mobile summary only: preserve the existing vertical scrollers and sticky footer.
   Fit content first, then block sideways gestures and elastic overscroll. */
@media (max-width: 899px) {
  .summary-backdrop {
    grid-template-columns: minmax(0, 1fr);
    overflow: hidden;
    overscroll-behavior: none;
    touch-action: pan-y pinch-zoom;
  }

  .business-summary-dialog,
  .summary-items {
    min-width: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior-x: none;
    touch-action: pan-y pinch-zoom;
  }

  .business-summary-dialog > header > div,
  .summary-section,
  .summary-section h4 {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .summary-date input {
    min-width: 0;
    max-width: 100%;
  }
}
</style>
