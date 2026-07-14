<script setup lang="ts">
import { ChevronRight, Clock3, MapPin, ShoppingBag, Utensils } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import OrderStatusBadge from '@/components/common/OrderStatusBadge.vue';
import { formatVietnamDateTime, formatVnd } from '@/domain';
import {
  tableLabel,
  type CashierOrderView,
} from '@/components/common/view-models';

const props = defineProps<{
  order: CashierOrderView;
  selected?: boolean;
  emphasize?: boolean;
}>();

defineEmits<{
  select: [orderId: string];
}>();

const { t, locale } = useI18n();

const typeLabel = computed(() => {
  if (props.order.orderType === 'DINE_IN') return t('order.type.dineIn');
  if (props.order.orderType === 'PICKUP') return t('order.type.pickup');
  if (props.order.orderType === 'DELIVERY') return t('order.type.delivery');
  return t('order.type.unknown');
});

const serviceLabel = computed(() => {
  if (props.order.orderType === 'DINE_IN') {
    return t('order.tableValue', { table: tableLabel(props.order) || t('common.notAvailable') });
  }
  if (props.order.orderType === 'DELIVERY') {
    return props.order.deliveryAddress || t('order.deliveryAddressMissing');
  }
  return props.order.contactPhone || t('order.contactMissing');
});

const itemSummary = computed(() => {
  const items = props.order.items || [];
  if (!items.length) return t('order.itemsEmpty');
  return items
    .slice(0, 3)
    .map((item) =>
      t('order.itemSummary', {
        name: locale.value === 'vi'
          ? item.productNameViSnapshot || item.productNameZhSnapshot || t('order.itemNameFallback')
          : locale.value === 'en'
            ? item.productNameEnSnapshot || item.productNameZhSnapshot || t('order.itemNameFallback')
            : item.productNameZhSnapshot || t('order.itemNameFallback'),
        count: item.quantity || 0,
      }),
    )
    .join(t('common.listSeparator'));
});

const ServiceIcon = computed(() => {
  if (props.order.orderType === 'DINE_IN') return Utensils;
  if (props.order.orderType === 'DELIVERY') return MapPin;
  return ShoppingBag;
});
</script>

<template>
  <button
    type="button"
    class="order-card"
    :class="{
      'order-card--selected': selected,
      'order-card--emphasize': emphasize,
    }"
    @click="$emit('select', order.id)"
  >
    <span class="order-card__topline">
      <span>
        <strong>{{ order.orderNo || t('order.numberFallback') }}</strong>
        <small>
          <Clock3 :size="14" aria-hidden="true" />
          {{ formatVietnamDateTime(order.createdAt, locale) }}
        </small>
      </span>
      <OrderStatusBadge :status="order.status" />
    </span>

    <span class="order-card__service">
      <component :is="ServiceIcon" :size="16" aria-hidden="true" />
      <b>{{ typeLabel }}</b>
      <span>{{ serviceLabel }}</span>
    </span>

    <span class="order-card__items">{{ itemSummary }}</span>

    <span class="order-card__footer">
      <strong>{{ formatVnd(order.totalAmountVnd, locale) }}</strong>
      <span>
        {{ t('common.viewDetail') }}
        <ChevronRight :size="18" aria-hidden="true" />
      </span>
    </span>
  </button>
</template>
