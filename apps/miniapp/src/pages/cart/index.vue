<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { formatNumberCurrency, orderTypeLabel, productName, useI18n, usePageTitle } from '@/i18n';
import { useAppConfigStore } from '@/stores/app-config';
import { useCartStore } from '@/stores/cart';
import { resolveMediaUrl } from '@/utils/media';

const appConfig = useAppConfigStore();
const cartStore = useCartStore();
const { locale, t } = useI18n();
const amount = computed(() => Number(cartStore.cart?.itemAmountVnd ?? 0));

usePageTitle(() => (appConfig.platformOrderingEnabled ? t('cartTitle') : t('orderingUnavailableTitle')));

onMounted(() => {
  void bootstrapCart();
});

async function bootstrapCart() {
  await appConfig.ensureLoaded();
  if (!appConfig.platformOrderingEnabled) return;
  await cartStore.load();
}

async function change(itemId: string, quantity: number) {
  if (!appConfig.platformOrderingEnabled) return;
  try {
    await cartStore.setQuantity(itemId, quantity);
  } catch (caught) {
    uni.showToast({
      title: caught instanceof Error ? caught.message : t('updateFailed'),
      icon: 'none',
    });
  }
}

async function remove(itemId: string) {
  if (!appConfig.platformOrderingEnabled) return;
  try {
    await cartStore.remove(itemId);
  } catch (caught) {
    uni.showToast({
      title: caught instanceof Error ? caught.message : t('updateFailed'),
      icon: 'none',
    });
  }
}

async function clear() {
  if (!appConfig.platformOrderingEnabled) return;
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: t('emptyCartTitle'),
      content: t('emptyCartConfirm'),
      success: (result) => resolve(result.confirm),
      fail: () => resolve(false),
    });
  });
  if (confirmed) await cartStore.clear();
}

function checkout() {
  if (!appConfig.platformOrderingEnabled) return;
  if (!cartStore.cart?.items.length) return;
  uni.navigateTo({ url: '/pages/checkout/index' });
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
    <view v-else-if="cartStore.context" class="context">
      <view class="context-mark">🍽️</view>
      <view>
        <text class="merchant">{{ cartStore.context.merchantName }}</text>
        <text class="order-type">
          {{
            cartStore.context.orderType === 'DINE_IN'
              ? t('contextDineIn', { table: cartStore.context.tableName || cartStore.context.tableNo || '' })
              : orderTypeLabel(cartStore.context.orderType, locale)
          }}
        </text>
      </view>
    </view>
    <view v-if="appConfig.platformOrderingEnabled && !cartStore.cart?.items.length" class="empty">
      <view class="empty-icon">🛒</view>
      <text class="empty-title">{{ t('cartEmpty') }}</text>
    </view>
    <view v-for="item in appConfig.platformOrderingEnabled ? cartStore.cart?.items : []" :key="item.id" class="item">
      <image
        v-if="resolveMediaUrl(item.product.imageUrl)"
        class="image"
        :src="resolveMediaUrl(item.product.imageUrl)"
        mode="aspectFill"
      />
      <view v-else class="image placeholder">{{ t('imagePlaceholder') }}</view>
      <view class="body">
        <text class="name">{{ productName(item.product, locale) }}</text>
        <text class="price">{{ formatNumberCurrency(item.product.priceVnd) }}</text>
        <view class="stepper">
          <button class="minus" @click="change(item.id, item.quantity - 1)">−</button>
          <text class="quantity">{{ item.quantity }}</text>
          <button class="plus" @click="change(item.id, item.quantity + 1)">+</button>
          <button class="delete" @click="remove(item.id)">{{ t('delete') }}</button>
        </view>
      </view>
    </view>
    <view v-if="appConfig.platformOrderingEnabled && cartStore.cart?.items.length" class="footer">
      <button class="clear" @click="clear">{{ t('clearCart') }}</button>
      <view class="total">
        <view class="total-copy">
          <text class="total-label">{{ t('totalAmount') }}</text>
          <text class="total-amount">{{ amount.toLocaleString() }} ₫</text>
        </view>
        <button class="submit" @click="checkout">{{ t('checkout') }}</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24rpx 24rpx calc(190rpx + env(safe-area-inset-bottom));
  color: #1f2d24;
  background: #f6faf7;
  box-sizing: border-box;
}

.safe-empty {
  display: grid;
  gap: 20rpx;
  place-items: center;
  padding: 56rpx 34rpx;
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

.context {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 26rpx;
  margin-bottom: 22rpx;
  border-radius: 28rpx;
  color: #fff;
  background: linear-gradient(135deg, #43a047, #2e7d32);
  box-shadow: 0 14rpx 36rpx rgb(46 125 50 / 15%);
}

.context-mark {
  display: grid;
  width: 72rpx;
  height: 72rpx;
  flex: none;
  place-items: center;
  border-radius: 22rpx;
  color: #2e7d32;
  background: #ffcf83;
  font-size: 32rpx;
}

.merchant {
  display: block;
  margin-bottom: 7rpx;
  font-size: 32rpx;
  font-weight: 800;
}

.order-type {
  display: block;
  color: rgb(255 255 255 / 84%);
  font-size: 23rpx;
}

.item {
  display: flex;
  gap: 20rpx;
  padding: 22rpx;
  margin-bottom: 18rpx;
  border-radius: 26rpx;
  background: #fff;
  box-shadow: 0 10rpx 28rpx rgb(46 125 50 / 7%);
}

.image {
  width: 142rpx;
  height: 126rpx;
  flex: none;
  border-radius: 18rpx;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6e7d72;
  background: #eaf7ee;
  font-size: 21rpx;
  text-align: center;
}

.body {
  min-width: 0;
  flex: 1;
}

.name,
.price {
  display: block;
}

.name {
  overflow: hidden;
  color: #1f2d24;
  font-size: 27rpx;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.price {
  margin: 10rpx 0 13rpx;
  color: #1f2d24;
  font-size: 25rpx;
  font-weight: 700;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.stepper button {
  width: 50rpx;
  height: 50rpx;
  min-height: 50rpx;
  padding: 0;
  margin: 0;
  border-radius: 50%;
  font-size: 28rpx;
  line-height: 50rpx;
}

.stepper button::after,
.clear::after,
.submit::after {
  border: 0;
}

.minus {
  border: 2rpx solid #43a047;
  color: #2e7d32;
  background: #fff;
}

.plus {
  border: 0;
  color: #fff;
  background: #43a047;
}

.quantity {
  min-width: 30rpx;
  color: #1f2d24;
  font-size: 24rpx;
  font-weight: 700;
  text-align: center;
}

.stepper .delete {
  width: auto;
  height: auto;
  min-height: 0;
  margin-left: auto;
  color: #c26a6a;
  background: transparent;
  font-size: 21rpx;
  line-height: 1.5;
}

.empty {
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 110rpx 30rpx;
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 12rpx 32rpx rgb(46 125 50 / 6%);
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 96rpx;
  height: 96rpx;
  place-items: center;
  margin-bottom: 20rpx;
  border-radius: 30rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 34rpx;
  font-weight: 800;
}

.empty-title {
  color: #1f2d24;
  font-size: 28rpx;
  font-weight: 700;
}

.footer {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 18rpx 24rpx calc(18rpx + env(safe-area-inset-bottom));
  background: #fff;
  box-shadow: 0 -8rpx 30rpx rgb(46 125 50 / 10%);
}

.total {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  gap: 18rpx;
}

.total-copy {
  display: grid;
  gap: 2rpx;
  text-align: right;
}

.total-label {
  color: #7c877f;
  font-size: 20rpx;
}

.total-amount {
  color: #1f2d24;
  font-size: 29rpx;
  font-weight: 800;
  white-space: nowrap;
}

.clear {
  flex: none;
  margin: 0;
  padding: 10rpx 8rpx;
  border: 0;
  color: #7d867f;
  background: transparent;
  font-size: 22rpx;
}

.submit {
  min-width: 190rpx;
  margin: 0;
  border: 0;
  border-radius: 22rpx;
  color: #fff;
  background: #2e7d32;
  font-size: 24rpx;
  font-weight: 700;
}
</style>
