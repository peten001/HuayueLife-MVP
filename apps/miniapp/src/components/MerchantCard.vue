<script setup lang="ts">
import type { MerchantSummary } from '@/types/api';

defineProps<{ merchant: MerchantSummary }>();
defineEmits<{ select: [merchant: MerchantSummary] }>();

const labels = {
  DINE_IN: '堂食',
  PICKUP: '自取',
  DELIVERY: '配送',
};
</script>

<template>
  <view class="merchant-card" @click="$emit('select', merchant)">
    <image
      v-if="merchant.coverUrl"
      class="cover"
      :src="merchant.coverUrl"
      mode="aspectFill"
    />
    <view v-else class="cover placeholder">餐厅</view>
    <view class="body">
      <view class="row">
        <text class="name">{{ merchant.nameZh }}</text>
        <text :class="['status', merchant.isOpen ? 'open' : 'closed']">
          {{ merchant.isOpen ? '营业中' : '休息中' }}
        </text>
      </view>
      <text class="address">{{ merchant.addressDetail }}</text>
      <view class="row meta">
        <text v-if="merchant.distanceKm !== null">{{ merchant.distanceKm }} km</text>
        <view class="tags">
          <text v-for="type in merchant.supportedOrderTypes" :key="type" class="tag">
            {{ labels[type] }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.merchant-card { display: flex; gap: 20rpx; padding: 22rpx; margin-bottom: 20rpx; border-radius: 20rpx; background: #fff; }
.cover { width: 180rpx; height: 150rpx; flex: none; border-radius: 14rpx; }
.placeholder { display: flex; align-items: center; justify-content: center; color: #fff; background: #c43b2f; }
.body { min-width: 0; flex: 1; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; }
.name { font-size: 32rpx; font-weight: 700; }
.status { flex: none; font-size: 22rpx; }
.open { color: #18854b; }
.closed { color: #888; }
.address { display: block; margin: 14rpx 0; overflow: hidden; color: #777; font-size: 24rpx; text-overflow: ellipsis; white-space: nowrap; }
.meta { color: #666; font-size: 24rpx; }
.tags { display: flex; gap: 8rpx; }
.tag { padding: 4rpx 9rpx; border-radius: 8rpx; color: #a83228; background: #fff0ed; font-size: 20rpx; }
</style>
