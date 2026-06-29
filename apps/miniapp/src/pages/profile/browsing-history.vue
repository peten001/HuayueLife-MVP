<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { locale, merchantName, useI18n, usePageTitle } from '@/i18n';
import type { MerchantBrowsingHistoryGroup, MerchantBrowsingHistoryRecord } from '@/utils/browsing-history';
import {
  browsingHistoryMerchantAddress,
  getMerchantBrowsingHistory,
  groupBrowsingHistoryByDate,
} from '@/utils/browsing-history';
import { resolveMediaUrl } from '@/utils/media';

const records = ref<MerchantBrowsingHistoryRecord[]>([]);
const { t } = useI18n();

usePageTitle(() => t('browsingHistory'));

const groupedRecords = computed<MerchantBrowsingHistoryGroup[]>(() =>
  groupBrowsingHistoryByDate(records.value, locale.value),
);

function loadRecords() {
  records.value = getMerchantBrowsingHistory();
}

function formatTime(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function openMerchant(record: MerchantBrowsingHistoryRecord) {
  uni.navigateTo({ url: `/pages/merchant/detail?id=${record.merchantId}` });
}

function goHome() {
  uni.switchTab({ url: '/pages/home/index' });
}

function groupLabel(key: MerchantBrowsingHistoryGroup['key']) {
  if (key === 'today') return t('today');
  if (key === 'yesterday') return t('yesterday');
  return t('earlier');
}

onShow(() => {
  loadRecords();
});
</script>

<template>
  <view class="page">
    <view class="page-heading">
      <text class="page-title">{{ t('browsingHistory') }}</text>
      <text class="page-subtitle">{{ t('profileBrowsingHistoryHint') }}</text>
    </view>

    <view v-if="!records.length" class="empty">
      <view class="empty-icon">🕘</view>
      <text class="empty-title">{{ t('browsingHistoryEmptyTitle') }}</text>
      <text class="empty-copy">{{ t('browsingHistoryEmptyHint') }}</text>
      <button class="empty-action" @click="goHome">{{ t('browsingHistoryGoHome') }}</button>
    </view>

    <view v-else class="groups">
      <view v-for="group in groupedRecords" :key="group.key" class="group">
        <text class="group-title">{{ groupLabel(group.key) }}</text>
        <view class="group-list">
          <view
            v-for="record in group.records"
            :key="record.merchantId"
            class="record-card"
            @click="openMerchant(record)"
          >
            <image
              v-if="resolveMediaUrl(record.merchant.coverUrl || record.merchant.logoUrl)"
              class="record-cover"
              :src="resolveMediaUrl(record.merchant.coverUrl || record.merchant.logoUrl)"
              mode="aspectFill"
            />
            <view v-else class="record-cover placeholder">
              <text class="placeholder-mark">🍽️</text>
            </view>

            <view class="record-main">
              <view class="record-head">
                <text class="merchant-title">{{ merchantName(record.merchant, locale) }}</text>
                <text class="viewed-time">{{ formatTime(record.lastViewedAt) }}</text>
              </view>
              <text class="merchant-copy">{{ browsingHistoryMerchantAddress(record, locale) }}</text>
              <text class="view-count">{{ t('viewCount', { count: record.viewCount }) }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 28rpx 24rpx calc(60rpx + env(safe-area-inset-bottom));
  color: #1f2d24;
  background: #f6faf7;
  box-sizing: border-box;
}

.page-heading {
  padding: 8rpx 4rpx 24rpx;
}

.page-title {
  display: block;
  font-size: 40rpx;
  font-weight: 800;
}

.page-subtitle {
  display: block;
  margin-top: 8rpx;
  color: #7b887f;
  font-size: 23rpx;
  line-height: 1.5;
}

.empty {
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 100rpx 30rpx;
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 12rpx 32rpx rgb(46 125 50 / 6%);
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 100rpx;
  height: 100rpx;
  place-items: center;
  margin-bottom: 24rpx;
  border-radius: 28rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 40rpx;
}

.empty-title {
  color: #1f2d24;
  font-size: 29rpx;
  font-weight: 700;
}

.empty-copy {
  margin-top: 10rpx;
  color: #7d8980;
  font-size: 23rpx;
}

.empty-action {
  margin-top: 28rpx;
  min-width: 220rpx;
  height: 72rpx;
  border: 0;
  border-radius: 999rpx;
  color: #fff;
  background: #43a047;
  font-size: 24rpx;
  font-weight: 700;
  line-height: 72rpx;
}

.empty-action::after {
  border: 0;
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.group-title {
  display: block;
  margin: 0 8rpx 12rpx;
  color: #7b887f;
  font-size: 22rpx;
  font-weight: 700;
}

.group-list {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.record-card {
  display: flex;
  gap: 18rpx;
  align-items: center;
  padding: 18rpx;
  border-radius: 24rpx;
  background: #fff;
  box-shadow: 0 10rpx 28rpx rgb(46 125 50 / 6%);
}

.record-cover {
  width: 108rpx;
  height: 108rpx;
  border-radius: 20rpx;
  background: #eef4ef;
}

.record-cover.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #2e7d32;
  background: #eaf7ee;
}

.placeholder-mark {
  font-size: 40rpx;
}

.record-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.record-head {
  display: flex;
  gap: 12rpx;
  align-items: flex-start;
  justify-content: space-between;
}

.merchant-title {
  flex: 1;
  overflow: hidden;
  color: #1f2d24;
  font-size: 27rpx;
  font-weight: 700;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewed-time {
  color: #7b887f;
  font-size: 21rpx;
  white-space: nowrap;
}

.merchant-copy {
  display: block;
  margin-top: 8rpx;
  overflow: hidden;
  color: #7d8980;
  font-size: 22rpx;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.view-count {
  margin-top: 10rpx;
  color: #2e7d32;
  font-size: 21rpx;
  font-weight: 600;
}
</style>
