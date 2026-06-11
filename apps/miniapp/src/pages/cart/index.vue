<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { formatNumberCurrency, orderTypeLabel, productName, useI18n, usePageTitle } from '@/i18n';
import { useCartStore } from '@/stores/cart';
import { resolveMediaUrl } from '@/utils/media';

const cartStore = useCartStore();
const { locale, t } = useI18n();
const amount = computed(() => Number(cartStore.cart?.itemAmountVnd ?? 0));

usePageTitle(() => t('cartTitle'));

onMounted(() => cartStore.load());

async function change(itemId: string, quantity: number) {
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
  if (!cartStore.cart?.items.length) return;
  uni.navigateTo({ url: '/pages/checkout/index' });
}
</script>

<template>
  <view class="page">
    <view v-if="cartStore.context" class="context">
      <text class="merchant">{{ cartStore.context.merchantName }}</text>
      <text>
        {{
          cartStore.context.orderType === 'DINE_IN'
            ? t('contextDineIn', { table: cartStore.context.tableName || cartStore.context.tableNo || '' })
            : orderTypeLabel(cartStore.context.orderType, locale)
        }}
      </text>
    </view>
    <view v-if="!cartStore.cart?.items.length" class="empty">{{ t('cartEmpty') }}</view>
    <view v-for="item in cartStore.cart?.items" :key="item.id" class="item">
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
          <button @click="change(item.id, item.quantity - 1)">-</button>
          <text>{{ item.quantity }}</text>
          <button @click="change(item.id, item.quantity + 1)">+</button>
          <button class="delete" @click="remove(item.id)">{{ t('delete') }}</button>
        </view>
      </view>
    </view>
    <view v-if="cartStore.cart?.items.length" class="footer">
      <button class="clear" @click="clear">{{ t('clearCart') }}</button>
      <view class="total">
        <text>{{ t('cartTotal', { amount: amount.toLocaleString() }) }}</text>
        <button class="submit" @click="checkout">{{ t('checkout') }}</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx 24rpx 180rpx; background: #f6f3ef; }
.context { padding: 24rpx; margin-bottom: 20rpx; border-radius: 18rpx; color: #fff; background: #9f2e26; }
.merchant { display: block; margin-bottom: 8rpx; font-size: 32rpx; font-weight: 700; }
.item { display: flex; gap: 20rpx; padding: 22rpx; margin-bottom: 16rpx; border-radius: 18rpx; background: #fff; }
.image { width: 140rpx; height: 120rpx; flex: none; border-radius: 12rpx; }
.placeholder { display: flex; align-items: center; justify-content: center; color: #9d8f84; background: #f1e8df; font-size: 22rpx; text-align: center; }
.body { min-width: 0; flex: 1; }
.name, .price { display: block; }
.name { font-weight: 700; }
.price { margin: 10rpx 0; color: #b83228; }
.stepper { display: flex; align-items: center; gap: 16rpx; }
.stepper button { width: 52rpx; padding: 4rpx; color: #333; background: #eee; line-height: 44rpx; }
.stepper .delete { width: auto; margin-left: auto; color: #a83228; background: transparent; font-size: 22rpx; }
.empty { padding: 120rpx 0; color: #888; text-align: center; }
.footer { position: fixed; right: 0; bottom: 0; left: 0; display: flex; align-items: center; justify-content: space-between; padding: 20rpx 24rpx; background: #fff; box-shadow: 0 -4rpx 18rpx rgb(0 0 0 / 8%); }
.total { display: flex; align-items: center; gap: 20rpx; font-weight: 700; }
.clear { color: #777; background: transparent; }
.submit { color: #fff; background: #c43b2f; }
</style>
