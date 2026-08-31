<script setup lang="ts">
import { ArrowRightLeft, Bell, ChevronLeft, CreditCard, Ellipsis, LoaderCircle, Minus, Plus, Printer, ShoppingBasket, UtensilsCrossed } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { formatItemPrice, formatVietnamTime, formatVnd } from '@/domain';
import { useI18n } from '@/i18n';
import type { DineInCanonicalLine, DineInCanonicalState, TableCardView, TableSessionDetail } from '@/types';
import DineInActionDock from '@/features/dine-in/DineInActionDock.vue';
import MobileV2BillActionDock from '@/mobile-v2/MobileV2BillActionDock.vue';

const props = defineProps<{
  table?: TableCardView | null;
  session?: TableSessionDetail | null;
  canonicalState?: DineInCanonicalState | null;
  checkingOut?: boolean;
  checkoutDisabled?: boolean;
  actionsDisabled?: boolean;
  itemActionsDisabled?: boolean;
  orderableProductIds?: Set<string>;
  adjustmentApplied?: boolean;
  embedded?: boolean;
  transferDisabled?: boolean;
  notificationLoading?: boolean;
  mobileV2Presentation?: boolean;
  // Compatibility-only props retained for older isolated component fixtures.
  draftLines?: unknown[];
  pendingDecreaseMergeKeys?: Set<string>;
  pendingDecreaseQuantities?: Record<string, number>;
  adjustmentLoadingId?: string;
  pendingAdjustmentItemId?: string;
  payableAmount?: string;
}>();

const emit = defineEmits<{
  notifyProduction: [];
  decreaseLine: [line: DineInCanonicalLine];
  increaseLine: [line: DineInCanonicalLine];
  transfer: [];
  checkout: [];
  adjustment: [];
  back: [];
  addItems: [];
  decreaseItem: [unknown, unknown?, number?, string?];
  increaseItem: [unknown, unknown?, string?, string?];
  returnItem: [unknown, unknown];
}>();

const { t, locale } = useI18n();
const canonicalLines = computed(() => props.canonicalState?.items ?? []);
const totals = computed(() => props.canonicalState?.totals ?? {
  originalAmountVnd: props.session?.originalAmountVnd || props.session?.totalAmountVnd || '0',
  discountPayableRateBps: props.session?.discountPayableRateBps ?? null,
  discountAmountVnd: props.session?.discountAmountVnd || '0',
  roundingAmountVnd: props.session?.roundingAmountVnd || '0',
  payableAmountVnd: props.session?.payableAmountVnd || props.session?.totalAmountVnd || '0',
});
const totalDishQuantity = computed(() => canonicalLines.value.reduce((total, line) => total + line.quantity, 0));
const dishCountLabel = computed(() => t(totalDishQuantity.value === 1 ? 'table.dishCountOne' : 'table.dishCount', { count: totalDishQuantity.value }));
const productionNotification = computed(() => props.canonicalState?.productionNotification);
const canNotifyProduction = computed(() => Boolean(
  props.session?.status === 'OPEN'
  && props.table?.status !== 'DISABLED'
  && productionNotification.value?.status === 'READY'
  && productionNotification.value.pendingItemQuantity > 0,
));
const productionNotificationTitle = computed(() => {
  if (productionNotification.value?.status === 'READY') {
    return t('productionNotification.pending', {
      count: productionNotification.value.pendingItemQuantity,
    });
  }
  if (productionNotification.value?.status === 'UNCONFIGURED') return t('productionNotification.unconfigured');
  if (productionNotification.value?.status === 'UNAVAILABLE') return t('productionNotification.unavailable');
  return t('productionNotification.upToDate');
});
const tableStatus = computed(() => props.table?.operationalStatus || 'IN_USE');
const tableStatusLabel = computed(() => {
  if (tableStatus.value === 'DISABLED') return t('table.status.disabled');
  if (tableStatus.value === 'AVAILABLE') return t('table.status.available');
  return t('table.status.inUse');
});
const mobileActionsOpen = ref(false);
const mobileActionsRoot = ref<HTMLElement | null>(null);

function closeMobileActionsOnOutside(event: PointerEvent) {
  if (!mobileActionsRoot.value?.contains(event.target as Node)) mobileActionsOpen.value = false;
}

function closeMobileActionsOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') mobileActionsOpen.value = false;
}

function openTransferFromMobileActions() {
  mobileActionsOpen.value = false;
  emit('transfer');
}

onMounted(() => {
  document.addEventListener('pointerdown', closeMobileActionsOnOutside);
  document.addEventListener('keydown', closeMobileActionsOnEscape);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeMobileActionsOnOutside);
  document.removeEventListener('keydown', closeMobileActionsOnEscape);
});

function canonicalName(line: DineInCanonicalLine) {
  if (locale.value === 'vi') return line.productNameVi || line.productNameZh;
  if (locale.value === 'en') return line.productNameEn || line.productNameZh;
  return line.productNameZh;
}

function decreaseDisabled(line: DineInCanonicalLine) {
  return Boolean((props.itemActionsDisabled ?? props.actionsDisabled) || line.quantity <= line.lockedQuantity);
}

function increaseDisabled(line: DineInCanonicalLine) {
  return Boolean(
    (props.itemActionsDisabled ?? props.actionsDisabled)
    || !line.productId
    || (props.orderableProductIds && !props.orderableProductIds.has(line.productId)),
  );
}

function priceCanExpand(line: DineInCanonicalLine) {
  return BigInt(line.subtotalVnd || '0') >= 10_000_000n;
}
</script>

<template>
  <div
    class="detail-panel-content table-bill-detail table-bill-shell"
    :class="{
      'table-bill-shell--active': Boolean(session),
      'table-empty-detail table-bill-shell--empty-table': !session && Boolean(table),
      'table-bill-shell--no-selection': !session && !table,
    }"
    data-testid="table-detail"
  >
    <header v-if="mobileV2Presentation" class="mobile-v2-bill-header" data-testid="right-panel-header">
      <button type="button" class="mobile-v2-bill-header__back" :aria-label="t('fulfillment.backToTables')" data-testid="mobile-v2-bill-back" @click="emit('back')">
        <ChevronLeft :size="28" aria-hidden="true" />
      </button>
      <div class="mobile-v2-bill-header__identity">
        <strong>{{ canonicalState?.tableNo || session?.tableNo || table?.tableNo || t('table.numberFallback') }}</strong>
        <small v-if="session">{{ tableStatusLabel }} · {{ formatVietnamTime(session.openedAt, locale) }} · {{ dishCountLabel }}</small>
        <small v-else-if="table">{{ tableStatusLabel }}</small>
      </div>
      <div ref="mobileActionsRoot" class="mobile-v2-bill-header__actions">
        <button type="button" class="mobile-v2-bill-header__more" :aria-label="t('cashierV2.moreActions')" :aria-expanded="mobileActionsOpen" data-testid="mobile-v2-bill-more" @click="mobileActionsOpen = !mobileActionsOpen">
          <Ellipsis :size="25" aria-hidden="true" />
        </button>
        <Transition name="mobile-v2-more-menu">
          <section v-if="mobileActionsOpen" class="mobile-v2-bill-header__menu" :aria-label="t('cashierV2.moreActions')">
            <button type="button" data-testid="mobile-v2-bill-transfer" :disabled="transferDisabled || actionsDisabled || !session" @click="openTransferFromMobileActions">
              <ArrowRightLeft :size="19" aria-hidden="true" />{{ t('tableTransfer.open') }}
            </button>
          </section>
        </Transition>
      </div>
    </header>

    <header v-else class="table-detail-header table-bill-shell__header" data-testid="right-panel-header">
      <div v-if="session" class="table-detail-header__line">
        <h3>{{ canonicalState?.tableNo || session.tableNo || table?.tableNo || t('table.numberFallback') }}</h3>
        <span :class="`table-detail-state table-detail-state--${tableStatus.toLowerCase().replace(/_/g, '-')}`">{{ tableStatusLabel }}</span>
        <span class="table-detail-header__meta">{{ t('table.openedAtValue', { time: formatVietnamTime(session.openedAt, locale) }) }} | {{ dishCountLabel }}</span>
        <button v-if="!mobileV2Presentation" type="button" class="table-transfer-entry" data-testid="table-transfer-entry" :aria-label="t('tableTransfer.open')" :title="t('tableTransfer.open')" :disabled="transferDisabled || actionsDisabled" @click="emit('transfer')"><ArrowRightLeft :size="18" aria-hidden="true" /></button>
      </div>
      <div v-else-if="table" class="table-detail-header__line">
        <h3>{{ table.tableNo || t('table.numberFallback') }}</h3>
        <span class="table-detail-state table-detail-state--available">{{ t('table.status.available') }}</span>
      </div>
      <div v-else class="table-detail-header__line table-detail-header__line--passive"><h3>{{ t('table.detailEmptyTitle') }}</h3></div>
    </header>

    <section class="detail-section table-bill-content table-bill-shell__body" data-testid="right-panel-body">
      <div v-if="canonicalLines.length" class="table-bill-scroll" data-testid="table-bill-scroll">
        <div class="table-item-summary-list" data-testid="table-item-summary">
          <article v-for="entry in canonicalLines" :key="entry.lineKey" class="table-item-summary-row canonical-table-item-row" :class="{ 'table-item-summary-row--extended-price': priceCanExpand(entry) }" :data-product-id="entry.productId" :data-line-key="entry.lineKey">
            <div class="table-item-summary-row__name">
              <strong :title="canonicalName(entry)">{{ canonicalName(entry) }}</strong>
              <small v-if="entry.remark">{{ entry.remark }}</small>
            </div>
            <div class="committed-item-stepper" :class="{ 'committed-item-stepper--wide-quantity': entry.quantity >= 100 }" :aria-label="t('ordering.quantityFor', { name: canonicalName(entry) })">
              <button type="button" data-testid="decrease-canonical-line" :aria-label="`${t('itemAdjustment.decrease')} ${canonicalName(entry)}`" :disabled="decreaseDisabled(entry)" :title="decreaseDisabled(entry) ? t('itemAdjustment.unavailable') : t('itemAdjustment.decrease')" @click="emit('decreaseLine', entry)"><Minus :size="16" aria-hidden="true" /></button>
              <output>{{ entry.quantity }}</output>
              <button type="button" data-testid="increase-canonical-line" :aria-label="`${t('ordering.increaseQuantity')} ${canonicalName(entry)}`" :disabled="increaseDisabled(entry)" :title="increaseDisabled(entry) ? t('ordering.historicalProductUnavailable') : t('ordering.increaseQuantity')" @click="emit('increaseLine', entry)"><Plus :size="16" aria-hidden="true" /></button>
            </div>
            <b class="table-item-summary-row__item-price">{{ formatItemPrice(entry.subtotalVnd, locale) }}</b>
          </article>
        </div>
      </div>
      <div v-else-if="table" class="table-bill-empty-canvas" data-testid="right-panel-empty-table">
        <span class="table-bill-empty-canvas__icon" data-testid="empty-order-icon"><ShoppingBasket :size="34" aria-hidden="true" /></span>
        <strong data-testid="empty-order-primary">{{ t('bill.emptyOrderTitle') }}</strong>
        <p data-testid="empty-order-secondary">{{ t('bill.emptyOrderDescription') }}</p>
      </div>
      <div v-else class="table-bill-passive-state" data-testid="right-panel-passive-state">
        <span><UtensilsCrossed :size="22" aria-hidden="true" /></span><strong>{{ t('table.detailEmptyTitle') }}</strong><p>{{ t('table.detailEmptyDescription') }}</p>
      </div>
    </section>

    <footer class="table-bill-shell__footer" data-testid="right-panel-footer">
      <button v-if="session && mobileV2Presentation" type="button" class="mobile-v2-bill-add-items" data-testid="mobile-v2-bill-add-items" :aria-label="t('table.addItems')" :title="t('table.addItems')" :disabled="actionsDisabled" @click="emit('addItems')">
        <Plus :size="28" aria-hidden="true" />
      </button>
      <div class="table-bill-total-row dinein-summary-row" :class="{ 'dinein-summary-row--placeholder': !session }">
        <button v-if="session && !embedded" type="button" class="secondary-action dinein-action-button production-notify-action" :class="{ 'production-notify-action--ready': canNotifyProduction }" data-testid="table-production-notify" :aria-busy="notificationLoading" :title="productionNotificationTitle" :disabled="actionsDisabled || notificationLoading || !canNotifyProduction" @click="emit('notifyProduction')"><LoaderCircle v-if="notificationLoading" :size="18" class="spinning" aria-hidden="true" /><Bell v-else :size="18" aria-hidden="true" />{{ t(notificationLoading ? 'productionNotification.loading' : 'productionNotification.action') }}</button>
        <button v-else-if="!session" type="button" class="secondary-action dinein-action-button production-notify-action" disabled><Bell :size="18" aria-hidden="true" />{{ t('productionNotification.action') }}</button>
        <dl class="dinein-settlement-summary">
          <template v-if="session">
            <div><dt>{{ t('discount.cashierOriginal') }}</dt><dd>{{ formatVnd(totals.originalAmountVnd, locale) }}</dd></div>
            <div v-if="BigInt(totals.discountAmountVnd) > 0n"><dt>{{ t('discount.cashierAmount') }}</dt><dd class="is-deduction">-{{ formatVnd(totals.discountAmountVnd, locale) }}</dd></div>
            <div v-if="BigInt(totals.roundingAmountVnd) > 0n"><dt>{{ t('discount.cashierRounding') }}</dt><dd class="is-deduction">-{{ formatVnd(totals.roundingAmountVnd, locale) }}</dd></div>
            <div class="is-payable"><dt>{{ t('discount.cashierPayable') }}</dt><dd :title="formatVnd(totals.payableAmountVnd, locale)">{{ formatVnd(totals.payableAmountVnd, locale) }}</dd></div>
          </template>
          <template v-else><div><dt>{{ t('discount.cashierOriginal') }}</dt><dd>–</dd></div><div class="is-payable"><dt>{{ t('discount.cashierPayable') }}</dt><dd>–</dd></div></template>
        </dl>
      </div>

      <MobileV2BillActionDock v-if="session && mobileV2Presentation" :session-id="session.id" :checkout-disabled="checkoutDisabled" :checking-out="checkingOut" :actions-disabled="actionsDisabled" :adjustment-applied="adjustmentApplied" @adjustment="emit('adjustment')" @checkout="emit('checkout')" />
      <DineInActionDock v-else-if="session" :session-id="session.id" :checkout-disabled="checkoutDisabled" :checking-out="checkingOut" :actions-disabled="actionsDisabled" :adjustment-applied="adjustmentApplied" @adjustment="emit('adjustment')" @checkout="emit('checkout')" />
      <div v-else class="dinein-action-dock dinein-action-dock--placeholder" data-testid="dinein-action-dock-placeholder">
        <button type="button" class="secondary-action detail-print-action dinein-action-button" disabled><Printer :size="18" aria-hidden="true" />{{ t('print.action') }}</button>
        <button type="button" class="dinein-action-dock__action dinein-action-button dinein-action-dock__rounding" disabled>{{ t('discount.entry') }}</button>
        <button type="button" class="dinein-action-dock__action dinein-action-button dinein-action-dock__checkout" disabled><CreditCard :size="18" aria-hidden="true" />{{ t('table.checkout') }}</button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.dinein-settlement-summary { display: grid; width: 100%; min-width: 0; gap: 7px; margin: 0; }
.dinein-settlement-summary div { display: grid; grid-template-columns: max-content max-content; align-items: baseline; justify-content: start; column-gap: 10px; }
.dinein-settlement-summary dt { min-width: 0; color: var(--cashier-shell-muted); font-size: 14px; font-weight: 400; }
.dinein-settlement-summary dd { min-width: max-content; margin: 0; overflow: visible; color: var(--cashier-shell-text); font-size: 16px; font-variant-numeric: tabular-nums; font-weight: 700; text-align: right; text-overflow: clip; white-space: nowrap; }
.dinein-settlement-summary .is-deduction { color: var(--cashier-red); }
.dinein-settlement-summary .is-payable { margin-top: 1px; padding-top: 6px; border-top: 1px solid var(--cashier-shell-border); }
.dinein-settlement-summary .is-payable dt { color: var(--cashier-shell-text); font-size: 16px; font-weight: 600; }
.dinein-settlement-summary .is-payable dd { color: var(--cashier-detail-total); font-size: 21px; font-weight: 700; }
.production-notify-action--ready { border-color: var(--cashier-green-alpha-52); background: var(--cashier-green-alpha-13); }
.production-notify-action .spinning { animation: production-notify-spin 800ms linear infinite; }
.production-notify-action--ready:active:not(:disabled) { transform: translateY(1px); }
@media (hover: hover) and (pointer: fine) {
  .production-notify-action--ready:hover:not(:disabled) { border-color: var(--cashier-green); background: var(--cashier-green-alpha-22); }
}
@media (prefers-reduced-motion: reduce) {
  .production-notify-action .spinning { animation: none; }
}
@keyframes production-notify-spin { to { transform: rotate(360deg); } }
.canonical-table-item-row { grid-template-columns: minmax(0, 1fr) 116px auto !important; }
.canonical-table-item-row .table-item-summary-row__name { grid-column: 1 !important; }
.canonical-table-item-row .committed-item-stepper { grid-column: 2 !important; }
.canonical-table-item-row .table-item-summary-row__item-price { grid-column: 3 !important; }
@media (max-width: 430px) { .canonical-table-item-row { grid-template-columns: minmax(0, 1fr) 104px auto !important; } }
</style>
