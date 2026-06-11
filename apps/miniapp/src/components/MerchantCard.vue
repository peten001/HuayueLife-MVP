<script setup lang="ts">
import { computed } from 'vue';
import { merchantName, orderTypeLabel, useI18n } from '@/i18n';
import type { MerchantSummary } from '@/types/api';

const props = defineProps<{ merchant: MerchantSummary }>();
defineEmits<{ select: [merchant: MerchantSummary] }>();

const { locale, t } = useI18n();
const title = computed(() => merchantName(props.merchant));
</script>

<template>
  <view class="merchant-card" @click="$emit('select', props.merchant)">
    <image
      v-if="props.merchant.coverUrl"
      class="cover"
      :src="props.merchant.coverUrl"
      mode="aspectFill"
    />
    <view v-else class="cover placeholder">{{ t('restaurant') }}</view>
    <view class="body">
      <view class="row">
        <text class="name">{{ title }}</text>
        <text :class="['status', props.merchant.isOpen ? 'open' : 'closed']">
          {{ props.merchant.isOpen ? t('merchantOpen') : t('merchantClosed') }}
        </text>
      </view>
      <text class="address">{{ props.merchant.addressDetail }}</text>
      <view class="row meta">
        <text v-if="props.merchant.distanceKm !== null">{{ props.merchant.distanceKm }} km</text>
        <view class="tags">
          <text v-for="type in props.merchant.supportedOrderTypes" :key="type" class="tag">
            {{ orderTypeLabel(type, locale) }}
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
