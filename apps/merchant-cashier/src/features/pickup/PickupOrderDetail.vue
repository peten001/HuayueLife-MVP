<script setup lang="ts">
import { MessageSquareText, Phone, UserRound } from '@lucide/vue';
import { computed } from 'vue';
import { estimatedReadyAt, formatVietnamDateTime, formatVietnamTime, packingFeeVnd, pickupCode } from '@/domain';
import { useI18n } from '@/i18n';
import type { MerchantOrder } from '@/types';
import OrderStatusBadge from '@/components/common/OrderStatusBadge.vue';
import BillSummary from '@/components/bills/BillSummary.vue';
import OrderItemsSection from '@/features/fulfillment/OrderItemsSection.vue';
import WaitDuration from '@/features/fulfillment/WaitDuration.vue';
import FulfillmentProgressRail from '@/features/fulfillment/FulfillmentProgressRail.vue';

const props = defineProps<{ order: MerchantOrder }>();
const { t, locale } = useI18n();
const estimate = computed(() => estimatedReadyAt(props.order));
const packingFee = computed(() => packingFeeVnd(props.order));
</script>

<template>
  <article class="fulfillment-detail pickup-order-detail">
    <header class="fulfillment-detail__header">
      <div>
        <span>{{ t('order.type.pickup') }} · #{{ order.orderNo }}</span>
        <h2>{{ t('fulfillment.pickupCode') }} <strong>{{ pickupCode(order) || t('common.notAvailable') }}</strong></h2>
      </div>
      <OrderStatusBadge :status="order.status" />
    </header>
    <dl class="fulfillment-facts">
      <div><dt>{{ t('fulfillment.estimatedReady') }}</dt><dd>{{ estimate ? formatVietnamTime(estimate, locale) : t('common.notAvailable') }}</dd></div>
      <div><dt>{{ t('fulfillment.waiting') }}</dt><dd><WaitDuration :created-at="order.createdAt" /></dd></div>
      <div><dt>{{ t('order.createdAt') }}</dt><dd>{{ formatVietnamDateTime(order.createdAt, locale) }}</dd></div>
    </dl>
    <FulfillmentProgressRail :order="order" />
    <section class="workflow-section fulfillment-customer">
      <header><h3>{{ t('order.customerInfo') }}</h3></header>
      <p><UserRound :size="17" aria-hidden="true" />{{ order.contactName || t('order.customerFallback') }}</p>
      <p><Phone :size="17" aria-hidden="true" />{{ order.contactPhone || t('order.contactMissing') }}</p>
      <p v-if="order.customerRemark" class="fulfillment-customer__remark"><MessageSquareText :size="17" aria-hidden="true" /><span><small>{{ t('order.customerRemark') }}</small>{{ order.customerRemark }}</span></p>
    </section>
    <OrderItemsSection :order="order" />
    <BillSummary :item-amount="order.itemAmountVnd" :packing-fee="packingFee" :total-amount="order.totalAmountVnd" show-packing-fee />
  </article>
</template>
