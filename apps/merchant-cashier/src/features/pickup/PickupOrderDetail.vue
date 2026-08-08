<script setup lang="ts">
import { MessageSquareText, Phone, UserRound } from '@lucide/vue';
import { computed } from 'vue';
import { estimatedReadyAt, formatVietnamDateTime, formatVietnamTime, formatVnd, packingFeeVnd, pickupCode } from '@/domain';
import { useI18n } from '@/i18n';
import type { MerchantOrder } from '@/types';
import OrderItemsSection from '@/features/fulfillment/OrderItemsSection.vue';
import WaitDuration from '@/features/fulfillment/WaitDuration.vue';
import FulfillmentProgressRail from '@/features/fulfillment/FulfillmentProgressRail.vue';

const props = defineProps<{ order: MerchantOrder }>();
const { t, locale } = useI18n();
const estimate = computed(() => estimatedReadyAt(props.order));
const packingFee = computed(() => packingFeeVnd(props.order));
const roundingAmount = computed(() => props.order.roundingAmountVnd || '0');
const discountAmount = computed(() => props.order.discountAmountVnd || '0');
const payableAmount = computed(() => props.order.payableAmountVnd || props.order.totalAmountVnd);
</script>

<template>
  <article class="fulfillment-detail pickup-order-detail">
    <header class="fulfillment-detail__header">
      <div>
        <h2>{{ t('fulfillment.pickupCode') }} <strong>{{ pickupCode(order) || t('common.notAvailable') }}</strong></h2>
      </div>
    </header>
    <dl class="fulfillment-facts">
      <div><dt>{{ t('fulfillment.estimatedReady') }}</dt><dd>{{ estimate ? formatVietnamTime(estimate, locale) : t('common.notAvailable') }}</dd></div>
      <div><dt>{{ t('fulfillment.waiting') }}</dt><dd><WaitDuration compact :created-at="order.createdAt" /></dd></div>
      <div><dt>{{ t('order.createdAt') }}</dt><dd>{{ formatVietnamDateTime(order.createdAt, locale) }}</dd></div>
    </dl>
    <FulfillmentProgressRail :order="order" show-current-status />
    <section class="workflow-section fulfillment-customer">
      <header><h3>{{ t('order.customerInfo') }}</h3></header>
      <p><UserRound :size="17" aria-hidden="true" />{{ order.contactName || t('order.customerFallback') }}</p>
      <p><Phone :size="17" aria-hidden="true" />{{ order.contactPhone || t('order.contactMissing') }}</p>
      <p v-if="order.customerRemark" class="fulfillment-customer__remark"><MessageSquareText :size="17" aria-hidden="true" /><span><small>{{ t('order.customerRemark') }}</small>{{ order.customerRemark }}</span></p>
    </section>
    <OrderItemsSection :order="order" />
    <dl class="pickup-settlement-summary">
      <div>
        <dt>{{ t('bill.itemsSubtotal') }}</dt>
        <dd>{{ formatVnd(order.itemAmountVnd, locale) }}</dd>
      </div>
      <div v-if="Number(packingFee) > 0">
        <dt>{{ t('bill.packingFee') }}</dt>
        <dd>{{ formatVnd(packingFee, locale) }}</dd>
      </div>
      <div v-if="BigInt(discountAmount) > 0n">
        <dt>{{ t('discount.amount') }}</dt>
        <dd class="pickup-settlement-summary__rounding">-{{ formatVnd(discountAmount, locale) }}</dd>
      </div>
      <div v-if="BigInt(roundingAmount) > 0n">
        <dt>{{ t('table.roundingAmount') }}</dt>
        <dd class="pickup-settlement-summary__rounding">-{{ formatVnd(roundingAmount, locale) }}</dd>
      </div>
      <div class="pickup-settlement-summary__payable">
        <dt>{{ t('discount.finalPayable') }}</dt>
        <dd>{{ formatVnd(payableAmount, locale) }}</dd>
      </div>
    </dl>
  </article>
</template>
