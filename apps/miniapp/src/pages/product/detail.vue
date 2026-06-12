<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getProduct } from '@/api/catalog';
import {
  formatNumberCurrency,
  merchantName,
  productName,
  useI18n,
  usePageTitle,
} from '@/i18n';
import { useCartStore } from '@/stores/cart';
import { resolveMediaUrl } from '@/utils/media';
import type { OrderType, Product } from '@/types/api';

const cartStore = useCartStore();
const product = ref<Product | null>(null);
const tableLabel = ref('');
const quantity = ref(1);
const error = ref('');
const notice = ref('');
const { locale, t } = useI18n();

usePageTitle(() => t('productDetailTitle'));

onLoad(async (options) => {
  const tableName = decodeURIComponent(String(options?.tableName ?? ''));
  const tableNo = decodeURIComponent(String(options?.tableNo ?? ''));
  tableLabel.value = tableName || tableNo;
  try {
    const loadedProduct = await getProduct(String(options?.id ?? ''));
    const result = await cartStore.switchContext({
      merchantId: String(options?.merchantId ?? loadedProduct.merchant?.id ?? ''),
      merchantName: loadedProduct.merchant
        ? merchantName(loadedProduct.merchant, locale.value)
        : '',
      orderType: String(options?.orderType ?? 'PICKUP') as OrderType,
      tableToken: String(options?.tableToken ?? '') || undefined,
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
</script>

<template>
  <view class="page">
    <text v-if="notice" class="notice">{{ notice }}</text>
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
        <text v-if="product.nameVi" class="vi">{{ product.nameVi }}</text>
        <text class="description">{{ product.description || t('noProductDescription') }}</text>
        <text class="price">{{ formatNumberCurrency(product.priceVnd) }}</text>
        <text v-if="product.status === 'SOLD_OUT'" class="sold-out">{{ t('soldOutCurrent') }}</text>
      </view>
      <view class="quantity">
        <button @click="quantity = Math.max(1, quantity - 1)">-</button>
        <text>{{ quantity }}</text>
        <button @click="quantity = Math.min(99, quantity + 1)">+</button>
      </view>
      <button :disabled="product.status === 'SOLD_OUT'" @click="add">
        {{ product.status === 'SOLD_OUT' ? t('soldOut') : t('addToCart') }}
      </button>
    </template>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx; background: #f6f3ef; }
.context { padding: 18rpx 22rpx; margin-bottom: 20rpx; border-radius: 14rpx; color: #fff; background: #9f2e26; }
.notice { display: block; padding: 18rpx 22rpx; margin-bottom: 20rpx; border-radius: 14rpx; color: #8a5f00; background: #fff4d6; }
.image { width: 100%; height: 520rpx; border-radius: 24rpx; }
.placeholder { display: flex; align-items: center; justify-content: center; color: #9d8f84; background: #f1e8df; font-size: 28rpx; }
.card { padding: 28rpx; margin: 20rpx 0; border-radius: 20rpx; background: #fff; }
.name { display: block; font-size: 40rpx; font-weight: 800; }
.vi { display: block; margin-top: 6rpx; color: #888; }
.description { display: block; margin: 26rpx 0; color: #666; line-height: 1.7; }
.price { color: #b83228; font-size: 36rpx; font-weight: 800; }
.sold-out, .error { display: block; margin-top: 16rpx; color: #a83228; }
.quantity { display: flex; align-items: center; justify-content: center; gap: 28rpx; margin-bottom: 20rpx; }
.quantity button { width: 64rpx; padding: 6rpx; color: #333; background: #eee; }
button { color: #fff; background: #c43b2f; }
button[disabled] { color: #777; background: #ddd; }
</style>
