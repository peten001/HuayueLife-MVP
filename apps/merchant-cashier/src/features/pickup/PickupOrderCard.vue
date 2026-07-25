<script setup lang="ts">
import { Clock3, Phone, UserRound } from '@lucide/vue';
import { computed } from 'vue';
import { estimatedReadyAt, formatVietnamTime, maskedPhone, pickupCode } from '@/domain';
import { useI18n } from '@/i18n';
import type { MerchantOrder } from '@/types';
import OrderStatusBadge from '@/components/common/OrderStatusBadge.vue';
import OrderUnreadBadge from '@/features/fulfillment/OrderUnreadBadge.vue';
import WaitDuration from '@/features/fulfillment/WaitDuration.vue';
import OrderCardMeta from '@/features/fulfillment/OrderCardMeta.vue';

const props = defineProps<{ order: MerchantOrder; selected?: boolean }>();
defineEmits<{ select: [id: string] }>();
const { t, locale } = useI18n();
const estimate = computed(() => estimatedReadyAt(props.order));
</script>

<template>
  <button type="button" class="fulfillment-order-card pickup-order-card" :class="{ 'is-selected': selected }" :data-testid="`pickup-order-${order.id}`" @click="$emit('select', order.id)">
    <div class="fulfillment-order-card__heading">
      <strong class="pickup-code">{{ pickupCode(order) || t('common.notAvailable') }}</strong>
      <div class="fulfillment-order-card__badges">
        <OrderStatusBadge :status="order.status" />
        <OrderUnreadBadge :count="order.chatConversation?.merchantUnreadCount" />
      </div>
    </div>
    <div class="fulfillment-order-card__identity">
      <span><UserRound :size="15" aria-hidden="true" />{{ order.contactName || t('order.customerFallback') }}</span>
      <span><Phone :size="15" aria-hidden="true" />{{ maskedPhone(order.contactPhone) || t('order.contactMissing') }}</span>
    </div>
    <div class="fulfillment-order-card__timing">
      <span><Clock3 :size="15" aria-hidden="true" />{{ t('fulfillment.estimatedAt', { time: estimate ? formatVietnamTime(estimate, locale) : t('common.notAvailable') }) }}</span>
      <WaitDuration :created-at="order.createdAt" />
    </div>
    <OrderCardMeta :order="order" />
  </button>
</template>
