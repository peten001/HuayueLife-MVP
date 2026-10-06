<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { merchantName, localizedName, useI18n } from '@/i18n';
import { resolveMediaUrl } from '@/utils/media';
import { merchantDiscoveryPhotos, merchantServiceBadges } from '@/utils/merchant-discovery';
import { resolveContentTemplate } from '@/utils/merchant-content-template';
import type { MerchantSummary } from '@/types/api';
import NetworkImage from './NetworkImage.vue';
const props = defineProps<{ merchant: MerchantSummary }>();
defineEmits<{ select: [merchant: MerchantSummary] }>();
const { locale, t } = useI18n();
const failedPhotos = ref<Set<string>>(new Set());
const photos = computed(() => merchantDiscoveryPhotos(props.merchant));
const imageUrl = computed(() => resolveMediaUrl(photos.value.find(url => !failedPhotos.value.has(url))));
watch(() => photos.value.join('|'), () => { failedPhotos.value = new Set(); });
function imageFailed() {
  const url = photos.value.find(item => !failedPhotos.value.has(item));
  if (url) failedPhotos.value = new Set([...failedPhotos.value, url]);
}
const serviceTags = computed(() => merchantServiceBadges(props.merchant, resolveContentTemplate(props.merchant) === 'RESTAURANT')
  .map(badge => ({ key: badge.code, label: t(badge.labelKey) }))
  .filter(tag => tag.label));
const promotion = computed(() => props.merchant.promotionTags?.[0]);
const distance = computed(() => typeof props.merchant.distanceKm === 'number' && Number.isFinite(props.merchant.distanceKm) ? `${props.merchant.distanceKm.toFixed(1)} km` : '');
</script>
<template>
  <view class="discovery-card" role="button" :aria-label="merchantName(props.merchant, locale)" @tap="$emit('select', props.merchant)">
    <view class="discovery-photo">
      <NetworkImage v-if="imageUrl" class="discovery-image" :src="imageUrl" variant="card" mode="aspectFill" :lazy-load="true" @error="imageFailed" />
      <!-- i18n-check-allow avatar-initial: use the current localized merchant name. -->
      <view v-else class="discovery-image discovery-placeholder"><text>{{ merchantName(props.merchant, locale).slice(0, 1) }}</text></view>
      <text :class="['discovery-photo-status', { open: props.merchant.isOpen }]"><text class="status-dot" />{{ props.merchant.isOpen ? t('merchantOpen') : t('merchantClosed') }}</text>
    </view>
    <view class="discovery-copy">
      <text class="discovery-name">{{ merchantName(props.merchant, locale) }}</text>
      <text v-if="promotion" class="discovery-promotion">{{ localizedName(promotion, locale) }}</text>
      <view v-if="serviceTags.length || distance" class="discovery-meta">
        <view v-if="serviceTags.length" class="discovery-services"><text v-for="tag in serviceTags" :key="tag.key" class="discovery-service">{{ tag.label }}</text></view>
        <text v-if="distance" class="discovery-distance">{{ distance }}</text>
      </view>
    </view>
  </view>
</template>
<style scoped>
/* finesse · component=merchant-discovery-card · photo-led truthful local commerce */
.discovery-card { overflow: hidden; border-radius: var(--explore-radius); background: #fff; min-width: 0; box-shadow: 0 4rpx 16rpx rgba(86,68,37,.04); }
.discovery-card:active { opacity: .88; }
.discovery-photo { position: relative; }
.discovery-image { display: block; width: 100%; height: 290rpx; background: #f5eee0; }
.discovery-placeholder { display: flex; align-items: center; justify-content: center; color: var(--explore-green); font-size: 48rpx; }
.discovery-photo-status { position: absolute; bottom: 12rpx; left: 12rpx; display: flex; align-items: center; gap: 7rpx; max-width: calc(100% - 24rpx); padding: 5rpx 11rpx; border-radius: 10rpx; color: #fff; background: rgba(24,36,28,.75); font-size: 12px; line-height: 1.4; box-sizing: border-box; }
.status-dot { flex: none; width: 8rpx; height: 8rpx; border-radius: 50%; background: #d6d6ce; }
.discovery-photo-status.open .status-dot { background: #abe2a4; }
.discovery-copy { padding: 16rpx; }
.discovery-name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 29rpx; line-height: 1.4; font-weight: 700; overflow-wrap: anywhere; color: var(--explore-ink); }
.discovery-promotion { display: inline-block; max-width: 100%; margin-top: 10rpx; padding: 4rpx 10rpx; border-radius: 8rpx; color: #7c511c; background: #fff0ce; font-size: 12px; font-weight: 600; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; box-sizing: border-box; }
.discovery-meta { display: flex; flex-direction: column; align-items: stretch; gap: 8rpx; margin-top: 12rpx; color: var(--explore-muted); font-size: 22rpx; line-height: 1.5; }
.discovery-services { display: flex; min-width: 0; flex-wrap: wrap; gap: 8rpx; }
.discovery-service { max-width: 100%; padding: 5rpx 10rpx; border-radius: 8rpx; background: #eaf7ee; color: var(--explore-green); font-size: 24rpx; line-height: 1.5; overflow-wrap: anywhere; box-sizing: border-box; }
.discovery-distance { align-self: flex-end; }
@media (max-width: 360px) { .discovery-name { font-size: 13px; } .discovery-meta, .discovery-service { font-size: 12px; } }
</style>
