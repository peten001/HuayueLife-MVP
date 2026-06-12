<script setup lang="ts">
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getMerchant } from '@/api/catalog';
import {
  merchantName,
  orderTypeLabel,
  useI18n,
  usePageTitle,
} from '@/i18n';
import { useCartStore } from '@/stores/cart';
import type { MerchantDetail } from '@/types/api';
import { resolveMediaUrl } from '@/utils/media';

const cartStore = useCartStore();
const merchant = ref<MerchantDetail | null>(null);
const error = ref('');
const { locale, t } = useI18n();

usePageTitle(() => t('merchantDetailTitle'));

onLoad(async (options) => {
  try {
    merchant.value = await getMerchant(String(options?.id ?? ''));
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : t('merchantLoadFailed');
  }
});

async function openMenu(orderType: 'PICKUP' | 'DELIVERY') {
  if (!merchant.value) return;
  const merchantId = merchant.value.id;
  const url = `/pages/menu/index?merchantId=${merchantId}&orderType=${orderType}`;
  const nextContext = {
    merchantId,
    merchantName: merchantName(merchant.value, locale.value),
    orderType,
  };
  console.log('[merchant/detail] tap open menu', {
    merchantId,
    orderType,
    currentContext: cartStore.context,
    cart: cartStore.cart,
    hasItems: cartStore.hasItems(),
    needsContextSwitch: cartStore.needsContextSwitch(nextContext),
    nextContext,
    url,
  });
  try {
    console.log('[merchant/detail] before ensureLoaded', {
      merchantId,
      orderType,
      currentContext: cartStore.context,
      cart: cartStore.cart,
      hasItems: cartStore.hasItems(),
      needsSwitch: cartStore.needsContextSwitch(nextContext),
    });
    await cartStore.ensureLoaded();
    console.log('[merchant/detail] after ensureLoaded', {
      currentContext: cartStore.context,
      cart: cartStore.cart,
      hasItems: cartStore.hasItems(),
      needsSwitch: cartStore.needsContextSwitch(nextContext),
    });
    const needsSwitch = cartStore.needsContextSwitch(nextContext);
    const hasItems = cartStore.hasItems();
    console.log('[merchant/detail] switch decision', {
      merchantId,
      orderType,
      currentContext: cartStore.context,
      cart: cartStore.cart,
      hasItems,
      needsSwitch,
      nextContext,
    });
    if (needsSwitch && hasItems) {
      console.log('[merchant/detail] show confirm modal', {
        merchantId,
        orderType,
      });
      const confirmed = await confirmSwitch();
      console.log('[merchant/detail] confirm result', {
        merchantId,
        orderType,
        confirmed,
      });
      if (!confirmed) {
        return;
      }
      try {
        await cartStore.clearCart();
      } catch (error) {
        console.error('[merchant/detail] clearCart failed', {
          merchantId,
          orderType,
          currentContext: cartStore.context,
          nextContext,
          error,
        });
        uni.showToast({ title: t('cartContextSwitchError'), icon: 'none' });
        return;
      }
    }
    const result = await cartStore.switchContext(nextContext);
    console.log('[merchant/detail] switchContext result', {
      merchantId,
      orderType,
      result,
      currentContext: cartStore.context,
      nextContext,
    });
    if (result === 'failed') {
      console.error('[merchant/detail] switch context failed', {
        merchantId,
        orderType,
        currentContext: cartStore.context,
        nextContext,
      });
      uni.showToast({ title: t('cartContextSwitchError'), icon: 'none' });
      return;
    }
    uni.navigateTo({
      url,
      fail(error) {
        console.log('[merchant/detail] navigateTo failed', error);
        uni.showToast({ title: t('navigationFailed'), icon: 'none' });
      },
    });
  } catch (error) {
    console.error('[merchant/detail] openMenu failed', error);
    uni.showToast({ title: t('cartContextSwitchError'), icon: 'none' });
  }
}

function confirmSwitch() {
  return new Promise<boolean>((resolve, reject) => {
    try {
      uni.showModal({
        title: t('switchSceneTitle'),
        content: t('switchSceneContent'),
        confirmText: t('switchSceneConfirm'),
        cancelText: t('switchSceneCancel'),
        success: (result) => resolve(result.confirm),
        fail: (error) => {
          console.error('[merchant/detail] confirmSwitch failed', error);
          reject(error);
        },
      });
    } catch (error) {
      console.error('[merchant/detail] confirmSwitch threw', error);
      reject(error);
    }
  });
}
</script>

<template>
  <view class="page">
    <text v-if="error" class="error">{{ error }}</text>
    <template v-else-if="merchant">
      <image
        v-if="resolveMediaUrl(merchant.coverUrl)"
        class="cover"
        :src="resolveMediaUrl(merchant.coverUrl)"
        mode="aspectFill"
      />
      <view v-else class="cover placeholder">{{ t('imagePlaceholder') }}</view>
      <view class="card">
        <view class="headline">
          <text class="title">{{ merchantName(merchant, locale) }}</text>
          <text :class="merchant.isOpen ? 'open' : 'closed'">{{ merchant.isOpen ? t('merchantOpen') : t('merchantClosed') }}</text>
        </view>
        <text class="address">{{ merchant.addressDetail }}</text>
        <text class="phone">{{ t('phone') }}：{{ merchant.contactPhone }}</text>
        <text v-if="merchant.notice" class="notice">{{ merchant.notice }}</text>
        <view class="tags">
          <text v-for="type in merchant.supportedOrderTypes" :key="type" class="tag">{{ orderTypeLabel(type, locale) }}</text>
        </view>
      </view>
      <view class="actions">
        <button
          v-if="merchant.supportedOrderTypes.includes('PICKUP')"
          type="button"
          class="primary"
          @tap="openMenu('PICKUP')"
        >
          {{ t('pickup') }}
        </button>
        <button
          v-if="merchant.supportedOrderTypes.includes('DELIVERY')"
          type="button"
          class="primary delivery"
          @tap="openMenu('DELIVERY')"
        >
          {{ t('delivery') }}
        </button>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx; background: #f6f3ef; }
.cover { width: 100%; height: 360rpx; border-radius: 24rpx; }
.placeholder { display: flex; align-items: center; justify-content: center; color: #9d8f84; background: #f1e8df; font-size: 28rpx; }
.card { padding: 28rpx; margin: 20rpx 0; border-radius: 20rpx; background: #fff; }
.headline { display: flex; justify-content: space-between; gap: 20rpx; }
.title { font-size: 40rpx; font-weight: 800; }
.open { color: #16854a; }
.closed, .error { color: #a83228; }
.address, .phone, .notice { display: block; margin-top: 18rpx; color: #666; }
.notice { padding: 18rpx; border-radius: 12rpx; background: #fff5eb; }
.tags { display: flex; gap: 10rpx; margin-top: 20rpx; }
.tag { padding: 6rpx 12rpx; border-radius: 8rpx; color: #a83228; background: #fff0ed; font-size: 22rpx; }
.primary { color: #fff; background: #c43b2f; }
.actions { display: flex; gap: 16rpx; }
.actions button { flex: 1; }
.delivery { background: #9b5a2e; }
</style>
