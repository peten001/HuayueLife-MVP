<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { getMenu } from '@/api/catalog';
import CartBar from '@/components/CartBar.vue';
import {
  categoryName,
  locale,
  merchantName,
  productName,
  useI18n,
  usePageTitle,
} from '@/i18n';
import { useCartStore } from '@/stores/cart';
import { resolveMediaUrl } from '@/utils/media';
import type { MenuResponse, OrderType, Product } from '@/types/api';

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

usePageTitle(() => t('menuTitle'));

onLoad(async (options) => {
  merchantId.value = String(options?.merchantId ?? '');
  orderType.value = (String(options?.orderType ?? 'PICKUP') as OrderType);
  tableNo.value = decodeURIComponent(String(options?.tableNo ?? ''));
  tableName.value = decodeURIComponent(String(options?.tableName ?? ''));
  tableToken.value = String(options?.tableToken ?? '');
  try {
    const loadedMenu = await getMenu(merchantId.value);
    const result = await cartStore.switchContext({
      merchantId: merchantId.value,
      merchantName: merchantName(loadedMenu.merchant, locale.value),
      orderType: orderType.value,
      tableToken: tableToken.value || undefined,
      tableNo: tableNo.value || undefined,
      tableName: tableName.value || undefined,
    });
    if (result === 'cancelled') {
      notice.value = t('cartContextSwitchCancelled');
      return;
    }
    if (result === 'failed') {
      error.value = t('cartContextSwitchError');
      return;
    }
    menu.value = loadedMenu;
    activeCategory.value = loadedMenu.categories[0]?.id ?? '';
  } catch (caught) {
    console.error('[menu] switchContext error', caught);
    const message = caught instanceof Error ? caught.message : t('cartContextSwitchError');
    uni.showToast({ title: message, icon: 'none' });
    error.value = message;
  }
});

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
    <view v-if="menu" class="context">
      <view>
        <text class="merchant">{{ merchantName(menu.merchant, locale) }}</text>
        <text v-if="hasTable" class="table">{{ t('tableLabel', { table: tableName || tableNo }) }}</text>
        <text v-else class="table">{{ t('browseOnly') }}</text>
      </view>
      <text :class="menu.merchant.isOpen ? 'open' : 'closed'">{{ menu.merchant.isOpen ? t('merchantOpen') : t('merchantClosed') }}</text>
    </view>
    <text v-if="notice" class="notice">{{ notice }}</text>
    <text v-if="error" class="error">{{ error }}</text>
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
        <template v-for="category in menu.categories" :key="category.id">
          <view v-if="activeCategory === category.id">
            <text class="category-title">{{ categoryName(category, locale) }}</text>
            <view
              v-for="product in category.products"
              :key="product.id"
              class="product"
              @click="openProduct(product)"
            >
              <image
                v-if="resolveMediaUrl(product.imageUrl)"
                class="image"
                :src="resolveMediaUrl(product.imageUrl)"
                mode="aspectFill"
              />
              <view v-else class="image placeholder">{{ t('imagePlaceholder') }}</view>
              <view class="product-body">
                <text class="product-name">{{ productName(product, locale) }}</text>
                <text class="description">{{ product.description || t('productDescriptionFallback') }}</text>
                <view class="price-row">
                  <text class="price">{{ Number(product.priceVnd).toLocaleString() }} ₫</text>
                  <text v-if="product.status === 'SOLD_OUT'" class="sold-out">{{ t('soldOut') }}</text>
                  <button v-else class="add" @click.stop="add(product)">+</button>
                </view>
              </view>
            </view>
          </view>
        </template>
      </scroll-view>
    </view>
    <CartBar v-if="menu" />
  </view>
</template>

<style scoped>
.page { min-height: 100vh; background: #f6f3ef; }
.context { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; padding: 22rpx 28rpx; color: #fff; background: #9f2e26; }
.merchant { display: block; font-size: 32rpx; font-weight: 700; }
.table { display: block; margin-top: 5rpx; opacity: .86; font-size: 23rpx; }
.open { color: #dff7e8; }
.closed, .error { color: #ffd2cd; }
.notice { display: block; padding: 18rpx 28rpx; color: #8a5f00; background: #fff4d6; }
.menu-layout { display: grid; grid-template-columns: 190rpx 1fr; height: calc(100vh - 190rpx); }
.categories { height: 100%; background: #eee8e3; }
.category { padding: 28rpx 18rpx; color: #666; font-size: 25rpx; }
.category.active { color: #a83228; background: #fff; font-weight: 700; }
.products { height: 100%; padding: 24rpx; background: #fff; box-sizing: border-box; }
.category-title { display: block; margin-bottom: 18rpx; font-size: 30rpx; font-weight: 700; }
.product { display: flex; gap: 18rpx; padding: 20rpx 0; border-bottom: 1rpx solid #eee; }
.image { width: 150rpx; height: 130rpx; flex: none; border-radius: 14rpx; }
.placeholder { display: flex; align-items: center; justify-content: center; color: #9d8f84; background: #f1e8df; font-size: 22rpx; }
.product-body { min-width: 0; flex: 1; }
.product-name { display: block; font-weight: 700; }
.description { display: -webkit-box; margin: 10rpx 0; overflow: hidden; color: #888; font-size: 22rpx; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.price-row { display: flex; justify-content: space-between; }
.price { color: #b83228; font-weight: 700; }
.sold-out { color: #999; font-size: 22rpx; }
.add { width: 48rpx; height: 48rpx; padding: 0; border-radius: 50%; color: #fff; background: #c43b2f; font-size: 32rpx; line-height: 48rpx; }
</style>
