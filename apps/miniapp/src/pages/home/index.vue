<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import MerchantCard from '@/components/MerchantCard.vue';
import { getNearbyMerchants } from '@/api/catalog';
import { cityOptions, localeLabel, useI18n, usePageTitle } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { useLocationStore } from '@/stores/location';
import type { MerchantSummary } from '@/types/api';

const auth = useAuthStore();
const locationStore = useLocationStore();
const { locale, t } = useI18n();
const cities = computed(() => cityOptions(locale.value));
const merchants = ref<MerchantSummary[]>([]);
const loading = ref(false);

const cityIndex = computed({
  get: () => {
    const index = cities.value.findIndex((city) => city.value === locationStore.city);
    return index >= 0 ? index : 0;
  },
  set: (value: number) => {
    const city = cities.value[value]?.value;
    if (city === 'Bac Giang' || city === 'Bac Ninh') {
      locationStore.setCity(city);
    }
  },
});

const currentCityLabel = computed(
  () => cities.value.find((city) => city.value === locationStore.city)?.label || locationStore.city,
);

usePageTitle(() => t('homeTitle'));

onShow(() => {
  void refreshHome(false);
});

async function refreshHome(forceRelocate: boolean) {
  auth.ensureLogin().catch(() => undefined);
  loading.value = true;
  try {
    const city = forceRelocate
      ? await locationStore.relocate()
      : await locationStore.bootstrapCity();
    try {
      await loadByCity(city);
    } catch {
      merchants.value = [];
    }
  } finally {
    loading.value = false;
  }
}

async function loadByCity(city: 'Bac Giang' | 'Bac Ninh') {
  const result = await getNearbyMerchants({
    city,
    page: 1,
  });
  merchants.value = result.items;
}

async function changeCity(event: { detail: { value: string } }) {
  loading.value = true;
  try {
    cityIndex.value = Number(event.detail.value);
    await loadByCity(locationStore.city);
  } finally {
    loading.value = false;
  }
}

async function relocate() {
  await refreshHome(true);
}

function openMerchant(merchant: MerchantSummary) {
  uni.navigateTo({ url: `/pages/merchant/detail?id=${merchant.id}` });
}

function scan() {
  uni.scanCode({
    scanType: ['qrCode'],
    success(result) {
      const token = extractToken(result.result);
      if (!token) {
        uni.showToast({ title: t('qrMissingToken'), icon: 'none' });
        return;
      }
      uni.navigateTo({
        url: `/pages/scan/resolve?token=${encodeURIComponent(token)}`,
      });
    },
  });
}

function extractToken(value: string) {
  if (/^[a-f0-9]{64}$/.test(value)) return value;
  const matched = value.match(/[?&]token=([a-f0-9]{64})/);
  return matched?.[1] ?? '';
}
</script>

<template>
  <view class="page">
    <view class="hero">
      <view>
        <text class="eyebrow">{{ localeLabel(locale) }}</text>
        <text class="title">{{ t('appName') }}</text>
      </view>
      <picker range-key="label" :range="cities" :value="cityIndex" @change="changeCity">
        <view class="city">{{ cities[cityIndex]?.label }} ▾</view>
      </picker>
    </view>

    <button class="scan-button" @click="scan">
      <text class="scan-title">{{ t('scanOrder') }}</text>
      <text class="scan-copy">{{ t('scanSubtitle') }}</text>
    </button>

    <view class="section-head">
      <view>
        <text class="section-title">{{ t('nearbyMerchants') }}</text>
        <text class="mode">{{ t('currentCity') }}：{{ currentCityLabel }}</text>
      </view>
      <button class="location-button" @click="relocate">{{ t('relocate') }}</button>
    </view>

    <view v-if="loading" class="empty">{{ t('loading') }}</view>
    <view v-else-if="!merchants.length" class="empty">{{ t('noMerchants') }}</view>
    <MerchantCard
      v-for="merchant in merchants"
      :key="merchant.id"
      :merchant="merchant"
      @select="openMerchant"
    />
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 32rpx 28rpx 60rpx; background: #f6f3ef; }
.hero { display: flex; align-items: center; justify-content: space-between; margin: 18rpx 0 34rpx; }
.eyebrow { display: block; color: #9b6a54; font-size: 22rpx; letter-spacing: 2rpx; }
.title { display: block; margin-top: 8rpx; font-size: 48rpx; font-weight: 800; }
.city { padding: 14rpx 20rpx; border-radius: 999rpx; background: #fff; font-size: 26rpx; }
.scan-button { display: flex; align-items: flex-start; flex-direction: column; padding: 30rpx; margin-bottom: 36rpx; border: 0; border-radius: 24rpx; color: #fff; background: linear-gradient(135deg, #b83228, #d45a3d); text-align: left; }
.scan-title { font-size: 36rpx; font-weight: 700; }
.scan-copy { margin-top: 8rpx; opacity: .85; font-size: 24rpx; }
.section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18rpx; }
.section-title { display: block; font-size: 34rpx; font-weight: 700; }
.mode { display: block; margin-top: 4rpx; color: #8a817c; font-size: 22rpx; }
.location-button { padding: 10rpx 18rpx; border: 1rpx solid #d8cec8; border-radius: 999rpx; background: transparent; font-size: 22rpx; line-height: 1.5; }
.empty { padding: 80rpx 0; color: #888; text-align: center; }
</style>
