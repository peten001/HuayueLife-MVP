<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { localizedName, merchantName, useI18n } from '@/i18n';
import type { MerchantSummary } from '@/types/api';
import { resolveMediaUrl } from '@/utils/media';
import { resolveContentTemplate } from '@/utils/merchant-content-template';
import { merchantServiceBadges } from '@/utils/merchant-discovery';
import NetworkImage from './NetworkImage.vue';

const props = withDefaults(
  defineProps<{
    merchant: MerchantSummary;
    variant?: 'default' | 'compact' | 'browse';
    localeClass?: string;
    hideLocationAndCategory?: boolean;
  }>(),
  {
    variant: 'default',
    localeClass: 'zh',
    hideLocationAndCategory: false,
  },
);
defineEmits<{ select: [merchant: MerchantSummary] }>();

const { locale, t } = useI18n();
const title = computed(() => merchantName(props.merchant));
const coverUrl = computed(() => resolveMediaUrl(props.merchant.coverUrl || props.merchant.logoUrl));
const imageFailed = ref(false);
watch(coverUrl, () => { imageFailed.value = false; });
const industryLabel = computed(() => props.merchant.businessType ? localizedName(props.merchant.businessType, locale.value) : '');
const serviceTags = computed(() => merchantServiceBadges(props.merchant, resolveContentTemplate(props.merchant) === 'RESTAURANT')
  .map(badge => ({ key: badge.code, label: t(badge.labelKey) }))
  .filter(tag => tag.label));
</script>

<template>
  <view
    :class="['merchant-card', `merchant-card--${props.variant}`, `merchant-card--${props.localeClass}`]"
    role="button"
    :aria-label="title"
    @click="$emit('select', props.merchant)"
  >
    <NetworkImage
      v-if="coverUrl && !imageFailed"
      class="cover"
      :src="coverUrl"
      variant="card"
      mode="aspectFill"
      :lazy-load="true"
      @error="imageFailed = true"
    />
    <!-- i18n-check-allow avatar-initial: use the current localized merchant name. -->
    <view v-else class="cover placeholder">{{ title.slice(0, 1) }}</view>
    <view class="body">
      <view class="row">
        <text class="name">{{ title }}</text>
        <text :class="['status', props.merchant.isOpen ? 'open' : 'closed']">
          {{ props.merchant.isOpen ? t('merchantOpen') : t('merchantClosed') }}
        </text>
      </view>
      <text v-if="props.variant !== 'browse' && !props.hideLocationAndCategory && industryLabel" class="industry">{{ industryLabel }}</text>
      <text v-if="!props.hideLocationAndCategory" class="address">{{ props.merchant.addressDetail }}</text>
      <view v-if="props.merchant.distanceKm !== null" class="distance-row">
        <text>{{ props.merchant.distanceKm }} km</text>
      </view>
      <view v-if="serviceTags.length" class="tags">
        <view
          v-for="tag in serviceTags"
          :key="tag.key"
          class="tag"
        >
          <text class="tag-text">
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
.merchant-card:active { opacity: .88; }
.cover { width: 164rpx; height: 164rpx; flex: none; border-radius: 16rpx; }
.body { min-width: 0; flex: 1; }
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #2e7d32;
  background: #eaf7ed;
  font-weight: 700;
}
.row { display: flex; align-items: center; justify-content: space-between; gap: 10rpx; }
.name { min-width: 0; flex: 1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; font-size: 30rpx; font-weight: 700; }
.industry { display: block; margin-top: 6rpx; color: #53675a; font-size: 23rpx; line-height: 1.5; }
.status { flex: none; font-size: 22rpx; }
.open { color: #18854b; }
.closed { color: #66736b; }
.address { display: block; margin: 10rpx 0 12rpx; overflow: hidden; color: #66736b; font-size: 23rpx; text-overflow: ellipsis; white-space: nowrap; }
.distance-row {
  margin-bottom: 10rpx;
  color: #666;
  font-size: 23rpx;
}
.tags {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 8rpx;
  background: transparent;
}
.tag {
  flex: 0 0 auto;
  width: auto;
  max-width: 100%;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6rpx 12rpx;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #eaf7ed;
  font-size: 20rpx;
}
.tag-text {
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.5;
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

.merchant-card--browse { align-items: flex-start; gap: 16rpx; padding: 16rpx 14rpx; margin-bottom: 12rpx; border-radius: 24rpx; box-shadow: none; }
.merchant-card--browse .cover { width: 164rpx; height: 164rpx; border-radius: 18rpx; }
.merchant-card--browse .row { align-items: flex-start; }
.merchant-card--browse .tags { flex-wrap: wrap; gap: 8rpx; margin-top: 12rpx; }
.merchant-card--browse { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif; }
.merchant-card--browse .name { font-size: 32rpx; font-weight: 600; line-height: 1.4; letter-spacing: 0; }
.merchant-card--browse .address { margin: 10rpx 0 0; font-size: 23rpx; line-height: 1.5; color: #737d76; }
.merchant-card--browse .status { margin-top: 4rpx; font-size: 20rpx; font-weight: 400; line-height: 1.5; }
.merchant-card--browse .tag { font-size: 21rpx; font-weight: 400; padding: 4rpx 10rpx; }
@media (max-width: 360px) { .merchant-card--browse .cover { width: 148rpx; height: 148rpx; } .merchant-card--browse .status { font-size: 11px; } }
</style>
