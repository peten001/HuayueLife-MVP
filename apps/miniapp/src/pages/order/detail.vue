<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onLoad, onShow } from '@dcloudio/uni-app';
import { cancelOrder, confirmReceived, getOrder } from '@/api/orders';
import { useAuthStore } from '@/stores/auth';
import type { OrderStatus, OrderType, UserOrder } from '@/types/api';

const auth = useAuthStore();
const orderId = ref('');
const order = ref<UserOrder>();
const loading = ref(false);
const operating = ref(false);
const message = ref('');
let timer: ReturnType<typeof setInterval> | undefined;

const canCancel = computed(
  () => order.value?.status === 'PENDING_ACCEPTANCE',
);
const canConfirmReceived = computed(
  () =>
    order.value?.orderType === 'DELIVERY' &&
    order.value.status === 'DELIVERING',
);

onLoad((options) => {
  orderId.value = String(options?.id ?? '');
});

onShow(() => {
  void load(true);
  if (!timer) timer = setInterval(() => void load(), 5000);
});

onHide(() => {
  if (timer) clearInterval(timer);
  timer = undefined;
});

async function load(showLoading = false) {
  if (!orderId.value) {
    message.value = '缺少订单编号';
    return;
  }
  if (showLoading) loading.value = true;
  try {
    await auth.ensureLogin();
    order.value = await getOrder(orderId.value);
    message.value = '';
  } catch (caught) {
    message.value = caught instanceof Error ? caught.message : '订单加载失败';
  } finally {
    loading.value = false;
  }
}

function cancel() {
  if (!order.value) return;
  uni.showModal({
    title: '取消订单',
    content: '仅待商家接单的订单可以取消，确认取消？',
    success: async (result) => {
      if (!result.confirm || !order.value) return;
      try {
        operating.value = true;
        order.value = await cancelOrder(order.value.id);
        uni.showToast({ title: '订单已取消', icon: 'success' });
      } catch (caught) {
        message.value = caught instanceof Error ? caught.message : '取消失败';
        await load();
      } finally {
        operating.value = false;
      }
    },
  });
}

function receive() {
  if (!order.value) return;
  uni.showModal({
    title: '确认收货',
    content: '确认已经收到商家配送的餐品？',
    success: async (result) => {
      if (!result.confirm || !order.value) return;
      try {
        operating.value = true;
        order.value = await confirmReceived(order.value.id);
        uni.showToast({ title: '订单已完成', icon: 'success' });
      } catch (caught) {
        message.value =
          caught instanceof Error ? caught.message : '确认收货失败';
        await load();
      } finally {
        operating.value = false;
      }
    },
  });
}

function statusLabel(status: OrderStatus) {
  return {
    PENDING_ACCEPTANCE: '等待商家接单',
    ACCEPTED: '商家已接单',
    PREPARING: '商家正在制作',
    READY: '餐品制作完成',
    DELIVERING: '商家配送中',
    COMPLETED: '订单已完成',
    CANCELLED: '订单已取消',
  }[status];
}

function typeLabel(type: OrderType) {
  return { DINE_IN: '堂食', PICKUP: '到店自取', DELIVERY: '商家配送' }[
    type
  ];
}

function serviceInfo() {
  if (!order.value) return '';
  if (order.value.orderType === 'DINE_IN') {
    return `桌号：${order.value.tableNoSnapshot || order.value.table?.tableNo || '-'}`;
  }
  if (order.value.orderType === 'PICKUP') {
    return `${order.value.contactName || ''} ${order.value.contactPhone || ''}`;
  }
  return `${order.value.contactName || ''} ${order.value.contactPhone || ''}\n${order.value.deliveryAddress || ''}`;
}
</script>

<template>
  <view class="page">
    <view v-if="loading && !order" class="empty">加载中...</view>
    <text v-if="message" class="message">{{ message }}</text>

    <template v-if="order">
      <view class="status-card">
        <text class="status">{{ statusLabel(order.status) }}</text>
        <text class="status-copy">订单状态每 5 秒自动更新</text>
      </view>

      <view class="card">
        <view class="card-title">{{ order.merchant.nameZh }}</view>
        <view class="info-row"><text>订单号</text><text>{{ order.orderNo }}</text></view>
        <view class="info-row"><text>订单类型</text><text>{{ typeLabel(order.orderType) }}</text></view>
        <view class="info-row service"><text>用餐信息</text><text>{{ serviceInfo() }}</text></view>
        <view class="info-row"><text>下单时间</text><text>{{ new Date(order.createdAt).toLocaleString() }}</text></view>
        <view v-if="order.customerRemark" class="info-row"><text>订单备注</text><text>{{ order.customerRemark }}</text></view>
        <view v-if="order.cancelReason" class="info-row"><text>取消原因</text><text>{{ order.cancelReason }}</text></view>
      </view>

      <view class="card">
        <view class="card-title">菜品明细</view>
        <view v-for="item in order.items" :key="item.id" class="item">
          <image v-if="item.imageUrlSnapshot" :src="item.imageUrlSnapshot" mode="aspectFill" />
          <view class="item-main">
            <text>{{ item.productNameZhSnapshot }}</text>
            <text v-if="item.remark" class="remark">备注：{{ item.remark }}</text>
          </view>
          <text>× {{ item.quantity }}</text>
          <text>{{ Number(item.subtotalVnd).toLocaleString() }} ₫</text>
        </view>
        <view class="amount-row"><text>菜品金额</text><text>{{ Number(order.itemAmountVnd).toLocaleString() }} ₫</text></view>
        <view v-if="order.orderType === 'DELIVERY'" class="amount-row"><text>配送费</text><text>{{ Number(order.deliveryFeeVnd).toLocaleString() }} ₫</text></view>
        <view class="amount-row total"><text>合计</text><text>{{ Number(order.totalAmountVnd).toLocaleString() }} ₫</text></view>
        <text class="settlement">{{ order.settlementStatus === 'SETTLED' ? '商家已标记收款' : '请按商家线下方式付款' }}</text>
      </view>

      <view v-if="order.statusLogs?.length" class="card">
        <view class="card-title">状态记录</view>
        <view v-for="log in order.statusLogs" :key="log.id" class="log">
          <view class="dot" />
          <view>
            <text>{{ statusLabel(log.toStatus) }}</text>
            <text class="log-copy">{{ log.remark || '' }} · {{ new Date(log.createdAt).toLocaleString() }}</text>
          </view>
        </view>
      </view>

      <button v-if="canCancel" class="action danger" :disabled="operating" @click="cancel">
        取消订单
      </button>
      <button v-if="canConfirmReceived" class="action" :disabled="operating" @click="receive">
        确认收货
      </button>
    </template>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx 24rpx 60rpx; background: #f6f3ef; }
.empty { padding: 120rpx 0; color: #888; text-align: center; }
.message { display: block; margin-bottom: 18rpx; color: #a83228; }
.status-card { display: grid; gap: 10rpx; padding: 30rpx 26rpx; margin-bottom: 18rpx; border-radius: 20rpx; color: #fff; background: linear-gradient(135deg, #a82f27, #d25d42); }
.status { font-size: 38rpx; font-weight: 800; }
.status-copy { opacity: .82; font-size: 22rpx; }
.card { padding: 24rpx; margin-bottom: 18rpx; border-radius: 20rpx; background: #fff; }
.card-title { padding-bottom: 18rpx; border-bottom: 1rpx solid #eee9e5; font-size: 30rpx; font-weight: 700; }
.info-row, .amount-row { display: flex; justify-content: space-between; gap: 24rpx; padding-top: 18rpx; color: #4f4945; font-size: 25rpx; }
.info-row > text:first-child { color: #8b837e; white-space: nowrap; }
.info-row > text:last-child { text-align: right; white-space: pre-line; }
.item { display: grid; grid-template-columns: 80rpx 1fr auto auto; align-items: center; gap: 14rpx; padding: 20rpx 0; border-bottom: 1rpx solid #eee9e5; font-size: 24rpx; }
.item image { width: 80rpx; height: 80rpx; border-radius: 10rpx; background: #eee; }
.item-main { display: grid; gap: 6rpx; }
.remark { color: #9a7161; font-size: 21rpx; }
.amount-row { padding-top: 14rpx; }
.amount-row.total { margin-top: 8rpx; color: #b83228; font-size: 30rpx; font-weight: 800; }
.settlement { display: block; margin-top: 16rpx; color: #8b837e; font-size: 22rpx; text-align: right; }
.log { position: relative; display: grid; grid-template-columns: 20rpx 1fr; gap: 10rpx; padding-top: 20rpx; }
.dot { width: 12rpx; height: 12rpx; margin-top: 9rpx; border-radius: 50%; background: #b83228; }
.log-copy { display: block; margin-top: 5rpx; color: #918984; font-size: 21rpx; }
.action { width: 100%; margin-top: 20rpx; color: #fff; background: #b83228; }
.action.danger { color: #a83228; background: #fff; border: 1rpx solid #d8a39f; }
</style>
