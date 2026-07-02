<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getMerchant } from '@/api/catalog';
import {
  merchantName,
  orderTypeLabel,
  useI18n,
  usePageTitle,
} from '@/i18n';
import { useCartStore } from '@/stores/cart';
import type { MerchantDetail } from '@/types/api';
import { isFavorite, toggleFavorite } from '@/utils/favorites';
import { addMerchantBrowsingHistory } from '@/utils/browsing-history';
import { requireLoginForAction } from '@/utils/login-guard';
import { resolveMediaUrl } from '@/utils/media';

const cartStore = useCartStore();
const merchant = ref<MerchantDetail | null>(null);
const error = ref('');
const { locale, t } = useI18n();
const favoriteState = ref(false);
const favoriteLabel = computed(() => (favoriteState.value ? t('saved') : t('saveFavorite')));
const enabledCapabilityCodes = computed(() =>
  new Set(
    (merchant.value?.capabilities ?? [])
      .filter((item) => item.isEnabled)
      .map((item) => item.code),
  ),
);
const hasCapabilityRecords = computed(() => Boolean(merchant.value?.capabilities?.length));
const canPhone = computed(() => hasCapability('phoneEnabled', true));
const canNavigate = computed(() => hasCapability('navigationEnabled', true));
const canShowGallery = computed(() => hasCapability('imageGalleryEnabled', true));
const canPickup = computed(() =>
  hasCapabilityRecords.value
    ? (merchant.value?.pickupEnabled ?? enabledCapabilityCodes.value.has('pickupEnabled'))
    : Boolean(merchant.value?.supportedOrderTypes.includes('PICKUP')),
);
const canDelivery = computed(() =>
  hasCapabilityRecords.value
    ? (merchant.value?.deliveryEnabled ?? enabledCapabilityCodes.value.has('deliveryEnabled'))
    : Boolean(merchant.value?.supportedOrderTypes.includes('DELIVERY')),
);
const hasDineInTag = computed(() =>
  merchant.value?.dineInEnabled ?? Boolean(merchant.value?.supportedOrderTypes.includes('DINE_IN')),
);
const canScanOrder = computed(() =>
  hasCapabilityRecords.value
    ? (merchant.value?.qrOrderEnabled ?? enabledCapabilityCodes.value.has('qrOrderEnabled'))
    : Boolean(merchant.value?.supportedOrderTypes.includes('DINE_IN')),
);
const displayAddress = computed(() => {
  if (!merchant.value) return '';
  if (locale.value === 'vi') return merchant.value.addressVi || merchant.value.addressDetail;
  if (locale.value === 'en') return merchant.value.addressEn || merchant.value.addressDetail;
  return merchant.value.addressZh || merchant.value.addressDetail;
});
const displayDescription = computed(() => {
  if (!merchant.value) return '';
  if (locale.value === 'vi') return merchant.value.descriptionVi || merchant.value.descriptionZh || '';
  if (locale.value === 'en') return merchant.value.descriptionEn || merchant.value.descriptionZh || '';
  return merchant.value.descriptionZh || merchant.value.notice || '';
});
const displayTags = computed(() => merchant.value?.promotionTags?.map((item) => item.nameZh) ?? []);
const galleryImages = computed(() =>
  canShowGallery.value
    ? (merchant.value?.images ?? []).filter((item) =>
        ['STORE', 'ENVIRONMENT', 'PRODUCT', 'MENU'].includes(item.imageType),
      )
    : [],
);

usePageTitle(() => t('merchantDetailTitle'));

onLoad(async (options) => {
  try {
    merchant.value = await getMerchant(String(options?.id ?? ''));
    favoriteState.value = isFavorite(merchant.value.id);
    addMerchantBrowsingHistory(merchant.value);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : '';
    if (
      message.includes('Merchant not found or unavailable') ||
      message.includes('商家不存在') ||
      message.includes('商家不可用')
    ) {
      error.value = t('merchantUnavailable');
      return;
    }
    error.value = caught instanceof Error ? caught.message : t('merchantLoadFailed');
  }
});

function handleToggleFavorite() {
  if (!merchant.value) return;
  void requireLoginForAction('favorite', () => {
    if (!merchant.value) return;
    const result = toggleFavorite(merchant.value);
    favoriteState.value = result.saved;
    uni.showToast({
      title: result.saved ? t('favoriteSavedToast') : t('favoriteRemovedToast'),
      icon: 'none',
    });
  });
}

async function openMenu(orderType: 'PICKUP' | 'DELIVERY') {
  if (!merchant.value) return;
  const merchantId = merchant.value.id;
  const url = `/pages/menu/index?merchantId=${merchantId}&orderType=${orderType}`;
  const nextContext = {
    merchantId,
    merchantName: merchantName(merchant.value, locale.value),
    orderType,
  };
  console.log('[merchant/detail] tap open menu', {
    merchantId,
    orderType,
    currentContext: cartStore.context,
    cart: cartStore.cart,
    hasItems: cartStore.hasItems(),
    needsContextSwitch: cartStore.needsContextSwitch(nextContext),
    nextContext,
    url,
  });
  try {
    console.log('[merchant/detail] before ensureLoaded', {
      merchantId,
      orderType,
      currentContext: cartStore.context,
      cart: cartStore.cart,
      hasItems: cartStore.hasItems(),
      needsSwitch: cartStore.needsContextSwitch(nextContext),
    });
    await cartStore.ensureLoaded();
    console.log('[merchant/detail] after ensureLoaded', {
      currentContext: cartStore.context,
      cart: cartStore.cart,
      hasItems: cartStore.hasItems(),
      needsSwitch: cartStore.needsContextSwitch(nextContext),
    });
    const needsSwitch = cartStore.needsContextSwitch(nextContext);
    const hasItems = cartStore.hasItems();
    console.log('[merchant/detail] switch decision', {
      merchantId,
      orderType,
      currentContext: cartStore.context,
      cart: cartStore.cart,
      hasItems,
      needsSwitch,
      nextContext,
    });
    if (needsSwitch && hasItems) {
      console.log('[merchant/detail] show confirm modal', {
        merchantId,
        orderType,
      });
      const confirmed = await confirmSwitch();
      console.log('[merchant/detail] confirm result', {
        merchantId,
        orderType,
        confirmed,
      });
      if (!confirmed) {
        return;
      }
      try {
        await cartStore.clearCart();
      } catch (error) {
        console.error('[merchant/detail] clearCart failed', {
          merchantId,
          orderType,
          currentContext: cartStore.context,
          nextContext,
          error,
        });
        uni.showToast({ title: t('cartContextSwitchError'), icon: 'none' });
        return;
      }
    }
    const result = await cartStore.switchContext(nextContext);
    console.log('[merchant/detail] switchContext result', {
      merchantId,
      orderType,
      result,
      currentContext: cartStore.context,
      nextContext,
    });
    if (result === 'failed') {
      console.error('[merchant/detail] switch context failed', {
        merchantId,
        orderType,
        currentContext: cartStore.context,
        nextContext,
      });
      uni.showToast({ title: t('cartContextSwitchError'), icon: 'none' });
      return;
    }
    uni.navigateTo({
      url,
      fail(error) {
        console.log('[merchant/detail] navigateTo failed', error);
        uni.showToast({ title: t('navigationFailed'), icon: 'none' });
      },
    });
  } catch (error) {
    console.error('[merchant/detail] openMenu failed', error);
    uni.showToast({ title: t('cartContextSwitchError'), icon: 'none' });
  }
}

function confirmSwitch() {
  return new Promise<boolean>((resolve, reject) => {
    try {
      uni.showModal({
        title: t('switchSceneTitle'),
        content: t('switchSceneContent'),
        confirmText: t('switchSceneConfirm'),
        cancelText: t('switchSceneCancel'),
        success: (result) => resolve(result.confirm),
        fail: (error) => {
          console.error('[merchant/detail] confirmSwitch failed', error);
          reject(error);
        },
      });
    } catch (error) {
      console.error('[merchant/detail] confirmSwitch threw', error);
      reject(error);
    }
  });
}

function merchantLocation() {
  if (!merchant.value) return null;
  const latitude = Number(merchant.value.latitude);
  const longitude = Number(merchant.value.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function handleAddressTap() {
  const location = merchantLocation();
  if (!location || !merchant.value) {
    uni.showToast({ title: t('merchantLocationMissing'), icon: 'none' });
    return;
  }
  const merchantValue = merchant.value;
  void (async () => {
    const shouldContinue = await new Promise<boolean>((resolve) => {
      uni.showModal({
        title: t('navigationRecommendationTitle'),
        content: t('navigationRecommendationContent'),
        confirmText: t('continueNavigation'),
        cancelText: t('cancel'),
        success: (result) => resolve(Boolean(result.confirm)),
        fail: () => resolve(false),
      });
    });

    if (!shouldContinue) return;

    uni.openLocation({
      ...location,
      name: merchantName(merchantValue, locale.value),
      address: merchantValue.addressDetail,
      scale: 16,
      fail(error) {
        console.warn('[merchant/detail] openLocation failed', error);
        uni.showToast({ title: t('miniappMapOpenFailed'), icon: 'none' });
      },
    });
  })();
}

function handlePhoneTap() {
  const phoneNumber = merchant.value?.contactPhone?.replace(/\s+/g, '') ?? '';
  if (!phoneNumber) {
    uni.showToast({ title: t('merchantPhoneMissing'), icon: 'none' });
    return;
  }
  uni.makePhoneCall({
    phoneNumber,
    fail(error) {
      console.warn('[merchant/detail] makePhoneCall failed', error);
      uni.showToast({ title: t('merchantPhoneCallFailed'), icon: 'none' });
    },
  });
}

function hasCapability(code: string, fallbackValue: boolean) {
  if (!hasCapabilityRecords.value) return fallbackValue;
  return enabledCapabilityCodes.value.has(code);
}
</script>

<template>
  <view class="page">
    <view v-if="error" class="error">{{ error }}</view>
    <template v-else-if="merchant">
      <view class="cover-wrap">
        <image
          v-if="resolveMediaUrl(merchant.coverUrl)"
          class="cover"
          :src="resolveMediaUrl(merchant.coverUrl)"
          mode="aspectFill"
        />
        <view v-else class="cover placeholder">
          <view class="placeholder-mark">🍽️</view>
          <text>{{ t('imagePlaceholder') }}</text>
        </view>
      </view>
      <view class="card">
        <view class="headline">
          <view class="headline-main">
            <text class="title">{{ merchantName(merchant, locale) }}</text>
            <text :class="['status', merchant.isOpen ? 'open' : 'closed']">
              {{ merchant.isOpen ? t('merchantOpen') : t('merchantClosed') }}
            </text>
          </view>
          <button class="favorite-button" @tap="handleToggleFavorite">
            {{ favoriteLabel }}
          </button>
        </view>
        <view v-if="canNavigate" class="info-line info-action" @tap="handleAddressTap">
          <text class="info-icon">📍</text>
          <text class="info-text">{{ displayAddress }}</text>
          <text class="info-link">{{ t('mapNavigation') }}</text>
        </view>
        <view v-if="canPhone" class="info-line info-action" @tap="handlePhoneTap">
          <text class="info-icon">📞</text>
          <text class="info-text">{{ t('phone') }}：{{ merchant.contactPhone }}</text>
          <text class="info-link">{{ t('callMerchant') }}</text>
        </view>
        <view v-if="merchant.openingHoursText" class="notice">营业时间：{{ merchant.openingHoursText }}</view>
        <view v-if="displayDescription" class="notice">{{ displayDescription }}</view>
        <view v-if="displayTags.length" class="tags">
          <text v-for="tag in displayTags" :key="tag" class="tag">{{ tag }}</text>
        </view>
        <view v-if="galleryImages.length" class="gallery">
          <image
            v-for="image in galleryImages"
            :key="image.id"
            class="gallery-image"
            :src="resolveMediaUrl(image.imageUrl)"
            mode="aspectFill"
          />
        </view>
        <view class="tags">
          <text v-if="hasDineInTag" class="tag">
            {{ t('dineIn') }}
          </text>
          <text
            v-for="type in merchant.supportedOrderTypes.filter((item) => item !== 'DINE_IN')"
            :key="type"
            class="tag"
          >
            {{ orderTypeLabel(type, locale) }}
          </text>
          <text v-if="canScanOrder" class="tag">
            {{ t('inStoreScanOrder') }}
          </text>
        </view>
      </view>
      <view class="actions">
        <button
          v-if="canPickup && merchant.supportedOrderTypes.includes('PICKUP')"
          type="button"
          class="primary pickup"
          @tap="openMenu('PICKUP')"
        >
          {{ t('pickup') }}
        </button>
        <button
          v-if="canDelivery && merchant.supportedOrderTypes.includes('DELIVERY')"
          type="button"
          class="primary delivery"
          @tap="openMenu('DELIVERY')"
        >
          {{ t('delivery') }}
        </button>
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

.error {
  padding: 22rpx 24rpx;
  border-radius: 20rpx;
  color: #8a5a00;
  background: #fff3dd;
  font-size: 23rpx;
}

.cover-wrap {
  overflow: hidden;
  border-radius: 30rpx;
  box-shadow: 0 14rpx 36rpx rgb(46 125 50 / 9%);
}

.cover {
  width: 100%;
  height: 380rpx;
  display: block;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 14rpx;
  color: #2e7d32;
  background: linear-gradient(135deg, #eaf7ee, #bde5c2);
  font-size: 23rpx;
}

.placeholder-mark {
  display: grid;
  width: 116rpx;
  height: 116rpx;
  place-items: center;
  border: 10rpx solid rgb(255 255 255 / 70%);
  border-radius: 50%;
  color: #2e7d32;
  background: #ffcf83;
  font-size: 42rpx;
  font-weight: 800;
  box-sizing: border-box;
}

.card {
  padding: 30rpx 28rpx;
  margin: 22rpx 0;
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 12rpx 32rpx rgb(46 125 50 / 7%);
}

.headline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20rpx;
}

.headline-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.title {
  min-width: 0;
  color: #1f2d24;
  font-size: 40rpx;
  font-weight: 800;
}

.favorite-button {
  flex: none;
  margin: 0;
  padding: 10rpx 18rpx;
  border: 0;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1.5;
}

.favorite-button::after {
  border: 0;
}

.status {
  flex: none;
  padding: 8rpx 14rpx;
  border-radius: 999rpx;
  font-size: 21rpx;
  font-weight: 700;
}

.open {
  color: #2e7d32;
  background: #eaf7ee;
}

.closed {
  color: #a66400;
  background: #fff1dc;
}

.info-line {
  display: flex;
  align-items: flex-start;
  gap: 13rpx;
  margin-top: 20rpx;
  color: #666;
  font-size: 24rpx;
  line-height: 1.55;
}

.info-action {
  align-items: center;
}

.info-text {
  min-width: 0;
  flex: 1;
}

.info-link {
  flex: none;
  padding: 7rpx 12rpx;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 21rpx;
  font-weight: 700;
}

.info-icon {
  display: grid;
  width: 42rpx;
  height: 42rpx;
  flex: none;
  place-items: center;
  border-radius: 13rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 18rpx;
  font-weight: 700;
}

.notice {
  padding: 18rpx 20rpx;
  margin-top: 20rpx;
  border-radius: 18rpx;
  color: #7b5a16;
  background: #fff8e1;
  font-size: 23rpx;
  line-height: 1.6;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 22rpx;
}

.gallery {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14rpx;
  margin-top: 22rpx;
}

.gallery-image {
  width: 100%;
  height: 180rpx;
  border-radius: 18rpx;
  background: #edf5ee;
}

.tag {
  padding: 7rpx 13rpx;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 21rpx;
}

.actions {
  display: flex;
  gap: 18rpx;
}

.actions button {
  height: 92rpx;
  min-height: 92rpx;
  flex: 1;
  margin: 0;
  padding: 0 18rpx;
  border: 2rpx solid transparent;
  border-radius: 24rpx;
  font-size: 30rpx;
  font-weight: 700;
  line-height: 88rpx;
  box-sizing: border-box;
}

.actions button::after {
  border: 0;
}

.primary {
  color: #fff;
  background: #2e7d32;
}

.delivery {
  border: 2rpx solid #43a047;
  color: #2e7d32;
  background: #fff;
}
</style>
