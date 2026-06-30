<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getOrders } from '@/api/orders';
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
const merchantRecords = ref<UserOrder[]>([]);
const merchantLoading = ref(false);
const merchantLoginLoading = ref(false);
const merchantMessage = ref('');
const loggedIn = computed(() => Boolean(auth.user));

const tabs = computed<Array<{ value: MessageTab; label: string }>>(() => [
  { value: 'merchant', label: t('merchantNoticesTab') },
  { value: 'system', label: t('systemNoticesTab') },
]);

const panelDescription = computed(() =>
  activeTab.value === 'merchant' ? t('merchantNoticesDescription') : t('systemNoticesDescription'),
);

async function loadMerchantRecords(showLoading = false) {
  if (!auth.user) return;
  if (showLoading) merchantLoading.value = true;
  try {
    merchantRecords.value = await getOrders();
    merchantMessage.value = '';
  } catch (caught) {
    merchantMessage.value =
      caught instanceof Error ? translateApiError(caught.message) : t('orderLoadError');
  } finally {
    merchantLoading.value = false;
  }
}

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
  ].includes(normalized);
}

function openOrder(id: string) {
  uni.navigateTo({ url: `/pages/order/detail?id=${id}` });
}

function openConversation(order: UserOrder) {
  const readonly = isClosedOrder(order.status) ? '&readonly=1' : '';
  uni.navigateTo({ url: `/pages/order/chat?orderId=${order.id}${readonly}` });
}

onShow(() => {
  void auth.restoreSession().then(() => {
    if (activeTab.value === 'merchant' && auth.user) {
      void loadMerchantRecords(true);
    }
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
        {{ merchantMessage }}
      </view>

      <view v-if="activeTab === 'merchant' && loggedIn && merchantLoading" class="empty-state compact">
        <view class="empty-icon">🧾</view>
        <text class="empty-title">{{ t('loading') }}</text>
      </view>

      <view
        v-else-if="activeTab === 'merchant' && loggedIn && merchantRecords.length"
        class="records"
      >
        <view
          v-for="order in merchantRecords"
          :key="order.id"
          class="record-card"
          @click="openOrder(order.id)"
        >
          <view class="record-head">
            <view class="record-main">
              <text class="merchant-name">{{ orderMerchantName(order, locale) }}</text>
              <text class="record-time">{{ new Date(order.createdAt).toLocaleString() }}</text>
            </view>
            <text :class="['status-pill', isClosedOrder(order.status) ? 'closed' : 'active']">
              {{ orderStatusLabel(order.status, locale) }}
            </text>
          </view>

          <view class="record-meta">
            <text class="type-pill">{{ orderTypeLabel(order.orderType, locale) }}</text>
            <text class="order-no">{{ t('orderNo') }}：{{ order.orderNo }}</text>
          </view>

          <view class="record-items">
            <text v-for="item in order.items.slice(0, 2)" :key="item.id" class="item-line">
              {{ productSnapshotName(item, locale) }} × {{ item.quantity }}
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
              <button class="ghost-button" @click.stop="openOrder(order.id)">
                {{ t('viewDetails') }}
              </button>
              <button
                :class="['action-button', isClosedOrder(order.status) ? 'muted' : 'primary']"
                @click.stop="openConversation(order)"
              >
                {{ isClosedOrder(order.status) ? t('viewConversation') : t('openConversation') }}
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
  white-space: nowrap;
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
  align-items: flex-end;
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
  flex-shrink: 0;
}

.ghost-button,
.action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 132rpx;
  height: 64rpx;
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
