<script setup lang="ts">
import { ref } from 'vue';
import { formatReservationTime, reservationText, type ArrivalKind, type ReservationTextKey } from '@huayue-life/shared';
import { replyReservationTime } from '@/api/reservations';
import { useI18n } from '@/i18n';
const props = defineProps<{ kind: ArrivalKind; id: string; proposed: string }>();
const emit = defineEmits<{ updated: [] }>();
const { locale } = useI18n();
const rt = (key: ReservationTextKey) => reservationText(key, locale.value);
const busy = ref(false);
const error = ref('');
async function reply(accept: boolean) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try { await replyReservationTime(props.kind, props.id, props.proposed, accept); emit('updated'); }
  catch (caught) { error.value = caught instanceof Error ? caught.message : rt('loadError'); }
  finally { busy.value = false; }
}
</script>
<template>
  <view class="time-change">
    <text class="change-title">{{ rt('changeProposed') }}</text>
    <text class="change-time">{{ formatReservationTime(proposed, locale) }}</text>
    <text class="change-hint">{{ rt('changeHint') }} · {{ rt('vietnamTime') }}</text>
    <view class="change-actions"><button class="change-button" :disabled="busy" @tap="reply(false)">{{ rt('keepTime') }}</button><button class="change-button accept" :disabled="busy" @tap="reply(true)">{{ rt('acceptTime') }}</button></view>
    <text v-if="error" class="change-error">{{ error }}</text>
  </view>
</template>
<style scoped>
.time-change{margin-bottom:24rpx;padding:28rpx;border-radius:28rpx;background:#fff7e8;color:#1f2d24}.change-title{display:block;font-size:28rpx;font-weight:700}.change-time{display:block;margin-top:14rpx;font-size:34rpx;font-weight:700}.change-hint{display:block;margin-top:14rpx;font-size:24rpx;color:#766448;line-height:1.6}.change-actions{display:flex;gap:16rpx;margin-top:24rpx}.change-button{flex:1;min-width:0;min-height:88rpx;margin:0;padding:20rpx 12rpx;border-radius:18rpx;background:#fff;color:#2e7d32;font-size:25rpx;line-height:1.6;white-space:normal}.change-button::after{border:0}.change-actions .accept{background:#43a047;color:#fff}.change-error{display:block;margin-top:16rpx;color:#b33b2b;font-size:24rpx;line-height:1.5}
</style>
