<script setup lang="ts">
import { Clock3, Phone, UserRound } from '@lucide/vue';
import { computed } from 'vue';
import { formatReservationTime, reservationText } from '@huayue-life/shared';
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
  <button type="button" class="fulfillment-order-card pickup-order-card" :class="{ 'is-selected': selected, 'pickup-order-card--scheduled': order.isReservation }" :data-testid="`pickup-order-${order.id}`" @click="$emit('select', order.id)">
    <div class="fulfillment-order-card__heading">
      <strong class="pickup-code">{{ pickupCode(order) || t('common.notAvailable') }}</strong>
      <div class="fulfillment-order-card__badges">
        <OrderStatusBadge :status="order.status" :label="order.isReservation && order.status === 'ACCEPTED' ? t('fulfillment.pickupConfirmed') : undefined" />
        <OrderUnreadBadge :count="order.chatConversation?.merchantUnreadCount" />
      </div>
    </div>
    <div class="fulfillment-order-card__identity">
      <span><UserRound :size="15" aria-hidden="true" />{{ order.contactName || t('order.customerFallback') }}</span>
      <span><Phone :size="15" aria-hidden="true" />{{ maskedPhone(order.contactPhone) || t('order.contactMissing') }}</span>
    </div>
    <div class="fulfillment-order-card__timing">
      <span v-if="order.isReservation"><Clock3 :size="15" aria-hidden="true" />{{ reservationText('pickupTime', locale) }} · {{ formatReservationTime(order.scheduledFor, locale) }}</span>
      <span v-else><Clock3 :size="15" aria-hidden="true" />{{ t('fulfillment.estimatedAt', { time: estimate ? formatVietnamTime(estimate, locale) : t('common.notAvailable') }) }}</span>
      <span v-if="order.proposedScheduledFor">{{ t('fulfillment.pickupTimePending') }}</span>
      <WaitDuration v-else-if="!order.isReservation || ['PREPARING', 'READY'].includes(order.status)" :created-at="order.createdAt" />
    </div>
    <OrderCardMeta :order="order" />
  </button>
</template>

<style scoped>
.pickup-order-card--scheduled .fulfillment-order-card__timing{grid-template-columns:minmax(0,1fr)}.pickup-order-card--scheduled .fulfillment-order-card__timing span{overflow:visible;text-overflow:clip;white-space:normal;overflow-wrap:anywhere;line-height:1.5}
</style>
