<script setup lang="ts">
import { ImageIcon, MapPin, Minus, Phone, ReceiptText, RotateCcw, UserRound } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import EmptyState from '@/components/common/EmptyState.vue';
import OrderStatusBadge from '@/components/common/OrderStatusBadge.vue';
import BillSummary from '@/components/bills/BillSummary.vue';
import PrintJobActions from '@/components/printing/PrintJobActions.vue';
import OrderActionBar from './OrderActionBar.vue';
import { formatVietnamDateTime, formatVnd, resolveMediaUrl } from '@/domain';
import {
  tableLabel,
  type CashierOrderAction,
  type CashierOrderItemView,
  type CashierOrderView,
} from '@/components/common/view-models';

const props = defineProps<{
  order?: CashierOrderView | null;
  actionLoading?: boolean;
  actionsDisabled?: boolean;
  adjustmentLoadingId?: string;
  pendingAdjustmentItemId?: string;
}>();

defineEmits<{
  action: [action: CashierOrderAction];
  decreaseItem: [item: CashierOrderItemView];
  returnItem: [item: CashierOrderItemView];
}>();

const { t, locale } = useI18n();
const canDecreaseItems = computed(() =>
  props.order?.orderType === 'DINE_IN'
  && Boolean(props.order.tableSessionId)
  && props.order.status === 'PENDING_ACCEPTANCE',
);
const canReturnItems = computed(() =>
  props.order?.orderType === 'DINE_IN'
  && Boolean(props.order.tableSessionId)
  && ['ACCEPTED', 'PREPARING', 'READY'].includes(props.order.status || ''),
);

const serviceLabel = computed(() => {
  if (props.order?.orderType === 'DINE_IN') {
    return t('order.tableValue', {
      table: tableLabel(props.order) || t('common.notAvailable'),
    });
  }
  if (props.order?.orderType === 'PICKUP') return t('order.type.pickup');
  if (props.order?.orderType === 'DELIVERY') return t('order.type.delivery');
  return t('order.type.unknown');
});

function itemName(item: NonNullable<CashierOrderView['items']>[number]) {
  if (locale.value === 'vi') {
    return item.productNameViSnapshot || item.productNameZhSnapshot || t('order.itemNameFallback');
  }
  if (locale.value === 'en') {
    return item.productNameEnSnapshot || item.productNameZhSnapshot || t('order.itemNameFallback');
  }
  return item.productNameZhSnapshot || t('order.itemNameFallback');
}

function hideBrokenImage(event: Event) {
  (event.currentTarget as HTMLImageElement).hidden = true;
}

function adjustmentDisabled(itemId: string) {
  return Boolean(
    props.actionsDisabled
    || props.adjustmentLoadingId
    || (props.pendingAdjustmentItemId && props.pendingAdjustmentItemId !== itemId),
  );
}

function adjustmentLabel(itemId: string, fallback: 'itemAdjustment.decrease' | 'itemAdjustment.return') {
  return props.pendingAdjustmentItemId === itemId && !props.adjustmentLoadingId
    ? t('mutation.retrySameRequest')
    : t(fallback);
}
</script>

<template>
  <div v-if="order" class="detail-panel-content order-detail-panel">
    <header class="detail-panel-header">
      <span class="detail-panel-header__icon" aria-hidden="true">
        <ReceiptText :size="24" />
      </span>
      <div>
        <span>{{ t('order.detailTitle') }}</span>
        <h3>{{ order.orderNo || t('order.numberFallback') }}</h3>
      </div>
      <OrderStatusBadge :status="order.status" />
    </header>

    <dl class="detail-facts">
      <div>
        <dt>{{ t('order.serviceType') }}</dt>
        <dd>{{ serviceLabel }}</dd>
      </div>
      <div>
        <dt>{{ t('order.createdAt') }}</dt>
        <dd>{{ formatVietnamDateTime(order.createdAt, locale) }}</dd>
      </div>
    </dl>

    <section class="detail-section detail-section--scrollable order-detail-scroll" data-testid="order-item-scroll">
      <div class="detail-section__heading">
        <h4>{{ t('order.itemsTitle') }}</h4>
        <span>{{ t('order.itemKinds', { count: order.items?.length || 0 }) }}</span>
      </div>
      <div class="order-item-list">
        <article v-for="item in order.items || []" :key="item.id" class="order-item-row">
          <span class="order-item-row__image" aria-hidden="true">
            <img
              v-if="resolveMediaUrl(item.imageUrlSnapshot)"
              :src="resolveMediaUrl(item.imageUrlSnapshot)"
              alt=""
              loading="lazy"
              @error="hideBrokenImage"
            />
            <ImageIcon :size="16" />
          </span>
          <div>
            <strong>{{ itemName(item) }}</strong>
            <small v-if="item.remark">{{ t('order.itemRemark', { remark: item.remark }) }}</small>
            <small>{{ t('order.quantity', { count: item.quantity || 0 }) }}</small>
          </div>
          <div class="order-item-row__aside">
            <b>{{ formatVnd(item.subtotalVnd, locale) }}</b>
            <button
              v-if="pendingAdjustmentItemId === item.id || canDecreaseItems"
              type="button"
              class="order-item-adjustment order-item-adjustment--decrease"
              data-testid="decrease-order-item"
              :disabled="adjustmentDisabled(item.id)"
              @click="$emit('decreaseItem', item)"
            >
              <Minus :size="15" aria-hidden="true" />{{ adjustmentLabel(item.id, 'itemAdjustment.decrease') }}
            </button>
            <button
              v-else-if="canReturnItems"
              type="button"
              class="order-item-adjustment order-item-adjustment--return"
              data-testid="return-order-item"
              :disabled="adjustmentDisabled(item.id)"
              @click="$emit('returnItem', item)"
            >
              <RotateCcw :size="14" aria-hidden="true" />{{ adjustmentLabel(item.id, 'itemAdjustment.return') }}
            </button>
          </div>
        </article>
      </div>

      <section v-if="order.contactName || order.contactPhone || order.deliveryAddress" class="order-detail-contact">
        <strong>{{ t('order.customerInfo') }}</strong>
        <ul class="contact-list">
          <li v-if="order.contactName">
            <UserRound :size="16" aria-hidden="true" />
            <span>{{ order.contactName }}</span>
          </li>
          <li v-if="order.contactPhone">
            <Phone :size="16" aria-hidden="true" />
            <span>{{ order.contactPhone }}</span>
          </li>
          <li v-if="order.deliveryAddress">
            <MapPin :size="16" aria-hidden="true" />
            <span>{{ order.deliveryAddress }}</span>
          </li>
        </ul>
      </section>

      <section v-if="order.customerRemark" class="detail-remark">
        <strong>{{ t('order.customerRemark') }}</strong>
        <p>{{ order.customerRemark }}</p>
      </section>
    </section>

    <BillSummary
      :item-amount="order.itemAmountVnd"
      :delivery-fee="order.deliveryFeeVnd"
      :total-amount="order.totalAmountVnd"
    />

    <div class="detail-action-stack">
      <OrderActionBar
        :order="order"
        :loading="actionLoading"
        :disabled="actionsDisabled || Boolean(adjustmentLoadingId) || Boolean(pendingAdjustmentItemId)"
        @action="$emit('action', $event)"
      >
        <template #print>
          <PrintJobActions compact :order-id="order.id" :disabled="actionsDisabled" />
        </template>
      </OrderActionBar>
    </div>
  </div>

  <EmptyState
    v-else
    :title="t('order.detailEmptyTitle')"
    :description="t('order.detailEmptyDescription')"
  />
</template>
