<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onHide, onShow, onUnload } from '@dcloudio/uni-app';
import { chatMediaLabel } from '@/utils/order-chat-media';
import { getOrders } from '@/api/orders';
import { getDiningReservations } from '@/api/reservations';
import { formatReservationTime, reservationText, type ArrivalReservation } from '@huayue-life/shared';
import {
  locale,
  orderMerchantName,
  orderStatusLabel,
  orderTypeLabel,
  productSnapshotName,
  translateApiError,
  useI18n,
  usePageTitle,
} from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import type { UserOrder } from '@/types/api';

type MessageTab = 'merchant' | 'system';

const auth = useAuthStore();
const activeTab = ref<MessageTab>('merchant');
const { t } = useI18n();
const orders = ref<UserOrder[]>([]);
const reservations = ref<ArrivalReservation[]>([]);
// A seated reservation may also have a dining order. Keep one reservation
// card until that order has its own messages; never hide an existing history.
const linkedOrderIds = computed(() => new Set(reservations.value.map(row => row.orderId).filter(Boolean)));
const merchantRecords = computed(() => [
  ...orders.value.filter(order => order.orderType !== 'DINE_IN' || !linkedOrderIds.value.has(order.id) || Boolean(order.chatConversation?.lastMessageId)).map(order => ({
    key: `order:${order.id}`, id: order.id, kind: 'order' as const, merchant: order.merchant,
    number: order.orderNo, status: order.status, statusLabel: order.isReservation && ['PENDING_ACCEPTANCE', 'ACCEPTED'].includes(order.status)
      ? reservationText(order.status === 'PENDING_ACCEPTANCE' ? 'PENDING' : 'CONFIRMED', locale.value) : orderStatusLabel(order.status, locale.value),
    typeLabel: order.isReservation ? reservationText('pickup', locale.value) : orderTypeLabel(order.orderType, locale.value),
    createdAt: order.createdAt, scheduledFor: order.scheduledFor,
    chat: order.chatConversation,
    items: order.items.map(item => ({ name: productSnapshotName(item, locale.value), quantity: item.quantity })),
  })),
  ...reservations.value.map(row => ({
    key: `reservation:${row.id}`, id: row.id, kind: 'reservation' as const, merchant: row.merchant,
    number: row.reservationNo, status: row.status, statusLabel: reservationText(row.status, locale.value),
    typeLabel: reservationText('dineIn', locale.value), createdAt: row.createdAt, scheduledFor: row.scheduledFor,
    chat: row.chatConversation,
    items: row.items.map(item => ({ name: productSnapshotName(item, locale.value), quantity: item.quantity })),
  })),
].sort((a, b) => new Date(b.chat?.lastMessageAt || b.createdAt).getTime() - new Date(a.chat?.lastMessageAt || a.createdAt).getTime() || a.key.localeCompare(b.key)));
type MerchantRecord = (typeof merchantRecords.value)[number];
let timer: ReturnType<typeof setInterval> | undefined;
let requestSeq = 0;
let loadingRecords = false;
let visible = false;
let accountId = '';
const merchantLoading = ref(false);
const merchantLoginLoading = ref(false);
const merchantMessage = ref('');
const loggedIn = computed(() => Boolean(auth.user));
watch(() => auth.user?.id, () => {
  requestSeq++;
  orders.value = []; reservations.value = []; accountId = '';
  loadingRecords = false; merchantLoading.value = false; merchantMessage.value = '';
  if (visible && auth.user) void loadMerchantRecords(true);
});

const tabs = computed<Array<{ value: MessageTab; label: string }>>(() => [
  { value: 'merchant', label: t('merchantNoticesTab') },
  { value: 'system', label: t('systemNoticesTab') },
]);

const panelDescription = computed(() =>
  activeTab.value === 'merchant' ? t('merchantNoticesDescription') : t('systemNoticesDescription'),
);

async function loadMerchantRecords(showLoading = false) {
  if (!auth.user || loadingRecords) return;
  const userId = auth.user.id;
  const seq = ++requestSeq;
  loadingRecords = true;
  if (accountId !== userId) { orders.value = []; reservations.value = []; accountId = userId; }
  if (showLoading) merchantLoading.value = true;
  try {
    const results = await Promise.allSettled([getOrders(), getDiningReservations()]);
    if (seq !== requestSeq || auth.user?.id !== userId) return;
    if (results[0].status === 'fulfilled') orders.value = results[0].value;
    if (results[1].status === 'fulfilled') reservations.value = results[1].value;
    const failed = results.find(result => result.status === 'rejected');
    merchantMessage.value = failed?.status === 'rejected'
      ? failed.reason instanceof Error ? translateApiError(failed.reason.message) : t('orderLoadError') : '';
  } finally {
    if (seq === requestSeq) { loadingRecords = false; merchantLoading.value = false; }
  }
}

function startPolling() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (visible && activeTab.value === 'merchant') void loadMerchantRecords();
  }, 10000);
}
function stopPolling() { visible = false; requestSeq++; loadingRecords = false; merchantLoading.value = false; if (timer) clearInterval(timer); timer = undefined; }
onHide(stopPolling);
onUnload(stopPolling);

function switchTab(tab: MessageTab) {
  activeTab.value = tab;
  if (tab === 'merchant' && auth.user && !merchantRecords.value.length) {
    void loadMerchantRecords(true);
  }
}

async function loginForMerchantNotices() {
  if (merchantLoginLoading.value) return;
  console.log('[messages] login button tapped');
  merchantLoginLoading.value = true;
  try {
    await auth.loginWithWechat();
    await auth.restoreSession();
    console.log('[messages] login success, loading merchant notices');
    await loadMerchantRecords(true);
  } catch (error) {
    console.warn('[messages] merchant notice login failed', error);
    uni.showToast({
      title: error instanceof Error ? error.message : t('wechatLoginFailedSimple'),
      icon: 'none',
    });
  } finally {
    merchantLoginLoading.value = false;
  }
}

function isClosedOrder(status: string | undefined | null) {
  const normalized = String(status ?? '').trim().toUpperCase();
  return [
    'COMPLETED',
    'COMPLETE',
    'FINISHED',
    'DONE',
    'CLOSED',
    'CANCELLED',
    'CANCELED',
    'REFUNDED',
    'REJECTED',
    'NO_SHOW',
  ].includes(normalized);
}

function openOrder(record: MerchantRecord) {
  const path = record.kind === 'reservation' ? '/pages/reservation/detail' : '/pages/order/detail';
  uni.navigateTo({ url: `${path}?id=${encodeURIComponent(record.id)}` });
}

function openConversation(record: MerchantRecord) {
  const key = record.kind === 'reservation' ? 'reservationId' : 'orderId';
  uni.navigateTo({ url: `/pages/order/chat?${key}=${encodeURIComponent(record.id)}` });
}

onShow(() => {
  visible = true;
  startPolling();
  void auth.restoreSession().then(() => {
    if (!visible) return;
    if (!auth.user) { orders.value = []; reservations.value = []; accountId = ''; return; }
    if (activeTab.value === 'merchant') void loadMerchantRecords(true);
  });
});

usePageTitle(() => t('messagesTitle'));
</script>

<template>
  <view class="page">
    <view class="hero">
      <text class="title">{{ t('messagesTitle') }}</text>
      <text class="subtitle">{{ t('messagesSubtitle') }}</text>
    </view>

    <view class="tabs">
      <view
        v-for="tab in tabs"
        :key="tab.value"
        :class="['tab', activeTab === tab.value ? 'active' : '']"
        @click="switchTab(tab.value)"
      >
        {{ tab.label }}
      </view>
    </view>

    <view class="panel">
      <text class="panel-desc">{{ panelDescription }}</text>

      <view v-if="activeTab === 'merchant' && !loggedIn" class="login-guide">
        <view class="empty-icon">🔔</view>
        <text class="empty-title">{{ t('loginMerchantNoticeTitle') }}</text>
        <text class="empty-copy">{{ t('loginMerchantNoticeContent') }}</text>
        <button
          class="login-button"
          :loading="auth.loading || merchantLoginLoading"
          @click="loginForMerchantNotices"
        >
          {{ merchantLoginLoading ? t('loggingIn') : t('wechatOneTapLogin') }}
        </button>
      </view>

      <view v-else-if="activeTab === 'merchant' && merchantMessage" class="message">
        <text>{{ merchantMessage }}</text><button class="ghost-button" @click="loadMerchantRecords(true)">{{ t('retry') }}</button>
      </view>

      <view v-if="activeTab === 'merchant' && loggedIn && merchantLoading && !merchantRecords.length" class="empty-state compact">
        <view class="empty-icon">🧾</view>
        <text class="empty-title">{{ t('loading') }}</text>
      </view>

      <view
        v-else-if="activeTab === 'merchant' && loggedIn && merchantRecords.length"
        class="records"
      >
        <view
          v-for="order in merchantRecords"
          :key="order.key"
          class="record-card"
          @click="openOrder(order)"
        >
          <view class="record-head">
            <view class="record-main">
              <text class="merchant-name">{{ orderMerchantName(order, locale) }}</text>
              <text class="record-time">{{ new Date(order.createdAt).toLocaleString() }}</text>
            </view>
            <text :class="['status-pill', isClosedOrder(order.status) ? 'closed' : 'active']">
              {{ order.statusLabel }}
            </text>
          </view>

          <view class="record-meta">
            <text class="type-pill">{{ order.typeLabel }}</text>
            <text class="order-no">{{ t('orderNo') }}：{{ order.number }}</text>
          </view>

          <text v-if="order.scheduledFor" class="record-schedule">{{ formatReservationTime(order.scheduledFor, locale) }} · {{ reservationText(order.kind === 'reservation' ? 'arrivalTime' : 'pickupTime', locale) }}</text>
          <text v-if="order.chat?.lastMessage" class="record-preview">{{ order.chat.lastMessage.messageType === 'IMAGE' ? chatMediaLabel(locale, 'image') : order.chat.lastMessage.messageType === 'LOCATION' ? chatMediaLabel(locale, 'location') : order.chat.lastMessage.content }}</text>
          <view v-else class="record-items">
            <text v-for="(item, index) in order.items.slice(0, 2)" :key="index" class="item-line">
              {{ item.name }} × {{ item.quantity }}
            </text>
            <text v-if="order.items.length > 2" class="item-line more">
              {{ t('orderItemsMore', { count: order.items.length - 2 }) }}
            </text>
          </view>

          <view class="record-foot">
            <view class="foot-copy">
              <text class="foot-label">{{ t('merchantServiceRecords') }}</text>
              <text class="foot-state">
                {{ isClosedOrder(order.status) ? t('completedViewRecordOnly') : t('merchantConversationAvailable') }}
              </text>
            </view>
            <view class="foot-actions">
              <button class="ghost-button" @click.stop="openOrder(order)">
                {{ t('viewDetails') }}
              </button>
              <button
                :class="['action-button', isClosedOrder(order.status) ? 'muted' : 'primary']"
                @click.stop="openConversation(order)"
              >
                {{ isClosedOrder(order.status) ? t('viewConversation') : t('openConversation') }}
                <text v-if="order.chat?.customerUnreadCount" class="unread-count">{{ order.chat.customerUnreadCount > 99 ? '99+' : order.chat.customerUnreadCount }}</text>
              </button>
            </view>
          </view>
        </view>
      </view>

      <view v-else-if="activeTab !== 'merchant' || loggedIn" class="empty-state">
        <view class="empty-icon">{{ activeTab === 'merchant' ? '🔔' : '📢' }}</view>
        <text class="empty-title">
          {{ activeTab === 'merchant' ? t('noMerchantNoticesTitle') : t('noSystemNoticesTitle') }}
        </text>
        <text class="empty-copy">
          {{ activeTab === 'merchant' ? t('noMerchantNoticesHint') : t('noSystemNoticesHint') }}
        </text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.record-schedule,.record-preview{display:block;margin-top:16rpx;color:#666;font-size:24rpx;line-height:1.6;overflow-wrap:anywhere}.record-preview{display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:#1f2d24}.unread-count{min-width:36rpx;margin-left:10rpx;padding:0 6rpx;box-sizing:border-box;border-radius:999rpx;background:#fff;color:#2e7d32;text-align:center;font-size:21rpx}

.page {
  min-height: 100vh;
  padding: 24rpx 24rpx calc(44rpx + env(safe-area-inset-bottom));
  color: #1f2d24;
  background: #f6faf7;
  box-sizing: border-box;
}

.hero {
  padding: 10rpx 6rpx 18rpx;
}

.title {
  display: block;
  font-size: 38rpx;
  font-weight: 800;
}

.subtitle {
  display: block;
  margin-top: 8rpx;
  color: #728077;
  font-size: 24rpx;
  line-height: 1.5;
}

.tabs {
  display: flex;
  gap: 12rpx;
  padding: 8rpx;
  margin-bottom: 18rpx;
  border-radius: 20rpx;
  background: #fff;
  box-shadow: 0 10rpx 28rpx rgb(46 125 50 / 6%);
}

.tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 70rpx;
  padding: 0 10rpx;
  border-radius: 16rpx;
  color: #728077;
  font-size: 24rpx;
  font-weight: 600;
}

.tab.active {
  color: #2e7d32;
  background: #eaf7ee;
}

.panel {
  padding: 20rpx;
  border-radius: 22rpx;
  background: #fff;
  box-shadow: 0 10rpx 28rpx rgb(46 125 50 / 6%);
}

.message {
  display: block;
  padding: 20rpx 22rpx;
  margin-bottom: 18rpx;
  border-radius: 18rpx;
  color: #8a5a00;
  background: #fff3dd;
  font-size: 22rpx;
}

.panel-desc {
  display: block;
  margin-bottom: 16rpx;
  color: #728077;
  font-size: 23rpx;
  line-height: 1.5;
}

.empty-state {
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 72rpx 28rpx 64rpx;
  text-align: center;
}

.empty-state.compact {
  padding: 56rpx 24rpx 48rpx;
}

.login-guide {
  position: relative;
  z-index: 2;
  pointer-events: auto;
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 64rpx 28rpx 56rpx;
  text-align: center;
}

.login-button {
  width: 100%;
  min-width: 300rpx;
  margin-top: 24rpx;
  border-radius: 999rpx;
  color: #fff;
  background: #2e7d32;
  font-size: 25rpx;
  font-weight: 800;
}

.login-button::after {
  border: 0;
}

.empty-icon {
  display: grid;
  width: 96rpx;
  height: 96rpx;
  place-items: center;
  margin-bottom: 20rpx;
  border-radius: 28rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 42rpx;
}

.empty-title {
  color: #1f2d24;
  font-size: 28rpx;
  font-weight: 700;
}

.empty-copy {
  margin-top: 10rpx;
  color: #7f8c84;
  font-size: 22rpx;
  line-height: 1.6;
}

.records {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.record-card {
  padding: 22rpx;
  border: 1rpx solid #e6efe8;
  border-radius: 20rpx;
  background: #fcfffd;
}

.record-head {
  display: flex;
  gap: 16rpx;
  align-items: flex-start;
  justify-content: space-between;
}

.record-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.merchant-name {
  color: #1f2d24;
  font-size: 28rpx;
  font-weight: 700;
  line-height: 1.35;
}

.record-time {
  margin-top: 6rpx;
  color: #7b887f;
  font-size: 22rpx;
}

.status-pill,
.type-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  font-size: 20rpx;
  font-weight: 600;
  white-space: normal;
}

.status-pill.active {
  color: #2e7d32;
  background: #eaf7ee;
}

.status-pill.closed {
  color: #66756c;
  background: #eef2ef;
}

.record-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx 12rpx;
  align-items: center;
  margin-top: 16rpx;
}

.type-pill {
  color: #2e7d32;
  background: #eaf7ee;
}

.order-no {
  color: #728077;
  font-size: 22rpx;
}

.record-items {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-top: 16rpx;
}

.item-line {
  color: #445249;
  font-size: 23rpx;
  line-height: 1.5;
}

.item-line.more {
  color: #7b887f;
}

.record-foot {
  display: flex;
  gap: 16rpx;
  align-items: stretch;
  flex-direction: column;
  justify-content: space-between;
  margin-top: 18rpx;
}

.foot-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.foot-label {
  color: #1f2d24;
  font-size: 22rpx;
  font-weight: 600;
}

.foot-state {
  margin-top: 8rpx;
  color: #728077;
  font-size: 21rpx;
  line-height: 1.5;
}

.foot-actions {
  display: flex;
  gap: 12rpx;
  align-items: center;
  flex-wrap: wrap;
}

.ghost-button,
.action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 132rpx;
  min-height: 44px;
  padding: 0 20rpx;
  border: 0;
  border-radius: 999rpx;
  font-size: 22rpx;
  font-weight: 600;
}

.ghost-button::after,
.action-button::after {
  border: 0;
}

.ghost-button {
  color: #496154;
  background: #f1f5f2;
}

.action-button.primary {
  color: #fff;
  background: #2e7d32;
}

.action-button.muted {
  color: #496154;
  background: #eaf3ec;
}
</style>
