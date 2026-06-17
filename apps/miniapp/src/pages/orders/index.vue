<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import { getOrders } from '@/api/orders';
import {
  locale,
  merchantName,
  orderStatusLabel,
  orderTypeLabel,
  useI18n,
  usePageTitle,
} from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import type { UserOrder } from '@/types/api';

type Filter = 'ALL' | 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

const auth = useAuthStore();
const orders = ref<UserOrder[]>([]);
const filter = ref<Filter>('ALL');
const loading = ref(false);
const message = ref('');
let timer: ReturnType<typeof setInterval> | undefined;
const { t } = useI18n();

usePageTitle(() => t('ordersTitle'));

const filterOptions = computed<Array<{ value: Filter; label: string }>>(() => [
  { value: 'ALL', label: t('all') },
  { value: 'PENDING', label: t('pendingAcceptance') },
  { value: 'ACTIVE', label: t('active') },
  { value: 'COMPLETED', label: t('completed') },
  { value: 'CANCELLED', label: t('cancelled') },
]);

const filteredOrders = computed(() =>
  orders.value.filter((order) => {
    if (filter.value === 'PENDING') return order.status === 'PENDING_ACCEPTANCE';
    if (filter.value === 'ACTIVE') {
      return !['PENDING_ACCEPTANCE', 'COMPLETED', 'CANCELLED'].includes(order.status);
    }
    if (filter.value === 'COMPLETED') return order.status === 'COMPLETED';
    if (filter.value === 'CANCELLED') return order.status === 'CANCELLED';
    return true;
  }),
);

async function load(showLoading = false) {
  if (showLoading) loading.value = true;
  try {
    await auth.ensureLogin();
    orders.value = await getOrders();
    message.value = '';
  } catch (caught) {
    message.value = caught instanceof Error ? caught.message : t('orderLoadError');
  } finally {
    loading.value = false;
  }
}

function openOrder(id: string) {
  uni.navigateTo({ url: `/pages/order/detail?id=${id}` });
}

function orderNow() {
  uni.switchTab({ url: '/pages/home/index' });
}

onShow(() => {
  void load(true);
  if (!timer) timer = setInterval(() => void load(), 5000);
});

onHide(() => {
  if (timer) clearInterval(timer);
  timer = undefined;
});
</script>

<template>
  <view class="page">
    <view class="page-heading">
      <text class="page-title">{{ t('ordersTitle') }}</text>
      <text class="page-subtitle">{{ t('ordersSubtitle') }}</text>
    </view>

    <view class="filters">
      <button
        v-for="item in filterOptions"
        :key="item.value"
        :class="{ active: filter === item.value }"
        @click="filter = item.value"
      >
        {{ item.label }}
      </button>
    </view>

    <view v-if="message" class="message">{{ message }}</view>
    <view v-if="loading" class="empty">
      <view class="empty-icon">单</view>
      <text class="empty-title">{{ t('loading') }}</text>
    </view>
    <view v-else-if="!filteredOrders.length" class="empty">
      <view class="empty-icon">单</view>
      <text class="empty-title">{{ t('noOrders') }}</text>
      <text class="empty-copy">{{ t('ordersEmptyHint') }}</text>
      <button class="order-now" @click="orderNow">{{ t('orderNow') }}</button>
    </view>

    <view
      v-for="order in filteredOrders"
      :key="order.id"
      class="order-card"
      @click="openOrder(order.id)"
    >
      <view class="card-head">
        <view>
          <text class="merchant">{{ merchantName(order.merchant, locale) }}</text>
          <text class="order-no">{{ order.orderNo }}</text>
        </view>
        <text :class="['status', `status-${order.status.toLowerCase()}`]">
          {{ orderStatusLabel(order.status, locale) }}
        </text>
      </view>
      <view class="order-meta">
        <text class="type-pill">{{ orderTypeLabel(order.orderType, locale) }}</text>
        <text v-if="order.table?.tableNo">{{ t('tableLabel', { table: order.table.tableNo }) }}</text>
        <text>{{ new Date(order.createdAt).toLocaleString() }}</text>
      </view>
      <view class="items">
        <text v-for="item in order.items.slice(0, 3)" :key="item.id">
          {{ item.productNameZhSnapshot }} × {{ item.quantity }}
        </text>
        <text v-if="order.items.length > 3">{{ t('orderItemsMore', { count: order.items.length - 3 }) }}</text>
      </view>
      <view class="card-foot">
        <view>
          <text class="amount-label">{{ t('paidAmount') }}</text>
          <text class="amount">{{ Number(order.totalAmountVnd).toLocaleString() }} ₫</text>
        </view>
        <button class="detail-button" @click.stop="openOrder(order.id)">
          {{ t('viewDetails') }}
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 28rpx 24rpx calc(60rpx + env(safe-area-inset-bottom));
  color: #1f2d24;
  background: #f6faf7;
  box-sizing: border-box;
}

.page-heading {
  padding: 8rpx 4rpx 24rpx;
}

.page-title {
  display: block;
  font-size: 42rpx;
  font-weight: 800;
}

.page-subtitle {
  display: block;
  margin-top: 7rpx;
  color: #77837a;
  font-size: 23rpx;
}

.filters {
  display: flex;
  gap: 12rpx;
  overflow-x: auto;
  padding: 8rpx;
  margin-bottom: 24rpx;
  border-radius: 24rpx;
  background: #fff;
  box-shadow: 0 10rpx 28rpx rgb(46 125 50 / 6%);
  white-space: nowrap;
}

.filters button {
  min-width: 112rpx;
  flex: 1 0 auto;
  padding: 14rpx 16rpx;
  border: 0;
  border-radius: 18rpx;
  color: #666;
  background: transparent;
  font-size: 23rpx;
  line-height: 1.5;
}

.filters button::after,
.order-now::after,
.detail-button::after {
  border: 0;
}

.filters button.active {
  color: #fff;
  background: #43a047;
  font-weight: 700;
}

.message {
  display: block;
  padding: 20rpx 22rpx;
  margin-bottom: 18rpx;
  border-radius: 20rpx;
  color: #8a5a00;
  background: #fff3dd;
  font-size: 23rpx;
}

.empty {
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 100rpx 30rpx;
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 12rpx 32rpx rgb(46 125 50 / 6%);
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 100rpx;
  height: 100rpx;
  place-items: center;
  margin-bottom: 24rpx;
  border-radius: 32rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 38rpx;
  font-weight: 800;
}

.empty-title {
  color: #1f2d24;
  font-size: 29rpx;
  font-weight: 700;
}

.empty-copy {
  margin-top: 10rpx;
  color: #7d8980;
  font-size: 23rpx;
}

.order-now {
  min-width: 220rpx;
  margin-top: 28rpx;
  border: 0;
  border-radius: 999rpx;
  color: #fff;
  background: #43a047;
  font-size: 24rpx;
  font-weight: 700;
}

.order-card {
  padding: 26rpx;
  margin-bottom: 20rpx;
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 12rpx 32rpx rgb(46 125 50 / 7%);
}

.card-head,
.card-foot {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18rpx;
}

.merchant {
  display: block;
  color: #1f2d24;
  font-size: 31rpx;
  font-weight: 800;
}

.order-no {
  display: block;
  margin-top: 7rpx;
  color: #929b94;
  font-size: 21rpx;
}

.status {
  padding: 8rpx 13rpx;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 21rpx;
  font-weight: 700;
  white-space: nowrap;
}

.status-completed {
  color: #55735e;
  background: #edf4ef;
}

.status-cancelled {
  color: #777;
  background: #f0f0f0;
}

.status-delivering {
  color: #2e7d32;
  background: #eaf7ee;
}

.order-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10rpx 14rpx;
  margin-top: 20rpx;
  color: #7a867d;
  font-size: 21rpx;
}

.type-pill {
  padding: 5rpx 11rpx;
  border-radius: 999rpx;
  color: #9a6200;
  background: #fff2dc;
}

.items {
  display: grid;
  gap: 10rpx;
  padding: 22rpx 0;
  margin: 20rpx 0;
  border-top: 1rpx solid #f0f0f0;
  border-bottom: 1rpx solid #f0f0f0;
  color: #4d5950;
  font-size: 25rpx;
}

.card-foot {
  align-items: center;
}

.amount-label {
  margin-right: 10rpx;
  color: #7c877f;
  font-size: 21rpx;
}

.amount {
  color: #1f2d24;
  font-size: 29rpx;
  font-weight: 800;
  white-space: nowrap;
}

.detail-button {
  min-width: 150rpx;
  margin: 0;
  padding: 9rpx 22rpx;
  border: 0;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 1.5;
}
</style>
