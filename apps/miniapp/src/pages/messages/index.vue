<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import {
  getOrderChat,
  listOrderChatMessages,
  type UserChatConversation,
} from '@/api/order-chat';
import { getOrders } from '@/api/orders';
import { locale, orderMerchantName, orderStatusLabel, usePageTitle } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import type { OrderChatMessage } from '@/types/api';
import type { UserOrder } from '@/types/api';

type MessageTab = 'orders' | 'chats' | 'system';
type ChatSession = {
  id: string;
  merchantName: string;
  orderNo: string;
  unread: number;
  time: string;
  sortValue: string;
  closed: boolean;
  summary: string;
};

const auth = useAuthStore();
const activeTab = ref<MessageTab>('orders');
const orders = ref<UserOrder[]>([]);
const chatSessions = ref<ChatSession[]>([]);
const loading = ref(false);
const error = ref('');

const copy = computed(() => {
  if (locale.value === 'vi') {
    return {
      title: 'Tin nhắn',
      subtitle: 'Xem tiến độ đơn hàng, chat với cửa hàng và thông báo hệ thống',
      tabs: {
        orders: 'Tin đơn hàng',
        chats: 'Chat với cửa hàng',
        system: 'Thông báo hệ thống',
      },
      descriptions: {
        orders: 'Xem thông báo gửi đơn, nhận đơn, đang chuẩn bị, hoàn tất và hủy đơn',
        chats: 'Xem lịch sử trò chuyện của bạn với các cửa hàng',
        system: 'Xem thông báo nền tảng, nhắc nhở hệ thống và dịch vụ',
      },
      empty: {
        orders: 'Chưa có tin đơn hàng',
        chats: 'Chưa có cuộc trò chuyện',
        system: 'Chưa có thông báo hệ thống',
      },
      actions: {
        openChat: 'Vào chat',
        viewHistory: 'Xem lịch sử',
      },
      labels: {
        latestMessage: 'Tin nhắn gần nhất',
        orderNo: 'Mã đơn',
        status: 'Trạng thái',
      },
      readOnly: 'Đơn hàng đã đóng, chỉ có thể xem lịch sử trò chuyện',
      activeChat: 'Có thể tiếp tục trao đổi',
      noChatContent: 'Chưa có nội dung trò chuyện',
      systemNoticeTitle: 'Chào mừng bạn đến với Huayue Life',
      systemNoticeBody: 'Thông báo nền tảng và nhắc nhở dịch vụ sẽ xuất hiện tại đây.',
      states: {
        pending: 'Đơn hàng đã gửi, đang chờ cửa hàng xác nhận',
        accepted: 'Cửa hàng đã nhận đơn',
        preparing: 'Cửa hàng đang chuẩn bị món',
        completed: 'Đơn hàng đã hoàn tất',
        cancelled: 'Đơn hàng đã hủy',
        activeChat: 'Cuộc trò chuyện với cửa hàng đang diễn ra',
      },
    };
  }

  if (locale.value === 'en') {
    return {
      title: 'Messages',
      subtitle: 'View order progress, merchant chats, and system notices',
      tabs: {
        orders: 'Order updates',
        chats: 'Merchant chats',
        system: 'System notices',
      },
      descriptions: {
        orders: 'View submitted, accepted, preparing, completed, and canceled order updates',
        chats: 'View your chat history with merchants',
        system: 'View platform announcements, system reminders, and service notices',
      },
      empty: {
        orders: 'No order updates',
        chats: 'No merchant chats',
        system: 'No system notices',
      },
      actions: {
        openChat: 'Open chat',
        viewHistory: 'View history',
      },
      labels: {
        latestMessage: 'Latest message',
        orderNo: 'Order No.',
        status: 'Status',
      },
      readOnly: 'Order closed. Chat history is read-only',
      activeChat: 'Chat is still available',
      noChatContent: 'No chat content',
      systemNoticeTitle: 'Welcome to Huayue Life',
      systemNoticeBody: 'Platform announcements and service reminders will appear here.',
      states: {
        pending: 'Order submitted, waiting for merchant acceptance',
        accepted: 'Merchant accepted the order',
        preparing: 'Merchant is preparing the food',
        completed: 'Order completed',
        cancelled: 'Order canceled',
        activeChat: 'Active conversation with the merchant',
      },
    };
  }

  return {
    title: '消息',
    subtitle: '查看订单进度、商家聊天和系统通知',
    tabs: {
      orders: '订单消息',
      chats: '商家聊天',
      system: '系统通知',
    },
    descriptions: {
      orders: '查看订单提交、接单、制作、完成和取消通知',
      chats: '查看你与商家的历史聊天记录',
      system: '查看平台公告、系统提醒和服务通知',
    },
    empty: {
      orders: '暂无订单消息',
      chats: '暂无商家聊天',
      system: '暂无系统通知',
    },
    actions: {
      openChat: '进入聊天',
      viewHistory: '查看记录',
    },
    labels: {
      latestMessage: '最近消息',
      orderNo: '订单号',
      status: '状态',
    },
    readOnly: '订单已关闭，仅可查看聊天记录',
    activeChat: '可继续沟通',
    noChatContent: '暂无聊天内容',
    systemNoticeTitle: '欢迎使用华越优选',
    systemNoticeBody: '平台公告、系统提醒和服务通知会显示在这里。',
    states: {
      pending: '订单已提交，等待商家接单',
      accepted: '商家已接单',
      preparing: '商家正在准备餐品',
      completed: '订单已完成',
      cancelled: '订单已取消',
      activeChat: '你与商家的聊天仍可继续',
    },
  };
});

const tabs = computed<Array<{ value: MessageTab; label: string }>>(() => [
  { value: 'orders', label: copy.value.tabs.orders },
  { value: 'chats', label: copy.value.tabs.chats },
  { value: 'system', label: copy.value.tabs.system },
]);

const orderMessages = computed(() =>
  [...orders.value]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .map((order) => ({
      id: order.id,
      merchantName: orderMerchantName(order, locale.value),
      orderNo: order.orderNo,
      statusLabel: orderStatusLabel(order.status, locale.value),
      time: formatDate(order.updatedAt || order.createdAt),
      summary: orderSummary(order),
    })),
);

const chatMessages = computed(() => chatSessions.value);

const systemNotices = computed(() => [
  {
    id: 'welcome',
    title: copy.value.systemNoticeTitle,
    body: copy.value.systemNoticeBody,
    time: formatDate(new Date().toISOString()),
  },
]);

usePageTitle(() => copy.value.title);

onShow(() => {
  void loadOrders();
});

async function loadOrders() {
  loading.value = true;
  error.value = '';
  try {
    await auth.ensureLogin();
    orders.value = await getOrders();
    await loadChatSessions(orders.value);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : 'Load failed';
  } finally {
    loading.value = false;
  }
}

async function loadChatSessions(orderList: UserOrder[]) {
  const recentOrders = [...orderList]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 20);

  const sessions = await Promise.allSettled(
    recentOrders.map(async (order) => {
      const [conversationResult, messagesResult] = await Promise.allSettled([
        getOrderChat(order.id),
        listOrderChatMessages(order.id, { limit: 1 }),
      ]);

      if (conversationResult.status !== 'fulfilled' || messagesResult.status !== 'fulfilled') {
        throw new Error(`chat-load-failed:${order.id}`);
      }

      const conversation = conversationResult.value;
      const latestMessage = resolveLatestMessage(conversation, messagesResult.value.items);
      if (!latestMessage?.content?.trim()) {
        return null;
      }

      return {
        id: order.id,
        merchantName: orderMerchantName(
          {
            ...order,
            merchant:
              conversation.merchant && typeof conversation.merchant === 'object'
                ? conversation.merchant
                : order.merchant,
          },
          locale.value,
        ),
        orderNo: order.orderNo,
        unread: conversation.customerUnreadCount ?? 0,
        time: formatDate(latestMessage.createdAt || conversation.lastMessageAt || order.updatedAt || order.createdAt),
        sortValue: latestMessage.createdAt || conversation.lastMessageAt || order.updatedAt || order.createdAt,
        closed: isClosedOrder(order.status),
        summary: latestMessage.content.trim(),
      } satisfies ChatSession;
    }),
  );

  chatSessions.value = sessions
    .flatMap((result) => {
      if (result.status === 'fulfilled' && result.value) return [result.value];
      if (result.status === 'rejected') console.warn('[messages] load chat session failed', result.reason);
      return [];
    })
    .sort((left, right) => Date.parse(right.sortValue) - Date.parse(left.sortValue));
}

function formatDate(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function isClosedOrder(status: UserOrder['status'] | string | undefined | null) {
  const normalized = String(status ?? '').trim().toUpperCase();
  return [
    'COMPLETED',
    'COMPLETE',
    'FINISHED',
    'DONE',
    'CLOSED',
    'CANCELLED',
    'CANCELED',
    'REFUNDED',
    'REJECTED',
  ].includes(normalized);
}

function resolveLatestMessage(
  conversation: UserChatConversation,
  messages: OrderChatMessage[],
) {
  if (conversation.lastMessage?.content) return conversation.lastMessage;
  if (messages.length) return messages[messages.length - 1];
  return null;
}

function orderSummary(order: UserOrder) {
  if (order.status === 'PENDING_ACCEPTANCE') return copy.value.states.pending;
  if (order.status === 'ACCEPTED' || order.status === 'READY' || order.status === 'DELIVERING') {
    return copy.value.states.accepted;
  }
  if (order.status === 'PREPARING') return copy.value.states.preparing;
  if (order.status === 'COMPLETED') return copy.value.states.completed;
  if (order.status === 'CANCELLED') return copy.value.states.cancelled;
  return copy.value.states.pending;
}

function openOrderDetail(orderId: string) {
  uni.navigateTo({ url: `/pages/order/detail?id=${orderId}` });
}

function openChat(orderId: string, readonly = false) {
  const readonlyQuery = readonly ? '&readonly=1' : '';
  uni.navigateTo({ url: `/pages/order/chat?orderId=${orderId}${readonlyQuery}` });
}
</script>

<template>
  <view class="page">
    <view class="hero">
      <text class="title">{{ copy.title }}</text>
      <text class="subtitle">{{ copy.subtitle }}</text>
    </view>

    <view class="tabs">
      <view
        v-for="tab in tabs"
        :key="tab.value"
        :class="['tab', activeTab === tab.value ? 'active' : '']"
        @click="activeTab = tab.value"
      >
        {{ tab.label }}
      </view>
    </view>

    <view class="panel">
      <text class="panel-desc">
        {{ activeTab === 'orders' ? copy.descriptions.orders : activeTab === 'chats' ? copy.descriptions.chats : copy.descriptions.system }}
      </text>

      <view v-if="error" class="message">{{ error }}</view>

      <view v-if="loading" class="empty-state">
        <view class="empty-icon">🔔</view>
        <text class="empty-title">{{ locale === 'vi' ? 'Đang tải...' : locale === 'en' ? 'Loading...' : '加载中...' }}</text>
      </view>

      <template v-else-if="activeTab === 'orders'">
        <view v-if="orderMessages.length" class="list">
          <view
            v-for="item in orderMessages"
            :key="item.id"
            class="item-card"
            @click="openOrderDetail(item.id)"
          >
            <view class="item-head">
              <text class="item-title">{{ item.merchantName }}</text>
              <text class="item-time">{{ item.time }}</text>
            </view>
            <text class="item-subtitle">#{{ item.orderNo }}</text>
            <text class="item-body">{{ item.summary }}</text>
            <text class="item-status">{{ item.statusLabel }}</text>
          </view>
        </view>
        <view v-else class="empty-state">
          <view class="empty-icon">🧾</view>
          <text class="empty-title">{{ copy.empty.orders }}</text>
        </view>
      </template>

      <template v-else-if="activeTab === 'chats'">
        <view v-if="chatMessages.length" class="list">
          <view
            v-for="item in chatMessages"
            :key="item.id"
            class="item-card"
          >
            <view class="item-head">
              <text class="item-title">{{ item.merchantName }}</text>
              <view class="item-meta">
                <text v-if="item.unread" class="badge">{{ item.unread > 99 ? '99+' : item.unread }}</text>
                <text class="item-time">{{ item.time }}</text>
              </view>
            </view>
            <text class="item-subtitle">{{ copy.labels.orderNo }}：#{{ item.orderNo }}</text>
            <text class="item-body">{{ copy.labels.latestMessage }}：{{ item.summary || copy.noChatContent }}</text>
            <text class="item-secondary">
              {{ copy.labels.status }}：{{ item.closed ? copy.readOnly : copy.activeChat }}
            </text>
            <view class="item-actions">
              <button
                :class="['item-button', item.closed ? 'secondary' : 'primary']"
                @click.stop="item.closed ? openChat(item.id, true) : openChat(item.id)"
              >
                {{ item.closed ? copy.actions.viewHistory : copy.actions.openChat }}
              </button>
            </view>
          </view>
        </view>
        <view v-else class="empty-state">
          <view class="empty-icon">💬</view>
          <text class="empty-title">{{ copy.empty.chats }}</text>
        </view>
      </template>

      <template v-else>
        <view v-if="systemNotices.length" class="list">
          <view
            v-for="item in systemNotices"
            :key="item.id"
            class="item-card"
          >
            <view class="item-head">
              <text class="item-title">{{ item.title }}</text>
              <text class="item-time">{{ item.time }}</text>
            </view>
            <text class="item-body">{{ item.body }}</text>
          </view>
        </view>
        <view v-else class="empty-state">
          <view class="empty-icon">🔔</view>
          <text class="empty-title">{{ copy.empty.system }}</text>
        </view>
      </template>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24rpx 24rpx calc(44rpx + env(safe-area-inset-bottom));
  color: #1f2d24;
  background: #f6faf7;
  box-sizing: border-box;
}

.hero {
  padding: 10rpx 6rpx 18rpx;
}

.title {
  display: block;
  font-size: 38rpx;
  font-weight: 800;
}

.subtitle {
  display: block;
  margin-top: 8rpx;
  color: #728077;
  font-size: 24rpx;
  line-height: 1.5;
}

.tabs {
  display: flex;
  gap: 12rpx;
  padding: 8rpx;
  margin-bottom: 18rpx;
  border-radius: 20rpx;
  background: #fff;
  box-shadow: 0 10rpx 28rpx rgb(46 125 50 / 6%);
}

.tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 70rpx;
  padding: 0 10rpx;
  border-radius: 16rpx;
  color: #728077;
  font-size: 24rpx;
  font-weight: 600;
}

.tab.active {
  color: #2e7d32;
  background: #eaf7ee;
}

.panel {
  padding: 20rpx;
  border-radius: 22rpx;
  background: #fff;
  box-shadow: 0 10rpx 28rpx rgb(46 125 50 / 6%);
}

.panel-desc {
  display: block;
  margin-bottom: 16rpx;
  color: #728077;
  font-size: 23rpx;
  line-height: 1.5;
}

.message {
  padding: 18rpx 20rpx;
  margin-bottom: 16rpx;
  border-radius: 16rpx;
  color: #8a5a00;
  background: #fff3dd;
  font-size: 22rpx;
}

.list {
  display: grid;
  gap: 12rpx;
}

.item-card {
  padding: 20rpx 18rpx;
  border-radius: 18rpx;
  background: #f9fbf9;
}

.item-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12rpx;
}

.item-title {
  flex: 1;
  color: #1f2d24;
  font-size: 26rpx;
  font-weight: 700;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.item-time {
  color: #8a948d;
  font-size: 20rpx;
  white-space: nowrap;
}

.item-subtitle {
  display: block;
  margin-top: 6rpx;
  color: #7d8b81;
  font-size: 21rpx;
}

.item-body {
  display: block;
  margin-top: 8rpx;
  color: #4b574f;
  font-size: 22rpx;
  line-height: 1.5;
}

.item-secondary {
  display: block;
  margin-top: 8rpx;
  color: #7b8780;
  font-size: 20rpx;
  line-height: 1.45;
}

.item-status {
  display: inline-flex;
  align-items: center;
  margin-top: 10rpx;
  padding: 6rpx 12rpx;
  border-radius: 999rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 20rpx;
  font-weight: 700;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34rpx;
  height: 34rpx;
  padding: 0 8rpx;
  border-radius: 999rpx;
  color: #fff;
  background: #43a047;
  font-size: 18rpx;
  font-weight: 700;
  box-sizing: border-box;
}

.item-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12rpx;
}

.item-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 150rpx;
  min-height: 62rpx;
  padding: 0 18rpx;
  border: 0;
  border-radius: 999rpx;
  color: #fff;
  background: #43a047;
  font-size: 22rpx;
  font-weight: 700;
}

.item-button.primary {
  color: #fff;
  background: #43a047;
}

.item-button.secondary {
  color: #617067;
  background: #eef3ef;
}

.item-button::after {
  border: 0;
}

.empty-state {
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 56rpx 16rpx 42rpx;
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 76rpx;
  height: 76rpx;
  place-items: center;
  border-radius: 22rpx;
  color: #2e7d32;
  background: #eaf7ee;
  font-size: 28rpx;
  font-weight: 800;
}

.empty-title {
  margin-top: 16rpx;
  font-size: 27rpx;
  font-weight: 700;
}
</style>
