<script setup lang="ts">
import { computed } from 'vue';
import { useCartStore } from '@/stores/cart';

const cartStore = useCartStore();
const amount = computed(() => Number(cartStore.cart?.itemAmountVnd ?? 0));

function openCart() {
  uni.navigateTo({ url: '/pages/cart/index' });
}
</script>

<template>
  <view class="cart-bar" @click="openCart">
    <view class="summary">
      <text class="count">{{ cartStore.cart?.totalQuantity ?? 0 }}</text>
      <text class="amount">{{ amount.toLocaleString() }} ₫</text>
    </view>
    <button>查看购物车</button>
  </view>
</template>

<style scoped>
.cart-bar { position: fixed; right: 24rpx; bottom: 28rpx; left: 214rpx; z-index: 5; display: flex; align-items: center; justify-content: space-between; padding: 14rpx 16rpx 14rpx 24rpx; border-radius: 999rpx; color: #fff; background: #262626; box-shadow: 0 10rpx 30rpx rgb(0 0 0 / 20%); }
.summary { display: flex; align-items: center; gap: 16rpx; }
.count { display: grid; width: 42rpx; height: 42rpx; place-items: center; border-radius: 50%; background: #c43b2f; font-size: 22rpx; }
.amount { font-weight: 700; }
button { margin: 0; padding: 10rpx 20rpx; border-radius: 999rpx; color: #fff; background: #c43b2f; font-size: 23rpx; line-height: 1.5; }
</style>
