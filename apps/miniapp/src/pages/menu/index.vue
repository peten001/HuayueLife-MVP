<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { getMenu } from '@/api/catalog';
import CartBar from '@/components/CartBar.vue';
import {
  categoryName,
  locale,
  merchantName,
  orderTypeLabel,
  useI18n,
  usePageTitle,
} from '@/i18n';
import { useCartStore } from '@/stores/cart';
import { resolveMediaUrl } from '@/utils/media';
import type { MenuResponse, OrderType, Product } from '@/types/api';
import type { CartContext } from '@/types/api';

const cartStore = useCartStore();
const menu = ref<MenuResponse | null>(null);
const merchantId = ref('');
const orderType = ref<OrderType>('PICKUP');
const tableNo = ref('');
const tableName = ref('');
const tableToken = ref('');
const activeCategory = ref('');
const error = ref('');
const notice = ref('');
const hasTable = computed(() => Boolean(tableToken.value && tableNo.value));
const { t } = useI18n();
const currentCategory = computed(
  () => menu.value?.categories.find((category) => category.id === activeCategory.value) ?? null,
);

usePageTitle(() => t('menuTitle'));

onLoad(async (options) => {
  merchantId.value = String(options?.merchantId ?? '');
  orderType.value = (String(options?.orderType ?? 'PICKUP') as OrderType);
  tableNo.value = decodeURIComponent(String(options?.tableNo ?? ''));
  tableName.value = decodeURIComponent(String(options?.tableName ?? ''));
  tableToken.value = String(options?.tableToken ?? '');
  try {
    const loadedMenu = await getMenu(merchantId.value, {
      tableToken: tableToken.value,
    });
    await ensureMenuContext(loadedMenu);
    menu.value = loadedMenu;
    activeCategory.value = loadedMenu.categories[0]?.id ?? '';
  } catch (caught) {
    console.error('[menu] ensure cart context failed', caught);
    const message = caught instanceof Error ? caught.message : t('cartContextSwitchError');
    uni.showToast({ title: message, icon: 'none' });
    error.value = message;
  }
});

onShow(() => {
  if (!menu.value || !merchantId.value) return;
  void ensureMenuContext(menu.value);
});

async function ensureMenuContext(loadedMenu: MenuResponse) {
  const nextContext = buildContext(loadedMenu);
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

  if (!cartStore.context || !cartStore.needsContextSwitch(nextContext)) {
    const result = await cartStore.switchContext(nextContext);
    if (result === 'failed') {
      throw new Error(t('cartContextSwitchError'));
    }
    console.log('[menu] ensure cart context success', cartStore.context);
    error.value = '';
    return result;
  }

  if (cartStore.hasItems()) {
    const confirmed = await confirmContextSwitch(nextContext);
    console.log('[cart] user confirmed switch', confirmed);
    if (!confirmed) {
      notice.value = t('cartContextSwitchCancelled');
      console.log('[menu] ensure cart context failed', {
        reason: 'user cancelled switch',
        currentContext: cartStore.context,
        nextContext,
      });
      return 'cancelled';
    }
    console.log('[cart] clear cart before switch');
    try {
      await cartStore.clearCart();
    } catch (error) {
      console.error('[menu] clear cart before switch failed', error);
      throw error instanceof Error ? error : new Error(t('cartContextSwitchError'));
    }
  }

  const result = await cartStore.switchContext(nextContext);
  if (result === 'failed') {
    throw new Error(t('cartContextSwitchError'));
  }
  console.log('[menu] ensure cart context success', cartStore.context);
  error.value = '';
  notice.value = '';
  return result;
}

function buildContext(loadedMenu: MenuResponse): CartContext {
  return {
    merchantId: merchantId.value,
    merchantName: merchantName(loadedMenu.merchant, locale.value),
    orderType: orderType.value,
    tableToken: tableToken.value || undefined,
    tableNo: tableNo.value || undefined,
    tableName: tableName.value || undefined,
  };
}

function confirmContextSwitch(nextContext: CartContext) {
  const sameMerchant = cartStore.context?.merchantId === nextContext.merchantId;
  const content = sameMerchant
    ? '当前购物车已有菜品，是否切换到新的桌台？\n切换后当前购物车将清空。'
    : '切换商家会清空当前购物车，是否继续？';
  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '提示',
      content,
      cancelText: '取消',
      confirmText: sameMerchant ? '切换桌台' : '继续切换',
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => resolve(false),
    });
  });
}

function openProduct(product: Product) {
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
  if (locale.value === 'vi') return product.nameVi || product.nameZh;
  if (locale.value === 'en') return product.nameZh;
  return product.nameZh;
}

function getProductSubtitle(product: Product) {
  if (locale.value === 'zh') return product.nameVi || '';
  if (locale.value === 'vi') return product.nameZh || '';
  return product.nameZh || product.nameVi || '';
}

async function add(product: Product) {
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
</script>

<template>
  <view class="page">
    <view v-if="menu" class="merchant-card">
      <view class="merchant-visual">
        <view class="visual-circle visual-circle-large"></view>
        <view class="visual-circle visual-circle-small"></view>
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
          <text class="table-notice-icon">桌</text>
          <text>{{ t('tableOrderingActive', { table: tableName || tableNo }) }}</text>
        </view>
      </view>
    </view>
    <view v-if="notice" class="notice">{{ notice }}</view>
    <view v-if="error" class="error">{{ error }}</view>
    <view v-else-if="menu" class="menu-layout">
      <scroll-view class="categories" scroll-y>
        <view
          v-for="category in menu.categories"
          :key="category.id"
          :class="['category', activeCategory === category.id ? 'active' : '']"
          @click="activeCategory = category.id"
        >
          {{ categoryName(category, locale) }}
        </view>
      </scroll-view>
      <scroll-view class="products" scroll-y>
        <view v-if="currentCategory" class="product-list">
          <view class="category-heading">
            <text class="category-title">{{ categoryName(currentCategory, locale) }}</text>
            <text class="category-count">
              {{ t('dishCount', { count: currentCategory.products.length }) }}
            </text>
          </view>
          <view v-if="!currentCategory.products.length" class="empty">
            <view class="empty-icon">菜</view>
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
              <view class="price-row">
                <text class="price">
                  <text class="currency">₫</text>
                  {{ Number(product.priceVnd).toLocaleString() }}
                </text>
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
          <view class="empty-icon">菜</view>
          <text class="empty-title">{{ t('noDishes') }}</text>
          <text class="empty-copy">{{ t('tryAgainLater') }}</text>
        </view>
      </scroll-view>
    </view>
    <CartBar v-if="menu" />
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

.price-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-top: auto;
}

.price {
  color: #1f2d24;
  font-size: 17px;
  font-weight: 800;
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
