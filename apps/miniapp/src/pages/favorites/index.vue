<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import MerchantCard from '@/components/MerchantCard.vue';
import { getMerchant } from '@/api/catalog';
import { useI18n, usePageTitle } from '@/i18n';
import { getFavorites } from '@/utils/favorites';
import type { MerchantSummary } from '@/types/api';

const { t } = useI18n();
const favorites = ref<MerchantSummary[]>([]);

usePageTitle(() => t('favoritesTab'));

const emptyTitle = computed(() => t('noFavoritesTitle'));
const emptyHint = computed(() => t('noFavoritesHint'));

async function loadFavorites() {
  const saved = getFavorites();
  const items: MerchantSummary[] = [];
  for (const item of saved) {
    try {
      const merchant = await getMerchant(item.id);
      items.push(merchant);
    } catch {
      items.push({
        id: item.id,
        nameZh: item.nameZh,
        nameVi: item.nameVi,
        coverUrl: item.coverUrl,
        addressDetail: item.addressDetail ?? '',
        city: '',
        distanceKm: item.distanceKm ?? null,
        isOpen: Boolean(item.isOpen),
        supportedOrderTypes: item.supportedOrderTypes ?? ['PICKUP'],
        minimumDeliveryAmountVnd: '0',
        deliveryFeeVnd: '0',
        latitude: '',
        longitude: '',
        deliveryRadiusKm: '',
        homepageCategoryKeys: item.homepageCategoryKeys ?? [],
        manualPopular: Boolean(item.manualPopular),
      });
    }
  }
  favorites.value = items;
}

onShow(() => {
  void loadFavorites();
});

function openMerchant(merchant: MerchantSummary) {
  uni.navigateTo({ url: `/pages/merchant/detail?id=${merchant.id}` });
}
</script>

<template>
  <view class="page">
    <view class="page-heading">
      <text class="page-title">{{ t('favoritesTab') }}</text>
      <text class="page-subtitle">{{ t('favoritesPageSubtitle') }}</text>
    </view>

    <view v-if="!favorites.length" class="empty">
      <view class="empty-icon">❤️</view>
      <text class="empty-title">{{ emptyTitle }}</text>
      <text class="empty-copy">{{ emptyHint }}</text>
    </view>

    <MerchantCard
      v-for="merchant in favorites"
      :key="merchant.id"
      :merchant="merchant"
      @select="openMerchant"
    />
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 28rpx 24rpx calc(60rpx + env(safe-area-inset-bottom));
  background: #f6faf7;
  box-sizing: border-box;
}
.page-heading { padding: 8rpx 4rpx 24rpx; }
.page-title { display: block; font-size: 42rpx; font-weight: 800; }
.page-subtitle { display: block; margin-top: 7rpx; color: #77837a; font-size: 23rpx; }
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
  border-radius: 32rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 38rpx;
  font-weight: 800;
}
.empty-title { color: #1f2d24; font-size: 29rpx; font-weight: 700; }
.empty-copy { margin-top: 10rpx; color: #7d8980; font-size: 23rpx; }
</style>
