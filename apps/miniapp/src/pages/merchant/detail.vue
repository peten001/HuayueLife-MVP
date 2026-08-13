<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app';
import { getMerchant } from '@/api/catalog';
import {
  formatNumberCurrency,
  localizedName,
  localizedText,
  merchantName,
  useI18n,
  usePageTitle,
} from '@/i18n';
import { useAppConfigStore } from '@/stores/app-config';
import { useCartStore } from '@/stores/cart';
import type { MerchantDetail } from '@/types/api';
import { isFavorite, toggleFavorite } from '@/utils/favorites';
import { addMerchantBrowsingHistory } from '@/utils/browsing-history';
import { wgs84ToGcj02 } from '@/utils/coordinates';
import { requireLoginForAction } from '@/utils/login-guard';
import { resolveMediaUrl } from '@/utils/media';
import { resolveMerchantOrderingVisibility } from '@/utils/merchant-ordering-visibility';

const cartStore = useCartStore();
const appConfig = useAppConfigStore();
const merchant = ref<MerchantDetail | null>(null);
const merchantId = ref('');
const error = ref('');
const errorRetryable = ref(true);
const loading = ref(true);
const activeHeroIndex = ref(0);
const activeGalleryCategory = ref<ClaimedGalleryKey | ''>('');
const viewportWidth = ref(390);
const signatureExpanded = ref(false);
const hotExpanded = ref(false);
const merchantNavStyle = ref<Record<string, string>>({});
const failedMediaUrls = ref<Set<string>>(new Set());
const { locale, t } = useI18n();
const merchantNavTitle = computed(() => t('merchantDetailTitle'));
const favoriteState = ref(false);
const favoriteLabel = computed(() => (favoriteState.value ? t('saved') : t('saveFavorite')));
const capabilityByCode = computed(() =>
  new Map((merchant.value?.capabilities ?? []).map((item) => [item.code, item])),
);
const enabledCapabilityCodes = computed(() =>
  new Set(
    (merchant.value?.capabilities ?? [])
      .filter((item) => item.isEnabled)
      .map((item) => item.code),
  ),
);
const hasCapabilityRecords = computed(() => Boolean(merchant.value?.capabilities?.length));
const canPhone = computed(() =>
  Boolean(merchant.value?.contactPhone?.trim()) && hasCapability('phoneEnabled', true),
);
const canNavigate = computed(() =>
  Boolean(merchantLocation()) && hasCapability('navigationEnabled', true),
);
const canShowGallery = computed(() => hasCapability('imageGalleryEnabled', true));
const orderingVisibility = computed(() =>
  resolveMerchantOrderingVisibility({
    merchantMode: merchant.value?.merchantMode,
    claimStatus: merchant.value?.claimStatus,
    isOpen: Boolean(merchant.value?.isOpen),
    platformOrderingEnabled: appConfig.platformOrderingEnabled,
    hasCapabilityRecords: hasCapabilityRecords.value,
    pickupEnabled: merchant.value?.pickupEnabled,
    deliveryEnabled: merchant.value?.deliveryEnabled,
    dineInEnabled: merchant.value?.dineInEnabled,
    qrOrderEnabled: merchant.value?.qrOrderEnabled,
    enabledCapabilityCodes: enabledCapabilityCodes.value,
    supportedOrderTypes: merchant.value?.supportedOrderTypes ?? [],
  }),
);
const canOpenPickup = computed(() => orderingVisibility.value.pickupCtaVisible);
const canOpenDelivery = computed(() => orderingVisibility.value.deliveryCtaVisible);
const hasBottomCta = computed(() => canOpenPickup.value || canOpenDelivery.value);
const displayAddress = computed(() => {
  if (!merchant.value) return '';
  if (locale.value === 'vi') {
    return merchant.value.addressVi || merchant.value.addressZh || merchant.value.addressEn || merchant.value.addressDetail;
  }
  if (locale.value === 'en') {
    return merchant.value.addressEn || merchant.value.addressVi || merchant.value.addressZh || merchant.value.addressDetail;
  }
  return merchant.value.addressZh || merchant.value.addressVi || merchant.value.addressEn || merchant.value.addressDetail;
});
const displayDescription = computed(() => {
  if (!merchant.value) return '';
  return localizedText(merchant.value, locale.value);
});
const displayBusinessType = computed(() =>
  merchant.value?.businessType ? localizedName(merchant.value.businessType, locale.value) : '',
);
const displayTags = computed(() =>
  merchant.value?.detailDisplayTags
    ?.map((item) => ({ id: item.id, label: localizedName(item, locale.value) }))
    .filter((item) => Boolean(item.label)) ?? [],
);
const isClaimedMerchant = computed(
  () => merchant.value?.merchantMode === 'MANAGED' && merchant.value?.claimStatus === 'CLAIMED',
);
const isUnclaimedDisplayMerchant = computed(
  () => merchant.value?.merchantMode === 'DISPLAY' && merchant.value?.claimStatus === 'UNCLAIMED',
);
const merchantClaimLabel = computed(() =>
  isClaimedMerchant.value ? t('merchantClaimed') : t('merchantUnclaimed'),
);
const showClaimCta = computed(() => isUnclaimedDisplayMerchant.value);
const visibleGalleryImages = computed(() =>
  canShowGallery.value
    ? (merchant.value?.images ?? []).filter((item) => item.isVisible !== false)
    : [],
);
type ClaimedGalleryKey = 'COVER' | 'STORE' | 'PRODUCT' | 'ENVIRONMENT';
type ClaimedGalleryCategory = {
  key: ClaimedGalleryKey;
  label: string;
  urls: string[];
};

function sortedGalleryUrls(imageType: string, limit: number) {
  return visibleGalleryImages.value
    .filter((item) => item.imageType === imageType)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    .map((item) => resolveMediaUrl(item.imageUrl))
    .filter((url): url is string => Boolean(url))
    .filter((url, index, urls) => urls.indexOf(url) === index)
    .slice(0, limit);
}

const claimedGalleryCategories = computed<ClaimedGalleryCategory[]>(() => {
  if (!isClaimedMerchant.value || !canShowGallery.value) return [];
  const cover = resolveMediaUrl(merchant.value?.coverUrl);
  const productUrls = sortedGalleryUrls('PRODUCT', 6);
  const appendProduct = (url?: string | null) => {
    const resolved = resolveMediaUrl(url ?? undefined);
    if (resolved && !productUrls.includes(resolved) && productUrls.length < 6) productUrls.push(resolved);
  };
  signatureDishes.value.forEach((dish) => appendProduct(dish.imageUrl));
  hotRecommendations.value.forEach((product) => appendProduct(product.imageUrl));

  const categories: ClaimedGalleryCategory[] = [
    { key: 'COVER', label: t('galleryCover'), urls: cover ? [cover] : [] },
    { key: 'STORE', label: t('galleryStore'), urls: sortedGalleryUrls('STORE', 3) },
    { key: 'PRODUCT', label: t('galleryProduct'), urls: productUrls },
    { key: 'ENVIRONMENT', label: t('galleryEnvironment'), urls: sortedGalleryUrls('ENVIRONMENT', 3) },
  ];
  return categories.filter((category) => category.urls.length > 0);
});

const displayHeroImages = computed(() => {
  const urls: string[] = [];
  const append = (url?: string | null) => {
    const resolved = resolveMediaUrl(url ?? undefined);
    if (resolved && !urls.includes(resolved)) urls.push(resolved);
  };
  append(merchant.value?.coverUrl);
  (['STORE', 'MENU'] as const).forEach((imageType) => {
    visibleGalleryImages.value
      .filter((item) => item.imageType === imageType)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
      .forEach((item) => append(item.imageUrl));
  });
  return urls;
});
const heroImages = computed(() => {
  if (!isClaimedMerchant.value) return displayHeroImages.value;
  const selected = claimedGalleryCategories.value.find(
    (category) => category.key === activeGalleryCategory.value,
  );
  return selected?.urls ?? claimedGalleryCategories.value[0]?.urls ?? [];
});
const environmentImages = computed(() => {
  const heroUrls = new Set(displayHeroImages.value);
  const urls: string[] = [];
  visibleGalleryImages.value
    .filter((item) => item.imageType === 'ENVIRONMENT')
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    .forEach((item) => {
      const resolved = resolveMediaUrl(item.imageUrl);
      if (resolved && !heroUrls.has(resolved) && !urls.includes(resolved)) urls.push(resolved);
    });
  return urls;
});
const signatureDishes = computed(() => merchant.value?.signatureDishes ?? []);
const hotRecommendations = computed(() => merchant.value?.hotRecommendations ?? []);
const signatureDefaultLimit = computed(() => (viewportWidth.value < 390 ? 6 : 8));
const hotDefaultLimit = computed(() => (viewportWidth.value < 390 ? 3 : 4));
const visibleSignatureDishes = computed(() => (
  isClaimedMerchant.value && !signatureExpanded.value
    ? signatureDishes.value.slice(0, signatureDefaultLimit.value)
    : signatureDishes.value
));
const visibleHotRecommendations = computed(() => (
  isClaimedMerchant.value && !hotExpanded.value
    ? hotRecommendations.value.slice(0, hotDefaultLimit.value)
    : hotRecommendations.value
));
const hasSignatureOverflow = computed(() => (
  isClaimedMerchant.value && signatureDishes.value.length > signatureDefaultLimit.value
));
const hasHotOverflow = computed(() => (
  isClaimedMerchant.value && hotRecommendations.value.length > hotDefaultLimit.value
));
const uiIcons = {
  arrowLeft: '/static/merchant-detail-icons/arrow-left-white.png',
  heart: '/static/merchant-detail-icons/heart-white.png',
  heartActive: '/static/merchant-detail-icons/heart-filled-warm.png',
  heartGreen: '/static/merchant-detail-icons/heart-green.png',
  share: '/static/merchant-detail-icons/share-2-white.png',
  merchantProfile: '/static/merchant-detail-icons/door-open-green.png',
  phone: '/static/merchant-detail-icons/phone-green.png',
  navigation: '/static/merchant-detail-icons/navigation-green.png',
  mapPin: '/static/merchant-detail-icons/map-pin-green.png',
  pickup: '/static/merchant-detail-icons/package-check-green.png',
  pickupWhite: '/static/merchant-detail-icons/package-check-white.png',
  delivery: '/static/merchant-detail-icons/bike-green.png',
  deliveryWhite: '/static/merchant-detail-icons/bike-white.png',
} as const;
const serviceCapabilities = computed(() => {
  const items: Array<{ code: string; icon: string; label: string }> = [];
  appendDictionaryCapability(
    items,
    'chineseServiceEnabled',
    '/static/merchant-detail-icons/languages-green.png',
    t('chineseService'),
  );
  appendDictionaryCapability(
    items,
    'privateRoomEnabled',
    '/static/merchant-detail-icons/door-open-green.png',
    t('privateRooms'),
  );
  appendDictionaryCapability(
    items,
    'airConditioningEnabled',
    '/static/merchant-detail-icons/air-vent-green.png',
    t('airConditioned'),
  );
  appendDictionaryCapability(
    items,
    'freeWifiEnabled',
    '/static/merchant-detail-icons/wifi-green.png',
    t('freeWifi'),
  );
  if (orderingVisibility.value.pickupFacilityVisible) {
    items.push({ code: 'pickupEnabled', icon: uiIcons.pickup, label: t('supportsPickup') });
  }
  if (orderingVisibility.value.deliveryFacilityVisible) {
    items.push({ code: 'deliveryEnabled', icon: uiIcons.delivery, label: t('supportsDelivery') });
  }
  if (orderingVisibility.value.qrFacilityVisible) {
    items.push({
      code: 'qrOrderEnabled',
      icon: '/static/merchant-detail-icons/qr-code-green.png',
      label: t('supportsQrOrder'),
    });
  }
  return items;
});

usePageTitle(() => t('merchantDetailTitle'));

onLoad((options) => {
  merchantId.value = String(options?.id ?? '');
  syncMerchantNavMetrics();
  void loadMerchant();
});

type MenuButtonRect = {
  top?: number;
  right?: number;
  width?: number;
  height?: number;
};

function finitePositive(value: unknown, fallback = 0) {
  const resolved = Number(value);
  return Number.isFinite(resolved) && resolved > 0 ? resolved : fallback;
}

function getMenuButtonRect(): MenuButtonRect | undefined {
  const runtime = globalThis as typeof globalThis & {
    wx?: { getMenuButtonBoundingClientRect?: () => MenuButtonRect };
  };
  return runtime.wx?.getMenuButtonBoundingClientRect?.();
}

function syncMerchantNavMetrics() {
  const systemInfo = typeof uni.getWindowInfo === 'function' ? uni.getWindowInfo() : uni.getSystemInfoSync();
  viewportWidth.value = finitePositive(systemInfo.windowWidth, finitePositive(systemInfo.screenWidth, 390));
  const statusBarHeight = finitePositive(systemInfo.statusBarHeight);
  const menuButton = getMenuButtonRect();
  const capsuleTop = finitePositive(menuButton?.top);
  const capsuleHeight = finitePositive(menuButton?.height);
  const capsuleTopGap = capsuleTop > statusBarHeight ? capsuleTop - statusBarHeight : 0;
  const navContentHeight = Math.max(44, capsuleHeight ? capsuleHeight + capsuleTopGap * 2 : 44);

  merchantNavStyle.value = {
    '--merchant-status-bar-height': `${statusBarHeight}px`,
    '--merchant-nav-content-height': `${navContentHeight}px`,
  };
}

async function loadMerchant() {
  loading.value = true;
  error.value = '';
  errorRetryable.value = true;
  try {
    const [loadedMerchant] = await Promise.all([
      getMerchant(merchantId.value),
      appConfig.ensureLoaded(),
    ]);
    merchant.value = loadedMerchant;
    activeGalleryCategory.value = claimedGalleryCategories.value[0]?.key ?? '';
    activeHeroIndex.value = 0;
    signatureExpanded.value = false;
    hotExpanded.value = false;
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
      errorRetryable.value = false;
      return;
    }
    error.value = t('merchantLoadFailed');
  } finally {
    loading.value = false;
  }
}

function appendDictionaryCapability(
  items: Array<{ code: string; icon: string; label: string }>,
  code: string,
  icon: string,
  fallbackLabel: string,
) {
  const capability = capabilityByCode.value.get(code);
  if (!capability?.isEnabled) return;
  items.push({
    code,
    icon,
    label: localizedName(capability, locale.value) || fallbackLabel,
  });
}

function handleHeroChange(event: { detail?: { current?: number } }) {
  const current = Number(event.detail?.current ?? 0);
  activeHeroIndex.value = Number.isFinite(current) ? current : 0;
}

function selectHeroImage(index: number) {
  activeHeroIndex.value = index;
}

function selectGalleryCategory(key: ClaimedGalleryKey) {
  if (activeGalleryCategory.value === key) return;
  activeGalleryCategory.value = key;
  activeHeroIndex.value = 0;
}

function handleBack() {
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack();
    return;
  }
  uni.reLaunch({ url: '/pages/home/index' });
}

function handleMediaError(url?: string | null) {
  const resolved = resolveMediaUrl(url ?? undefined);
  if (!resolved) return;
  const next = new Set(failedMediaUrls.value);
  next.add(resolved);
  failedMediaUrls.value = next;
}

function mediaAvailable(url?: string | null) {
  const resolved = resolveMediaUrl(url ?? undefined);
  return Boolean(resolved && !failedMediaUrls.value.has(resolved));
}

function merchantShareTitle() {
  return merchantName(merchant.value, locale.value) || '云桥 Life';
}

function merchantSharePath() {
  return merchantId.value
    ? `/pages/merchant/detail?id=${encodeURIComponent(merchantId.value)}`
    : '/pages/home/index';
}

onShareAppMessage(() => ({
  title: merchantShareTitle(),
  path: merchantSharePath(),
}));

onShareTimeline(() => ({
  title: merchantShareTitle(),
  ...(merchantId.value ? { query: `id=${encodeURIComponent(merchantId.value)}` } : {}),
}));

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
  if (!appConfig.platformOrderingEnabled) return;
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
  const sourceLocation = merchantLocation();
  if (!sourceLocation || !merchant.value) {
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

    const openLocationCoordinate = wgs84ToGcj02(
      sourceLocation.latitude,
      sourceLocation.longitude,
    );

    if (import.meta.env.DEV) {
      console.log('[merchant-navigation]', {
        merchantId: merchantValue.id,
        sourceCoordinateSystem: 'WGS84',
        targetCoordinateSystem: 'GCJ02',
        source: {
          latitude: sourceLocation.latitude,
          longitude: sourceLocation.longitude,
        },
        openLocation: {
          latitude: openLocationCoordinate.latitude,
          longitude: openLocationCoordinate.longitude,
        },
      });
    }

    uni.openLocation({
      latitude: openLocationCoordinate.latitude,
      longitude: openLocationCoordinate.longitude,
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

function previewGallery(imageUrl?: string | null) {
  const current = resolveMediaUrl(imageUrl ?? undefined);
  const urls = heroImages.value.filter((url) => mediaAvailable(url));
  if (!urls.length || !current || !urls.includes(current)) return;
  uni.previewImage({ current, urls });
}

function previewEnvironment(imageUrl?: string | null) {
  const current = resolveMediaUrl(imageUrl ?? undefined);
  const urls = environmentImages.value.filter((url) => mediaAvailable(url));
  if (!urls.length || !current || !urls.includes(current)) return;
  uni.previewImage({ current, urls });
}

function hasCapability(code: string, fallbackValue: boolean) {
  if (!hasCapabilityRecords.value) return fallbackValue;
  return enabledCapabilityCodes.value.has(code);
}
</script>

<template>
  <view :class="['page', { 'has-order-actions': hasBottomCta }]">
    <view class="merchant-nav" :style="merchantNavStyle">
      <view class="merchant-nav-row">
        <button
          class="merchant-nav-back"
          hover-class="is-pressed"
          :aria-label="t('back')"
          @tap="handleBack"
        >
          <view class="merchant-nav-back-icon" />
        </button>
        <text class="merchant-nav-title">{{ merchantNavTitle }}</text>
      </view>
    </view>
    <view v-if="loading" class="loading-state">
      <view class="loading-hero" />
      <view class="loading-overview">
        <view class="loading-copy">
          <view class="loading-line is-wide" />
          <view class="loading-line" />
        </view>
      </view>
      <view class="loading-card">
        <view class="loading-line is-title" />
        <view class="loading-line is-full" />
        <view class="loading-line is-medium" />
      </view>
    </view>
    <view v-else-if="error" class="error-state">
      <view class="error-mark">!</view>
      <text class="error-title">{{ error }}</text>
      <text v-if="errorRetryable" class="error-hint">{{ t('tryAgainLater') }}</text>
      <view class="error-actions">
        <button
          v-if="errorRetryable"
          class="error-button is-primary"
          hover-class="is-pressed"
          @tap="loadMerchant"
        >
          {{ t('reload') }}
        </button>
        <button class="error-button" hover-class="is-pressed" @tap="handleBack">
          {{ t('back') }}
        </button>
      </view>
    </view>
    <template v-else-if="merchant">
      <view class="hero-shell">
        <swiper
          v-if="heroImages.length"
          class="hero"
          :current="activeHeroIndex"
          :circular="heroImages.length > 1"
          @change="handleHeroChange"
        >
          <swiper-item v-for="(url, index) in heroImages" :key="url">
            <image
              v-if="mediaAvailable(url)"
              class="hero-image"
              :src="url"
              mode="aspectFill"
              :aria-label="`${merchantName(merchant, locale)} ${index + 1}`"
              @tap="previewGallery(url)"
              @error="handleMediaError(url)"
            />
            <view v-else class="hero-image placeholder">
              <view class="placeholder-mark">
                <image class="placeholder-hero-icon" :src="uiIcons.merchantProfile" mode="aspectFit" />
              </view>
            </view>
          </swiper-item>
        </swiper>
        <view v-else class="hero placeholder">
          <view class="placeholder-mark">
            <image class="placeholder-hero-icon" :src="uiIcons.merchantProfile" mode="aspectFit" />
          </view>
        </view>

        <view class="hero-controls">
          <view class="hero-controls-right">
            <button
              class="hero-button"
              :class="{ 'is-favorite': favoriteState }"
              :aria-label="favoriteLabel"
              :aria-pressed="favoriteState"
              hover-class="is-pressed"
              @tap="handleToggleFavorite"
            >
              <image
                class="hero-control-icon"
                :src="favoriteState ? uiIcons.heartActive : uiIcons.heart"
                mode="aspectFit"
              />
            </button>
            <button
              class="hero-button hero-share"
              open-type="share"
              hover-class="is-pressed"
              :aria-label="t('shareMerchant')"
            >
              <image class="hero-control-icon" :src="uiIcons.share" mode="aspectFit" />
            </button>
          </view>
        </view>
        <text
          v-if="heroImages.length > 1"
          :class="['hero-count', { 'has-gallery-overlay': isClaimedMerchant && claimedGalleryCategories.length }]"
        >{{ activeHeroIndex + 1 }}/{{ heroImages.length }}</text>
        <scroll-view v-if="isClaimedMerchant && claimedGalleryCategories.length" class="gallery-category-scroll" scroll-x show-scrollbar="false">
          <view class="gallery-category-list">
            <button
              v-for="category in claimedGalleryCategories"
              :key="category.key"
              :class="['gallery-category-button', { 'is-active': activeGalleryCategory === category.key }]"
              :aria-pressed="activeGalleryCategory === category.key"
              hover-class="is-pressed"
              @tap="selectGalleryCategory(category.key)"
            >
              <text>{{ category.label }}</text>
              <text v-if="category.key !== 'COVER'" class="gallery-category-count">{{ category.urls.length }}</text>
            </button>
          </view>
        </scroll-view>
      </view>

      <scroll-view v-if="!isClaimedMerchant && heroImages.length > 1" class="thumbnail-scroll" scroll-x show-scrollbar="false">
        <view class="thumbnail-list">
          <button
            v-for="(url, index) in heroImages"
            :key="url"
            :class="['thumbnail-button', { 'is-active': activeHeroIndex === index }]"
            :aria-label="`${merchantName(merchant, locale)} ${index + 1}`"
            :aria-current="activeHeroIndex === index ? 'true' : 'false'"
            hover-class="is-pressed"
            @tap="selectHeroImage(index)"
          >
            <image v-if="mediaAvailable(url)" class="thumbnail-image" :src="url" mode="aspectFill" @error="handleMediaError(url)" />
            <view v-else class="thumbnail-image placeholder">
              <image class="placeholder-inline-icon is-thumbnail" :src="uiIcons.merchantProfile" mode="aspectFit" />
            </view>
          </button>
        </view>
      </scroll-view>

      <view class="merchant-overview">
        <view class="headline">
          <view class="identity-row">
            <image
              v-if="mediaAvailable(merchant.logoUrl)"
              class="merchant-logo"
              :src="resolveMediaUrl(merchant.logoUrl)"
              mode="aspectFill"
              :aria-label="merchantName(merchant, locale)"
              @error="handleMediaError(merchant.logoUrl)"
            />
            <view class="identity-copy">
              <text class="title">{{ merchantName(merchant, locale) }}</text>
              <view class="identity-badges">
                <text
                  v-if="isClaimedMerchant || isUnclaimedDisplayMerchant"
                  :class="['claim-badge', { 'is-claimed': isClaimedMerchant }]"
                >
                  {{ merchantClaimLabel }}
                </text>
                <text :class="['status', merchant.isOpen ? 'open' : 'closed']">
                  {{ merchant.isOpen ? t('merchantOpen') : t('merchantClosed') }}
                </text>
              </view>
            </view>
          </view>
        </view>
        <view v-if="displayBusinessType || displayTags.length" class="meta-row">
          <text v-if="displayBusinessType" class="meta-type">{{ displayBusinessType }}</text>
          <text v-for="tag in displayTags" :key="tag.id" class="tag">{{ tag.label }}</text>
        </view>
        <view v-if="merchant.distanceKm !== null || merchant.openingHoursText" class="summary-line">
          <text v-if="merchant.distanceKm !== null" class="distance">{{ merchant.distanceKm }} km</text>
          <text v-if="merchant.openingHoursText" class="hours">{{ merchant.openingHoursText }}</text>
        </view>
      </view>

      <view v-if="displayDescription" class="intro-card">
        <view class="intro-heading">
          <view class="intro-icon-shell">
            <image class="intro-icon" :src="uiIcons.merchantProfile" mode="aspectFit" />
          </view>
          <text class="section-title">{{ t('merchantIntro') }}</text>
        </view>
        <text class="description">{{ displayDescription }}</text>
      </view>

      <view v-if="serviceCapabilities.length" class="content-section facility-section">
        <view class="facility-grid">
          <view v-for="service in serviceCapabilities" :key="service.code" class="facility-item">
            <image class="facility-icon" :src="service.icon" mode="aspectFit" />
            <text class="facility-label">{{ service.label }}</text>
          </view>
        </view>
      </view>

      <view v-if="signatureDishes.length" class="content-section featured-section">
        <view class="section-heading">
          <text class="section-title">{{ locale === 'zh' ? `⭐ ${t('signatureDishes')}` : t('signatureDishes') }}</text>
          <button v-if="hasSignatureOverflow" class="section-more" :aria-expanded="signatureExpanded" hover-class="is-pressed" @tap="signatureExpanded = !signatureExpanded">
            <text>{{ signatureExpanded ? t('collapse') : t('viewMore') }}</text>
            <text :class="['section-more-arrow', { 'is-expanded': signatureExpanded }]">›</text>
          </button>
        </view>
        <view v-if="isClaimedMerchant" :class="['dish-grid', 'signature-grid', { 'is-narrow': viewportWidth < 390 }]">
          <view v-for="dish in visibleSignatureDishes" :key="dish.id" class="signature-card">
            <image v-if="mediaAvailable(dish.imageUrl)" class="signature-image" :src="resolveMediaUrl(dish.imageUrl)" mode="aspectFill" :aria-label="`${t('signatureDishes')} · ${localizedName(dish, locale)}`" lazy-load @error="handleMediaError(dish.imageUrl)" />
            <view v-else class="signature-image placeholder">
              <image class="placeholder-inline-icon" :src="uiIcons.merchantProfile" mode="aspectFit" />
            </view>
            <text class="signature-name">{{ localizedName(dish, locale) }}</text>
          </view>
        </view>
        <scroll-view v-else class="horizontal-scroll" scroll-x show-scrollbar="false">
          <view class="horizontal-list">
            <view v-for="dish in signatureDishes" :key="dish.id" class="signature-card">
              <image v-if="mediaAvailable(dish.imageUrl)" class="signature-image" :src="resolveMediaUrl(dish.imageUrl)" mode="aspectFill" :aria-label="`${t('signatureDishes')} · ${localizedName(dish, locale)}`" lazy-load @error="handleMediaError(dish.imageUrl)" />
              <view v-else class="signature-image placeholder">
                <image class="placeholder-inline-icon" :src="uiIcons.merchantProfile" mode="aspectFit" />
              </view>
              <text class="signature-name">{{ localizedName(dish, locale) }}</text>
            </view>
          </view>
        </scroll-view>
      </view>

      <view v-if="hotRecommendations.length" class="content-section featured-section">
        <view class="section-heading">
          <text class="section-title">{{ locale === 'zh' ? `🔥 ${t('merchantHotRecommendations')}` : t('merchantHotRecommendations') }}</text>
          <button v-if="hasHotOverflow" class="section-more" :aria-expanded="hotExpanded" hover-class="is-pressed" @tap="hotExpanded = !hotExpanded">
            <text>{{ hotExpanded ? t('collapse') : t('viewMore') }}</text>
            <text :class="['section-more-arrow', { 'is-expanded': hotExpanded }]">›</text>
          </button>
        </view>
        <view v-if="isClaimedMerchant" :class="['dish-grid', 'hot-grid', { 'is-narrow': viewportWidth < 390 }]">
          <view v-for="product in visibleHotRecommendations" :key="product.id" class="hot-card">
            <view class="hot-image-wrap">
              <image v-if="mediaAvailable(product.imageUrl)" class="hot-image" :src="resolveMediaUrl(product.imageUrl ?? undefined)" mode="aspectFill" :aria-label="`${t('merchantHotRecommendations')} · ${localizedName(product, locale)}`" lazy-load @error="handleMediaError(product.imageUrl)" />
              <view v-else class="hot-image placeholder">
                <image class="placeholder-inline-icon" :src="uiIcons.merchantProfile" mode="aspectFit" />
              </view>
            </view>
            <text class="hot-name">{{ localizedName(product, locale) }}</text>
            <text class="hot-price">{{ formatNumberCurrency(product.priceVnd) }}</text>
            <view class="hot-meta">
              <text class="hot-sales">{{ t('salesCount', { count: product.salesCount }) }}</text>
              <text class="hot-meta-separator">·</text>
              <text class="hot-rank">{{ t('hotRank', { rank: product.hotRank }) }}</text>
            </view>
          </view>
        </view>
        <scroll-view v-else class="horizontal-scroll" scroll-x show-scrollbar="false">
          <view class="horizontal-list">
            <view v-for="product in hotRecommendations" :key="product.id" class="hot-card">
              <view class="hot-image-wrap">
                <image v-if="mediaAvailable(product.imageUrl)" class="hot-image" :src="resolveMediaUrl(product.imageUrl ?? undefined)" mode="aspectFill" :aria-label="`${t('merchantHotRecommendations')} · ${localizedName(product, locale)}`" lazy-load @error="handleMediaError(product.imageUrl)" />
                <view v-else class="hot-image placeholder">
                  <image class="placeholder-inline-icon" :src="uiIcons.merchantProfile" mode="aspectFit" />
                </view>
              </view>
              <text class="hot-name">{{ localizedName(product, locale) }}</text>
              <text class="hot-price">{{ formatNumberCurrency(product.priceVnd) }}</text>
              <view class="hot-meta">
                <text class="hot-sales">{{ t('salesCount', { count: product.salesCount }) }}</text>
                <text class="hot-meta-separator">·</text>
                <text class="hot-rank">{{ t('hotRank', { rank: product.hotRank }) }}</text>
              </view>
            </view>
          </view>
        </scroll-view>
      </view>

      <view v-if="!isClaimedMerchant && environmentImages.length" class="content-section environment-section">
        <view class="section-heading">
          <text class="section-title">{{ t('environmentPhotos') }}</text>
        </view>
        <scroll-view class="environment-scroll" scroll-x show-scrollbar="false">
          <view class="environment-list">
            <view v-for="url in environmentImages" :key="url" class="environment-frame">
              <image
                v-if="mediaAvailable(url)"
                class="environment-image"
                :src="url"
                mode="aspectFill"
                :aria-label="`${merchantName(merchant, locale)} · ${t('environmentPhotos')}`"
                lazy-load
                @tap="previewEnvironment(url)"
                @error="handleMediaError(url)"
              />
              <view v-else class="environment-image placeholder">
                <image class="placeholder-inline-icon" :src="uiIcons.merchantProfile" mode="aspectFit" />
              </view>
            </view>
          </view>
        </scroll-view>
      </view>

      <view v-if="displayAddress" class="address-card">
        <image class="address-pin" :src="uiIcons.mapPin" mode="aspectFit" />
        <view class="address-copy">
          <text class="address-label">{{ t('merchantAddress') }}</text>
          <text class="address-text">{{ displayAddress }}</text>
          <text v-if="merchant.distanceKm !== null" class="address-distance">{{ merchant.distanceKm }} km</text>
        </view>
      </view>

      <view v-if="showClaimCta" class="claim-card">
        <view class="claim-copy">
          <text class="claim-title">{{ t('merchantClaimTitle') }}</text>
          <text class="claim-description">{{ t('merchantClaimDescription') }}</text>
        </view>
        <button
          class="claim-action"
          open-type="contact"
          hover-class="is-pressed"
        >
          {{ t('merchantClaimAction') }}
        </button>
      </view>

      <view :class="['sticky-actions', { 'has-order-ctas': hasBottomCta }]">
        <view class="sticky-tools">
          <button v-if="canPhone" class="bottom-action" hover-class="is-pressed" @tap="handlePhoneTap">
            <image class="bottom-action-icon" :src="uiIcons.phone" mode="aspectFit" />
            <text>{{ t('phone') }}</text>
          </button>
          <button v-if="canNavigate" class="bottom-action" hover-class="is-pressed" @tap="handleAddressTap">
            <image class="bottom-action-icon" :src="uiIcons.navigation" mode="aspectFit" />
            <text>{{ t('mapNavigation') }}</text>
          </button>
          <button :class="['bottom-action', { 'is-favorite': favoriteState }]" :aria-pressed="favoriteState" hover-class="is-pressed" @tap="handleToggleFavorite">
            <image class="bottom-action-icon" :src="favoriteState ? uiIcons.heartActive : uiIcons.heartGreen" mode="aspectFit" />
            <text>{{ favoriteLabel }}</text>
          </button>
        </view>
        <view v-if="hasBottomCta" class="sticky-orders">
          <button
            v-if="canOpenPickup"
            class="primary pickup"
            hover-class="is-pressed"
            @tap="openMenu('PICKUP')"
          >
            <image class="order-action-icon" :src="uiIcons.pickup" mode="aspectFit" />
            <text>{{ t('pickup') }}</text>
          </button>
          <button
            v-if="canOpenDelivery"
            :class="['primary', 'delivery', { 'is-solo': !canOpenPickup }]"
            hover-class="is-pressed"
            @tap="openMenu('DELIVERY')"
          >
            <image class="order-action-icon" :src="uiIcons.deliveryWhite" mode="aspectFit" />
            <text>{{ t('delivery') }}</text>
          </button>
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped>
/* finesse · register=h5 · morph=D-commerce-stack · A=forest-green+warm-signal
 * B=compact-system-sans · C=cover-store-menu-gallery+claim-state-identity+four-column-facilities+delivery-priority-action-dock
 * D=feedback-only · E=existing-restaurant-photography · SOUL=6 SPECTACLE=2 DENSITY=9 */
.page {
  --page-bg: #f6faf7;
  --surface: #fcfefc;
  --surface-soft: #f8fbf8;
  --brand: #43a047;
  --brand-deep: #2e7d32;
  --brand-soft: #eaf7ee;
  --ink: #1f2d24;
  --ink-2: #455249;
  --ink-3: #667169;
  --line: #e7efe9;
  --warm: #fff4dc;
  --warm-ink: #6b5628;
  --warning: #9a6500;
  --warning-deep: #ad5a00;
  --on-brand: #f8fff9;
  --on-brand-warm: #fff0d0;
  --loading: #e8f1ea;
  --loading-soft: #eef5ef;
  --control-overlay: rgb(31 45 36 / 72%);
  --control-overlay-soft: rgb(31 45 36 / 66%);
  --badge-overlay: rgb(31 45 36 / 76%);
  --surface-translucent: rgb(255 255 255 / 78%);
  --brand-hairline: rgb(46 125 50 / 10%);
  --claim-line: rgb(154 101 0 / 14%);
  --claim-claimed-line: rgb(46 125 50 / 10%);
  --control-shadow: 0 8rpx 24rpx rgb(0 0 0 / 16%);
  --logo-shadow: 0 6rpx 18rpx rgb(31 45 36 / 8%);
  --dock-shadow: 0 -12rpx 30rpx rgb(31 45 36 / 8%);
  --shadow: 0 12rpx 34rpx rgb(31 45 36 / 11%);
  min-height: 100vh;
  padding: 0 0 calc(40rpx + env(safe-area-inset-bottom));
  color: var(--ink);
  background: var(--page-bg);
  box-sizing: border-box;
}

.page.has-order-actions {
  padding-bottom: calc(164rpx + env(safe-area-inset-bottom));
}

.merchant-nav {
  position: relative;
  z-index: 3;
  padding-top: var(--merchant-status-bar-height, env(safe-area-inset-top));
  border-bottom: 1rpx solid var(--line);
  background: var(--surface);
  box-shadow: 0 2rpx 10rpx rgb(31 45 36 / 3%);
}

.merchant-nav-row {
  position: relative;
  height: var(--merchant-nav-content-height, 88rpx);
  display: flex;
  align-items: center;
}

.merchant-nav-back {
  width: 88rpx;
  height: 88rpx;
  min-height: 88rpx;
  display: flex;
  margin: 0 0 0 12rpx;
  padding: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 44rpx;
  color: var(--ink);
  background: transparent;
  transition: transform 160ms ease, opacity 160ms ease;
  box-sizing: border-box;
}

.merchant-nav-back::after {
  border: 0;
}

.merchant-nav-back-icon {
  width: 22rpx;
  height: 22rpx;
  border-bottom: 4rpx solid currentColor;
  border-left: 4rpx solid currentColor;
  transform: rotate(45deg);
  box-sizing: border-box;
}

.merchant-nav-title {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 100%;
  display: flex;
  overflow: hidden;
  align-items: center;
  justify-content: center;
  color: var(--ink);
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
}

.loading-state {
  position: relative;
  padding: 12rpx 24rpx 48rpx;
}

.loading-hero,
.loading-avatar,
.loading-line,
.loading-card {
  background: var(--loading);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.loading-hero {
  height: 420rpx;
  border-radius: 28rpx;
}

.loading-overview {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 28rpx 6rpx;
}

.loading-avatar {
  width: 88rpx;
  height: 88rpx;
  flex: none;
  border-radius: 44rpx;
}

.loading-copy {
  min-width: 0;
  flex: 1;
}

.loading-line {
  width: 44%;
  height: 22rpx;
  margin-top: 16rpx;
  border-radius: 11rpx;
}

.loading-line.is-wide {
  width: 72%;
  height: 34rpx;
  margin-top: 0;
}

.loading-line.is-title {
  width: 34%;
  height: 28rpx;
  margin-top: 0;
}

.loading-line.is-full {
  width: 100%;
}

.loading-line.is-medium {
  width: 68%;
}

.loading-card {
  min-height: 176rpx;
  padding: 26rpx;
  border-radius: 24rpx;
  background: var(--loading-soft);
  box-sizing: border-box;
}

.error-state {
  min-height: 100vh;
  display: flex;
  padding: 80rpx 48rpx;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
  box-sizing: border-box;
}

.error-mark {
  display: grid;
  width: 96rpx;
  height: 96rpx;
  place-items: center;
  border-radius: 48rpx;
  color: var(--warning);
  background: var(--warm);
  font-size: 44rpx;
  font-weight: 800;
}

.error-title {
  margin-top: 26rpx;
  color: var(--ink);
  font-size: 30rpx;
  font-weight: 800;
  line-height: 1.45;
}

.error-hint {
  margin-top: 12rpx;
  color: var(--ink-3);
  font-size: 24rpx;
  line-height: 1.55;
}

.error-actions {
  width: 100%;
  display: flex;
  gap: 16rpx;
  margin-top: 34rpx;
}

.error-button {
  height: 88rpx;
  min-height: 88rpx;
  flex: 1;
  margin: 0;
  padding: 0 20rpx;
  border: 2rpx solid var(--brand);
  border-radius: 22rpx;
  color: var(--brand-deep);
  background: var(--surface);
  font-size: 26rpx;
  font-weight: 700;
  line-height: 84rpx;
  box-sizing: border-box;
}

.error-button.is-primary {
  color: var(--on-brand);
  background: var(--brand-deep);
}

.hero-shell {
  position: relative;
  padding: 12rpx 20rpx 0;
  background: var(--surface);
}

.hero {
  height: 420rpx;
  overflow: hidden;
  border-radius: 28rpx;
  background: var(--brand-soft);
  box-shadow: var(--shadow);
}

.hero-image {
  width: 100%;
  height: 420rpx;
  display: block;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--brand-deep);
  background: var(--brand-soft);
  font-size: 24rpx;
  font-weight: 800;
}

.placeholder-mark {
  display: grid;
  width: 96rpx;
  height: 96rpx;
  place-items: center;
  border: 2rpx solid var(--brand-hairline);
  border-radius: 48rpx;
  color: var(--brand-deep);
  background: var(--surface-translucent);
  font-size: 36rpx;
  font-weight: 800;
}

.placeholder-hero-icon {
  width: 44rpx;
  height: 44rpx;
  display: block;
}

.placeholder-inline-icon {
  width: 40rpx;
  height: 40rpx;
  display: block;
  opacity: 0.72;
}

.placeholder-inline-icon.is-thumbnail {
  width: 30rpx;
  height: 30rpx;
}

.hero-controls {
  position: absolute;
  top: 28rpx;
  right: 36rpx;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hero-controls-right {
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.hero-button,
.merchant-nav-back,
.thumbnail-button,
.bottom-action,
.address-nav,
.error-button {
  transition: transform 160ms ease, opacity 160ms ease;
}

.hero-button,
.merchant-nav-back,
.thumbnail-button,
.bottom-action,
.address-nav {
  margin: 0;
  border: 0;
  box-sizing: border-box;
}

.hero-button::after,
.merchant-nav-back::after,
.thumbnail-button::after,
.bottom-action::after,
.address-nav::after,
.error-button::after,
.actions button::after {
  border: 0;
}

.hero-button {
  width: 88rpx;
  height: 88rpx;
  min-height: 88rpx;
  display: flex;
  padding: 0;
  align-items: center;
  justify-content: center;
  border-radius: 44rpx;
  color: var(--on-brand);
  background: var(--control-overlay);
  box-shadow: var(--control-shadow);
  font-size: 38rpx;
  line-height: 1;
}

.hero-button.is-favorite {
  color: var(--on-brand-warm);
}

.hero-share {
  padding-bottom: 5rpx;
  font-size: 34rpx;
}

.hero-count {
  position: absolute;
  right: 40rpx;
  bottom: 18rpx;
  z-index: 2;
  padding: 8rpx 15rpx;
  border-radius: 999rpx;
  color: var(--on-brand);
  background: var(--control-overlay-soft);
  font-size: 22rpx;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.thumbnail-scroll {
  width: 100%;
  padding: 16rpx 20rpx 4rpx;
  white-space: nowrap;
  background: var(--surface);
  box-sizing: border-box;
}

.gallery-category-scroll {
  width: 100%;
  padding: 10rpx 18rpx 6rpx;
  white-space: nowrap;
  background: var(--surface);
  box-sizing: border-box;
}

.gallery-category-list {
  display: flex;
  width: max-content;
  gap: 10rpx;
}

.gallery-category-button {
  min-width: 132rpx;
  min-height: 88rpx;
  display: inline-flex;
  padding: 0 20rpx;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  border: 2rpx solid var(--line);
  border-radius: 18rpx;
  color: var(--ink-2);
  background: var(--surface-soft);
  font-size: 23rpx;
  font-weight: 700;
  line-height: 1.2;
  box-sizing: border-box;
}

.gallery-category-button.is-active {
  border-color: var(--brand);
  color: var(--brand-deep);
  background: var(--brand-soft);
}

.gallery-category-count {
  min-width: 30rpx;
  height: 30rpx;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999rpx;
  color: var(--brand-deep);
  background: rgb(255 255 255 / 72%);
  font-size: 19rpx;
}

.thumbnail-list {
  display: flex;
  width: max-content;
  gap: 12rpx;
}

.thumbnail-button {
  width: 132rpx;
  height: 96rpx;
  min-height: 96rpx;
  padding: 4rpx;
  overflow: hidden;
  border: 3rpx solid transparent;
  border-radius: 18rpx;
  background: var(--surface);
  line-height: 1;
}

.thumbnail-button.is-active {
  border-color: var(--brand);
}

.thumbnail-image {
  width: 118rpx;
  height: 82rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12rpx;
  font-size: 22rpx;
}

.merchant-overview {
  padding: 28rpx 28rpx 26rpx;
  background: var(--surface);
}

.headline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20rpx;
}

.identity-row {
  min-width: 0;
  display: flex;
  flex: 1;
  align-items: flex-start;
  gap: 18rpx;
}

.identity-copy {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12rpx;
}

.merchant-logo {
  width: 82rpx;
  height: 82rpx;
  flex: none;
  border: 2rpx solid var(--line);
  border-radius: 41rpx;
  background: var(--surface-soft);
  box-shadow: var(--logo-shadow);
  box-sizing: border-box;
}

.merchant-logo-placeholder {
  display: grid;
  place-items: center;
  color: var(--brand-deep);
  background: var(--brand-soft);
  font-size: 32rpx;
  font-weight: 800;
}

.title {
  min-width: 0;
  display: -webkit-box;
  overflow: hidden;
  color: var(--ink);
  font-size: 38rpx;
  font-weight: 800;
  line-height: 1.28;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.status {
  flex: none;
  margin-top: 4rpx;
  padding: 8rpx 14rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1.2;
}

.open {
  color: var(--brand-deep);
  background: var(--brand-soft);
}

.closed {
  color: var(--warning);
  background: var(--warm);
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 9rpx;
}

.meta-type,
.tag {
  padding: 6rpx 12rpx;
  border-radius: 999rpx;
  color: var(--brand-deep);
  background: var(--brand-soft);
  font-size: 22rpx;
  font-weight: 600;
  line-height: 1.35;
}

.summary-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10rpx 18rpx;
  margin-top: 18rpx;
  color: var(--ink-3);
  font-size: 23rpx;
}

.distance,
.hours {
  color: var(--ink-3);
  font-size: 23rpx;
}

.intro-card {
  padding: 24rpx 26rpx;
  margin: 0 24rpx 22rpx;
  border-radius: 24rpx;
  background: var(--warm);
}

.content-section {
  padding: 28rpx 24rpx 30rpx;
  border-top: 12rpx solid var(--page-bg);
  background: var(--surface);
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.section-title {
  display: block;
  color: var(--ink);
  font-size: 31rpx;
  font-weight: 800;
  line-height: 1.3;
}

.description {
  display: block;
  margin-top: 12rpx;
  color: var(--warm-ink);
  font-size: 25rpx;
  line-height: 1.68;
  overflow-wrap: anywhere;
  white-space: pre-line;
}

.facility-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20rpx 12rpx;
  margin-top: 22rpx;
}

.facility-grid.is-wide-labels {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 22rpx 16rpx;
}

.facility-item {
  min-width: 0;
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 10rpx;
  text-align: center;
}

.facility-icon {
  display: grid;
  width: 80rpx;
  height: 80rpx;
  place-items: center;
  border-radius: 24rpx;
  color: var(--brand-deep);
  background: var(--brand-soft);
  font-size: 24rpx;
  font-weight: 800;
}

.facility-label {
  display: block;
  min-height: 68rpx;
  color: var(--ink-2);
  font-size: 24rpx;
  line-height: 1.4;
  overflow-wrap: anywhere;
  white-space: normal;
}

.facility-grid.is-wide-labels .facility-label {
  min-height: 102rpx;
}

.horizontal-scroll {
  width: 100%;
  margin-top: 18rpx;
  white-space: nowrap;
}

.horizontal-list {
  display: flex;
  width: max-content;
  align-items: flex-start;
  gap: 16rpx;
  padding-right: 24rpx;
}

.signature-card,
.hot-card {
  width: 280rpx;
  overflow: hidden;
  border: 1rpx solid var(--line);
  border-radius: 20rpx;
  background: var(--surface-soft);
  box-sizing: border-box;
}

.signature-image,
.hot-image {
  width: 280rpx;
  height: 198rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-soft);
  font-size: 32rpx;
}

.hot-image-wrap {
  position: relative;
  width: 280rpx;
  height: 198rpx;
}

.hot-rank {
  position: absolute;
  top: 12rpx;
  left: 12rpx;
  padding: 7rpx 12rpx;
  border-radius: 999rpx;
  color: var(--on-brand);
  background: var(--badge-overlay);
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1.2;
}

.signature-name,
.hot-name {
  min-height: 68rpx;
  display: -webkit-box;
  overflow: hidden;
  padding: 14rpx 15rpx 0;
  color: var(--ink);
  font-size: 24rpx;
  font-weight: 700;
  line-height: 1.42;
  white-space: normal;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  box-sizing: border-box;
}

.signature-name {
  padding-bottom: 16rpx;
}

.hot-price {
  display: block;
  padding: 9rpx 15rpx 0;
  color: var(--brand-deep);
  font-size: 26rpx;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.hot-sales {
  display: block;
  padding: 9rpx 15rpx 16rpx;
  color: var(--ink-3);
  font-size: 22rpx;
}

.bottom-actions {
  display: flex;
  gap: 14rpx;
  padding: 26rpx 24rpx 12rpx;
  border-top: 12rpx solid var(--page-bg);
  background: var(--surface);
}

.bottom-action {
  min-width: 0;
  height: 92rpx;
  min-height: 92rpx;
  display: flex;
  flex: 1;
  padding: 0 12rpx;
  align-items: center;
  justify-content: center;
  gap: 9rpx;
  border-radius: 20rpx;
  color: var(--brand-deep);
  background: var(--brand-soft);
  font-size: 24rpx;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
}

.bottom-action-icon {
  font-size: 28rpx;
  line-height: 1;
}

.address-card {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx;
  margin: 14rpx 24rpx 24rpx;
  border: 1rpx solid var(--line);
  border-radius: 22rpx;
  background: var(--surface);
  box-sizing: border-box;
}

.address-copy {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8rpx;
}

.address-label {
  color: var(--brand-deep);
  font-size: 23rpx;
  font-weight: 700;
}

.address-text {
  color: var(--ink-2);
  font-size: 23rpx;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.address-distance {
  color: var(--ink-3);
  font-size: 22rpx;
}

.address-nav {
  min-width: 112rpx;
  height: 88rpx;
  min-height: 88rpx;
  padding: 0 18rpx;
  border-radius: 20rpx;
  color: var(--on-brand);
  background: var(--brand-deep);
  font-size: 22rpx;
  font-weight: 700;
  line-height: 88rpx;
  white-space: nowrap;
}

.actions {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
  display: flex;
  gap: 16rpx;
  padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom));
  border-top: 1rpx solid var(--line);
  background: var(--surface);
  box-shadow: var(--dock-shadow);
  box-sizing: border-box;
}

.actions button {
  height: 96rpx;
  min-height: 96rpx;
  flex: 1;
  margin: 0;
  padding: 0 18rpx;
  border: 2rpx solid transparent;
  border-radius: 24rpx;
  color: var(--on-brand);
  background: var(--brand-deep);
  font-size: 28rpx;
  font-weight: 800;
  line-height: 92rpx;
  white-space: nowrap;
  transition: transform 160ms ease, opacity 160ms ease;
  box-sizing: border-box;
}

.actions .delivery {
  border-color: var(--brand);
  color: var(--brand-deep);
  background: var(--surface);
}

.hero-button.is-pressed,
.merchant-nav-back.is-pressed,
.thumbnail-button.is-pressed,
.bottom-action.is-pressed,
.address-nav.is-pressed,
.error-button.is-pressed,
.actions button.is-pressed {
  opacity: 0.86;
  transform: scale(0.96);
}

@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.58;
  }
}

@media (prefers-reduced-motion: reduce) {
  .loading-hero,
  .loading-avatar,
  .loading-line,
  .loading-card {
    animation: none;
  }

  .hero-button,
  .merchant-nav-back,
  .thumbnail-button,
  .bottom-action,
  .address-nav,
  .error-button,
  .actions button {
    transition: none;
  }
}

/* Screenshot-led density pass: preserve content and ordering behavior while matching the compact commerce stack. */
.page {
  --page-bg: #f4f8f5;
  --surface-soft: #f7faf7;
  --warm: #fff8e8;
  --control-overlay: rgb(25 35 29 / 78%);
  --control-overlay-soft: rgb(25 35 29 / 68%);
  --dock-shadow: 0 -8rpx 24rpx rgb(31 45 36 / 7%);
  --shadow: 0 8rpx 24rpx rgb(31 45 36 / 9%);
  overflow-x: clip;
  padding-bottom: calc(28rpx + env(safe-area-inset-bottom));
}

.page.has-order-actions {
  padding-bottom: calc(132rpx + env(safe-area-inset-bottom));
}

.loading-state {
  padding: 8rpx 16rpx 40rpx;
}

.loading-hero {
  height: 330rpx;
  border-radius: 22rpx;
}

.loading-overview {
  padding: 22rpx 8rpx 18rpx;
}

.loading-copy {
  width: 100%;
}

.loading-card {
  min-height: 142rpx;
  padding: 20rpx;
  border-radius: 18rpx;
}

.hero-shell {
  padding: 8rpx 16rpx 0;
}

.hero,
.hero-image {
  height: 330rpx;
}

.hero {
  border-radius: 22rpx;
}

.hero-controls {
  top: 20rpx;
  right: 28rpx;
}

.hero-controls-right {
  gap: 10rpx;
}

.hero-button {
  width: 88rpx;
  height: 88rpx;
  min-height: 88rpx;
  border-radius: 24rpx;
  box-shadow: 0 5rpx 16rpx rgb(0 0 0 / 14%);
}

.hero-share {
  padding: 0;
}

.hero-control-icon {
  width: 38rpx;
  height: 38rpx;
  display: block;
}

.hero-count {
  right: 28rpx;
  bottom: 12rpx;
  padding: 6rpx 12rpx;
  font-size: 20rpx;
}

.thumbnail-scroll {
  padding: 10rpx 18rpx 0;
}

.thumbnail-list {
  gap: 8rpx;
}

.thumbnail-button {
  width: 110rpx;
  height: 88rpx;
  min-height: 88rpx;
  padding: 3rpx;
  border-width: 2rpx;
  border-radius: 14rpx;
}

.thumbnail-image {
  width: 100rpx;
  height: 78rpx;
  border-radius: 10rpx;
}

.merchant-overview {
  padding: 18rpx 22rpx 14rpx;
}

.headline {
  align-items: center;
  gap: 16rpx;
}

.title {
  flex: 1;
  font-size: 35rpx;
  line-height: 1.24;
  -webkit-line-clamp: 2;
}

.status {
  margin-top: 0;
  padding: 7rpx 13rpx;
  font-size: 21rpx;
}

.meta-row {
  gap: 7rpx;
  margin-top: 8rpx;
}

.meta-type,
.tag {
  padding: 5rpx 10rpx;
  font-size: 20rpx;
}

.summary-line {
  gap: 8rpx 14rpx;
  margin-top: 8rpx;
  font-size: 21rpx;
}

.distance,
.hours {
  font-size: 21rpx;
}

.intro-card {
  padding: 14rpx 16rpx;
  margin: 0 20rpx 10rpx;
  border-radius: 16rpx;
}

.intro-heading {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.intro-icon-shell {
  width: 40rpx;
  height: 40rpx;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 12rpx;
  background: rgb(255 255 255 / 70%);
}

.intro-icon {
  width: 25rpx;
  height: 25rpx;
  display: block;
}

.section-title {
  font-size: 29rpx;
  line-height: 1.25;
}

.description {
  margin-top: 6rpx;
  font-size: 23rpx;
  line-height: 1.48;
}

.content-section {
  padding: 18rpx 22rpx 20rpx;
  border-top-width: 8rpx;
}

.facility-section {
  padding-top: 12rpx;
  padding-bottom: 12rpx;
}

.facility-scroll {
  width: 100%;
  white-space: nowrap;
}

.facility-list {
  display: flex;
  width: max-content;
  gap: 9rpx;
  padding-right: 0;
}

.facility-item {
  width: 134rpx;
  min-height: 110rpx;
  display: flex;
  flex: none;
  padding: 9rpx 5rpx 8rpx;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 4rpx;
  border-radius: 16rpx;
  background: var(--surface-soft);
  text-align: center;
  box-sizing: border-box;
}

.facility-icon {
  width: 34rpx;
  height: 34rpx;
  display: block;
  flex: none;
  border-radius: 0;
  background: transparent;
}

.facility-label {
  min-height: 56rpx;
  display: -webkit-box;
  overflow: hidden;
  color: var(--ink-2);
  font-size: 23rpx;
  line-height: 1.2;
  white-space: normal;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.section-heading {
  gap: 0;
}

.horizontal-scroll {
  margin-top: 10rpx;
}

.horizontal-list {
  gap: 17rpx;
  padding-right: 0;
}

.signature-card,
.hot-card {
  width: 224rpx;
  overflow: visible;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.signature-image,
.hot-image {
  width: 224rpx;
  height: 154rpx;
  overflow: hidden;
  border-radius: 15rpx;
  font-size: 25rpx;
}

.hot-image-wrap {
  width: 224rpx;
  height: 154rpx;
}

.hot-rank {
  top: 8rpx;
  left: 8rpx;
  padding: 5rpx 8rpx;
  font-size: 20rpx;
}

.signature-name,
.hot-name {
  min-height: 60rpx;
  padding: 7rpx 2rpx 0;
  font-size: 23rpx;
  line-height: 1.3;
}

.signature-name {
  padding-bottom: 0;
}

.hot-price {
  padding: 4rpx 2rpx 0;
  font-size: 24rpx;
}

.hot-sales {
  padding: 2rpx 2rpx 0;
  font-size: 22rpx;
}

.bottom-actions {
  gap: 0;
  padding: 8rpx 24rpx 4rpx;
  border-top-width: 8rpx;
}

.bottom-action {
  height: 88rpx;
  min-height: 88rpx;
  padding: 5rpx 8rpx 3rpx;
  flex-direction: column;
  gap: 3rpx;
  border-radius: 16rpx;
  color: var(--ink-2);
  background: transparent;
  font-size: 23rpx;
  line-height: 1.15;
}

.bottom-action-icon {
  width: 28rpx;
  height: 28rpx;
  display: block;
}

.address-card {
  gap: 12rpx;
  padding: 12rpx 14rpx;
  margin: 0 22rpx 12rpx;
  border-radius: 16rpx;
}

.address-pin {
  width: 30rpx;
  height: 30rpx;
  display: block;
  flex: none;
}

.address-copy {
  gap: 3rpx;
}

.address-label {
  font-size: 20rpx;
}

.address-text {
  font-size: 22rpx;
  line-height: 1.38;
}

.address-distance {
  font-size: 20rpx;
}

.address-nav {
  min-width: 98rpx;
  height: 88rpx;
  min-height: 88rpx;
  display: flex;
  padding: 0 10rpx;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  border-radius: 16rpx;
  color: var(--brand-deep);
  background: var(--brand-soft);
  font-size: 20rpx;
  line-height: 1.1;
}

.address-nav-icon {
  width: 21rpx;
  height: 21rpx;
  display: block;
}

.actions {
  gap: 10rpx;
  padding: 8rpx 20rpx calc(8rpx + env(safe-area-inset-bottom));
}

.actions button {
  height: 96rpx;
  min-height: 96rpx;
  display: flex;
  padding: 0 16rpx;
  align-items: center;
  justify-content: center;
  gap: 9rpx;
  border-radius: 20rpx;
  font-size: 25rpx;
  line-height: 1.1;
}

.actions .delivery {
  border-color: transparent;
  background: var(--brand-soft);
}

.actions .delivery.is-solo {
  color: var(--on-brand);
  background: var(--brand-deep);
}

.order-action-icon {
  width: 30rpx;
  height: 30rpx;
  display: block;
  flex: none;
}

/* Final directed polish: compact content rails, split gallery roles, and one safe-area action dock. */
.page,
.page.has-order-actions {
  padding-bottom: calc(128rpx + env(safe-area-inset-bottom));
}

.meta-type,
.tag {
  border: 1rpx solid rgb(46 125 50 / 8%);
  color: #36753c;
  background: #f1f8f2;
}

.intro-card {
  background: #fff9eb;
}

.intro-icon-shell {
  border: 1rpx solid rgb(154 101 0 / 9%);
  background: rgb(255 255 255 / 76%);
}

.content-section {
  padding: 20rpx 22rpx 22rpx;
}

.facility-section {
  padding-top: 8rpx;
  padding-bottom: 8rpx;
}

.facility-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6rpx;
  margin-top: 0;
}

.facility-item {
  width: auto;
  height: 92rpx;
  min-height: 92rpx;
  padding: 3rpx 2rpx;
  gap: 2rpx;
  border-radius: 12rpx;
}

.facility-icon {
  width: 28rpx;
  height: 28rpx;
}

.facility-label {
  min-height: 44rpx;
  font-size: 21rpx;
  line-height: 1.16;
  -webkit-line-clamp: 2;
}

.featured-section .horizontal-scroll {
  margin-top: 11rpx;
}

.section-more {
  min-width: 96rpx;
  min-height: 88rpx;
  padding: 0 10rpx;
  color: var(--brand-deep);
  background: transparent;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1.2;
}

.dish-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18rpx 12rpx;
  margin-top: 11rpx;
}

.dish-grid.is-narrow {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18rpx 14rpx;
}

.dish-grid .signature-card,
.dish-grid .hot-card,
.dish-grid .signature-image,
.dish-grid .hot-image,
.dish-grid .hot-image-wrap {
  width: 100%;
}

.dish-grid .signature-image,
.dish-grid .hot-image,
.dish-grid .hot-image-wrap {
  height: 124rpx;
}

.dish-grid.is-narrow .signature-image,
.dish-grid.is-narrow .hot-image,
.dish-grid.is-narrow .hot-image-wrap {
  height: 148rpx;
}

.dish-grid .signature-name,
.dish-grid .hot-name {
  min-height: 56rpx;
  padding-top: 7rpx;
  font-size: 21rpx;
}

.dish-grid .hot-price {
  font-size: 21rpx;
}

.dish-grid .hot-meta {
  min-height: 54rpx;
  align-content: flex-start;
}

.dish-grid .hot-sales,
.dish-grid .hot-rank,
.dish-grid .hot-meta-separator {
  font-size: 18rpx;
  white-space: normal;
}

.horizontal-list {
  gap: 14rpx;
  padding-right: 22rpx;
}

.signature-card,
.hot-card {
  width: 208rpx;
}

.signature-image,
.hot-image,
.hot-image-wrap {
  width: 208rpx;
  height: 148rpx;
}

.signature-image,
.hot-image {
  border-radius: 14rpx;
}

.signature-name,
.hot-name {
  min-height: 58rpx;
  padding: 7rpx 1rpx 0;
  font-size: 22rpx;
  line-height: 1.3;
}

.hot-price {
  padding: 4rpx 1rpx 0;
  color: var(--brand-deep);
  font-size: 23rpx;
  line-height: 1.25;
}

.hot-meta {
  min-height: 32rpx;
  display: flex;
  padding: 3rpx 1rpx 0;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0 5rpx;
  line-height: 1.3;
}

.hot-sales,
.hot-rank,
.hot-meta-separator {
  position: static;
  display: inline;
  padding: 0;
  border-radius: 0;
  background: transparent;
  font-size: 20rpx;
  font-weight: 600;
  white-space: nowrap;
}

.hot-sales,
.hot-meta-separator {
  color: var(--ink-3);
}

.hot-rank {
  color: var(--warning-deep);
}

.environment-section {
  padding-bottom: 20rpx;
}

.environment-scroll {
  width: 100%;
  margin-top: 11rpx;
  white-space: nowrap;
}

.environment-list {
  display: flex;
  width: max-content;
  align-items: flex-start;
  gap: 14rpx;
  padding-right: 22rpx;
}

.environment-frame,
.environment-image {
  width: 310rpx;
  height: 184rpx;
}

.environment-frame {
  flex: none;
  overflow: hidden;
  border-radius: 15rpx;
  background: var(--brand-soft);
}

.environment-image {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 25rpx;
}

.address-card {
  margin-top: 8rpx;
  margin-bottom: 14rpx;
}

.identity-badges {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8rpx;
}

.claim-badge {
  display: inline-flex;
  padding: 6rpx 12rpx;
  align-items: center;
  border: 1rpx solid var(--claim-line);
  border-radius: 999rpx;
  color: var(--warning);
  background: var(--warm);
  font-size: 20rpx;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  box-sizing: border-box;
}

.claim-badge.is-claimed {
  border-color: var(--claim-claimed-line);
  color: var(--brand-deep);
  background: var(--brand-soft);
}

.claim-card {
  display: flex;
  margin: 0 22rpx 16rpx;
  padding: 18rpx;
  align-items: center;
  gap: 16rpx;
  border: 1rpx solid var(--claim-claimed-line);
  border-radius: 16rpx;
  background: var(--surface-soft);
  box-shadow: 0 7rpx 18rpx rgb(31 45 36 / 5%);
  box-sizing: border-box;
}

.claim-copy {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4rpx;
}

.claim-title {
  color: var(--ink);
  font-size: 25rpx;
  font-weight: 750;
  line-height: 1.3;
}

.claim-description {
  color: var(--ink-3);
  font-size: 21rpx;
  line-height: 1.4;
}

.claim-action {
  min-width: 154rpx;
  height: 88rpx;
  min-height: 88rpx;
  margin: 0;
  padding: 0 16rpx;
  border: 0;
  border-radius: 14rpx;
  color: var(--on-brand);
  background: var(--brand-deep);
  font-size: 22rpx;
  font-weight: 750;
  line-height: 88rpx;
  white-space: nowrap;
  transition: transform 160ms ease, opacity 160ms ease;
  box-sizing: border-box;
}

.claim-action::after {
  border: 0;
}

.claim-action.is-pressed {
  opacity: 0.86;
  transform: scale(0.96);
}

.sticky-actions {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
  display: flex;
  padding: 6rpx 18rpx calc(6rpx + env(safe-area-inset-bottom));
  align-items: stretch;
  gap: 8rpx;
  border-top: 1rpx solid var(--line);
  background: var(--surface);
  box-shadow: var(--dock-shadow);
  box-sizing: border-box;
}

.sticky-tools,
.sticky-orders {
  min-width: 0;
  display: flex;
  align-items: stretch;
}

.sticky-tools {
  flex: 1;
  justify-content: space-around;
}

.sticky-actions.has-order-ctas .sticky-tools {
  flex: 0 0 276rpx;
}

.sticky-orders {
  flex: 1;
  gap: 6rpx;
}

.sticky-actions .bottom-action {
  min-width: 88rpx;
  height: 88rpx;
  min-height: 88rpx;
  display: flex;
  margin: 0;
  padding: 4rpx 3rpx 2rpx;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 2rpx;
  border: 0;
  border-radius: 12rpx;
  color: var(--ink-2);
  background: transparent;
  font-size: 20rpx;
  font-weight: 650;
  line-height: 1.1;
  white-space: normal;
  box-sizing: border-box;
}

.sticky-actions:not(.has-order-ctas) .bottom-action {
  max-width: 190rpx;
}

.sticky-actions .bottom-action-icon {
  width: 24rpx;
  height: 24rpx;
  display: block;
  flex: none;
}

.sticky-orders button {
  min-width: 0;
  height: 88rpx;
  min-height: 88rpx;
  display: flex;
  flex: 1;
  margin: 0;
  padding: 0 7rpx;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  border: 2rpx solid transparent;
  border-radius: 16rpx;
  color: var(--on-brand);
  background: var(--brand-deep);
  font-size: 20rpx;
  font-weight: 800;
  line-height: 1.08;
  white-space: normal;
  transition: transform 160ms ease, opacity 160ms ease;
  box-sizing: border-box;
}

.sticky-orders button > text {
  min-width: 0;
  display: -webkit-box;
  overflow: hidden;
  text-align: center;
  overflow-wrap: anywhere;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.sticky-orders .delivery {
  border-color: transparent;
  color: var(--on-brand);
  background: var(--brand-deep);
}

.sticky-orders .pickup {
  border-color: var(--brand-hairline);
  color: var(--brand-deep);
  background: var(--brand-soft);
}

.sticky-orders .order-action-icon {
  width: 24rpx;
  height: 24rpx;
}

.sticky-orders button::after,
.sticky-actions .bottom-action::after {
  border: 0;
}

.sticky-orders button.is-pressed,
.sticky-actions .bottom-action.is-pressed {
  opacity: 0.86;
  transform: scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .sticky-orders button,
  .sticky-actions .bottom-action {
    transition: none;
  }
}

/* V3.2: claimed gallery controls stay inside the image without increasing Hero height. */
.gallery-category-scroll {
  position: absolute;
  right: 16rpx;
  bottom: 0;
  left: 16rpx;
  z-index: 3;
  width: auto;
  padding: 18rpx 12rpx 7rpx;
  overflow: hidden;
  border: 0;
  border-radius: 0 0 22rpx 22rpx;
  background: linear-gradient(180deg, rgb(16 34 23 / 0%) 0%, rgb(16 34 23 / 68%) 38%, rgb(16 34 23 / 82%) 100%);
  box-shadow: none;
  white-space: nowrap;
  box-sizing: border-box;
}

.gallery-category-list {
  display: inline-flex;
  min-width: max-content;
  gap: 5rpx;
}

.gallery-category-button {
  min-width: 118rpx;
  min-height: 88rpx;
  padding: 0 14rpx;
  gap: 6rpx;
  border: 1rpx solid transparent;
  border-radius: 14rpx;
  color: var(--on-brand);
  background: rgb(255 255 255 / 8%);
  font-size: 21rpx;
  font-weight: 750;
}

.gallery-category-button.is-active {
  border-color: rgb(255 255 255 / 54%);
  color: var(--brand-deep);
  background: rgb(255 255 255 / 92%);
}

.gallery-category-count {
  min-width: 27rpx;
  height: 27rpx;
  color: inherit;
  background: rgb(255 255 255 / 18%);
  font-size: 18rpx;
}

.gallery-category-button.is-active .gallery-category-count {
  background: var(--brand-soft);
}

.hero-count.has-gallery-overlay {
  bottom: 116rpx;
}

.section-heading {
  min-height: 88rpx;
  align-items: center;
}

.section-heading .section-title {
  min-width: 0;
  flex: 1;
}

.section-more {
  min-width: 0;
  display: inline-flex;
  flex: none;
  padding: 0 2rpx 0 18rpx;
  align-items: center;
  justify-content: flex-end;
  gap: 4rpx;
  white-space: nowrap;
}

.section-more-arrow {
  display: inline-block;
  font-size: 30rpx;
  font-weight: 500;
  line-height: 1;
  transition: transform 160ms ease;
}

.section-more-arrow.is-expanded {
  transform: rotate(-90deg);
}

.meta-type {
  border-color: var(--brand-deep);
  color: var(--on-brand);
  background: var(--brand-deep);
  font-weight: 750;
}
</style>
