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

type Filter = 'ALL' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

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
  { value: 'ACTIVE', label: t('active') },
  { value: 'COMPLETED', label: t('completed') },
  { value: 'CANCELLED', label: t('cancelled') },
]);

const filteredOrders = computed(() =>
  orders.value.filter((order) => {
    if (filter.value === 'ACTIVE') {
      return !['COMPLETED', 'CANCELLED'].includes(order.status);
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

    <text v-if="message" class="message">{{ message }}</text>
    <view v-if="loading" class="empty">{{ t('loading') }}</view>
    <view v-else-if="!filteredOrders.length" class="empty">{{ t('noOrders') }}</view>

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
      <view class="items">
        <text v-for="item in order.items.slice(0, 3)" :key="item.id">
          {{ item.productNameZhSnapshot }} × {{ item.quantity }}
        </text>
        <text v-if="order.items.length > 3">{{ t('orderItemsMore', { count: order.items.length - 3 }) }}</text>
      </view>
      <view class="card-foot">
        <text>{{ orderTypeLabel(order.orderType, locale) }} · {{ new Date(order.createdAt).toLocaleString() }}</text>
        <text class="amount">{{ Number(order.totalAmountVnd).toLocaleString() }} ₫</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx 24rpx 50rpx; background: #f6f3ef; }
.filters { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10rpx; margin-bottom: 24rpx; }
.filters button { padding: 14rpx 4rpx; color: #6e6661; background: #fff; font-size: 24rpx; line-height: 1.5; }
.filters button.active { color: #fff; background: #b83228; }
.message { display: block; margin-bottom: 18rpx; color: #a83228; }
.empty { padding: 120rpx 0; color: #8b837e; text-align: center; }
.order-card { padding: 24rpx; margin-bottom: 18rpx; border-radius: 20rpx; background: #fff; box-shadow: 0 6rpx 22rpx rgba(65, 42, 30, .05); }
.card-head, .card-foot { display: flex; align-items: flex-start; justify-content: space-between; gap: 18rpx; }
.merchant { display: block; font-size: 30rpx; font-weight: 700; }
.order-no { display: block; margin-top: 6rpx; color: #938b85; font-size: 21rpx; }
.status { padding: 7rpx 12rpx; border-radius: 999rpx; color: #8a5610; background: #fff0d9; font-size: 21rpx; white-space: nowrap; }
.status-completed { color: #17693c; background: #e5f5ec; }
.status-cancelled { color: #68707a; background: #edf0f2; }
.status-delivering { color: #6841a5; background: #f0eafb; }
.items { display: grid; gap: 8rpx; padding: 20rpx 0; margin: 18rpx 0; border-top: 1rpx solid #eee9e5; border-bottom: 1rpx solid #eee9e5; color: #514a46; font-size: 25rpx; }
.card-foot { align-items: center; color: #8b837e; font-size: 21rpx; }
.amount { color: #292521; font-size: 28rpx; font-weight: 700; white-space: nowrap; }
</style>
