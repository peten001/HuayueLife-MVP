<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getProduct } from '@/api/catalog';
import {
  formatNumberCurrency,
  merchantName,
  productName,
  productSubtitle,
  useI18n,
  usePageTitle,
} from '@/i18n';
import { useAppConfigStore } from '@/stores/app-config';
import { useCartStore } from '@/stores/cart';
import { resolveMediaUrl } from '@/utils/media';
import type { OrderType, Product } from '@/types/api';

const cartStore = useCartStore();
const appConfig = useAppConfigStore();
const product = ref<Product | null>(null);
const tableLabel = ref('');
const quantity = ref(1);
const error = ref('');
const notice = ref('');
const { locale, t } = useI18n();

usePageTitle(() => (appConfig.platformOrderingEnabled ? t('productDetailTitle') : t('orderingUnavailableTitle')));

onLoad(async (options) => {
  await appConfig.ensureLoaded();
  if (!appConfig.platformOrderingEnabled) return;
  const tableName = decodeURIComponent(String(options?.tableName ?? ''));
  const tableNo = decodeURIComponent(String(options?.tableNo ?? ''));
  const tableToken = String(options?.tableToken ?? '');
  tableLabel.value = tableName || tableNo;
  try {
    const loadedProduct = await getProduct(String(options?.id ?? ''), {
      tableToken,
    });
    const result = await cartStore.switchContext({
      merchantId: String(options?.merchantId ?? loadedProduct.merchant?.id ?? ''),
      merchantName: loadedProduct.merchant
        ? merchantName(loadedProduct.merchant, locale.value)
        : '',
      orderType: String(options?.orderType ?? 'PICKUP') as OrderType,
      tableToken: tableToken || undefined,
      tableNo: tableNo || undefined,
      tableName: tableName || undefined,
    });
    if (result === 'cancelled') {
      notice.value = t('cartContextSwitchCancelled');
      return;
    }
    if (result === 'failed') {
      error.value = t('cartContextSwitchError');
      uni.showToast({ title: error.value, icon: 'none' });
      return;
    }
    product.value = loadedProduct;
  } catch (caught) {
    console.error('[product] switchContext error', caught);
    error.value = caught instanceof Error ? caught.message : t('cartContextSwitchError');
    uni.showToast({ title: error.value, icon: 'none' });
  }
});

async function add() {
  if (!appConfig.platformOrderingEnabled) return;
  if (!product.value || product.value.status === 'SOLD_OUT') return;
  try {
    await cartStore.add(product.value.id, quantity.value);
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
    <view v-if="!appConfig.platformOrderingEnabled" class="safe-empty">
      <text class="safe-empty-title">{{ t('orderingUnavailableTitle') }}</text>
      <text class="safe-empty-copy">{{ t('orderingUnavailableMessage') }}</text>
      <button class="safe-empty-button" @click="goHome">{{ t('backHome') }}</button>
    </view>
    <text v-else-if="notice" class="notice">{{ notice }}</text>
    <view v-if="tableLabel && product" class="context">
      {{ product.merchant ? merchantName(product.merchant, locale) : '' }} · {{ t('tableLabel', { table: tableLabel }) }}
    </view>
    <text v-if="error" class="error">{{ error }}</text>
    <template v-else-if="product">
      <image
        v-if="resolveMediaUrl(product.imageUrl)"
        class="image"
        :src="resolveMediaUrl(product.imageUrl)"
        mode="aspectFill"
      />
      <view v-else class="image placeholder">{{ t('imagePlaceholder') }}</view>
      <view class="card">
        <text class="name">{{ productName(product, locale) }}</text>
        <text v-if="productSubtitle(product, locale)" class="vi">{{ productSubtitle(product, locale) }}</text>
        <text class="description">{{ product.description || t('noProductDescription') }}</text>
        <text class="price">{{ formatNumberCurrency(product.priceVnd) }}</text>
        <text v-if="product.status === 'SOLD_OUT'" class="sold-out">{{ t('soldOutCurrent') }}</text>
      </view>
      <view class="quantity">
        <button @click="quantity = Math.max(1, quantity - 1)">-</button>
        <text>{{ quantity }}</text>
        <button @click="quantity = Math.min(99, quantity + 1)">+</button>
      </view>
      <button class="add-cart" :disabled="product.status === 'SOLD_OUT'" @click="add">
        {{ product.status === 'SOLD_OUT' ? t('soldOut') : t('addToCart') }}
      </button>
    </template>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx; background: #f6faf7; }
.safe-empty { display: grid; gap: 20rpx; place-items: center; padding: 56rpx 34rpx; border-radius: 24rpx; background: #fff; text-align: center; box-shadow: 0 12rpx 32rpx rgb(46 125 50 / 7%); }
.safe-empty-title { color: #1f2d24; font-size: 34rpx; font-weight: 800; }
.safe-empty-copy { color: #5f6f64; font-size: 26rpx; line-height: 1.6; }
.safe-empty-button { min-width: 220rpx; margin: 0; color: #fff; background: #2e7d32; }
.safe-empty-button::after { border: 0; }
.context { padding: 18rpx 22rpx; margin-bottom: 20rpx; border-radius: 18rpx; color: #fff; background: #43a047; }
.notice { display: block; padding: 18rpx 22rpx; margin-bottom: 20rpx; border-radius: 14rpx; color: #8a5f00; background: #fff4d6; }
.image { width: 100%; height: 520rpx; border-radius: 24rpx; }
.placeholder { display: flex; align-items: center; justify-content: center; color: #6f8073; background: #e8f3ea; font-size: 28rpx; }
.card { padding: 28rpx; margin: 20rpx 0; border-radius: 24rpx; background: #fff; box-shadow: 0 12rpx 36rpx rgba(31, 45, 36, 0.08); }
.name { display: block; color: #1f2d24; font-size: 40rpx; font-weight: 800; }
.vi { display: block; margin-top: 6rpx; color: #5f6f64; }
.description { display: block; margin: 26rpx 0; color: #52645a; line-height: 1.7; }
.price { color: #1f2d24; font-size: 36rpx; font-weight: 800; }
.sold-out, .error { display: block; margin-top: 16rpx; color: #ff8a00; }
.quantity { display: flex; align-items: center; justify-content: center; gap: 28rpx; margin-bottom: 20rpx; }
.quantity text { color: #1f2d24; font-weight: 700; }
.quantity button { width: 64rpx; padding: 6rpx; color: #2e7d32; background: #e8f5e9; border: 2rpx solid #43a047; }
.add-cart { color: #fff; background: #2e7d32; }
.add-cart[disabled] { color: #7b8a80; background: #dfe7e1; }
</style>
