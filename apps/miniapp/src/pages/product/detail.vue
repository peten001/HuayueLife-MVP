<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getProduct } from '@/api/catalog';
import { useCartStore } from '@/stores/cart';
import type { OrderType, Product } from '@/types/api';

const cartStore = useCartStore();
const product = ref<Product | null>(null);
const tableLabel = ref('');
const quantity = ref(1);
const error = ref('');

onLoad(async (options) => {
  const tableName = decodeURIComponent(String(options?.tableName ?? ''));
  const tableNo = decodeURIComponent(String(options?.tableNo ?? ''));
  tableLabel.value = tableName || tableNo;
  try {
    product.value = await getProduct(String(options?.id ?? ''));
    const opened = await cartStore.openContext({
      merchantId: String(options?.merchantId ?? product.value.merchant?.id ?? ''),
      merchantName: product.value.merchant?.nameZh ?? '',
      orderType: String(options?.orderType ?? 'PICKUP') as OrderType,
      tableToken: String(options?.tableToken ?? '') || undefined,
      tableNo: tableNo || undefined,
      tableName: tableName || undefined,
    });
    if (!opened) {
      product.value = null;
      uni.navigateBack();
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '菜品加载失败';
  }
});

async function add() {
  if (!product.value || product.value.status === 'SOLD_OUT') return;
  try {
    await cartStore.add(product.value.id, quantity.value);
    uni.showToast({ title: '已加入购物车', icon: 'success' });
  } catch (caught) {
    uni.showToast({
      title: caught instanceof Error ? caught.message : '添加失败',
      icon: 'none',
    });
  }
}
</script>

<template>
  <view class="page">
    <view v-if="tableLabel && product" class="context">{{ product.merchant?.nameZh }} · 桌号 {{ tableLabel }}</view>
    <text v-if="error" class="error">{{ error }}</text>
    <template v-else-if="product">
      <image v-if="product.imageUrl" class="image" :src="product.imageUrl" mode="aspectFill" />
      <view class="card">
        <text class="name">{{ product.nameZh }}</text>
        <text v-if="product.nameVi" class="vi">{{ product.nameVi }}</text>
        <text class="description">{{ product.description || '暂无菜品描述' }}</text>
        <text class="price">{{ Number(product.priceVnd).toLocaleString() }} ₫</text>
        <text v-if="product.status === 'SOLD_OUT'" class="sold-out">当前已售罄</text>
      </view>
      <view class="quantity">
        <button @click="quantity = Math.max(1, quantity - 1)">-</button>
        <text>{{ quantity }}</text>
        <button @click="quantity = Math.min(99, quantity + 1)">+</button>
      </view>
      <button :disabled="product.status === 'SOLD_OUT'" @click="add">
        {{ product.status === 'SOLD_OUT' ? '已售罄' : '加入购物车' }}
      </button>
    </template>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx; background: #f6f3ef; }
.context { padding: 18rpx 22rpx; margin-bottom: 20rpx; border-radius: 14rpx; color: #fff; background: #9f2e26; }
.image { width: 100%; height: 520rpx; border-radius: 24rpx; }
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
