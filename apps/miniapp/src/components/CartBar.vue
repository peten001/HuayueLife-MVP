<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import { useCartStore } from '@/stores/cart';

const cartStore = useCartStore();
const { t } = useI18n();
const amount = computed(() => Number(cartStore.cart?.itemAmountVnd ?? 0));
const quantity = computed(() => cartStore.cart?.totalQuantity ?? 0);
const hasItems = computed(() => quantity.value > 0);

function openCart() {
  if (!hasItems.value) return;
  uni.navigateTo({ url: '/pages/cart/index' });
}
</script>

<template>
  <view class="cart-bar">
    <view class="summary">
      <view class="cart-icon" @click="openCart">
        <text class="cart-glyph">篮</text>
        <text v-if="hasItems" class="count">{{ quantity }}</text>
      </view>
      <view class="amount-block" @click="openCart">
        <text class="amount-label">{{ t('cartSelected', { count: quantity }) }}</text>
        <text class="amount">{{ amount.toLocaleString() }} ₫</text>
      </view>
    </view>
    <button :disabled="!hasItems" @click="openCart">
      {{ hasItems ? t('checkoutShort') : t('selectItems') }}
    </button>
  </view>
</template>

<style scoped>
.cart-bar {
  position: fixed;
  right: 24rpx;
  bottom: calc(24rpx + env(safe-area-inset-bottom));
  left: 24rpx;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 16rpx 18rpx 16rpx 20rpx;
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 -6rpx 32rpx rgb(46 125 50 / 12%);
}

.summary {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 16rpx;
}

.cart-icon {
  position: relative;
  display: grid;
  width: 74rpx;
  height: 74rpx;
  flex: none;
  place-items: center;
  border-radius: 24rpx;
  color: #fff;
  background: #43a047;
}

.cart-glyph {
  font-size: 26rpx;
  font-weight: 800;
}

.count {
  position: absolute;
  top: -10rpx;
  right: -9rpx;
  display: grid;
  min-width: 34rpx;
  height: 34rpx;
  padding: 0 7rpx;
  place-items: center;
  border: 4rpx solid #fff;
  border-radius: 999rpx;
  color: #fff;
  background: #ff8a00;
  font-size: 18rpx;
  font-weight: 700;
  box-sizing: border-box;
}

.amount-block {
  min-width: 0;
  display: grid;
  gap: 3rpx;
}

.amount-label {
  color: #7e8981;
  font-size: 20rpx;
}

.amount {
  color: #1f2d24;
  font-size: 29rpx;
  font-weight: 800;
  white-space: nowrap;
}

button {
  min-width: 176rpx;
  margin: 0;
  padding: 13rpx 22rpx;
  border: 0;
  border-radius: 999rpx;
  color: #fff;
  background: #2e7d32;
  font-size: 23rpx;
  font-weight: 700;
  line-height: 1.5;
}

button::after {
  border: 0;
}

button[disabled] {
  color: #929892;
  background: #eeeeee;
}
</style>
