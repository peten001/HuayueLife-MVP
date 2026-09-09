<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import MerchantReviewCard from '@/components/MerchantReviewCard.vue';
import { getOrder } from '@/api/orders';
import {
  createReview,
  getOwnReview,
  uploadReviewImage,
} from '@/api/reviews';
import {
  locale,
  merchantName,
  productSnapshotName,
  translateApiError,
  useI18n,
  usePageTitle,
} from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import type { OwnMerchantReview, UserOrder } from '@/types/api';

type SelectedImage = {
  localPath: string;
  remoteToken?: string;
};

const auth = useAuthStore();
const { t } = useI18n();
const orderId = ref('');
const order = ref<UserOrder>();
const existingReview = ref<OwnMerchantReview>();
const reviewLoadFailed = ref(false);
const rating = ref(0);
const content = ref('');
const isAnonymous = ref(false);
const images = ref<SelectedImage[]>([]);
const loading = ref(true);
const submitting = ref(false);
const message = ref('');
const starLevels = [1, 2, 3, 4, 5] as const;

const ratingLabel = computed(() => {
  if (rating.value === 1) return t('reviewRating1');
  if (rating.value === 2) return t('reviewRating2');
  if (rating.value === 3) return t('reviewRating3');
  if (rating.value === 4) return t('reviewRating4');
  if (rating.value === 5) return t('reviewRating5');
  return t('reviewRatingRequired');
});
const existingReviewTitle = computed(() =>
  existingReview.value?.status === 'HIDDEN' ? t('reviewHidden') : t('reviewSubmitted'),
);
const existingReviewCopy = computed(() =>
  existingReview.value?.status === 'HIDDEN'
    ? t('reviewHiddenHint')
    : t('reviewAlreadySubmitted'),
);

const orderItemSummary = computed(() => {
  if (!order.value) return '';
  const names = order.value.items
    .slice(0, 3)
    .map((item) => productSnapshotName(item, locale.value));
  const remaining = order.value.items.length - names.length;
  return remaining > 0 ? `${names.join('、')} +${remaining}` : names.join('、');
});

usePageTitle(() => existingReview.value ? t('viewReview') : t('reviewMerchant'));

onLoad((options) => {
  orderId.value = String(options?.orderId ?? '');
  void load();
});

async function load() {
  if (!orderId.value) {
    message.value = t('reviewUnavailable');
    loading.value = false;
    return;
  }
  loading.value = true;
  message.value = '';
  reviewLoadFailed.value = false;
  existingReview.value = undefined;
  try {
    await auth.ensureLogin();
    order.value = await getOrder(orderId.value);
    if (order.value.review) {
      try {
        existingReview.value = await getOwnReview(orderId.value);
      } catch (caught) {
        reviewLoadFailed.value = true;
        message.value = caught instanceof Error
          ? translateApiError(caught.message)
          : t('reviewLoadFailed');
      }
    }
  } catch (caught) {
    message.value = caught instanceof Error
      ? translateApiError(caught.message)
      : t('reviewLoadFailed');
  } finally {
    loading.value = false;
  }
}

function selectRating(value: number) {
  if (submitting.value) return;
  rating.value = value;
}

function chooseImages() {
  const remaining = 6 - images.value.length;
  if (remaining <= 0 || submitting.value) return;
  uni.chooseImage({
    count: remaining,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success(result) {
      const paths = Array.isArray(result.tempFilePaths)
        ? result.tempFilePaths.map(String)
        : [];
      images.value = [
        ...images.value,
        ...paths.map((localPath) => ({ localPath })),
      ].slice(0, 6);
    },
  });
}

function previewSelectedImage(current: string) {
  uni.previewImage({
    current,
    urls: images.value.map((image) => image.localPath),
  });
}

function removeImage(index: number) {
  if (submitting.value) return;
  images.value.splice(index, 1);
}

function handleAnonymousChange(event: Event) {
  const detail = (event as Event & { detail?: { value?: boolean } }).detail;
  isAnonymous.value = Boolean(detail?.value);
}

async function submit() {
  if (!order.value || submitting.value) return;
  if (!rating.value) {
    uni.showToast({ title: t('reviewRatingRequired'), icon: 'none' });
    return;
  }

  submitting.value = true;
  message.value = '';
  uni.showLoading({ title: t('submittingReview'), mask: true });
  try {
    await auth.ensureLogin();
    const imageTokens = await Promise.all(images.value.map(async (image) => {
      if (image.remoteToken) return image.remoteToken;
      const remoteToken = await uploadReviewImage(order.value!.id, image.localPath);
      image.remoteToken = remoteToken;
      return remoteToken;
    }));
    existingReview.value = await createReview(order.value.id, {
      rating: rating.value,
      content: content.value.trim() || undefined,
      isAnonymous: isAnonymous.value,
      imageTokens,
    });
    order.value = {
      ...order.value,
      canReview: false,
      review: {
        id: existingReview.value.id,
        rating: existingReview.value.rating,
        status: existingReview.value.status,
        createdAt: existingReview.value.createdAt,
      },
    };
    uni.showToast({ title: t('reviewSubmitted'), icon: 'success' });
  } catch (caught) {
    const errorMessage = caught instanceof Error
      ? translateApiError(caught.message)
      : t('reviewSubmitFailed');
    images.value.forEach((image) => {
      delete image.remoteToken;
    });
    await load();
    if (!existingReview.value) message.value = errorMessage;
  } finally {
    uni.hideLoading();
    submitting.value = false;
  }
}
</script>

<template>
  <view :class="['page', { 'has-submit-bar': order?.canReview && !existingReview }]">
    <view v-if="loading" class="state-card">
      <view class="state-mark loading-mark" />
      <text class="state-title">{{ t('loading') }}</text>
    </view>

    <view v-else-if="message && !order" class="state-card">
      <view class="state-mark">!</view>
      <text class="state-title">{{ message }}</text>
      <button class="retry-button" @tap="load">{{ t('retry') }}</button>
    </view>

    <template v-else-if="order">
      <view class="review-intro">
        <text class="intro-kicker">{{ t('reviewOrderContext') }}</text>
        <text class="merchant-name">{{ merchantName(order.merchant, locale) }}</text>
        <text class="order-items">{{ orderItemSummary }}</text>
        <text class="review-hint">{{ t('reviewMerchantHint') }}</text>
      </view>

      <view v-if="message && !reviewLoadFailed" class="message">{{ message }}</view>

      <view v-if="reviewLoadFailed" class="state-card compact">
        <view class="state-mark">!</view>
        <text class="state-title">{{ message }}</text>
        <button class="retry-button" @tap="load">{{ t('retry') }}</button>
      </view>

      <view v-else-if="existingReview" class="existing-review">
        <view class="published-row">
          <view class="published-check">{{ existingReview.status === 'HIDDEN' ? '!' : '✓' }}</view>
          <view>
            <text class="published-title">{{ existingReviewTitle }}</text>
            <text class="published-copy">{{ existingReviewCopy }}</text>
          </view>
        </view>
        <MerchantReviewCard :review="existingReview" />
      </view>

      <template v-else-if="order.canReview">
        <view class="rating-section">
          <text class="section-title">{{ t('reviewRating') }}</text>
          <view class="rating-stars" :aria-label="ratingLabel">
            <button
              v-for="level in starLevels"
              :key="level"
              :class="['rating-star', { active: level <= rating }]"
              :aria-label="`${level} / 5`"
              :aria-pressed="level === rating"
              @tap="selectRating(level)"
            >★</button>
          </view>
          <text :class="['rating-label', { selected: rating > 0 }]">{{ ratingLabel }}</text>
        </view>

        <view class="form-section">
          <view class="section-heading">
            <text class="section-title">{{ t('reviewContent') }}</text>
            <text class="character-count">{{ content.length }}/1000</text>
          </view>
          <textarea
            v-model="content"
            class="review-textarea"
            :placeholder="t('reviewContentPlaceholder')"
            :maxlength="1000"
            :disabled="submitting"
          />
        </view>

        <view class="form-section">
          <view class="section-heading photo-heading">
            <view>
              <text class="section-title">{{ t('reviewPhotos') }}</text>
              <text class="section-subtitle">{{ t('reviewPhotosHint') }}</text>
            </view>
            <text class="photo-count">{{ images.length }}/6</text>
          </view>
          <view class="photo-grid">
            <view v-for="(image, index) in images" :key="image.localPath" class="photo-item">
              <button
                class="photo-preview"
                :aria-label="t('reviewPhoto', { index: index + 1 })"
                @tap="previewSelectedImage(image.localPath)"
              >
                <image class="photo-image" :src="image.localPath" mode="aspectFill" />
              </button>
              <button
                class="photo-remove"
                :aria-label="t('removeReviewPhoto', { index: index + 1 })"
                @tap="removeImage(index)"
              ><text class="photo-remove-glyph">×</text></button>
            </view>
            <button
              v-if="images.length < 6"
              class="photo-add"
              :disabled="submitting"
              @tap="chooseImages"
            >
              <text class="photo-add-mark">＋</text>
              <text>{{ t('reviewPhotos') }}</text>
            </button>
          </view>
        </view>

        <view class="privacy-row">
          <view class="privacy-copy">
            <text class="privacy-title">{{ t('anonymousReview') }}</text>
            <text class="privacy-hint">{{ t('anonymousReviewHint') }}</text>
          </view>
          <switch
            :checked="isAnonymous"
            color="#43A047"
            :disabled="submitting"
            @change="handleAnonymousChange"
          />
        </view>

        <text class="window-hint">{{ t('reviewWindowHint') }}</text>

        <view class="submit-bar">
          <button class="submit-button" :disabled="submitting" @tap="submit">
            {{ submitting ? t('submittingReview') : t('submitReview') }}
          </button>
        </view>
      </template>

      <view v-else class="state-card compact">
        <view class="state-mark">!</view>
        <text class="state-title">{{ t('reviewUnavailable') }}</text>
        <text class="state-copy">{{ t('reviewWindowHint') }}</text>
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

.page.has-submit-bar {
  padding-bottom: calc(152rpx + env(safe-area-inset-bottom));
}

.review-intro,
.rating-section,
.form-section,
.privacy-row,
.existing-review,
.state-card {
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 12rpx 32rpx rgb(31 45 36 / 7%);
}

.review-intro {
  padding: 28rpx;
  margin-bottom: 20rpx;
}

.intro-kicker {
  display: block;
  color: #2e7d32;
  font-size: 21rpx;
  font-weight: 700;
}

.merchant-name {
  display: block;
  margin-top: 10rpx;
  color: #1f2d24;
  font-size: 34rpx;
  font-weight: 800;
  line-height: 1.35;
}

.order-items {
  display: block;
  overflow: hidden;
  margin-top: 9rpx;
  color: #637067;
  font-size: 22rpx;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-hint {
  display: block;
  padding-top: 18rpx;
  margin-top: 18rpx;
  border-top: 1rpx solid #edf2ee;
  color: #718077;
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
  line-height: 1.5;
}

.rating-section,
.form-section {
  padding: 28rpx;
  margin-bottom: 20rpx;
}

.section-title {
  color: #1f2d24;
  font-size: 28rpx;
  font-weight: 800;
}

.rating-stars {
  display: flex;
  justify-content: center;
  gap: 10rpx;
  margin-top: 28rpx;
}

.rating-star {
  width: 88rpx;
  height: 88rpx;
  min-height: 88rpx;
  display: grid;
  margin: 0;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 24rpx;
  color: #dfe5e0;
  background: #f4f7f5;
  font-size: 52rpx;
  line-height: 1;
  transition: transform 150ms ease, color 150ms ease, background-color 150ms ease;
}

.rating-star::after,
.photo-preview::after,
.photo-remove::after,
.photo-add::after,
.retry-button::after,
.submit-button::after {
  border: 0;
}

.rating-star.active {
  color: #f4a62a;
  background: #fff6e5;
}

.rating-star:active {
  transform: scale(.92);
}

.rating-label {
  display: block;
  margin-top: 18rpx;
  color: #8a958d;
  font-size: 23rpx;
  text-align: center;
}

.rating-label.selected {
  color: #9a6500;
  font-weight: 700;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
}

.character-count,
.photo-count {
  color: #8a958d;
  font-size: 20rpx;
}

.review-textarea {
  width: 100%;
  min-height: 250rpx;
  padding: 22rpx;
  margin-top: 20rpx;
  border-radius: 20rpx;
  color: #26352b;
  background: #f6faf7;
  font-size: 25rpx;
  line-height: 1.6;
  box-sizing: border-box;
}

.photo-heading {
  align-items: flex-start;
}

.section-subtitle {
  display: block;
  margin-top: 7rpx;
  color: #7b877f;
  font-size: 20rpx;
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14rpx;
  margin-top: 22rpx;
}

.photo-item {
  position: relative;
  height: 190rpx;
}

.photo-preview,
.photo-add {
  width: 100%;
  height: 190rpx;
  min-height: 190rpx;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 20rpx;
  background: #eef5ef;
}

.photo-image {
  width: 100%;
  height: 100%;
  display: block;
}

.photo-remove {
  position: absolute;
  top: -30rpx;
  right: -30rpx;
  z-index: 2;
  width: 88rpx;
  height: 88rpx;
  min-height: 88rpx;
  display: grid;
  margin: 0;
  padding: 0;
  place-items: center;
  border: 0;
  background: transparent;
  line-height: 1;
}

.photo-remove-glyph {
  width: 48rpx;
  height: 48rpx;
  display: grid;
  place-items: center;
  border: 4rpx solid #fff;
  border-radius: 50%;
  color: #fff;
  background: #4c5a50;
  font-size: 28rpx;
  line-height: 1;
  box-sizing: border-box;
}

.photo-add {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8rpx;
  color: #5e6d63;
  font-size: 21rpx;
}

.photo-add-mark {
  color: #2e7d32;
  font-size: 43rpx;
  line-height: 1;
}

.privacy-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  padding: 26rpx 28rpx;
}

.privacy-copy {
  min-width: 0;
  display: grid;
  gap: 7rpx;
}

.privacy-title {
  font-size: 26rpx;
  font-weight: 700;
}

.privacy-hint,
.window-hint,
.state-copy {
  color: #7a867d;
  font-size: 21rpx;
  line-height: 1.5;
}

.window-hint {
  display: block;
  margin-top: 20rpx;
  text-align: center;
}

.submit-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 10;
  padding: 18rpx 24rpx calc(18rpx + env(safe-area-inset-bottom));
  border-top: 1rpx solid #e7efe9;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 -12rpx 30rpx rgb(31 45 36 / 8%);
}

.submit-button,
.retry-button {
  min-height: 92rpx;
  margin: 0;
  border: 0;
  border-radius: 24rpx;
  color: #fff;
  background: #2e7d32;
  font-size: 27rpx;
  font-weight: 800;
  line-height: 92rpx;
}

.submit-button[disabled] {
  opacity: .55;
}

.state-card {
  min-height: 360rpx;
  display: flex;
  padding: 60rpx 36rpx;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
  box-sizing: border-box;
}

.state-card.compact {
  min-height: 300rpx;
}

.state-mark {
  width: 82rpx;
  height: 82rpx;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #9a6500;
  background: #fff3dd;
  font-size: 34rpx;
  font-weight: 800;
}

.loading-mark {
  border: 6rpx solid #dcecdf;
  border-top-color: #43a047;
  background: transparent;
  animation: spin 900ms linear infinite;
  box-sizing: border-box;
}

.state-title {
  margin-top: 22rpx;
  color: #1f2d24;
  font-size: 27rpx;
  font-weight: 700;
  line-height: 1.5;
}

.state-copy {
  margin-top: 8rpx;
}

.retry-button {
  min-width: 220rpx;
  margin-top: 24rpx;
  padding: 0 34rpx;
}

.existing-review {
  padding: 28rpx;
}

.published-row {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding-bottom: 24rpx;
  border-bottom: 1rpx solid #edf2ee;
}

.published-check {
  width: 64rpx;
  height: 64rpx;
  display: grid;
  flex: none;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #43a047;
  font-size: 30rpx;
  font-weight: 800;
}

.published-title,
.published-copy {
  display: block;
}

.published-title {
  font-size: 28rpx;
  font-weight: 800;
}

.published-copy {
  margin-top: 5rpx;
  color: #77837a;
  font-size: 21rpx;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
