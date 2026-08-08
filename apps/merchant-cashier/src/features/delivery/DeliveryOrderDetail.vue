<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import { formatVietnamDateTime, formatVnd, packingFeeVnd } from '@/domain';
import type { MerchantOrder } from '@/types';
import OrderItemsSection from '@/features/fulfillment/OrderItemsSection.vue';
import WaitDuration from '@/features/fulfillment/WaitDuration.vue';
import FulfillmentProgressRail from '@/features/fulfillment/FulfillmentProgressRail.vue';
import DeliveryContactPanel from './DeliveryContactPanel.vue';

const props = defineProps<{ order: MerchantOrder }>();
const { t, locale } = useI18n();
const packingFee = computed(() => packingFeeVnd(props.order));
const roundingAmount = computed(() => props.order.roundingAmountVnd || '0');
const discountAmount = computed(() => props.order.discountAmountVnd || '0');
const payableAmount = computed(() => props.order.payableAmountVnd || props.order.totalAmountVnd);
</script>

<template>
  <article class="fulfillment-detail delivery-order-detail">
    <header class="fulfillment-detail__header">
      <div><h2>#{{ order.orderNo }}</h2></div>
    </header>
    <DeliveryContactPanel :order="order" />
    <dl class="fulfillment-facts">
      <div><dt>{{ t('fulfillment.waiting') }}</dt><dd><WaitDuration :created-at="order.createdAt" /></dd></div>
      <div><dt>{{ t('order.createdAt') }}</dt><dd>{{ formatVietnamDateTime(order.createdAt, locale) }}</dd></div>
    </dl>
    <FulfillmentProgressRail :order="order" show-current-status />
    <OrderItemsSection :order="order" />
    <dl class="pickup-settlement-summary delivery-settlement-summary">
      <div><dt>{{ t('bill.itemsSubtotal') }}</dt><dd>{{ formatVnd(order.itemAmountVnd, locale) }}</dd></div>
      <div><dt>{{ t('bill.packingFee') }}</dt><dd>{{ formatVnd(packingFee, locale) }}</dd></div>
      <div><dt>{{ t('bill.deliveryFee') }}</dt><dd>{{ formatVnd(order.deliveryFeeVnd, locale) }}</dd></div>
      <div v-if="BigInt(discountAmount) > 0n"><dt>{{ t('discount.amount') }}</dt><dd class="pickup-settlement-summary__rounding">-{{ formatVnd(discountAmount, locale) }}</dd></div>
      <div v-if="BigInt(roundingAmount) > 0n"><dt>{{ t('table.roundingAmount') }}</dt><dd class="pickup-settlement-summary__rounding">-{{ formatVnd(roundingAmount, locale) }}</dd></div>
      <div class="pickup-settlement-summary__payable"><dt>{{ t('discount.finalPayable') }}</dt><dd>{{ formatVnd(payableAmount, locale) }}</dd></div>
    </dl>
  </article>
</template>
