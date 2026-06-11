<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onLoad, onShow } from '@dcloudio/uni-app';
import { cancelOrder, confirmReceived, getOrder } from '@/api/orders';
import {
  locale,
  merchantName,
  operatorLabel,
  orderStatusLabel,
  orderTypeLabel,
  settlementLabel,
  translateApiError,
  useI18n,
  usePageTitle,
} from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { resolveMediaUrl } from '@/utils/media';
import type { OrderStatus, OrderType, UserOrder } from '@/types/api';

const auth = useAuthStore();
const orderId = ref('');
const order = ref<UserOrder>();
const loading = ref(false);
const operating = ref(false);
const message = ref('');
let timer: ReturnType<typeof setInterval> | undefined;
const { t } = useI18n();

const canCancel = computed(
  () => order.value?.status === 'PENDING_ACCEPTANCE',
);
const canConfirmReceived = computed(
  () =>
    order.value?.orderType === 'DELIVERY' &&
    order.value.status === 'DELIVERING',
);

usePageTitle(() =>
  order.value ? `${t('orderDetailTitle')} ${order.value.orderNo}` : t('orderDetailTitle'),
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
    message.value = t('missingOrderNo');
    return;
  }
  if (showLoading) loading.value = true;
  try {
    await auth.ensureLogin();
    order.value = await getOrder(orderId.value);
    message.value = '';
  } catch (caught) {
    message.value = caught instanceof Error ? translateApiError(caught.message) : t('orderLoadError');
  } finally {
    loading.value = false;
  }
}

function cancel() {
  if (!order.value) return;
  uni.showModal({
    title: t('cancelOrderTitle'),
    content: t('cancelOrderConfirm'),
    success: async (result) => {
      if (!result.confirm || !order.value) return;
      try {
        operating.value = true;
        order.value = await cancelOrder(order.value.id);
        uni.showToast({ title: t('orderCancelled'), icon: 'success' });
      } catch (caught) {
        message.value = caught instanceof Error ? translateApiError(caught.message) : t('cancelFailed');
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
    title: t('confirmReceivedTitle'),
    content: t('confirmReceivedContent'),
    success: async (result) => {
      if (!result.confirm || !order.value) return;
      try {
        operating.value = true;
        order.value = await confirmReceived(order.value.id);
        uni.showToast({ title: t('orderCompleted'), icon: 'success' });
      } catch (caught) {
        message.value =
          caught instanceof Error ? translateApiError(caught.message) : t('confirmReceivedFailed');
        await load();
      } finally {
        operating.value = false;
      }
    },
  });
}

function serviceInfo() {
  if (!order.value) return '';
  if (order.value.orderType === 'DINE_IN') {
    return t('tableLabel', { table: order.value.tableNoSnapshot || order.value.table?.tableNo || '-' });
  }
  if (order.value.orderType === 'PICKUP') {
    return `${order.value.contactName || ''} ${order.value.contactPhone || ''}`;
  }
  return `${order.value.contactName || ''} ${order.value.contactPhone || ''}\n${order.value.deliveryAddress || ''}`;
}
</script>

<template>
  <view class="page">
    <view v-if="loading && !order" class="empty">{{ t('loading') }}</view>
    <text v-if="message" class="message">{{ message }}</text>

    <template v-if="order">
      <view class="status-card">
        <text class="status">{{ orderStatusLabel(order.status, locale) }}</text>
        <text class="status-copy">{{ t('orderStatusUpdated') }}</text>
      </view>

      <view class="card">
        <view class="card-title">{{ merchantName(order.merchant, locale) }}</view>
        <view class="info-row"><text>{{ t('orderNo') }}</text><text>{{ order.orderNo }}</text></view>
        <view class="info-row"><text>{{ t('orderType') }}</text><text>{{ orderTypeLabel(order.orderType, locale) }}</text></view>
        <view class="info-row service"><text>{{ t('diningInfo') }}</text><text>{{ serviceInfo() }}</text></view>
        <view class="info-row"><text>{{ t('orderTime') }}</text><text>{{ new Date(order.createdAt).toLocaleString() }}</text></view>
        <view v-if="order.customerRemark" class="info-row"><text>{{ t('orderNote') }}</text><text>{{ order.customerRemark }}</text></view>
        <view v-if="order.cancelReason" class="info-row"><text>{{ t('cancelReason') }}</text><text>{{ order.cancelReason }}</text></view>
      </view>

      <view class="card">
        <view class="card-title">{{ t('itemDetails') }}</view>
        <view v-for="item in order.items" :key="item.id" class="item">
          <image
            v-if="resolveMediaUrl(item.imageUrlSnapshot)"
            :src="resolveMediaUrl(item.imageUrlSnapshot)"
            mode="aspectFill"
          />
          <view v-else class="item-image placeholder">{{ t('imagePlaceholder') }}</view>
          <view class="item-main">
            <text>{{ item.productNameZhSnapshot }}</text>
            <text v-if="item.remark" class="remark">{{ t('orderNote') }}：{{ item.remark }}</text>
          </view>
          <text>× {{ item.quantity }}</text>
          <text>{{ Number(item.subtotalVnd).toLocaleString() }} ₫</text>
        </view>
        <view class="amount-row"><text>{{ t('subtotal') }}</text><text>{{ Number(order.itemAmountVnd).toLocaleString() }} ₫</text></view>
        <view v-if="order.orderType === 'DELIVERY'" class="amount-row"><text>{{ t('deliveryFee') }}</text><text>{{ Number(order.deliveryFeeVnd).toLocaleString() }} ₫</text></view>
        <view class="amount-row total"><text>{{ t('totalAmount') }}</text><text>{{ Number(order.totalAmountVnd).toLocaleString() }} ₫</text></view>
        <text class="settlement">{{ settlementLabel(order.settlementStatus, locale) }}</text>
      </view>

      <view v-if="order.statusLogs?.length" class="card">
        <view class="card-title">{{ t('statusRecord') }}</view>
        <view v-for="log in order.statusLogs" :key="log.id" class="log">
          <view class="dot" />
          <view>
            <text>{{ orderStatusLabel(log.toStatus, locale) }}</text>
            <text class="log-copy">{{ log.remark || '' }} · {{ new Date(log.createdAt).toLocaleString() }}</text>
          </view>
        </view>
      </view>

      <button v-if="canCancel" class="action danger" :disabled="operating" @click="cancel">
        {{ t('cancelOrder') }}
      </button>
      <button v-if="canConfirmReceived" class="action" :disabled="operating" @click="receive">
        {{ t('confirmReceived') }}
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
.item image, .item-image { width: 80rpx; height: 80rpx; border-radius: 10rpx; background: #eee; }
.placeholder { display: flex; align-items: center; justify-content: center; color: #9d8f84; background: #f1e8df; font-size: 18rpx; text-align: center; }
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
