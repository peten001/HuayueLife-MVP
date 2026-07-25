<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import { formatVietnamDateTime, packingFeeVnd } from '@/domain';
import type { MerchantOrder } from '@/types';
import OrderStatusBadge from '@/components/common/OrderStatusBadge.vue';
import BillSummary from '@/components/bills/BillSummary.vue';
import OrderItemsSection from '@/features/fulfillment/OrderItemsSection.vue';
import WaitDuration from '@/features/fulfillment/WaitDuration.vue';
import FulfillmentProgressRail from '@/features/fulfillment/FulfillmentProgressRail.vue';
import DeliveryContactPanel from './DeliveryContactPanel.vue';

const props = defineProps<{ order: MerchantOrder }>();
const { t, locale } = useI18n();
const packingFee = computed(() => packingFeeVnd(props.order));
</script>

<template>
  <article class="fulfillment-detail delivery-order-detail">
    <header class="fulfillment-detail__header">
      <div><span>{{ t('order.type.delivery') }}</span><h2>#{{ order.orderNo }}</h2></div>
      <OrderStatusBadge :status="order.status" />
    </header>
    <DeliveryContactPanel :order="order" />
    <dl class="fulfillment-facts">
      <div><dt>{{ t('fulfillment.waiting') }}</dt><dd><WaitDuration :created-at="order.createdAt" /></dd></div>
      <div><dt>{{ t('order.createdAt') }}</dt><dd>{{ formatVietnamDateTime(order.createdAt, locale) }}</dd></div>
    </dl>
    <FulfillmentProgressRail :order="order" />
    <OrderItemsSection :order="order" />
    <BillSummary :item-amount="order.itemAmountVnd" :packing-fee="packingFee" :delivery-fee="order.deliveryFeeVnd" :total-amount="order.totalAmountVnd" show-packing-fee show-delivery-fee />
  </article>
</template>
