<script setup lang="ts">
import { computed, ref } from 'vue';
import { locale, orderTypeLabel, useI18n } from '@/i18n';
import type { MerchantReview } from '@/types/api';
import { resolveMediaUrl } from '@/utils/media';

const props = defineProps<{
  review: MerchantReview;
}>();

const { t } = useI18n();
const starLevels = [1, 2, 3, 4, 5] as const;
const avatarFailed = ref(false);
const failedImageIds = ref<Set<string>>(new Set());
const authorDisplayName = computed(() => {
  if (props.review.isAnonymous) return t('anonymousUser');
  return props.review.author.displayName?.trim() || t('wechatUser');
});
const authorInitial = computed(() => Array.from(authorDisplayName.value)[0] ?? '?');
const imageItems = computed(() => props.review.images.flatMap((image) => {
  const resolvedUrl = resolveMediaUrl(image.imageUrl);
  return resolvedUrl ? [{ ...image, resolvedUrl }] : [];
}));
const dateLabel = computed(() => {
  const language = locale.value === 'vi' ? 'vi-VN' : locale.value === 'en' ? 'en-US' : 'zh-CN';
  return new Date(props.review.createdAt).toLocaleDateString(language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
});

function previewImage(current: string) {
  const urls = imageItems.value
    .filter((image) => !failedImageIds.value.has(image.id))
    .map((image) => image.resolvedUrl);
  if (urls.includes(current)) uni.previewImage({ current, urls });
}

function markImageFailed(imageId: string) {
  failedImageIds.value = new Set([...failedImageIds.value, imageId]);
}
</script>

<template>
  <view class="review-card">
    <view class="review-head">
      <image
        v-if="review.author.avatarUrl && !avatarFailed"
        class="review-avatar"
        :src="resolveMediaUrl(review.author.avatarUrl)"
        mode="aspectFill"
        @error="avatarFailed = true"
      />
      <view v-else class="review-avatar review-avatar-fallback">{{ authorInitial }}</view>
      <view class="review-author">
        <text class="review-name">{{ authorDisplayName }}</text>
        <view class="review-score" :aria-label="`${review.rating} / 5`">
          <text
            v-for="level in starLevels"
            :key="level"
            :class="['review-star', { active: level <= review.rating }]"
          >★</text>
        </view>
      </view>
      <text class="review-date">{{ dateLabel }}</text>
    </view>

    <text v-if="review.content" class="review-content">{{ review.content }}</text>

    <view
      v-if="imageItems.length"
      :class="['review-images', { single: imageItems.length === 1 }]"
    >
      <button
        v-for="(image, index) in imageItems"
        :key="image.id"
        class="review-image-button"
        :aria-label="t('reviewPhoto', { index: index + 1 })"
        :disabled="failedImageIds.has(image.id)"
        @tap="previewImage(image.resolvedUrl)"
      >
        <image
          v-if="!failedImageIds.has(image.id)"
          class="review-image"
          :src="image.resolvedUrl"
          mode="aspectFill"
          lazy-load
          @error="markImageFailed(image.id)"
        />
        <view v-else class="review-image-fallback">
          <text class="review-image-fallback-mark">▧</text>
          <text>{{ t('reviewImageLoadFailed') }}</text>
        </view>
      </button>
    </view>

    <text class="review-order-type">{{ orderTypeLabel(review.orderType, locale) }} · {{ t('reviewOrderContext') }}</text>
  </view>
</template>

<style scoped>
.review-card {
  padding: 28rpx 0;
  border-bottom: 1rpx solid #edf2ee;
}

.review-card:last-child {
  padding-bottom: 4rpx;
  border-bottom: 0;
}

.review-head {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.review-avatar {
  width: 68rpx;
  height: 68rpx;
  flex: none;
  border-radius: 50%;
  background: #eaf7ee;
}

.review-avatar-fallback {
  display: grid;
  place-items: center;
  color: #2e7d32;
  font-size: 25rpx;
  font-weight: 800;
}

.review-author {
  min-width: 0;
  display: grid;
  flex: 1;
  gap: 5rpx;
}

.review-name {
  overflow: hidden;
  color: #1f2d24;
  font-size: 25rpx;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-score {
  display: flex;
  gap: 2rpx;
}

.review-star {
  color: #dfe5e0;
  font-size: 22rpx;
  line-height: 1;
}

.review-star.active {
  color: #f4a62a;
}

.review-date {
  flex: none;
  color: #849087;
  font-size: 20rpx;
}

.review-content {
  display: block;
  margin-top: 18rpx;
  color: #35433a;
  font-size: 25rpx;
  line-height: 1.62;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.review-images {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10rpx;
  margin-top: 18rpx;
}

.review-images.single {
  width: 66%;
  grid-template-columns: 1fr;
}

.review-image-button {
  width: 100%;
  height: 194rpx;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 18rpx;
  background: #eef5ef;
  line-height: 1;
}

.review-image-button::after {
  border: 0;
}

.review-image {
  width: 100%;
  height: 100%;
  display: block;
}

.review-image-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  padding: 14rpx;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 6rpx;
  color: #77847b;
  background: #eef5ef;
  font-size: 20rpx;
  line-height: 1.3;
  box-sizing: border-box;
}

.review-image-fallback-mark {
  color: #9aaa9e;
  font-size: 34rpx;
}

.review-order-type {
  display: inline-flex;
  margin-top: 16rpx;
  padding: 6rpx 12rpx;
  border-radius: 999rpx;
  color: #667169;
  background: #f2f6f3;
  font-size: 20rpx;
  line-height: 1.3;
}
</style>
