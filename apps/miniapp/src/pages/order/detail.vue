<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import OrderChatPanel from '@/components/OrderChatPanel.vue';
import { getOrderChat } from '@/api/order-chat';
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
const chatOpen = ref(false);
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
const statusTone = computed(() => {
  if (order.value?.status === 'COMPLETED') return 'completed';
  if (order.value?.status === 'CANCELLED') return 'cancelled';
  return 'active';
});
const chatUnreadCount = computed(
  () => order.value?.chatConversation?.customerUnreadCount ?? 0,
);
const chatOrder = computed(() => order.value ?? null);

usePageTitle(() =>
  order.value ? `${t('orderDetailTitle')} ${order.value.orderNo}` : t('orderDetailTitle'),
);

onLoad((options) => {
  orderId.value = String(options?.id ?? '');
});

onShow(() => {
  void load(true);
  if (!timer) {
    timer = setInterval(() => {
      if (chatOpen.value) return;
      void load();
    }, 5000);
  }
});

function stopPolling() {
  if (timer) clearInterval(timer);
  timer = undefined;
  chatOpen.value = false;
}

onHide(stopPolling);
onUnload(stopPolling);

async function load(showLoading = false) {
  if (!orderId.value) {
    message.value = t('missingOrderNo');
    return;
  }
  if (showLoading) loading.value = true;
  try {
    await auth.ensureLogin();
    const [orderResult, chatResult] = await Promise.allSettled([
      getOrder(orderId.value),
      getOrderChat(orderId.value),
    ]);
    if (orderResult.status !== 'fulfilled') {
      throw orderResult.reason;
    }
    order.value = {
      ...orderResult.value,
      chatConversation:
        chatResult.status === 'fulfilled'
          ? chatResult.value
          : order.value?.chatConversation ?? null,
    };
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

function openChat() {
  chatOpen.value = true;
}

function closeChat() {
  chatOpen.value = false;
  void load();
}

function applyChatConversation(conversation: UserOrder['chatConversation'] | null) {
  if (!order.value) return;
  order.value.chatConversation = conversation;
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
    <view v-if="message" class="message">{{ message }}</view>

    <template v-if="order">
      <view :class="['status-card', `status-${statusTone}`]">
        <text class="status">{{ orderStatusLabel(order.status, locale) }}</text>
        <text class="status-copy">{{ t('orderStatusUpdated') }}</text>
      </view>

      <button class="chat-entry" @click="openChat">
        <text>{{ t('contactMerchant') }}</text>
        <view v-if="chatUnreadCount" class="chat-badge">{{ chatUnreadCount > 99 ? '99+' : chatUnreadCount }}</view>
      </button>

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
            class="item-image"
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

    <OrderChatPanel
      v-if="chatOpen && chatOrder"
      :visible="chatOpen"
      :order="chatOrder"
      @close="closeChat"
      @updated="applyChatConversation"
    />
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24rpx 24rpx calc(60rpx + env(safe-area-inset-bottom));
  color: #1f2d24;
  background: #f6faf7;
  box-sizing: border-box;
}

.empty {
  padding: 120rpx 0;
  color: #7d8980;
  text-align: center;
}

.message {
  display: block;
  padding: 18rpx 22rpx;
  margin-bottom: 18rpx;
  border-radius: 18rpx;
  color: #8a5a00;
  background: #fff3dd;
  font-size: 22rpx;
}

.status-card {
  display: grid;
  gap: 10rpx;
  padding: 32rpx 28rpx;
  margin-bottom: 20rpx;
  border-radius: 28rpx;
  box-shadow: 0 14rpx 36rpx rgb(46 125 50 / 10%);
}

.status-active {
  color: #fff;
  background: linear-gradient(135deg, #43a047, #2e7d32);
}

.status-completed {
  color: #2e7d32;
  background: linear-gradient(135deg, #eaf7ee, #d8efdc);
}

.status-cancelled {
  color: #666;
  background: #eeeeee;
  box-shadow: none;
}

.status {
  font-size: 38rpx;
  font-weight: 800;
}

.status-copy {
  opacity: .82;
  font-size: 22rpx;
}

.chat-entry {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14rpx;
  width: 100%;
  min-height: 82rpx;
  margin-bottom: 20rpx;
  border-radius: 24rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 26rpx;
  font-weight: 700;
}

.chat-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34rpx;
  height: 34rpx;
  padding: 0 9rpx;
  border-radius: 999rpx;
  color: #fff;
  background: #e53935;
  font-size: 20rpx;
  line-height: 1;
  font-weight: 700;
}

.card {
  padding: 26rpx;
  margin-bottom: 20rpx;
  border-radius: 28rpx;
  background: #fff;
  box-shadow: 0 12rpx 32rpx rgb(46 125 50 / 6%);
}

.card-title {
  padding-bottom: 18rpx;
  border-bottom: 1rpx solid #f0f0f0;
  color: #1f2d24;
  font-size: 30rpx;
  font-weight: 800;
}

.info-row,
.amount-row {
  display: flex;
  justify-content: space-between;
  gap: 24rpx;
  padding-top: 19rpx;
  color: #1f2d24;
  font-size: 24rpx;
}

.info-row > text:first-child {
  color: #666;
  white-space: nowrap;
}

.info-row > text:last-child {
  text-align: right;
  white-space: pre-line;
}

.item {
  display: grid;
  grid-template-columns: 86rpx minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 14rpx;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
  color: #1f2d24;
  font-size: 23rpx;
}

.item-image {
  width: 86rpx;
  height: 86rpx;
  border-radius: 15rpx;
  background: #eaf7ee;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #718077;
  font-size: 18rpx;
  text-align: center;
}

.item-main {
  min-width: 0;
  display: grid;
  gap: 6rpx;
}

.remark {
  color: #8a795a;
  font-size: 20rpx;
}

.amount-row {
  padding-top: 15rpx;
}

.amount-row.total {
  margin-top: 8rpx;
  color: #2e7d32;
  font-size: 30rpx;
  font-weight: 800;
}

.settlement {
  display: block;
  margin-top: 16rpx;
  color: #7d8980;
  font-size: 22rpx;
  text-align: right;
}

.log {
  position: relative;
  display: grid;
  grid-template-columns: 22rpx 1fr;
  gap: 11rpx;
  padding-top: 22rpx;
  color: #2e7d32;
  font-size: 24rpx;
  font-weight: 700;
}

.dot {
  width: 13rpx;
  height: 13rpx;
  margin-top: 9rpx;
  border-radius: 50%;
  background: #43a047;
  box-shadow: 0 0 0 7rpx #eaf7ee;
}

.log-copy {
  display: block;
  margin-top: 6rpx;
  color: #8a958d;
  font-size: 20rpx;
  font-weight: 400;
}

.action {
  width: 100%;
  min-height: 88rpx;
  margin-top: 20rpx;
  border: 0;
  border-radius: 24rpx;
  color: #fff;
  background: #2e7d32;
  font-weight: 700;
}

.action.danger {
  border: 2rpx solid #e8bcbc;
  color: #b65f5f;
  background: #fff;
}
</style>
