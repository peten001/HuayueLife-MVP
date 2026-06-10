<script setup lang="ts">
import { onMounted, ref } from 'vue';
import MerchantCard from '@/components/MerchantCard.vue';
import { getNearbyMerchants } from '@/api/catalog';
import { useAuthStore } from '@/stores/auth';
import type { MerchantSummary } from '@/types/api';

const auth = useAuthStore();
const cities = ['北宁', '北江'];
const cityIndex = ref(0);
const merchants = ref<MerchantSummary[]>([]);
const loading = ref(false);
const locationMode = ref<'GPS' | 'CITY'>('CITY');
const message = ref('');

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
    message.value = '未获得定位，已按所选城市展示餐厅';
  } finally {
    loading.value = false;
  }
}

async function loadByCity() {
  const result = await getNearbyMerchants({
    city: cities[cityIndex.value],
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
    message.value = `当前按${cities[cityIndex.value]}展示`;
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
        uni.showToast({ title: '无法识别桌台二维码', icon: 'none' });
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
        <text class="eyebrow">北宁 / 北江华人餐厅</text>
        <text class="title">华越优选</text>
      </view>
      <picker :range="cities" :value="cityIndex" @change="changeCity">
        <view class="city">{{ cities[cityIndex] }} ▾</view>
      </picker>
    </view>

    <button class="scan-button" @click="scan">
      <text class="scan-title">扫码点餐</text>
      <text class="scan-copy">扫描桌面二维码进入餐厅菜单</text>
    </button>

    <view class="section-head">
      <view>
        <text class="section-title">附近商家</text>
        <text class="mode">{{ locationMode === 'GPS' ? '按距离排序' : '按城市展示' }}</text>
      </view>
      <button class="location-button" @click="loadByLocation">重新定位</button>
    </view>
    <text v-if="message" class="message">{{ message }}</text>
    <view v-if="loading" class="empty">加载中...</view>
    <view v-else-if="!merchants.length" class="empty">当前区域暂无可用餐厅</view>
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
