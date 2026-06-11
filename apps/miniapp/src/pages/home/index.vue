<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import MerchantCard from '@/components/MerchantCard.vue';
import { getNearbyMerchants } from '@/api/catalog';
import { cityOptions, localeLabel, useI18n, usePageTitle } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import type { MerchantSummary } from '@/types/api';

const auth = useAuthStore();
const { locale, t } = useI18n();
const cities = computed(() => cityOptions(locale.value));
const cityIndex = ref(0);
const merchants = ref<MerchantSummary[]>([]);
const loading = ref(false);
const locationMode = ref<'GPS' | 'CITY'>('CITY');
const message = ref('');

usePageTitle(() => t('homeTitle'));

onMounted(async () => {
  auth.ensureLogin().catch(() => undefined);
  await loadByLocation();
});

async function loadByLocation() {
  loading.value = true;
  message.value = '';
  try {
    const location = await new Promise<UniApp.GetLocationSuccess>((resolve, reject) => {
      uni.getLocation({
        type: 'wgs84',
        success: resolve,
        fail: reject,
      });
    });
    const result = await getNearbyMerchants({
      lat: location.latitude,
      lng: location.longitude,
      radiusKm: 10,
      page: 1,
    });
    merchants.value = result.items;
    locationMode.value = result.locationMode;
  } catch {
    await loadByCity();
    message.value = t('noLocation');
  } finally {
    loading.value = false;
  }
}

async function loadByCity() {
  const result = await getNearbyMerchants({
    city: cities.value[cityIndex.value]?.value,
    page: 1,
  });
  merchants.value = result.items;
  locationMode.value = 'CITY';
}

async function changeCity(event: { detail: { value: string } }) {
  cityIndex.value = Number(event.detail.value);
  loading.value = true;
  try {
    await loadByCity();
    message.value = t('currentByCity', { city: cities.value[cityIndex.value]?.label });
  } finally {
    loading.value = false;
  }
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
        <text class="mode">
          {{ locationMode === 'GPS' ? t('locationByDistance') : t('locationByCity') }}
        </text>
      </view>
      <button class="location-button" @click="loadByLocation">{{ t('relocate') }}</button>
    </view>
    <text v-if="message" class="message">{{ message }}</text>
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
.message { display: block; margin-bottom: 16rpx; color: #9b6a54; font-size: 23rpx; }
.empty { padding: 80rpx 0; color: #888; text-align: center; }
</style>
