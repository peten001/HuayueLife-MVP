<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getMerchant } from '@/api/catalog';
import {
  merchantName,
  orderTypeLabel,
  useI18n,
  usePageTitle,
} from '@/i18n';
import type { MerchantDetail } from '@/types/api';

const merchant = ref<MerchantDetail | null>(null);
const error = ref('');
const { locale, t } = useI18n();

usePageTitle(() => t('merchantDetailTitle'));

onLoad(async (options) => {
  try {
    merchant.value = await getMerchant(String(options?.id ?? ''));
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : t('merchantLoadFailed');
  }
});

function openMenu(orderType: 'PICKUP' | 'DELIVERY') {
  if (!merchant.value) return;
  uni.navigateTo({
    url: `/pages/menu/index?merchantId=${merchant.value.id}&orderType=${orderType}`,
  });
}
</script>

<template>
  <view class="page">
    <text v-if="error" class="error">{{ error }}</text>
    <template v-else-if="merchant">
      <image v-if="merchant.coverUrl" class="cover" :src="merchant.coverUrl" mode="aspectFill" />
      <view class="card">
        <view class="headline">
          <text class="title">{{ merchantName(merchant, locale) }}</text>
          <text :class="merchant.isOpen ? 'open' : 'closed'">{{ merchant.isOpen ? t('merchantOpen') : t('merchantClosed') }}</text>
        </view>
        <text class="address">{{ merchant.addressDetail }}</text>
        <text class="phone">{{ t('phone') }}：{{ merchant.contactPhone }}</text>
        <text v-if="merchant.notice" class="notice">{{ merchant.notice }}</text>
        <view class="tags">
          <text v-for="type in merchant.supportedOrderTypes" :key="type" class="tag">{{ orderTypeLabel(type, locale) }}</text>
        </view>
      </view>
      <view class="actions">
        <button
          v-if="merchant.supportedOrderTypes.includes('PICKUP')"
          class="primary"
          @click="openMenu('PICKUP')"
        >
          {{ t('pickup') }}
        </button>
        <button
          v-if="merchant.supportedOrderTypes.includes('DELIVERY')"
          class="primary delivery"
          @click="openMenu('DELIVERY')"
        >
          {{ t('delivery') }}
        </button>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx; background: #f6f3ef; }
.cover { width: 100%; height: 360rpx; border-radius: 24rpx; }
.card { padding: 28rpx; margin: 20rpx 0; border-radius: 20rpx; background: #fff; }
.headline { display: flex; justify-content: space-between; gap: 20rpx; }
.title { font-size: 40rpx; font-weight: 800; }
.open { color: #16854a; }
.closed, .error { color: #a83228; }
.address, .phone, .notice { display: block; margin-top: 18rpx; color: #666; }
.notice { padding: 18rpx; border-radius: 12rpx; background: #fff5eb; }
.tags { display: flex; gap: 10rpx; margin-top: 20rpx; }
.tag { padding: 6rpx 12rpx; border-radius: 8rpx; color: #a83228; background: #fff0ed; font-size: 22rpx; }
.primary { color: #fff; background: #c43b2f; }
.actions { display: flex; gap: 16rpx; }
.actions button { flex: 1; }
.delivery { background: #9b5a2e; }
</style>
