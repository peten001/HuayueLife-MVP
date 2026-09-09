<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onReachBottom } from '@dcloudio/uni-app';
import MerchantReviewCard from '@/components/MerchantReviewCard.vue';
import { getMerchantReviews } from '@/api/reviews';
import { locale, merchantName, translateApiError, useI18n, usePageTitle } from '@/i18n';
import type { MerchantReview, MerchantReviewPage } from '@/types/api';

const { t } = useI18n();
const merchantId = ref('');
const merchant = ref<MerchantReviewPage['merchant']>();
const summary = ref<MerchantReviewPage['summary']>();
const reviews = ref<MerchantReview[]>([]);
const page = ref(1);
const hasMore = ref(false);
const loading = ref(true);
const loadingMore = ref(false);
const message = ref('');
const starLevels = [1, 2, 3, 4, 5] as const;

const averageLabel = computed(() => summary.value?.averageRating?.toFixed(1) ?? '—');
const summaryRows = computed(() => {
  const total = summary.value?.total ?? 0;
  return [5, 4, 3, 2, 1].map((rating) => {
    const count = summary.value?.distribution[String(rating) as '1' | '2' | '3' | '4' | '5'] ?? 0;
    return {
      rating,
      count,
      percentage: total ? Math.round((count / total) * 100) : 0,
    };
  });
});

usePageTitle(() => merchant.value
  ? `${merchantName(merchant.value, locale.value)} · ${t('customerReviews')}`
  : t('customerReviews'));

onLoad((options) => {
  merchantId.value = String(options?.merchantId ?? '');
  void loadPage(1);
});

onReachBottom(() => {
  if (hasMore.value && !loadingMore.value) void loadPage(page.value + 1);
});

async function loadPage(targetPage: number) {
  if (!merchantId.value) {
    message.value = t('reviewLoadFailed');
    loading.value = false;
    return;
  }
  targetPage === 1 ? loading.value = true : loadingMore.value = true;
  message.value = '';
  try {
    const result = await getMerchantReviews(merchantId.value, targetPage);
    merchant.value = result.merchant;
    summary.value = result.summary;
    reviews.value = targetPage === 1
      ? result.items
      : [...reviews.value, ...result.items];
    page.value = result.page;
    hasMore.value = result.hasMore;
  } catch (caught) {
    message.value = caught instanceof Error
      ? translateApiError(caught.message)
      : t('reviewLoadFailed');
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}
</script>

<template>
  <view class="page">
    <view v-if="message && summary" class="message">{{ message }}</view>

    <view v-if="loading" class="loading-card">
      <view class="loading-line wide" />
      <view class="loading-line" />
      <view class="loading-line short" />
    </view>

    <view v-else-if="message && !summary" class="error-card">
      <view class="error-mark">!</view>
      <text class="error-title">{{ message }}</text>
      <button class="retry-button" @tap="loadPage(1)">{{ t('retry') }}</button>
    </view>

    <template v-else-if="summary">
      <view class="summary-card">
        <view class="summary-score">
          <text class="average">{{ averageLabel }}</text>
          <view class="summary-stars" :aria-label="`${averageLabel} / 5`">
            <text
              v-for="level in starLevels"
              :key="level"
              :class="['summary-star', { active: level <= Math.round(summary.averageRating ?? 0) }]"
            >★</text>
          </view>
          <text class="review-total">{{ t('reviewCount', { count: summary.total }) }}</text>
        </view>

        <view class="distribution">
          <view v-for="row in summaryRows" :key="row.rating" class="distribution-row">
            <text class="distribution-label">{{ row.rating }}★</text>
            <view class="distribution-track">
              <view class="distribution-fill" :style="{ width: `${row.percentage}%` }" />
            </view>
            <text class="distribution-value">{{ row.percentage }}%</text>
          </view>
        </view>
      </view>

      <view v-if="reviews.length" class="reviews-card">
        <MerchantReviewCard
          v-for="review in reviews"
          :key="review.id"
          :review="review"
        />
        <button
          v-if="hasMore"
          class="load-more"
          :disabled="loadingMore"
          @tap="loadPage(page + 1)"
        >{{ loadingMore ? t('loading') : t('reviewLoadMore') }}</button>
        <text v-else class="review-end">{{ t('reviewNoMore') }}</text>
      </view>

      <view v-else class="empty-card">
        <view class="empty-stars">★★★★★</view>
        <text class="empty-title">{{ t('noReviews') }}</text>
        <text class="empty-copy">{{ t('noReviewsHint') }}</text>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24rpx 24rpx calc(48rpx + env(safe-area-inset-bottom));
  color: #1f2d24;
  background: #f6faf7;
  box-sizing: border-box;
}

.summary-card,
.reviews-card,
.empty-card,
.loading-card,
.error-card {
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 12rpx 32rpx rgb(31 45 36 / 7%);
}

.summary-card {
  display: grid;
  grid-template-columns: 220rpx minmax(0, 1fr);
  gap: 32rpx;
  padding: 32rpx 28rpx;
  align-items: center;
}

.summary-score {
  display: flex;
  align-items: center;
  flex-direction: column;
}

.average {
  color: #9a6500;
  font-size: 66rpx;
  font-weight: 800;
  line-height: 1;
}

.summary-stars {
  display: flex;
  gap: 2rpx;
  margin-top: 14rpx;
}

.summary-star {
  color: #dfe5e0;
  font-size: 25rpx;
}

.summary-star.active {
  color: #f4a62a;
}

.review-total {
  margin-top: 9rpx;
  color: #78847b;
  font-size: 22rpx;
}

.distribution {
  display: grid;
  gap: 9rpx;
}

.distribution-row {
  display: grid;
  grid-template-columns: 42rpx minmax(0, 1fr) 55rpx;
  align-items: center;
  gap: 10rpx;
}

.distribution-label,
.distribution-value {
  color: #78847b;
  font-size: 20rpx;
}

.distribution-value {
  text-align: right;
}

.distribution-track {
  height: 10rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: #edf2ee;
}

.distribution-fill {
  height: 100%;
  min-width: 0;
  border-radius: inherit;
  background: #f4a62a;
}

.reviews-card {
  padding: 2rpx 28rpx 24rpx;
  margin-top: 20rpx;
}

.load-more {
  width: 100%;
  min-height: 88rpx;
  margin: 22rpx 0 0;
  border: 0;
  border-radius: 20rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 23rpx;
  font-weight: 700;
}

.load-more::after {
  border: 0;
}

.review-end {
  display: block;
  padding-top: 25rpx;
  color: #8b958e;
  font-size: 20rpx;
  text-align: center;
}

.empty-card {
  display: flex;
  min-height: 360rpx;
  padding: 58rpx 36rpx;
  margin-top: 20rpx;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
  box-sizing: border-box;
}

.empty-stars {
  color: #dfe5e0;
  font-size: 34rpx;
  letter-spacing: 5rpx;
}

.empty-title {
  margin-top: 22rpx;
  font-size: 28rpx;
  font-weight: 800;
}

.empty-copy {
  max-width: 480rpx;
  margin-top: 9rpx;
  color: #78847b;
  font-size: 22rpx;
  line-height: 1.55;
}

.message {
  padding: 18rpx 22rpx;
  margin-bottom: 20rpx;
  border-radius: 18rpx;
  color: #8a5a00;
  background: #fff3dd;
  font-size: 22rpx;
}

.loading-card {
  padding: 38rpx 30rpx;
}

.error-card {
  min-height: 360rpx;
  display: flex;
  padding: 54rpx 36rpx;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
  box-sizing: border-box;
}

.error-mark {
  width: 72rpx;
  height: 72rpx;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #9a6500;
  background: #fff3dd;
  font-size: 34rpx;
  font-weight: 800;
}

.error-title {
  max-width: 520rpx;
  margin-top: 20rpx;
  color: #516057;
  font-size: 23rpx;
  line-height: 1.55;
}

.retry-button {
  min-width: 220rpx;
  min-height: 88rpx;
  margin: 28rpx 0 0;
  padding: 0 34rpx;
  border: 0;
  border-radius: 22rpx;
  color: #fff;
  background: #2e7d32;
  font-size: 24rpx;
  font-weight: 700;
  line-height: 88rpx;
}

.retry-button::after {
  border: 0;
}

.loading-line {
  width: 62%;
  height: 24rpx;
  margin-top: 18rpx;
  border-radius: 12rpx;
  background: #e7f0e9;
  animation: pulse 1.4s ease-in-out infinite;
}

.loading-line.wide {
  width: 78%;
  height: 46rpx;
  margin-top: 0;
}

.loading-line.short {
  width: 38%;
}

@keyframes pulse {
  50% { opacity: .5; }
}

@media (max-width: 360px) {
  .summary-card {
    grid-template-columns: 180rpx minmax(0, 1fr);
    gap: 20rpx;
  }
}
</style>
