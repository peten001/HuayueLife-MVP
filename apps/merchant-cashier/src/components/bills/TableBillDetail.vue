<script setup lang="ts">
import { ArrowRightLeft, CreditCard, LoaderCircle, Minus, Plus, Printer, ShoppingBasket, UtensilsCrossed } from '@lucide/vue';
import { computed } from 'vue';
import {
  buildCanonicalTableBillLines,
  canDecreaseOrderItems,
  canReturnOrderItems,
  formatItemPrice,
  formatVietnamTime,
  formatVnd,
  resolveLocalizedOrderItemName,
  stabilizeCanonicalTableBillLineOrder,
  type CanonicalTableBillLine,
} from '@/domain';
import { useI18n } from '@/i18n';
import type { CashierMenuProduct, CashierOrderingDraftLine, OrderItem, TableCardView, TableSessionDetail, TableSessionOrder } from '@/types';
import DineInActionDock from '@/features/dine-in/DineInActionDock.vue';

const props = defineProps<{
  table?: TableCardView | null;
  session?: TableSessionDetail | null;
  checkingOut?: boolean;
  checkoutDisabled?: boolean;
  actionsDisabled?: boolean;
  itemActionsDisabled?: boolean;
  adjustmentLoadingId?: string;
  pendingAdjustmentItemId?: string;
  pendingDecreaseMergeKeys?: Set<string>;
  pendingDecreaseQuantities?: Record<string, number>;
  orderableProductIds?: Set<string>;
  adjustmentApplied?: boolean;
  payableAmount?: string;
  embedded?: boolean;
  transferDisabled?: boolean;
  draftLines?: CashierOrderingDraftLine[];
}>();

const emit = defineEmits<{
  orderItems: [];
  decreaseItem:
    | [item: OrderItem, order: TableSessionOrder, canonicalQuantity: number, mergeKey: string]
    | [productId: string, mergeKey: string];
  returnItem: [item: OrderItem, order: TableSessionOrder];
  increaseItem:
    | [item: OrderItem, order: TableSessionOrder, mergeKey: string]
    | [productId: string, sourceItemId: undefined, remark: string, mergeKey: string];
  transfer: [];
  checkout: [];
  adjustment: [];
}>();

const { t, locale } = useI18n();
const receivedAmount = computed(() => props.payableAmount || props.session?.payableAmountVnd || props.session?.totalAmountVnd || '0');
const discountAmount = computed(() => props.session?.discountAmountVnd || '0');
const roundingAmount = computed(() => props.session?.roundingAmountVnd || '0');
const canonicalLineOrderBySession = new Map<string, string[]>();
const canonicalLines = computed(() => {
  const lines = buildCanonicalTableBillLines(
    props.session?.orders || [],
    props.draftLines || [],
  ).map((line) => {
    const requestedDecrease = props.pendingDecreaseQuantities?.[line.mergeKey] || 0;
    if (!requestedDecrease) return line;
    const decreaseQuantity = Math.min(line.quantity, requestedDecrease);
    let remainingCommittedDecrease = Math.min(line.committedQuantity, decreaseQuantity);
    let subtotalVnd = BigInt(line.subtotalVnd || '0');
    for (const { item } of [...line.committedEntries].reverse()) {
      if (!remainingCommittedDecrease) break;
      const itemQuantity = Number(item.quantity || 0);
      const itemDecrease = Math.min(itemQuantity, remainingCommittedDecrease);
      const unitPriceVnd = BigInt(item.unitPriceVnd || (itemQuantity ? BigInt(item.subtotalVnd || '0') / BigInt(itemQuantity) : 0n));
      subtotalVnd -= unitPriceVnd * BigInt(itemDecrease);
      remainingCommittedDecrease -= itemDecrease;
    }
    const committedDecrease = Math.min(line.committedQuantity, decreaseQuantity);
    const pendingDecrease = Math.min(line.pendingQuantity, decreaseQuantity - committedDecrease);
    if (pendingDecrease) {
      const pendingUnitPriceVnd = BigInt(line.product?.priceVnd || line.draftLines[0]?.product.priceVnd || '0');
      subtotalVnd -= pendingUnitPriceVnd * BigInt(pendingDecrease);
    }
    return {
      ...line,
      committedQuantity: line.committedQuantity - committedDecrease,
      pendingQuantity: line.pendingQuantity - pendingDecrease,
      quantity: line.quantity - decreaseQuantity,
      subtotalVnd: (subtotalVnd > 0n ? subtotalVnd : 0n).toString(),
    };
  });
  const sessionKey = props.session?.id
    ? `session:${props.session.id}`
    : `table:${props.table?.id || 'unselected'}`;
  const stableLines = stabilizeCanonicalTableBillLineOrder(
    lines,
    canonicalLineOrderBySession.get(sessionKey),
  );
  canonicalLineOrderBySession.set(sessionKey, stableLines.map((line) => line.mergeKey));
  return stableLines;
});
const totalDishQuantity = computed(() => canonicalLines.value.reduce((total, line) => total + line.quantity, 0));
const dishCountLabel = computed(() => t(totalDishQuantity.value === 1 ? 'table.dishCountOne' : 'table.dishCount', { count: totalDishQuantity.value }));
const draftTotal = computed(() => (props.draftLines || []).reduce(
  (total, line) => total + BigInt(line.product.priceVnd || '0') * BigInt(line.quantity),
  0n,
).toString());
const canOrderItems = computed(() => props.session
  ? props.session.status === 'OPEN' && props.table?.status !== 'DISABLED'
  : props.table?.status === 'ACTIVE');
const tableStatus = computed(() => props.table?.operationalStatus || 'IN_USE');
const tableStatusLabel = computed(() => {
  if (tableStatus.value === 'DISABLED') return t('table.status.disabled');
  if (tableStatus.value === 'AVAILABLE') return t('table.status.available');
  return t('table.status.inUse');
});

function rowActionsDisabled() {
  return props.itemActionsDisabled ?? props.actionsDisabled;
}

function lineMutationBusy(line: CanonicalTableBillLine) {
  return Boolean(props.pendingDecreaseMergeKeys?.has(line.mergeKey));
}

function adjustmentDisabled(itemId: string, line: CanonicalTableBillLine) {
  return Boolean(
    rowActionsDisabled()
    || lineMutationBusy(line)
    || props.adjustmentLoadingId
    || (props.pendingAdjustmentItemId && props.pendingAdjustmentItemId !== itemId),
  );
}

function increaseDisabled(line: CanonicalTableBillLine) {
  const productId = line.item?.productId || line.product?.id;
  return Boolean(
    !productId
    || rowActionsDisabled()
    || props.adjustmentLoadingId
    || (props.orderableProductIds && !props.orderableProductIds.has(productId)),
  );
}

function sourceLabel(order: TableSessionOrder) {
  return order.createdByStaffId ? t('table.orderSource.staffShort') : t('table.orderSource.qrShort');
}

function sourceDescription(order: TableSessionOrder) {
  return order.createdByStaffId ? t('table.orderSource.staff') : t('table.orderSource.qr');
}

function itemName(item: OrderItem) {
  return resolveLocalizedOrderItemName(item, locale.value, t('order.itemNameFallback'));
}

function productName(product: CashierMenuProduct) {
  if (locale.value === 'vi') return product.nameVi || product.nameZh;
  if (locale.value === 'en') return product.nameEn || product.nameZh;
  return product.nameZh;
}

function canAdjust(item: OrderItem, order: TableSessionOrder) {
  if (props.session?.status !== 'OPEN') return false;
  if (Number(item.quantity || 0) <= 0) return false;
  const context = { orderType: 'DINE_IN' as const, tableSessionId: props.session.id, status: order.status };
  return canDecreaseOrderItems(context) || canReturnOrderItems(context);
}

function adjustmentEntry(line: CanonicalTableBillLine) {
  return [...line.committedEntries].reverse().find(({ item, order }) => canAdjust(item, order))
    || [...line.committedEntries].reverse().find(({ item }) => Number(item.quantity || 0) > 0)
    || line.committedEntries.at(-1);
}

function canonicalName(line: CanonicalTableBillLine) {
  if (line.item) return itemName(line.item);
  return line.product ? productName(line.product) : t('order.itemNameFallback');
}

function adjustmentTitle(line: CanonicalTableBillLine) {
  if (lineMutationBusy(line)) return t('common.processing');
  if (line.quantity <= 0) return t('itemAdjustment.noReturnableQuantity');
  if (line.pendingQuantity > 0) return t('itemAdjustment.decrease');
  const target = adjustmentEntry(line);
  if (!target || line.committedQuantity <= 0) return t('itemAdjustment.noReturnableQuantity');
  return canAdjust(target.item, target.order)
    ? t('itemAdjustment.decrease')
    : t('itemAdjustment.unavailable');
}

function emitItemAdjustment(line: CanonicalTableBillLine) {
  const productId = line.item?.productId || line.product?.id;
  if (!productId || line.quantity <= 0) return;
  const target = adjustmentEntry(line);
  if (target && canAdjust(target.item, target.order) && props.session) {
    emit('decreaseItem', target.item, target.order, line.committedQuantity, line.mergeKey);
    return;
  }
  if (line.pendingQuantity > 0) emit('decreaseItem', productId, line.mergeKey);
}

function emitItemIncrease(line: CanonicalTableBillLine) {
  const productId = line.item?.productId || line.product?.id;
  if (!productId) return;
  if (line.item && line.order) {
    emit('increaseItem', line.item, line.order, line.mergeKey);
    return;
  }
  emit('increaseItem', productId, undefined, line.remark, line.mergeKey);
}

function sourceOrder(line: CanonicalTableBillLine) {
  return line.order || line.committedEntries.at(-1)?.order;
}

function sourceLabelForLine(line: CanonicalTableBillLine) {
  const order = sourceOrder(line);
  return order ? sourceLabel(order) : t('ordering.pendingLabel');
}

function sourceDescriptionForLine(line: CanonicalTableBillLine) {
  const order = sourceOrder(line);
  return order ? sourceDescription(order) : t('ordering.pendingLabel');
}

function lineCanAdjust(line: CanonicalTableBillLine) {
  if (line.quantity <= 0) return false;
  if (line.pendingQuantity > 0) return true;
  const target = adjustmentEntry(line);
  return Boolean(target && canAdjust(target.item, target.order));
}

function adjustmentItemId(line: CanonicalTableBillLine) {
  return adjustmentEntry(line)?.item.id || '';
}

function priceCanExpand(line: CanonicalTableBillLine) {
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
    <header class="table-detail-header table-bill-shell__header" data-testid="right-panel-header">
      <div v-if="session" class="table-detail-header__line">
        <h3>{{ session.tableNo || table?.tableNo || t('table.numberFallback') }}</h3>
        <span :class="`table-detail-state table-detail-state--${tableStatus.toLowerCase().replace(/_/g, '-')}`">
          {{ tableStatusLabel }}
        </span>
        <span class="table-detail-header__meta">{{ t('table.openedAtValue', { time: formatVietnamTime(session.openedAt, locale) }) }} | {{ dishCountLabel }}</span>
        <button
          type="button"
          class="table-transfer-entry"
          data-testid="table-transfer-entry"
          :aria-label="t('tableTransfer.open')"
          :title="t('tableTransfer.open')"
          :disabled="transferDisabled || actionsDisabled"
          @click="emit('transfer')"
        ><ArrowRightLeft :size="18" aria-hidden="true" /></button>
      </div>
      <div v-else-if="table" class="table-detail-header__line">
        <h3>{{ table.tableNo || t('table.numberFallback') }}</h3>
        <span class="table-detail-state table-detail-state--available">{{ t('table.status.available') }}</span>
      </div>
      <div v-else class="table-detail-header__line table-detail-header__line--passive">
        <h3>{{ t('table.detailEmptyTitle') }}</h3>
      </div>
    </header>

    <section class="detail-section table-bill-content table-bill-shell__body" data-testid="right-panel-body">
      <div v-if="canonicalLines.length" class="table-bill-scroll" data-testid="table-bill-scroll">
        <div class="table-item-summary-list" data-testid="table-item-summary">
          <article
            v-for="entry in canonicalLines"
            :key="entry.mergeKey"
            class="table-item-summary-row"
            :class="{
              'table-item-summary-row--pending': !entry.committedEntries.length,
              'table-item-summary-row--extended-price': priceCanExpand(entry),
              'table-item-summary-row--mutation-busy': lineMutationBusy(entry),
            }"
            :data-order-id="sourceOrder(entry)?.id"
            :data-item-id="entry.item?.id"
            :data-product-id="entry.item?.productId || entry.product?.id"
            :data-merge-key="entry.mergeKey"
            :data-raw-item-ids="entry.committedEntries.map(({ item }) => item.id).join(',')"
          >
            <span
              class="table-item-summary-row__source"
              :title="sourceDescriptionForLine(entry)"
              :aria-label="sourceDescriptionForLine(entry)"
            >{{ sourceLabelForLine(entry) }}</span>
            <div class="table-item-summary-row__name">
              <strong :title="canonicalName(entry)">{{ canonicalName(entry) }}</strong>
              <small v-if="entry.remark" data-testid="canonical-line-remark">{{ entry.remark }}</small>
              <small v-if="entry.pendingQuantity" data-testid="pending-line-note">
                {{ entry.committedQuantity ? t('ordering.pendingIncrement', { count: entry.pendingQuantity }) : t('ordering.pendingOnly') }}
              </small>
            </div>
            <div
              class="committed-item-stepper"
              :class="{ 'committed-item-stepper--wide-quantity': entry.quantity >= 100 }"
              :aria-label="t('ordering.quantityFor', { name: canonicalName(entry) })"
              :aria-busy="lineMutationBusy(entry)"
            >
              <button
                type="button"
                :data-testid="entry.committedEntries.length ? 'decrease-order-item' : 'decrease-draft-item'"
                :aria-label="`${t('itemAdjustment.decrease')} ${canonicalName(entry)}`"
                :disabled="adjustmentDisabled(adjustmentItemId(entry), entry) || !lineCanAdjust(entry)"
                :title="adjustmentTitle(entry)"
                @click="emitItemAdjustment(entry)"
              ><LoaderCircle v-if="lineMutationBusy(entry)" :size="16" class="row-mutation-spinner" aria-hidden="true" /><Minus v-else :size="16" aria-hidden="true" /></button>
              <output>{{ entry.quantity }}</output>
              <button
                type="button"
                :data-testid="entry.committedEntries.length ? 'increase-committed-item' : 'increase-draft-item'"
                :aria-label="`${t('ordering.increaseQuantity')} ${canonicalName(entry)}`"
                :disabled="increaseDisabled(entry)"
                :title="increaseDisabled(entry) && (!(entry.item?.productId || entry.product?.id) || (orderableProductIds && !orderableProductIds.has(entry.item?.productId || entry.product?.id || ''))) ? t('ordering.historicalProductUnavailable') : t('ordering.addOneAsPending')"
                @click="emitItemIncrease(entry)"
              ><Plus :size="16" aria-hidden="true" /></button>
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
        <span><UtensilsCrossed :size="22" aria-hidden="true" /></span>
        <strong>{{ t('table.detailEmptyTitle') }}</strong>
        <p>{{ t('table.detailEmptyDescription') }}</p>
      </div>
    </section>

    <footer class="table-bill-shell__footer" data-testid="right-panel-footer">
      <div class="table-bill-total-row dinein-summary-row" :class="{ 'dinein-summary-row--placeholder': !session }">
        <button
          v-if="session && canOrderItems && !embedded"
          type="button"
          class="secondary-action dinein-action-button"
          data-testid="table-order-items"
          :disabled="actionsDisabled"
          @click="emit('orderItems')"
        ><UtensilsCrossed :size="18" aria-hidden="true" />{{ t('table.addItems') }}</button>
        <button v-else-if="!session" type="button" class="secondary-action dinein-action-button" disabled>
          <UtensilsCrossed :size="18" aria-hidden="true" />{{ t('table.addItems') }}
        </button>
        <dl class="dinein-settlement-summary">
          <template v-if="session">
            <div><dt>{{ t('discount.cashierOriginal') }}</dt><dd>{{ formatVnd(session.originalAmountVnd || session.totalAmountVnd, locale) }}</dd></div>
            <div v-if="BigInt(discountAmount) > 0n"><dt>{{ t('discount.cashierAmount') }}</dt><dd class="is-deduction">-{{ formatVnd(discountAmount, locale) }}</dd></div>
            <div v-if="BigInt(roundingAmount) > 0n"><dt>{{ t('discount.cashierRounding') }}</dt><dd class="is-deduction">-{{ formatVnd(roundingAmount, locale) }}</dd></div>
            <div v-if="BigInt(draftTotal) > 0n" class="is-pending"><dt>{{ t('ordering.pendingAmount') }}</dt><dd>+{{ formatVnd(draftTotal, locale) }}</dd></div>
            <div class="is-payable"><dt>{{ t('discount.cashierPayable') }}</dt><dd :title="formatVnd(receivedAmount, locale)">{{ formatVnd(receivedAmount, locale) }}</dd></div>
          </template>
          <template v-else>
            <div><dt>{{ t('discount.cashierOriginal') }}</dt><dd>–</dd></div>
            <div v-if="BigInt(draftTotal) > 0n" class="is-pending"><dt>{{ t('ordering.pendingAmount') }}</dt><dd>+{{ formatVnd(draftTotal, locale) }}</dd></div>
            <div class="is-payable"><dt>{{ t('discount.cashierPayable') }}</dt><dd>–</dd></div>
          </template>
        </dl>
      </div>

      <DineInActionDock
        v-if="session"
        :session-id="session.id"
        :checkout-disabled="checkoutDisabled"
        :checking-out="checkingOut"
        :actions-disabled="actionsDisabled"
        :adjustment-applied="adjustmentApplied"
        @adjustment="emit('adjustment')"
        @checkout="emit('checkout')"
      />
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
.dinein-settlement-summary .is-pending dd { color: var(--cashier-green); }
.table-item-summary-row--mutation-busy .committed-item-stepper { box-shadow: 0 0 0 2px color-mix(in srgb, var(--cashier-green) 18%, transparent); }
.row-mutation-spinner { animation: row-mutation-spin 0.7s linear infinite; }
@keyframes row-mutation-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .row-mutation-spinner { animation: none; } }
</style>
