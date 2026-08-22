<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { onLoad, onShareAppMessage, onShareTimeline, onShow } from '@dcloudio/uni-app';
import { getMenu } from '@/api/catalog';
import CartBar from '@/components/CartBar.vue';
import {
  categoryName,
  merchantName,
  orderTypeLabel,
  productName,
  productSubtitle,
  useI18n,
  usePageTitle,
} from '@/i18n';
import { useAppConfigStore } from '@/stores/app-config';
import { useCartStore, type ContextSwitchResult } from '@/stores/cart';
import { resolveMediaUrl } from '@/utils/media';
import { formatProductUnitSuffix } from '@/utils/product-unit-display';
import type { MenuResponse, OrderType, Product } from '@/types/api';
import type { CartContext } from '@/types/api';

const appConfig = useAppConfigStore();
const cartStore = useCartStore();
const menu = ref<MenuResponse | null>(null);
const merchantId = ref('');
const orderType = ref<OrderType>('PICKUP');
const tableNo = ref('');
const tableName = ref('');
const tableToken = ref('');
const activeCategory = ref('');
const searchQuery = ref('');
const previousBrowsingCategory = ref('');
const error = ref('');
const notice = ref('');
const orderingUnavailable = ref(false);
const HOT_CATEGORY_ID = '__hot_recommendations__';
const SEARCH_CATEGORY_ID = '__search_results__';
const hasTable = computed(() => Boolean(tableToken.value && tableNo.value));
const { locale, t } = useI18n();
const isSearching = computed(() => Boolean(searchQuery.value.trim()));
const normalCategories = computed(() => menu.value?.categories ?? []);
const hotProducts = computed(() => {
  const candidates: Array<{ product: Product; index: number }> = [];
  normalCategories.value.forEach((category) => {
    if (isHotCategoryExcluded(category)) return;
    category.products.forEach((product) => {
      if (Number(product.salesCount) > 0) {
        candidates.push({ product, index: candidates.length });
      }
    });
  });

  return candidates
    .sort((left, right) => Number(right.product.salesCount) - Number(left.product.salesCount) || left.index - right.index)
    .slice(0, 8)
    .map(({ product }) => product);
});
const hotCategory = computed(() =>
  hotProducts.value.length
    ? {
        id: HOT_CATEGORY_ID,
        nameZh: t('hotRecommendations'),
        products: hotProducts.value,
      }
    : null,
);
const hotRanks = computed(() => new Map(hotProducts.value.map((product, index) => [product.id, index + 1])));
const searchResults = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  if (!query) return [];
  return normalCategories.value.flatMap((category) =>
    category.products.filter((product) =>
      product.nameZh.toLocaleLowerCase().includes(query)
      || product.nameVi?.toLocaleLowerCase().includes(query)
      || product.nameEn?.toLocaleLowerCase().includes(query),
    ),
  );
});
const searchCategory = computed(() => ({
  id: SEARCH_CATEGORY_ID,
  nameZh: t('searchResults'),
  products: searchResults.value,
}));
const visibleCategories = computed(() => {
  if (isSearching.value) return [searchCategory.value];
  return hotCategory.value ? [hotCategory.value, ...normalCategories.value] : normalCategories.value;
});
const currentCategory = computed(
  () => visibleCategories.value.find((category) => category.id === activeCategory.value) ?? null,
);

watch(isSearching, (searching) => {
  if (searching) {
    if (activeCategory.value !== SEARCH_CATEGORY_ID) {
      previousBrowsingCategory.value = activeCategory.value;
    }
    activeCategory.value = SEARCH_CATEGORY_ID;
    return;
  }

  activeCategory.value = visibleCategories.value.some(
    (category) => category.id === previousBrowsingCategory.value,
  )
    ? previousBrowsingCategory.value
    : defaultCategoryId();
});

usePageTitle(() => (orderingUnavailable.value ? t('orderingUnavailableTitle') : t('menuTitle')));

onLoad(async (options) => {
  const shareMerchantId = String(options?.shareMerchantId ?? '').trim();
  if (
    String(options?.shareTarget ?? '') === 'merchantDetail'
    && /^\d+$/.test(shareMerchantId)
  ) {
    uni.redirectTo({
      url: `/pages/merchant/detail?id=${encodeURIComponent(shareMerchantId)}`,
    });
    return;
  }

  merchantId.value = String(options?.merchantId ?? '');
  orderType.value = (String(options?.orderType ?? 'PICKUP') as OrderType);
  tableNo.value = decodeURIComponent(String(options?.tableNo ?? ''));
  tableName.value = decodeURIComponent(String(options?.tableName ?? ''));
  tableToken.value = String(options?.tableToken ?? '');
  normalizeRouteContext();
  await appConfig.ensureLoaded();
  if (!appConfig.platformOrderingEnabled) {
    orderingUnavailable.value = true;
    return;
  }
  const previousContext = cloneCartContext(cartStore.context);
  try {
    const contextResult = await ensureMenuContext(buildContext());
    if (contextResult === 'cancelled') {
      redirectToPreviousCartContext(previousContext);
      return;
    }
    if (contextResult === 'failed') {
      redirectToPreviousCartContext(previousContext, t('cartContextSwitchError'));
      return;
    }
  } catch (caught) {
    console.error('[menu] ensure cart context failed', caught);
    const message = caught instanceof Error ? caught.message : t('cartContextSwitchError');
    redirectToPreviousCartContext(previousContext, message);
    return;
  }

  try {
    const loadedMenu = await getMenu(merchantId.value, {
      tableToken: tableToken.value,
    });
    cartStore.syncContextMetadata(buildContext(loadedMenu));
    menu.value = loadedMenu;
    activeCategory.value = defaultCategoryId();
    previousBrowsingCategory.value = activeCategory.value;
  } catch (caught) {
    console.error('[menu] load menu failed', caught);
    const message = caught instanceof Error ? caught.message : t('cartContextSwitchError');
    uni.showToast({ title: message, icon: 'none' });
    error.value = message;
  }
});

function menuShareTitle() {
  return merchantName(menu.value?.merchant, locale.value) || '云桥 Life';
}

function merchantDetailSharePath() {
  return merchantId.value
    ? `/pages/merchant/detail?id=${encodeURIComponent(merchantId.value)}`
    : '/pages/home/index';
}

onShareAppMessage(() => ({
  title: menuShareTitle(),
  path: merchantDetailSharePath(),
}));

onShareTimeline(() => ({
  title: menuShareTitle(),
  ...(merchantId.value
    ? {
        query:
          `shareTarget=merchantDetail&shareMerchantId=${encodeURIComponent(merchantId.value)}`,
      }
    : {}),
}));

onShow(() => {
  if (!menu.value || !merchantId.value) return;
  void ensureMenuContext(buildContext(menu.value));
});

async function ensureMenuContext(nextContext: CartContext): Promise<ContextSwitchResult> {
  console.log('[menu] ensure cart context start', {
    params: {
      merchantId: merchantId.value,
      orderType: orderType.value,
      tableToken: tableToken.value,
      tableNo: tableNo.value,
      tableName: tableName.value,
    },
    currentContext: cartStore.context,
    nextContext,
    hasItems: cartStore.hasItems(),
  });

  await cartStore.ensureLoaded();

  if (!cartStore.context || !cartStore.needsContextSwitch(nextContext)) {
    const result = await cartStore.switchContext(nextContext);
    if (result === 'failed') {
      return 'failed';
    }
    cartStore.syncContextMetadata(nextContext);
    console.log('[menu] ensure cart context success', cartStore.context);
    error.value = '';
    return result;
  }

  if (cartStore.hasItems()) {
    const confirmResult = await confirmContextSwitch(nextContext);
    console.log('[cart] user confirmed switch', confirmResult === 'confirmed');
    if (confirmResult === 'cancelled') {
      notice.value = '';
      console.log('[menu] ensure cart context failed', {
        reason: 'user cancelled switch',
        currentContext: cartStore.context,
        nextContext,
      });
      return 'cancelled';
    }
    console.log('[cart] clear cart and switch context');
    const result = await cartStore.clearAndSwitchContext(nextContext);
    if (result === 'failed') {
      return 'failed';
    }
    cartStore.syncContextMetadata(nextContext);
    console.log('[menu] ensure cart context success', cartStore.context);
    error.value = '';
    notice.value = '';
    return result;
  }

  const result = await cartStore.switchContext(nextContext);
  if (result === 'failed') {
    return 'failed';
  }
  cartStore.syncContextMetadata(nextContext);
  console.log('[menu] ensure cart context success', cartStore.context);
  error.value = '';
  notice.value = '';
  return result;
}

function normalizeRouteContext() {
  if (orderType.value !== 'DINE_IN') {
    tableNo.value = '';
    tableName.value = '';
    tableToken.value = '';
  }
}

function buildContext(loadedMenu?: MenuResponse): CartContext {
  const fallbackMerchantName =
    cartStore.context?.merchantId === merchantId.value ? cartStore.context.merchantName : '';
  const context: CartContext = {
    merchantId: merchantId.value,
    merchantName: loadedMenu ? merchantName(loadedMenu.merchant, locale.value) : fallbackMerchantName,
    orderType: orderType.value,
  };
  if (orderType.value === 'DINE_IN') {
    context.tableToken = tableToken.value || undefined;
    context.tableNo = tableNo.value || undefined;
    context.tableName = tableName.value || undefined;
  }
  return context;
}

function cloneCartContext(context: CartContext | null): CartContext | null {
  return context ? { ...context } : null;
}

function menuUrlFromContext(context: CartContext) {
  if (context.orderType !== 'DINE_IN' || !context.merchantId || !context.tableToken) {
    return '';
  }
  const query = [
    `merchantId=${encodeURIComponent(context.merchantId)}`,
    'orderType=DINE_IN',
    `tableToken=${encodeURIComponent(context.tableToken)}`,
  ];
  if (context.tableNo) query.push(`tableNo=${encodeURIComponent(context.tableNo)}`);
  if (context.tableName) query.push(`tableName=${encodeURIComponent(context.tableName)}`);
  return `/pages/menu/index?${query.join('&')}`;
}

function previousContextUrl(context: CartContext | null) {
  const menuUrl = context ? menuUrlFromContext(context) : '';
  if (menuUrl) return menuUrl;
  return '/pages/cart/index';
}

function redirectToPreviousCartContext(previousContext: CartContext | null, message?: string) {
  if (message) {
    uni.showToast({ title: message, icon: 'none' });
  }
  const context = previousContext ?? cloneCartContext(cartStore.context);
  const targetUrl = previousContextUrl(context);
  console.log('[menu] redirect to previous cart context', {
    previousContext: context,
    targetUrl,
  });
  redirectWithFallback(targetUrl);
}

function redirectWithFallback(url: string) {
  uni.redirectTo({
    url,
    fail(error) {
      console.warn('[menu] redirect to previous context failed', {
        url,
        error,
      });
      if (url !== '/pages/cart/index') {
        redirectWithFallback('/pages/cart/index');
        return;
      }
      uni.switchTab({
        url: '/pages/home/index',
        fail(homeError) {
          console.warn('[menu] fallback to home failed', homeError);
        },
      });
    },
  });
}

function confirmContextSwitch(nextContext: CartContext) {
  const sameMerchant = cartStore.context?.merchantId === nextContext.merchantId;
  const isTableSwitch =
    sameMerchant &&
    cartStore.context?.orderType === 'DINE_IN' &&
    nextContext.orderType === 'DINE_IN';
  const title = locale.value === 'vi' ? 'Thông báo' : locale.value === 'en' ? 'Notice' : '提示';
  const content = isTableSwitch
    ? locale.value === 'vi'
      ? 'Giỏ hàng hiện có món ăn. Bạn có muốn chuyển sang bàn mới không?\nSau khi chuyển bàn, giỏ hàng hiện tại sẽ bị xóa.'
      : locale.value === 'en'
        ? 'Your cart already has items. Do you want to switch to the new table?\nAfter switching tables, the current cart will be cleared.'
        : '当前购物车已有菜品，是否切换到新的桌台？\n切换后当前购物车将清空。'
    : locale.value === 'vi'
      ? 'Đổi cửa hàng, bàn hoặc loại đơn sẽ xóa giỏ hàng hiện tại. Tiếp tục không?'
      : locale.value === 'en'
        ? 'Switching merchant, table, or order type will clear the current cart. Continue?'
        : '切换商家、桌台或订单类型会清空当前购物车，是否继续？';
  const cancelText = locale.value === 'vi' ? 'Hủy' : locale.value === 'en' ? 'No' : '取消';
  const confirmText =
    locale.value === 'zh' && isTableSwitch
      ? '切换桌台'
      : locale.value === 'zh'
        ? '确认'
        : 'OK';
  return new Promise<'confirmed' | 'cancelled'>((resolve) => {
    uni.showModal({
      title,
      content,
      cancelText,
      confirmText,
      success: (result) => resolve(result.confirm === true ? 'confirmed' : 'cancelled'),
      fail: (error) => {
        console.warn('[menu] switch table modal failed', error);
        resolve('cancelled');
      },
    });
  });
}

function openProduct(product: Product) {
  if (orderingUnavailable.value || !appConfig.platformOrderingEnabled) return;
  const tableQuery = hasTable.value
    ? `&tableNo=${encodeURIComponent(tableNo.value)}&tableName=${encodeURIComponent(tableName.value)}&tableToken=${encodeURIComponent(tableToken.value)}`
    : '';
  uni.navigateTo({
    url:
      `/pages/product/detail?id=${product.id}` +
      `&merchantId=${merchantId.value}&orderType=${orderType.value}${tableQuery}`,
  });
}

function getProductDisplayName(product: Product) {
  return productName(product, locale.value);
}

function getProductSubtitle(product: Product) {
  return productSubtitle(product, locale.value);
}

function isHotCategoryExcluded(category: { nameZh: string }) {
  const name = category.nameZh.trim();
  return name.includes('米饭') || name.includes('饮料') || name.includes('饮品') || name.includes('酒水');
}

function defaultCategoryId() {
  return hotCategory.value?.id ?? normalCategories.value[0]?.id ?? '';
}

function selectCategory(categoryId: string) {
  activeCategory.value = categoryId;
  if (categoryId !== SEARCH_CATEGORY_ID) {
    previousBrowsingCategory.value = categoryId;
  }
}

function categoryDisplayName(category: { id: string; nameZh: string }) {
  if (category.id === HOT_CATEGORY_ID) return t('hotRecommendations');
  if (category.id === SEARCH_CATEGORY_ID) return t('searchResults');
  return categoryName(category, locale.value);
}

function hotRank(product: Product) {
  return hotRanks.value.get(product.id) ?? 0;
}

async function add(product: Product) {
  if (orderingUnavailable.value || !appConfig.platformOrderingEnabled) return;
  if (product.status === 'SOLD_OUT') return;
  try {
    await cartStore.add(product.id);
    uni.showToast({ title: t('addToCartSuccess'), icon: 'success' });
  } catch (caught) {
    uni.showToast({
      title: caught instanceof Error ? caught.message : t('addToCartFailed'),
      icon: 'none',
    });
  }
}

function goHome() {
  uni.switchTab({ url: '/pages/home/index' });
}
</script>

<template>
  <view class="page">
    <view v-if="orderingUnavailable" class="safe-empty">
      <text class="safe-empty-title">{{ t('orderingUnavailableTitle') }}</text>
      <text class="safe-empty-copy">{{ t('orderingUnavailableMessage') }}</text>
      <button class="safe-empty-button" @click="goHome">{{ t('backHome') }}</button>
    </view>
    <view v-else-if="menu" class="merchant-card">
      <view class="merchant-visual">
        <view class="visual-circle visual-circle-large"></view>
        <view class="visual-circle visual-circle-small"></view>
        <!-- Brand decoration only. Not a functional icon. -->
        <view class="dish-mark">鲜</view>
      </view>
      <view class="merchant-content">
        <view class="merchant-summary">
          <view class="merchant-head">
            <text class="merchant">{{ merchantName(menu.merchant, locale) }}</text>
          </view>
          <view class="service-tags">
            <text :class="['status', menu.merchant.isOpen ? 'open' : 'closed']">
              {{ menu.merchant.isOpen ? t('merchantOpen') : t('merchantClosed') }}
            </text>
            <text class="service-tag">{{ orderTypeLabel(orderType, locale) }}</text>
            <text class="service-tag">{{ t('browseMenu') }}</text>
            <text v-if="hasTable" class="service-tag table-tag">
              {{ t('currentTable') }}：{{ tableName || tableNo }}
            </text>
          </view>
        </view>
        <view v-if="hasTable" class="table-notice">
          <text class="table-notice-icon">🍽️</text>
          <text>{{ t('tableOrderingActive', { table: tableName || tableNo }) }}</text>
        </view>
      </view>
    </view>
    <view v-if="!orderingUnavailable && menu" class="menu-search">
      <input
        v-model="searchQuery"
        class="menu-search-input"
        type="text"
        :placeholder="t('searchDishes')"
        confirm-type="search"
      />
    </view>
    <view v-if="!orderingUnavailable && notice" class="notice">{{ notice }}</view>
    <view v-if="!orderingUnavailable && error" class="error">{{ error }}</view>
    <view v-else-if="!orderingUnavailable && menu" class="menu-layout">
      <scroll-view class="categories" scroll-y>
        <view
          v-for="category in visibleCategories"
          :key="category.id"
          :class="['category', activeCategory === category.id ? 'active' : '']"
          @click="selectCategory(category.id)"
        >
          {{ categoryDisplayName(category) }}
        </view>
      </scroll-view>
      <scroll-view class="products" scroll-y>
        <view v-if="currentCategory" class="product-list">
          <view class="category-heading">
            <text class="category-title">{{ categoryDisplayName(currentCategory) }}</text>
            <text class="category-count">
              {{ t('dishCount', { count: currentCategory.products.length }) }}
            </text>
          </view>
          <view v-if="!currentCategory.products.length" class="empty">
            <view class="empty-icon">🍽️</view>
            <text class="empty-title">{{ t('noDishes') }}</text>
            <text class="empty-copy">{{ t('tryAgainLater') }}</text>
          </view>
          <view
            v-for="product in currentCategory.products"
            :key="product.id"
            :class="['product', product.status === 'SOLD_OUT' ? 'product-sold-out' : '']"
            @click="openProduct(product)"
          >
            <view class="image-wrap">
              <image
                v-if="resolveMediaUrl(product.imageUrl)"
                class="image"
                :src="resolveMediaUrl(product.imageUrl)"
                mode="aspectFill"
              />
              <view v-else class="image placeholder">{{ t('imagePlaceholder') }}</view>
              <text v-if="product.status === 'SOLD_OUT'" class="sold-out-badge">
                {{ t('soldOut') }}
              </text>
            </view>
            <view class="product-body">
              <text class="product-name">{{ getProductDisplayName(product) }}</text>
              <text v-if="getProductSubtitle(product)" class="description">
                {{ getProductSubtitle(product) }}
              </text>
              <text class="sales-count">
                <text class="sales-value">{{ t('salesCount', { count: product.salesCount }) }}</text>
                <text v-if="hotRank(product)" class="sales-separator"> · </text>
                <text v-if="hotRank(product)" class="hot-rank">
                  {{ t('hotRank', { rank: hotRank(product) }) }}
                </text>
              </text>
              <view class="price-row">
                <view class="price-copy">
                  <text class="price">
                    <text class="currency">₫</text>
                    {{ Number(product.priceVnd).toLocaleString() }}
                  </text>
                  <text v-if="formatProductUnitSuffix(product.unit)" class="price-unit">
                    {{ formatProductUnitSuffix(product.unit) }}
                  </text>
                </view>
                <button
                  v-if="product.status !== 'SOLD_OUT'"
                  class="add"
                  :aria-label="t('addToCart')"
                  @click.stop="add(product)"
                >
                  +
                </button>
                <text v-else class="sold-out">{{ t('soldOut') }}</text>
              </view>
            </view>
          </view>
        </view>
        <view v-else class="empty product-list">
          <view class="empty-icon">🍽️</view>
          <text class="empty-title">{{ t('noDishes') }}</text>
          <text class="empty-copy">{{ t('tryAgainLater') }}</text>
        </view>
      </scroll-view>
    </view>
    <CartBar v-if="menu && !orderingUnavailable" />
  </view>
</template>

<style scoped>
.page {
  display: flex;
  height: 100vh;
  min-height: 0;
  flex-direction: column;
  padding: 8rpx 12rpx calc(132rpx + env(safe-area-inset-bottom));
  color: #1f2d24;
  background: #f6faf7;
  box-sizing: border-box;
}

.safe-empty {
  display: grid;
  gap: 20rpx;
  place-items: center;
  margin: auto 0;
  padding: 52rpx 34rpx;
  border-radius: 24rpx;
  background: #fff;
  text-align: center;
  box-shadow: 0 12rpx 32rpx rgb(46 125 50 / 7%);
}

.safe-empty-title {
  color: #1f2d24;
  font-size: 34rpx;
  font-weight: 800;
}

.safe-empty-copy {
  color: #5f6f64;
  font-size: 26rpx;
  line-height: 1.6;
}

.safe-empty-button {
  min-width: 220rpx;
  margin: 0;
  color: #fff;
  background: #2e7d32;
}

.safe-empty-button::after {
  border: 0;
}

.merchant-card {
  flex: none;
  overflow: hidden;
  margin: 8rpx 0;
  border-radius: 16px;
  background: linear-gradient(135deg, #2f8f3f, #4fb263 65%, #67c97a);
  box-shadow: 0 12rpx 28rpx rgb(46 125 50 / 10%);
}

.merchant-visual {
  position: relative;
  height: 82rpx;
  overflow: hidden;
  background: transparent;
}

.visual-circle {
  position: absolute;
  border-radius: 50%;
  background: rgb(255 255 255 / 13%);
}

.visual-circle-large {
  top: -90rpx;
  right: -42rpx;
  width: 188rpx;
  height: 188rpx;
}

.visual-circle-small {
  bottom: -34rpx;
  left: 92rpx;
  width: 84rpx;
  height: 84rpx;
}

.dish-mark {
  position: absolute;
  right: 22rpx;
  top: 20rpx;
  display: grid;
  width: 62rpx;
  height: 62rpx;
  place-items: center;
  border: 7rpx solid rgb(255 255 255 / 72%);
  border-radius: 50%;
  color: #2e7d32;
  background: #ffcf83;
  box-shadow: inset 0 0 0 7rpx rgb(255 255 255 / 35%);
  font-size: 22rpx;
  font-weight: 800;
  box-sizing: border-box;
}

.merchant-content {
  padding: 0 18px 14px;
}

.merchant-summary {
  transform: translateY(-12px);
}

.merchant-head {
  display: flex;
  align-items: flex-start;
  gap: 10rpx;
  padding-top: 0;
}

.merchant {
  min-width: 0;
  color: #fff;
  font-size: 22px;
  font-weight: 800;
}

.status {
  flex: none;
  padding: 6rpx 12rpx;
  border-radius: 999rpx;
  font-size: 12px;
  font-weight: 700;
}

.open {
  color: #1e7b34;
  background: rgb(255 255 255 / 92%);
}

.closed {
  color: #935d00;
  background: #fff1dc;
}

.service-tags {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  margin-top: 8px;
  overflow: hidden;
}

.service-tag {
  padding: 4rpx 10rpx;
  border-radius: 999rpx;
  color: #1e7b34;
  background: rgb(255 255 255 / 9);
  font-size: 12px;
  white-space: nowrap;
}

.table-tag {
  color: #1e7b34;
  background: rgb(255 255 255 / 92%);
}

.table-notice {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 12rpx 14rpx;
  margin-top: 10rpx;
  border-radius: 16rpx;
  color: #fff;
  background: rgb(255 255 255 / 14%);
  font-size: 22rpx;
  font-weight: 700;
}

.table-notice-icon {
  display: grid;
  width: 43rpx;
  height: 43rpx;
  flex: none;
  place-items: center;
  border-radius: 13rpx;
  color: #fff;
  background: #43a047;
  font-size: 18rpx;
}

.browse-note {
  display: block;
  margin-top: 12rpx;
  color: rgb(255 255 255 / 86%);
  font-size: 22rpx;
}

.notice,
.error {
  flex: none;
  display: block;
  padding: 18rpx 22rpx;
  margin-bottom: 18rpx;
  border-radius: 18rpx;
  font-size: 22rpx;
}

.notice {
  color: #8a5a00;
  background: #fff3dd;
}

.error {
  color: #8a5a00;
  background: #fff3dd;
}

.menu-search {
  flex: none;
  padding: 8rpx 0 16rpx;
}

.menu-search-input {
  width: 100%;
  height: 68rpx;
  padding: 0 24rpx;
  border: 2rpx solid #dceee0;
  border-radius: 18rpx;
  color: #1f2d24;
  background: #fff;
  font-size: 25rpx;
  box-sizing: border-box;
}

.menu-layout {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  min-height: 0;
  flex: 1;
  overflow: hidden;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 10rpx 28rpx rgb(46 125 50 / 6%);
}

.categories {
  height: 100%;
  min-height: 0;
  background: #f6faf7;
  scrollbar-width: none;
}

.categories::-webkit-scrollbar,
.products::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.category {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 48px;
  padding: 0 4px 0 10px;
  color: #3d473f;
  font-size: 13px;
  line-height: 1.2;
}

.category.active {
  color: #2e7d32;
  background: #fff;
  font-weight: 800;
}

.category.active::before {
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 0;
  width: 3px;
  border-radius: 0 8rpx 8rpx 0;
  background: #43a047;
  content: '';
}

.products {
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 10px 10px 0;
  background: #fff;
  box-sizing: border-box;
  scrollbar-width: none;
}

.product-list {
  padding-bottom: calc(90px + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.category-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12rpx;
  min-height: 40px;
  margin-bottom: 2px;
}

.category-title {
  color: #1f2d24;
  font-size: 18px;
  font-weight: 800;
}

.category-count {
  color: #919b93;
  font-size: 13px;
}

.product {
  display: flex;
  gap: 10px;
  min-height: 100px;
  padding: 10px 4px;
  margin-bottom: 0;
  border-bottom: 2rpx solid #eef2ef;
  background: #fff;
}

.product-sold-out {
  opacity: .7;
}

.image-wrap {
  position: relative;
  width: 76px;
  height: 76px;
  flex: none;
}

.image {
  width: 100%;
  height: 100%;
  border-radius: 10px;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6d7c71;
  background: #eaf7ee;
  font-size: 21rpx;
  text-align: center;
}

.sold-out-badge {
  position: absolute;
  right: 8rpx;
  bottom: 8rpx;
  padding: 5rpx 9rpx;
  border-radius: 999rpx;
  color: #666;
  background: rgb(255 255 255 / 92%);
  font-size: 18rpx;
}

.product-body {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
}

.product-name {
  display: block;
  overflow: hidden;
  color: #1f2d24;
  font-size: 16px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.description {
  display: block;
  margin: 3px 0 4px;
  overflow: hidden;
  color: #818b83;
  font-size: 12px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sales-count {
  display: block;
  margin: 3px 0 4px;
  color: #818b83;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
}

.sales-value {
  color: #818b83;
  font-weight: 400;
}

.sales-separator {
  color: #b3bbb5;
  font-weight: 400;
}

.hot-rank {
  color: #ff8a00;
  font-weight: 600;
}

.price-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-top: auto;
}

.price-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: baseline;
  overflow: hidden;
}

.price {
  flex: none;
  color: #1f2d24;
  font-size: 17px;
  font-weight: 800;
}

.price-unit {
  display: block;
  min-width: 0;
  margin-left: 6rpx;
  overflow: hidden;
  color: #5f6f64;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.currency {
  margin-right: 3rpx;
  color: #ff8a00;
  font-size: 13px;
}

.sold-out {
  color: #888;
  font-size: 21rpx;
}

.add {
  width: 38px;
  height: 38px;
  min-height: 38px;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 50%;
  color: #fff;
  background: #43a047;
  font-size: 22px;
  font-weight: 500;
  line-height: 38px;
}

.add::after {
  border: 0;
}

.empty {
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 100rpx 20rpx;
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 86rpx;
  height: 86rpx;
  place-items: center;
  margin-bottom: 20rpx;
  border-radius: 28rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 31rpx;
  font-weight: 800;
}

.empty-title {
  color: #1f2d24;
  font-size: 27rpx;
  font-weight: 700;
}

.empty-copy {
  margin-top: 9rpx;
  color: #8b958d;
  font-size: 21rpx;
}
</style>
