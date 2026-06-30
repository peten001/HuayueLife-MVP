<script setup lang="ts">
import { computed } from 'vue';
import { merchantName, orderTypeLabel, useI18n } from '@/i18n';
import type { MerchantSummary } from '@/types/api';
import { resolveMediaUrl } from '@/utils/media';

const props = withDefaults(
  defineProps<{
    merchant: MerchantSummary;
    variant?: 'default' | 'compact';
    localeClass?: string;
  }>(),
  {
    variant: 'default',
    localeClass: 'zh',
  },
);
defineEmits<{ select: [merchant: MerchantSummary] }>();

const { locale, t } = useI18n();
const title = computed(() => merchantName(props.merchant));
type ServiceTag = {
  key: string;
  label: string;
};
const canShowScanOrderTag = computed(() =>
  props.merchant.qrOrderEnabled ??
  props.merchant.supportedOrderTypes.includes('DINE_IN'),
);
const serviceTags = computed<ServiceTag[]>(() => {
  const tags: ServiceTag[] = props.merchant.supportedOrderTypes.map((type) => ({
    key: type,
    label: orderTypeLabel(type, locale.value),
  }));
  if (canShowScanOrderTag.value) {
    tags.push({
      key: 'SCAN_TO_ORDER',
      label: t('inStoreScanOrder'),
    });
  }
  return tags;
});
</script>

<template>
  <view
    :class="['merchant-card', `merchant-card--${props.variant}`, `merchant-card--${props.localeClass}`]"
    @click="$emit('select', props.merchant)"
  >
    <image
      v-if="resolveMediaUrl(props.merchant.coverUrl)"
      class="cover"
      :src="resolveMediaUrl(props.merchant.coverUrl)"
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
      <view v-if="props.merchant.distanceKm !== null" class="distance-row">
        <text>{{ props.merchant.distanceKm }} km</text>
      </view>
      <view v-if="serviceTags.length" class="tags">
        <view
          v-for="(tag, index) in serviceTags"
          :key="tag.key"
          :class="['tag', { 'tag--truncate': index === serviceTags.length - 1 }]"
        >
          <text :class="['tag-text', { 'tag-text--truncate': index === serviceTags.length - 1 }]">
            {{ tag.label }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.merchant-card {
  display: flex;
  gap: 18rpx;
  padding: 18rpx;
  margin-bottom: 16rpx;
  border-radius: 22rpx;
  background: #fff;
  box-shadow: 0 10rpx 24rpx rgb(46 125 50 / 6%);
}
.cover { width: 164rpx; height: 164rpx; flex: none; border-radius: 16rpx; }
.body { min-width: 0; flex: 1; }
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #2f9e44;
  background: #eaf7ed;
  font-weight: 700;
}
.row { display: flex; align-items: center; justify-content: space-between; gap: 10rpx; }
.name { font-size: 30rpx; font-weight: 700; }
.status { flex: none; font-size: 22rpx; }
.open { color: #18854b; }
.closed { color: #888; }
.address { display: block; margin: 10rpx 0 12rpx; overflow: hidden; color: #777; font-size: 23rpx; text-overflow: ellipsis; white-space: nowrap; }
.distance-row {
  margin-bottom: 10rpx;
  color: #666;
  font-size: 23rpx;
}
.tags {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-start;
  gap: 8rpx;
  overflow: hidden;
  background: transparent;
}
.tag {
  flex: 0 0 auto;
  width: auto;
  max-width: none;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6rpx 12rpx;
  border-radius: 999rpx;
  color: #2f9e44;
  background: #eaf7ed;
  font-size: 20rpx;
}
.tag--truncate {
  flex: 0 1 auto;
  width: auto;
  max-width: 220rpx;
  overflow: hidden;
}
.tag-text {
  white-space: nowrap;
}
.tag-text--truncate {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.merchant-card--compact {
  gap: 12rpx;
  padding: 12rpx;
  margin-bottom: 10rpx;
  border-radius: 14px;
}

.merchant-card--compact .cover {
  width: 152rpx;
  height: 152rpx;
  border-radius: 10px;
}

.merchant-card--compact .name {
  font-size: 18px;
}

.merchant-card--compact.merchant-card--vi .row {
  align-items: flex-start;
}

.merchant-card--compact.merchant-card--vi .name {
  display: -webkit-box;
  font-size: 16px;
  line-height: 1.2;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.merchant-card--compact .status {
  font-size: 12px;
}

.merchant-card--compact.merchant-card--vi .status {
  font-size: 11px;
}

.merchant-card--compact .address {
  margin: 6rpx 0 8rpx;
  font-size: 13px;
}

.merchant-card--compact .distance-row {
  margin-bottom: 8rpx;
  font-size: 12px;
}

.merchant-card--compact .tag {
  padding: 4rpx 8rpx;
  font-size: 11px;
}

.merchant-card--compact.merchant-card--vi .tag {
  font-size: 10.5px;
  padding: 4rpx 7rpx;
}

.merchant-card--compact .tags {
  gap: 4rpx;
}

.merchant-card--compact .tag--truncate {
  max-width: 160rpx;
}
</style>
