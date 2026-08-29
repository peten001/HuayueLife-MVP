<script setup lang="ts">
import { ArrowLeft, CalendarDays, ChevronDown, ClipboardList, RefreshCw } from '@lucide/vue';
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { formatVietnamDateFilter, formatVietnamDateFilterAria, formatVietnamDateTime, formatVnd } from '@/domain';
import { getBusinessDaySummary, messageFromApiError, printBusinessDaySummary } from '@/api';
import { useI18n } from '@/i18n';
import { useOrdersStore, useUiStore } from '@/stores';
import type { BusinessDaySummary, MerchantSettlement, OrderType, PaymentMethod } from '@/types';
import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import LoadingState from '@/components/common/LoadingState.vue';
import OrderStatusBadge from '@/components/common/OrderStatusBadge.vue';
import PrintJobActions from '@/components/printing/PrintJobActions.vue';
import BusinessDaySummaryDialog from '@/components/reports/BusinessDaySummaryDialog.vue';

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const ordersStore = useOrdersStore();
const uiStore = useUiStore();
const {
  historySettlements,
  selectedSettlement,
  settlementLoading,
  settlementDetailLoading,
  settlementErrorKey,
} = storeToRefs(ordersStore);
const status = ref<'ALL' | 'COMPLETED' | 'CANCELLED'>('ALL');
const orderType = ref<'' | OrderType>('');
const date = ref('');
const dateInput = ref<HTMLInputElement | null>(null);
const initialized = ref(false);
const summaryOpen = ref(false);
const summaryLoading = ref(false);
const summaryPrinting = ref(false);
const summaryError = ref('');
const summaryStatus = ref('');
const summaryDate = ref('');
const businessSummary = ref<BusinessDaySummary | null>(null);
const sourceOrdersOpen = ref(false);
let routeSequence = 0;

const dateFilterLabel = computed(() => formatVietnamDateFilter(date.value, locale.value));
const dateFilterAriaLabel = computed(() => `${t('orders.filterDate')} ${formatVietnamDateFilterAria(date.value, locale.value)}`);

function openDatePicker(event: MouseEvent) {
  const input = dateInput.value;
  if (!input || typeof input.showPicker !== 'function') return;
  event.preventDefault();
  try {
    input.focus({ preventScroll: true });
    input.showPicker();
  } catch {
    // WebView 83 has no showPicker(); native click fallback remains available.
  }
}

const filtered = computed(() => historySettlements.value.filter((item) => {
  if (status.value !== 'ALL' && item.status !== status.value) return false;
  if (orderType.value && item.orderType !== orderType.value) return false;
  return true;
}));
const settlement = computed(() =>
  selectedSettlement.value &&
  ['COMPLETED', 'CANCELLED'].includes(selectedSettlement.value.status)
    ? selectedSettlement.value
    : null,
);
const settlementPrintTarget = computed(() => {
  if (settlement.value?.tableSessionId) {
    return { tableSessionId: settlement.value.tableSessionId };
  }
  if (settlement.value?.orderIds.length === 1) {
    return { orderId: settlement.value.orderIds[0] };
  }
  return null;
});

function orderTypeKey(orderTypeValue: OrderType) {
  return orderTypeValue === 'DINE_IN' ? 'dineIn' : orderTypeValue.toLowerCase();
}

function settlementPrimaryLabel(item: MerchantSettlement) {
  if (item.orderType === 'DINE_IN') return item.tableName || item.orderNos[0] || t('order.type.dineIn');
  return `#${item.orderNos[0] ?? ''}`;
}

function settlementContext(item: MerchantSettlement) {
  if (item.orderType === 'DINE_IN') return item.tableName || t('order.type.dineIn');
  if (item.orderType === 'PICKUP') return t('order.type.pickup');
  return t('order.type.delivery');
}

function paymentLabel(method: PaymentMethod | null) {
  if (method === 'CASH') return t('payment.cash');
  if (method === 'BANK_TRANSFER') return t('payment.bankTransfer');
  return t('settlement.unrecorded');
}

function mergedSettlementItems(item: MerchantSettlement) {
  const merged: Array<{
    key: string;
    productNameZh: string;
    productNameVi: string | null;
    unitPriceVnd: string;
    quantity: number;
    subtotalVnd: string;
    remark: string | null;
  }> = [];
  for (const row of item.items) {
    const key = [
      row.productId ?? 'name',
      row.productNameZh,
      row.unitPriceVnd,
      row.remark ?? '',
    ].join('\u0000');
    const current = merged.find((entry) => entry.key === key);
    if (current) {
      current.quantity += row.quantity;
      current.subtotalVnd = String(
        BigInt(current.subtotalVnd) + BigInt(row.subtotalVnd),
      );
    } else {
      merged.push({
        key,
        productNameZh: row.productNameZh,
        productNameVi: row.productNameVi,
        unitPriceVnd: row.unitPriceVnd,
        quantity: row.quantity,
        subtotalVnd: row.subtotalVnd,
        remark: row.remark,
      });
    }
  }
  return merged;
}

function dishName(row: { productNameZh: string; productNameVi: string | null }) {
  if (locale.value === 'vi' && row.productNameVi) return row.productNameVi;
  return row.productNameZh;
}

async function refresh(showToast = true) {
  if (!date.value) return;
  try {
    await ordersStore.fetchSettlements({
      date: date.value,
      status: status.value === 'ALL' ? undefined : status.value,
      orderType: orderType.value || undefined,
    });
  } catch {
    if (showToast && historySettlements.value.length) uiStore.pushToast(t('error.refreshFailed'), 'error');
  }
}

async function loadBusinessSummary(businessDate?: string) {
  if (businessDate) summaryDate.value = businessDate;
  summaryLoading.value = true;
  summaryError.value = '';
  summaryStatus.value = '';
  try {
    businessSummary.value = await getBusinessDaySummary(businessDate);
    summaryDate.value = businessSummary.value.businessDate;
    return businessSummary.value;
  } catch (caught) {
    summaryError.value = messageFromApiError(caught);
    return null;
  } finally {
    summaryLoading.value = false;
  }
}

async function openBusinessSummary() {
  summaryOpen.value = true;
  summaryDate.value = date.value;
  await loadBusinessSummary(date.value || undefined);
}

async function changeSummaryDate(businessDate: string) {
  summaryDate.value = businessDate;
  if (businessDate) await loadBusinessSummary(businessDate);
}

async function printSummary() {
  if (!businessSummary.value || summaryPrinting.value) return;
  summaryPrinting.value = true;
  summaryError.value = '';
  try {
    const randomPart = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await printBusinessDaySummary(
      businessSummary.value.businessDate,
      `cashier.business-summary.${randomPart}`,
    );
    summaryStatus.value = t('summary.printSuccess');
  } catch (caught) {
    summaryError.value = messageFromApiError(caught);
  } finally {
    summaryPrinting.value = false;
  }
}

async function selectSettlement(id: string) {
  await router.push({ name: 'order-history', params: { orderId: id } });
}

watch([date, status, orderType], () => { if (initialized.value) void refresh(false); });
watch(
  () => route.params.orderId,
  async (value) => {
    const sequence = ++routeSequence;
    const id = typeof value === 'string' ? value : '';
    if (!id) {
      await ordersStore.selectSettlement(null);
      return;
    }
    try {
      const loaded = await ordersStore.selectSettlement(id);
      if (sequence !== routeSequence || !loaded) return;
    } catch {
      if (sequence === routeSequence) uiStore.pushToast(t('error.operationFailed'), 'error');
    }
  },
  { immediate: true },
);
onMounted(async () => {
  const initialSummary = await loadBusinessSummary();
  date.value = initialSummary?.businessDate ?? new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  await refresh(false);
  initialized.value = true;
});
</script>

<template>
  <section class="history-page" :class="{ 'has-selection': Boolean(settlement) }">
    <div class="history-workspace">
      <aside class="history-queue">
        <div class="history-toolbar">
          <div class="history-mobile-filter-row--date">
            <label class="history-date-control" @click="openDatePicker">
              <CalendarDays :size="16" aria-hidden="true" />
              <span>{{ dateFilterLabel }}</span>
              <input ref="dateInput" v-model="date" type="date" :aria-label="dateFilterAriaLabel" />
            </label>
            <button type="button" class="workflow-refresh-button" :disabled="settlementLoading" :aria-label="t('common.refresh')" :title="t('common.refresh')" @click="refresh()"><RefreshCw :size="17" :class="{ spinning: settlementLoading }" aria-hidden="true" /></button>
            <button type="button" class="summary-open-button" @click="openBusinessSummary"><ClipboardList :size="17" aria-hidden="true" />{{ t('summary.open') }}</button>
          </div>
          <div class="history-mobile-filter-row--selects">
            <label><select v-model="orderType" :aria-label="t('orders.filterType')"><option value="">{{ t('filter.orderTypeAll') }}</option><option value="DINE_IN">{{ t('order.type.dineIn') }}</option><option value="PICKUP">{{ t('order.type.pickup') }}</option><option value="DELIVERY">{{ t('order.type.delivery') }}</option></select></label>
            <label><select v-model="status" :aria-label="t('orders.filterStatus')" :title="t('filter.orderStatusAll')"><option value="ALL">{{ t('filter.orderStatusAll') }}</option><option value="COMPLETED">{{ t('order.status.completed') }}</option><option value="CANCELLED">{{ t('order.status.cancelled') }}</option></select></label>
          </div>
        </div>
        <LoadingState v-if="settlementLoading && !historySettlements.length" :label="t('orders.loading')" />
        <ErrorState v-else-if="settlementErrorKey && !historySettlements.length" :title="t('error.title')" :description="t(settlementErrorKey)" :retry-label="t('common.retry')" @retry="refresh(false)" />
        <div v-else-if="filtered.length" class="history-queue__list">
          <button
            v-for="item in filtered"
            :key="item.settlementId"
            type="button"
            class="history-order-card settlement-card"
            :class="{ 'is-selected': item.settlementId === settlement?.settlementId }"
            @click="selectSettlement(item.settlementId)"
          >
            <div class="history-order-card__top">
              <strong>{{ settlementPrimaryLabel(item) }}</strong>
              <OrderStatusBadge :status="item.status" />
              <b>{{ formatVnd(item.finalReceivableVnd, locale) }}</b>
            </div>
            <div class="history-order-card__context">
              <span>{{ t(`order.type.${orderTypeKey(item.orderType)}`) }}</span>
              <span>{{ settlementContext(item) }}</span>
            </div>
            <div class="history-order-card__footer">
              <span class="settlement-card__meta">
                <span>{{ t('settlement.countOrders', { count: item.orderCount }) }} · {{ t('table.itemCount', { count: item.itemQuantity }) }}</span>
                <span class="settlement-card__payment">{{ paymentLabel(item.paymentMethod) }}</span>
              </span>
              <small>{{ formatVietnamDateTime(item.settledAt, locale) }}</small>
            </div>
          </button>
        </div>
        <EmptyState v-else :title="t('orders.historyEmptyTitle')" :description="t('orders.historyEmptyDescription')" />
      </aside>
      <main class="history-detail">
        <button type="button" class="mobile-workspace-back" @click="router.push('/orders/history')"><ArrowLeft :size="18" aria-hidden="true" />{{ t('fulfillment.backToList') }}</button>
        <LoadingState v-if="settlementDetailLoading" :label="t('orders.loading')" />
        <article v-else-if="settlement" class="history-detail__content">
          <header class="history-detail__identity">
            <strong>{{ settlementPrimaryLabel(settlement) }}</strong>
            <span>{{ t(`order.type.${orderTypeKey(settlement.orderType)}`) }}</span>
            <OrderStatusBadge :status="settlement.status" />
          </header>
          <dl class="history-detail__facts">
            <div><dt>{{ t('order.createdAt') }}</dt><dd>{{ formatVietnamDateTime(settlement.settledAt, locale) }}</dd></div>
            <div><dt>{{ t('summary.businessDate') }}</dt><dd>{{ settlement.businessDate }}</dd></div>
            <div><dt>{{ t('settlement.paymentLabel') }}</dt><dd>{{ paymentLabel(settlement.paymentMethod) }}</dd></div>
          </dl>

          <section class="workflow-section settlement-items-section">
            <h3>{{ t('order.itemsTitle') }}</h3>
            <ul class="settlement-item-list">
              <li v-for="row in mergedSettlementItems(settlement)" :key="row.key" class="settlement-item-row">
                <div class="settlement-item-row__name">
                  <span>{{ dishName(row) }}</span>
                  <small v-if="row.remark">{{ row.remark }}</small>
                </div>
                <span class="settlement-item-row__qty">× {{ row.quantity }}</span>
                <span class="settlement-item-row__amount">{{ formatVnd(row.subtotalVnd, locale) }}</span>
              </li>
            </ul>
          </section>

          <section class="workflow-section settlement-financials" data-testid="settlement-financials">
            <h3>{{ t('settlement.sessionCheckout') }}</h3>
            <dl class="settlement-financial-list">
              <div><dt>{{ t('settlement.originalAmount') }}</dt><dd>{{ formatVnd(settlement.originalAmountVnd, locale) }}</dd></div>
              <div v-if="BigInt(settlement.discountAmountVnd || '0') > 0n"><dt>{{ t('settlement.tableDiscount') }}</dt><dd>-{{ formatVnd(settlement.discountAmountVnd || '0', locale) }}</dd></div>
              <div v-if="BigInt(settlement.roundingAmountVnd || '0') > 0n"><dt>{{ t('settlement.tableRounding') }}</dt><dd>-{{ formatVnd(settlement.roundingAmountVnd || '0', locale) }}</dd></div>
              <div class="settlement-financial-total"><dt>{{ t('settlement.finalReceivable') }}</dt><dd>{{ formatVnd(settlement.finalReceivableVnd, locale) }}</dd></div>
              <div><dt>{{ t('settlement.paymentLabel') }}</dt><dd>{{ paymentLabel(settlement.paymentMethod) }}</dd></div>
            </dl>
            <PrintJobActions
              v-if="settlementPrintTarget"
              compact
              compact-mode="inline"
              :table-session-id="settlementPrintTarget.tableSessionId"
              :order-id="settlementPrintTarget.orderId"
            />
          </section>

          <section v-if="settlement.sourceOrders.length > 1 || settlement.kind === 'TABLE_SESSION'" class="workflow-section settlement-source-section">
            <button type="button" class="settlement-source-toggle" :aria-expanded="sourceOrdersOpen" @click="sourceOrdersOpen = !sourceOrdersOpen">
              <span>{{ t('settlement.containsOrders', { count: settlement.sourceOrders.length }) }}</span>
              <ChevronDown :size="16" :class="{ 'is-open': sourceOrdersOpen }" aria-hidden="true" />
            </button>
            <div v-if="sourceOrdersOpen" class="settlement-source-list">
              <div v-for="source in settlement.sourceOrders" :key="source.id" class="settlement-source-row">
                <span class="settlement-source-row__no">#{{ source.orderNo }}</span>
                <OrderStatusBadge :status="source.status" />
                <span class="settlement-source-row__amount">{{ formatVnd(source.totalAmountVnd, locale) }}</span>
                <small>{{ formatVietnamDateTime(source.completedAt || source.cancelledAt || source.createdAt, locale) }}</small>
              </div>
            </div>
          </section>
        </article>
        <EmptyState v-else :title="t('order.detailEmptyTitle')" :description="t('order.detailEmptyDescription')" />
      </main>
    </div>
    <BusinessDaySummaryDialog
      :open="summaryOpen"
      :business-date="summaryDate"
      :summary="businessSummary"
      :loading="summaryLoading"
      :printing="summaryPrinting"
      :error="summaryError"
      :status="summaryStatus"
      @cancel="summaryOpen = false"
      @date-change="changeSummaryDate"
      @print="printSummary"
    />
  </section>
</template>

<style scoped>
.summary-open-button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;gap:7px;border:1px solid var(--cashier-border);border-radius:11px;padding:0 13px;background:var(--cashier-surface);color:var(--cashier-action-primary);font:inherit;font-size:13px;font-weight:800;white-space:nowrap;cursor:pointer}
.summary-open-button:focus-visible{outline:3px solid var(--cashier-green-alpha-35);outline-offset:2px}
@media(max-width:700px){.summary-open-button{width:100%}}

.settlement-card__meta{display:inline-flex;min-width:0;align-items:center;gap:8px}
.settlement-card__payment{color:var(--cashier-action-primary, #2e7d32);font-weight:700}

.settlement-item-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.settlement-item-row{display:flex;align-items:baseline;gap:10px;padding:7px 0;border-bottom:1px dashed var(--cashier-border, #e0e8e3)}
.settlement-item-row:last-child{border-bottom:0}
.settlement-item-row__name{display:flex;min-width:0;flex:1;flex-direction:column;gap:1px}
.settlement-item-row__name small{color:#839087;font-size:11px}
.settlement-item-row__qty{color:#506b5b;font-size:12px;font-weight:700;white-space:nowrap}
.settlement-item-row__amount{color:#25392d;font-variant-numeric:tabular-nums;white-space:nowrap}

.settlement-financial-list{display:flex;flex-direction:column;gap:6px;margin:0}
.settlement-financial-list>div{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.settlement-financial-list dt{color:#506b5b;font-size:12px}
.settlement-financial-list dd{margin:0;color:#25392d;font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}
.settlement-financial-total{border-top:1px solid var(--cashier-border, #e0e8e3);margin-top:4px;padding-top:8px}
.settlement-financial-total dt{color:#25392d;font-size:13px;font-weight:800}
.settlement-financial-total dd{color:var(--color-money-strong, #176b43);font-size:15px;font-weight:800}

.settlement-source-toggle{display:inline-flex;align-items:center;gap:6px;border:0;background:none;padding:0;color:#506b5b;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
.settlement-source-toggle svg{transition:transform .15s ease}
.settlement-source-toggle svg.is-open{transform:rotate(180deg)}
.settlement-source-list{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.settlement-source-row{display:flex;align-items:center;gap:10px;font-size:12px}
.settlement-source-row__no{min-width:0;overflow:hidden;color:#25392d;font-weight:700;text-overflow:ellipsis;white-space:nowrap}
.settlement-source-row__amount{margin-left:auto;color:#25392d;font-variant-numeric:tabular-nums;white-space:nowrap}
.settlement-source-row small{color:#839087;white-space:nowrap}
</style>
