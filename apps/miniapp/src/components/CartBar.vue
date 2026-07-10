<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import { useAppConfigStore } from '@/stores/app-config';
import { useCartStore } from '@/stores/cart';

const appConfig = useAppConfigStore();
const cartStore = useCartStore();
const { t } = useI18n();
const amount = computed(() => Number(cartStore.cart?.itemAmountVnd ?? 0));
const quantity = computed(() => cartStore.cart?.totalQuantity ?? 0);
const hasItems = computed(() => quantity.value > 0);

function openCart() {
  if (!appConfig.platformOrderingEnabled) return;
  if (!hasItems.value) return;
  uni.navigateTo({ url: '/pages/cart/index' });
}
</script>

<template>
  <view v-if="appConfig.platformOrderingEnabled" class="cart-bar">
    <view class="summary">
      <view class="cart-icon" @click="openCart">
        <view class="cart-glyph">
          <view class="cart-body"></view>
          <view class="cart-wheel cart-wheel-left"></view>
          <view class="cart-wheel cart-wheel-right"></view>
        </view>
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
  right: 12px;
  bottom: calc(8px + env(safe-area-inset-bottom));
  left: 12px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 10px 12px;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 -6rpx 32rpx rgb(46 125 50 / 12%);
}

.summary {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 12rpx;
}

.cart-icon {
  position: relative;
  display: grid;
  width: 42px;
  height: 42px;
  flex: none;
  place-items: center;
  border-radius: 14px;
  color: #fff;
  background: #43a047;
}

.cart-glyph {
  position: relative;
  width: 22px;
  height: 18px;
}

.cart-body {
  position: absolute;
  top: 1px;
  left: 2px;
  width: 16px;
  height: 10px;
  border: 2px solid #fff;
  border-top: 0;
  border-radius: 0 0 4px 4px;
}

.cart-body::before {
  position: absolute;
  top: -5px;
  left: 1px;
  width: 10px;
  height: 2px;
  background: #fff;
  content: '';
  transform: rotate(14deg);
  transform-origin: left center;
}

.cart-wheel {
  position: absolute;
  bottom: 0;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #fff;
}

.cart-wheel-left {
  left: 5px;
}

.cart-wheel-right {
  right: 3px;
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
  font-size: 12px;
}

.amount {
  color: #1f2d24;
  font-size: 18px;
  font-weight: 800;
  white-space: nowrap;
}

button {
  min-width: 120px;
  margin: 0;
  min-height: 40px;
  padding: 0 16px;
  border: 0;
  border-radius: 999rpx;
  color: #fff;
  background: #2e7d32;
  font-size: 14px;
  font-weight: 700;
  line-height: 40px;
}

button::after {
  border: 0;
}

button[disabled] {
  color: #929892;
  background: #eeeeee;
}
</style>
