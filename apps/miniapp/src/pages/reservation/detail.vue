<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { formatReservationTime, reservationText, type ArrivalReservation, type ReservationTextKey } from '@huayue-life/shared';
import { getDiningReservation, cancelDiningReservation } from '@/api/reservations';
import { useI18n, usePageTitle, merchantName } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import ReservationTimeChange from '@/components/ReservationTimeChange.vue';

const { locale } = useI18n();
const rt = (key: ReservationTextKey) => reservationText(key, locale.value);
const auth = useAuthStore();
const id = ref('');
const reservation = ref<ArrivalReservation | null>(null);
const loading = ref(true);
const error = ref('');
const busy = ref(false);
const assignedTable = computed(() => reservation.value?.table ?? reservation.value?.assignedTable);
let timer: ReturnType<typeof setInterval> | undefined;
let requestInFlight = false;
const address = computed(() => {
  const m = reservation.value?.merchant;
  return (locale.value === 'vi' ? m?.addressVi : locale.value === 'en' ? m?.addressEn : m?.addressZh) || m?.addressDetail || '';
});
usePageTitle(() => rt('details'));
onLoad(options => { id.value = String(options?.id ?? ''); });
onShow(() => { void load(); if (!timer) timer = setInterval(() => void load(), 5000); });
function stop() { if (timer) clearInterval(timer); timer = undefined; }
onHide(stop); onUnload(stop);
async function load() {
  if (requestInFlight || !id.value) return;
  requestInFlight = true;
  try { await auth.ensureLogin(); reservation.value = await getDiningReservation(id.value); error.value = ''; }
  catch (caught) { error.value = caught instanceof Error ? caught.message : rt('loadError'); }
  finally { loading.value = false; requestInFlight = false; }
}
async function cancel() {
  if (busy.value) return;
  const confirm = await new Promise<boolean>(resolve => uni.showModal({ title: rt('cancel'), content: rt('cancelConfirm'), success: result => resolve(result.confirm), fail: () => resolve(false) }));
  if (!confirm) return;
  busy.value = true;
  try { reservation.value = await cancelDiningReservation(id.value); error.value = ''; }
  catch (caught) { error.value = caught instanceof Error ? caught.message : rt('loadError'); }
  finally { busy.value = false; }
}
function openChat() {
  if (!reservation.value) return;
  uni.navigateTo({ url: `/pages/order/chat?reservationId=${encodeURIComponent(reservation.value.id)}` });
}
function call() {
  const phone = reservation.value?.merchant.contactPhone;
  if (phone) uni.makePhoneCall({ phoneNumber: phone, fail: () => undefined });
}
function navigate() {
  const m = reservation.value?.merchant;
  if (!m) return;
  const latitude = Number(m.latitude); const longitude = Number(m.longitude);
  if (m.latitude && m.longitude && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    uni.openLocation({ latitude, longitude, name: merchantName(m, locale.value), address: address.value,
      fail: () => uni.showToast({ title: rt('loadError'), icon: 'none' }) });
  }
}
function continueOrder() {
  const table = reservation.value?.table;
  if (!table?.qrToken) return;
  uni.navigateTo({ url: `/pages/menu/index?merchantId=${reservation.value!.merchant.id}&orderType=DINE_IN&tableToken=${encodeURIComponent(table.qrToken)}&tableNo=${encodeURIComponent(table.tableNo)}&tableName=${encodeURIComponent(table.tableName ?? '')}` });
}
function selectDishes() {
  const row = reservation.value;
  if (!row || row.status !== 'CONFIRMED' || row.proposedScheduledFor) return;
  uni.navigateTo({ url: `/pages/menu/index?merchantId=${row.merchant.id}&orderType=DINE_IN&reservation=1&reservationId=${encodeURIComponent(row.id)}` });
}
function itemName(item: ArrivalReservation['items'][number]) {
  return (locale.value === 'vi' ? item.productNameViSnapshot : locale.value === 'en' ? item.productNameEnSnapshot : item.productNameZhSnapshot) || item.productNameZhSnapshot;
}
</script>
<template>
  <view class="reservation-detail-page">
    <view v-if="loading" class="detail-card state">{{ rt('loading') }}</view>
    <view v-if="error" class="error-message"><text>{{ error }}</text><button @tap="load">{{ rt('retry') }}</button></view>
    <template v-if="reservation">
      <view class="reservation-status" :class="{ ended: ['CANCELLED', 'NO_SHOW'].includes(reservation.status) }"><text class="status-label">{{ rt(reservation.status) }}</text><text v-if="reservation.status === 'PENDING'" class="status-hint">{{ rt('pendingDetail') }}</text><text v-if="reservation.status === 'CONFIRMED'" class="status-hint">{{ rt('confirmedDetail') }}</text><text v-if="reservation.cancelReason" class="status-hint">{{ reservation.cancelReason }}</text></view>
      <ReservationTimeChange v-if="reservation.proposedScheduledFor" :id="id" kind="DINE_IN" :proposed="reservation.proposedScheduledFor" @updated="load" />
      <view v-if="assignedTable" class="detail-card assigned-table-card"><text class="hint">{{ rt('tableNumber') }}</text><text class="assigned-table-number">{{ assignedTable.tableNo }}</text><text v-if="assignedTable.tableName && assignedTable.tableName !== assignedTable.tableNo" class="hint">{{ assignedTable.tableName }}</text></view>
      <view class="detail-card"><text class="merchant-name">{{ merchantName(reservation.merchant, locale) }}</text><text class="address">{{ address }}</text><view class="store-actions"><button :disabled="!reservation.merchant.contactPhone" @tap="call">{{ rt('callStore') }}</button><button :disabled="!reservation.merchant.latitude || !reservation.merchant.longitude" @tap="navigate">{{ rt('navigate') }}</button></view></view>
      <button class="reservation-chat-entry" @tap="openChat"><view><text class="chat-entry-title">{{ rt(['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(reservation.status) ? 'chatHistory' : 'messageStore') }}</text><text class="hint">{{ rt(['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(reservation.status) ? 'chatEndedHint' : 'chatPlanHint') }}</text></view><text v-if="reservation.chatConversation?.customerUnreadCount" class="chat-unread">{{ reservation.chatConversation.customerUnreadCount > 99 ? '99+' : reservation.chatConversation.customerUnreadCount }}</text><text aria-hidden="true">›</text></button>
      <view class="detail-card"><view class="info-row"><text>{{ rt('arrivalTime') }}</text><text class="emphasis">{{ formatReservationTime(reservation.scheduledFor, locale) }}</text></view><text class="time-note">{{ rt('vietnamTime') }}</text><view class="info-row"><text>{{ rt('guests') }}</text><text>{{ reservation.guestCount }} {{ rt('people') }}</text></view><view v-if="reservation.status === 'CONFIRMED' && !assignedTable" class="info-row"><text>{{ rt('tableNumber') }}</text><text>{{ rt('tablePending') }}</text></view><view class="info-row"><text>{{ rt('contactName') }}</text><text>{{ reservation.contactName }}</text></view><view class="info-row"><text>{{ rt('contactPhone') }}</text><text>{{ reservation.contactPhone }}</text></view><view v-if="reservation.customerRemark" class="info-row"><text>{{ rt('remark') }}</text><text>{{ reservation.customerRemark }}</text></view></view>
      <view class="detail-card"><text class="card-title">{{ rt('preselected') }}</text><text v-if="!reservation.items.length" class="hint">{{ rt(['PENDING', 'CONFIRMED'].includes(reservation.status) ? 'chooseAfterConfirmation' : 'seatsOnly') }}</text><view v-for="(item, index) in reservation.items" :key="index" class="item-row"><view><text>{{ itemName(item) }} × {{ item.quantity }}</text><text v-if="item.remark" class="hint">{{ item.remark }}</text></view><text>{{ Number(item.subtotalVnd).toLocaleString() }} ₫</text></view><text v-if="reservation.items.length" class="hint cooking">{{ rt('cookOnArrival') }}</text><view v-if="reservation.items.length" class="info-row amount"><text>{{ rt('amount') }}</text><text>{{ Number(reservation.itemAmountVnd).toLocaleString() }} ₫</text></view><text class="hint">{{ rt('payAfterMeal') }}</text></view>
      <text class="reservation-number">{{ reservation.reservationNo }}</text>
      <view class="detail-dock"><button v-if="reservation.status === 'PENDING'" :disabled="busy" class="secondary" @tap="cancel">{{ rt('cancel') }}</button><button v-if="reservation.status === 'CONFIRMED' && !reservation.proposedScheduledFor" class="primary" @tap="selectDishes">{{ rt(reservation.items.length ? 'addDishes' : 'selectDishes') }}</button><button v-else-if="reservation.status === 'SEATED' && reservation.table?.qrToken" class="primary" @tap="continueOrder">{{ rt('continueOrder') }}</button><button v-else class="primary" :disabled="!reservation.merchant.contactPhone" @tap="call">{{ rt('callStore') }}</button><text v-if="reservation.status === 'CONFIRMED'" class="hint">{{ rt(reservation.proposedScheduledFor ? 'replyTimeBeforeDishes' : 'cancelContact') }}</text></view>
    </template>
  </view>
</template>
<style scoped>
.reservation-chat-entry{display:flex;align-items:center;gap:20rpx;width:100%;min-height:44px;margin:0 0 16rpx;padding:22rpx 24rpx;box-sizing:border-box;border-radius:32rpx;background:#fff;color:#2e7d32;text-align:left;font-size:32rpx;line-height:1.6}.reservation-chat-entry>view{flex:1;min-width:0}.chat-entry-title{display:block;font-size:28rpx;font-weight:700}.chat-unread{padding:0 14rpx;border-radius:999rpx;background:#43a047;color:#fff;font-size:24rpx}

.detail-card.assigned-table-card{background:#eaf7ee}.assigned-table-number{display:block;margin:12rpx 0;font-size:52rpx;font-weight:750;color:#2e7d32;line-height:1.4;word-break:break-all}
.reservation-detail-page{min-height:100vh;box-sizing:border-box;padding:24rpx 24rpx calc(200rpx + env(safe-area-inset-bottom));background:#f6faf7;color:#1f2d24;font-size:28rpx}.reservation-status{margin-bottom:16rpx;padding:24rpx;border-radius:32rpx;background:#eaf7ee;color:#2e7d32}.reservation-status.ended{background:#eef0ee;color:#666}.status-label{display:block;font-size:38rpx;font-weight:750;line-height:1.4}.status-hint{display:block;margin-top:14rpx;font-size:26rpx;line-height:1.6}.detail-card{margin-bottom:16rpx;padding:22rpx 24rpx;border-radius:32rpx;background:#fff}.merchant-name{display:block;font-size:32rpx;font-weight:700;line-height:1.5}.address{display:block;margin-top:16rpx;font-size:25rpx;color:#666;line-height:1.6}.store-actions{display:flex;gap:18rpx;margin-top:16rpx}.store-actions button{min-height:44px;flex:1;min-width:0;margin:0;padding:20rpx 12rpx;border-radius:18rpx;background:#f6faf7;color:#2e7d32;font-size:25rpx;line-height:1.6;white-space:normal}.info-row{display:flex;justify-content:space-between;align-items:baseline;gap:24rpx;margin-top:16rpx;line-height:1.6;font-size:26rpx}.info-row:first-child{margin-top:0}.info-row>text:first-child{color:#666;flex-shrink:0;max-width:40%}.info-row>text:last-child{text-align:right;word-break:break-all}.emphasis{font-weight:700;font-size:30rpx}.time-note{display:block;margin-top:8rpx;text-align:right;font-size:23rpx;color:#666}.hint{display:block;color:#666;font-size:24rpx;line-height:1.6}.card-title{display:block;margin-bottom:14rpx;font-size:30rpx;font-weight:700}.item-row{display:flex;justify-content:space-between;gap:20rpx;margin-top:14rpx;line-height:1.6;font-size:26rpx}.item-row>view{flex:1;min-width:0}.item-row>text{flex-shrink:0}.cooking{margin-top:16rpx;padding:18rpx;border-radius:16rpx;background:#eaf7ee;color:#2e7d32}.amount{padding-top:22rpx;border-top:1rpx solid #f0f0f0;margin-bottom:16rpx;font-weight:700}.reservation-number{display:block;text-align:center;color:#87918a;font-size:23rpx}.detail-dock{position:fixed;bottom:0;left:0;right:0;display:flex;flex-wrap:wrap;gap:16rpx;padding:18rpx 24rpx calc(18rpx + env(safe-area-inset-bottom));border-top:1rpx solid #f0f0f0;background:#fff}.detail-dock button{flex:1;min-width:0;min-height:44px;margin:0;padding:22rpx 18rpx;border-radius:22rpx;font-size:28rpx;line-height:1.6;white-space:normal}.primary{background:#43a047;color:#fff}.secondary{background:#f6faf7;color:#666}.detail-dock>.hint{width:100%;text-align:center}.state{text-align:center;padding:60rpx 24rpx}.error-message{margin-bottom:24rpx;padding:24rpx;border-radius:20rpx;background:#fff0ed;color:#b33b2b;font-size:26rpx;line-height:1.6}.error-message button{margin:18rpx 0 0;background:#fff;color:#2e7d32;border-radius:18rpx;font-size:26rpx}button::after{border:0}button[disabled]{background:#e9eeea;color:#819086}
</style>
