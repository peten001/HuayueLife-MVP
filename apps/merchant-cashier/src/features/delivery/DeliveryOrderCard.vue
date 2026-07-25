<script setup lang="ts">
import { Home, Phone, UserRound } from '@lucide/vue';
import { useI18n } from '@/i18n';
import { maskedPhone } from '@/domain';
import type { MerchantOrder } from '@/types';
import OrderStatusBadge from '@/components/common/OrderStatusBadge.vue';
import OrderUnreadBadge from '@/features/fulfillment/OrderUnreadBadge.vue';
import OrderCardMeta from '@/features/fulfillment/OrderCardMeta.vue';

defineProps<{ order: MerchantOrder; selected?: boolean }>();
defineEmits<{ select: [id: string] }>();
const { t } = useI18n();
</script>

<template>
  <button type="button" class="fulfillment-order-card delivery-order-card" :class="{ 'is-selected': selected }" :data-testid="`delivery-order-${order.id}`" @click="$emit('select', order.id)">
    <div class="fulfillment-order-card__heading">
      <strong>#{{ order.orderNo }}</strong>
      <div class="fulfillment-order-card__badges">
        <OrderStatusBadge :status="order.status" />
        <OrderUnreadBadge :count="order.chatConversation?.merchantUnreadCount" />
      </div>
    </div>
    <div class="delivery-order-card__location">
      <p class="delivery-order-card__address"><Home :size="16" aria-hidden="true" />{{ order.deliveryAddress || t('order.deliveryAddressMissing') }}</p>
      <p v-if="order.customerRemark" class="delivery-order-card__note">{{ t('fulfillment.deliveryNoteValue', { note: order.customerRemark }) }}</p>
    </div>
    <div class="fulfillment-order-card__identity">
      <span><UserRound :size="15" aria-hidden="true" />{{ order.contactName || t('order.customerFallback') }}</span>
      <span><Phone :size="15" aria-hidden="true" />{{ maskedPhone(order.contactPhone) || t('order.contactMissing') }}</span>
    </div>
    <OrderCardMeta :order="order" show-wait />
  </button>
</template>
