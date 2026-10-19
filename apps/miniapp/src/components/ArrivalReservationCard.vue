<script setup lang="ts">
import { formatReservationTime, reservationText, type ArrivalReservation, type ReservationTextKey } from '@huayue-life/shared';
import { useI18n, merchantName } from '@/i18n';
defineProps<{ reservation: ArrivalReservation }>();
defineEmits<{ open: [] }>();
const { locale } = useI18n();
const rt = (key: ReservationTextKey) => reservationText(key, locale.value);
</script>
<template>
  <view class="arrival-card" @tap="$emit('open')">
    <view class="arrival-card-head"><text class="arrival-merchant">{{ merchantName(reservation.merchant, locale) }}</text><text class="arrival-status">{{ rt(reservation.status) }}</text></view>
    <text class="arrival-time">{{ formatReservationTime(reservation.scheduledFor, locale) }}</text>
    <view class="arrival-meta"><text class="arrival-kind">{{ rt(reservation.kind === 'DINE_IN' ? 'dineIn' : 'pickup') }}</text><text v-if="reservation.guestCount">{{ reservation.guestCount }} {{ rt('people') }}</text><text>{{ rt('vietnamTime') }}</text></view>
    <text v-if="reservation.proposedScheduledFor" class="arrival-change">{{ rt('changeProposed') }}</text>
    <view class="arrival-foot"><text>{{ reservation.reservationNo }}</text><text class="arrival-link">{{ rt('details') }} ›</text></view>
  </view>
</template>
<style scoped>
.arrival-card{margin-bottom:24rpx;padding:28rpx;border-radius:32rpx;background:#fff;color:#1f2d24}.arrival-card-head{display:flex;justify-content:space-between;gap:18rpx;align-items:flex-start}.arrival-merchant{flex:1;min-width:0;font-size:30rpx;font-weight:700;line-height:1.5}.arrival-status{max-width:42%;color:#2e7d32;font-size:24rpx;line-height:1.5;text-align:right}.arrival-time{display:block;margin-top:24rpx;font-size:34rpx;font-weight:700;line-height:1.5}.arrival-meta{display:flex;flex-wrap:wrap;align-items:center;gap:14rpx;margin-top:16rpx;color:#666;font-size:23rpx;line-height:1.5}.arrival-kind{padding:6rpx 14rpx;border-radius:10rpx;background:#eaf7ee;color:#2e7d32}.arrival-change{display:block;margin-top:18rpx;color:#8a6328;font-size:25rpx}.arrival-foot{display:flex;justify-content:space-between;gap:18rpx;margin-top:26rpx;padding-top:22rpx;border-top:1rpx solid #f0f0f0;color:#87918a;font-size:23rpx;line-height:1.5;word-break:break-all}.arrival-link{color:#2e7d32;flex-shrink:0}
</style>
