<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from '@/i18n';
import {
  getOrderChat,
  listOrderChatMessages,
  markOrderChatRead,
  sendOrderChatMessage,
  type UserChatConversation,
} from '@/api/order-chat';
import type { OrderChatMessage, UserOrder } from '@/types/api';

const props = defineProps<{
  visible: boolean;
  order: UserOrder;
}>();

const emit = defineEmits<{
  close: [];
  updated: [conversation: UserOrder['chatConversation'] | null];
}>();

const { t, locale } = useI18n();
const loading = ref(false);
const refreshing = ref(false);
const sending = ref(false);
const error = ref('');
const draft = ref('');
const conversation = ref<UserChatConversation | null>(null);
const messages = ref<OrderChatMessage[]>([]);
const lastMessageId = ref('');
const scrollIntoViewId = ref('');
let timer: ReturnType<typeof setInterval> | undefined;
let requestSeq = 0;
let disposed = false;

const canSend = computed(() => {
  const current = conversation.value;
  if (!current) return false;
  return !['COMPLETED', 'CANCELLED'].includes(props.order.status) && current.status !== 'CLOSED';
});

const showReadOnlyHint = computed(
  () => ['COMPLETED', 'CANCELLED'].includes(props.order.status) || conversation.value?.status === 'CLOSED',
);

const merchantDisplayName = computed(() => {
  if (locale.value === 'vi') return props.order.merchant.nameVi || props.order.merchant.nameZh;
  return props.order.merchant.nameZh;
});

watch(
  () => [props.visible, props.order.id],
  ([visible]) => {
    if (visible) {
      void loadConversation(true);
      return;
    }
    clearTimer();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  disposed = true;
  clearTimer();
});

function clearTimer() {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

function startTimer() {
  clearTimer();
  timer = setInterval(() => {
    void loadConversation(false);
  }, 5000);
}

function mergeMessages(current: OrderChatMessage[], incoming: OrderChatMessage[]) {
  const map = new Map<string, OrderChatMessage>();
  for (const item of current) map.set(item.id, item);
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()].sort((left, right) => {
    if (left.id === right.id) return 0;
    return BigInt(left.id) > BigInt(right.id) ? 1 : -1;
  });
}

async function loadAllMessages(orderId: string) {
  const all: OrderChatMessage[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await listOrderChatMessages(
      orderId,
      cursor ? { cursor, limit: 50 } : { limit: 50 },
    );
    all.push(...page.items);
    if (!page.pageInfo.hasMore || !page.pageInfo.nextCursor) break;
    cursor = page.pageInfo.nextCursor;
  }

  return all;
}

function syncReadState() {
  const now = new Date().toISOString();
  messages.value = messages.value.map((message) =>
    message.senderType === 'MERCHANT' && !message.readAt
      ? { ...message, readAt: now }
      : message,
  );
}

async function scrollToLatest() {
  await nextTick();
  const targetId = messages.value[messages.value.length - 1]?.id;
  scrollIntoViewId.value = targetId ? `msg-${targetId}` : '';
}

async function loadConversation(initial = false) {
  if (!props.visible || disposed) return;

  const orderId = props.order.id;
  const seq = ++requestSeq;

  if (initial) {
    loading.value = true;
    error.value = '';
  } else {
    refreshing.value = true;
  }

  try {
    const [loadedConversation, loadedMessages] = await Promise.all([
      getOrderChat(orderId),
      loadAllMessages(orderId),
    ]);

    if (disposed || seq !== requestSeq) return;

    conversation.value = loadedConversation;
    messages.value = loadedMessages;
    lastMessageId.value =
      loadedMessages[loadedMessages.length - 1]?.id ??
      loadedConversation.lastMessageId ??
      '';

    const readConversation = await markOrderChatRead(orderId);
    if (disposed || seq !== requestSeq) return;
    conversation.value = readConversation;
    syncReadState();
    emit('updated', readConversation);
    await scrollToLatest();
    startTimer();
  } catch (caught) {
    if (disposed || seq !== requestSeq) return;
    error.value = caught instanceof Error ? caught.message : t('orderLoadError');
  } finally {
    if (disposed || seq !== requestSeq) return;
    loading.value = false;
    refreshing.value = false;
  }
}

async function refreshConversation() {
  if (!props.visible || disposed || !conversation.value) return;

  const orderId = props.order.id;
  const seq = ++requestSeq;
  refreshing.value = true;

  try {
    const [loadedConversation, page] = await Promise.all([
      getOrderChat(orderId),
      lastMessageId.value
        ? listOrderChatMessages(orderId, {
            cursor: lastMessageId.value,
            limit: 50,
          })
        : listOrderChatMessages(orderId, { limit: 50 }),
    ]);

    if (disposed || seq !== requestSeq) return;

    conversation.value = loadedConversation;
    if (page.items.length) {
      messages.value = mergeMessages(messages.value, page.items);
      lastMessageId.value = page.items[page.items.length - 1]?.id ?? lastMessageId.value;
    }
    const readConversation = await markOrderChatRead(orderId);
    if (disposed || seq !== requestSeq) return;
    conversation.value = readConversation;
    syncReadState();
    emit('updated', readConversation);
    if (page.items.length) {
      await scrollToLatest();
    }
  } catch (caught) {
    if (disposed || seq !== requestSeq) return;
    error.value = caught instanceof Error ? caught.message : t('orderLoadError');
  } finally {
    if (disposed || seq !== requestSeq) return;
    refreshing.value = false;
  }
}

async function sendMessage() {
  const content = draft.value.trim();
  if (!content || !canSend.value || sending.value) return;

  sending.value = true;
  error.value = '';

  try {
    const message = await sendOrderChatMessage(props.order.id, content);
    draft.value = '';
    messages.value = mergeMessages(messages.value, [message]);
    lastMessageId.value = message.id;
    if (conversation.value) {
      conversation.value = {
        ...conversation.value,
        lastMessage: message,
        lastMessageId: message.id,
        lastMessageAt: message.createdAt,
      };
      emit('updated', conversation.value);
    }
    await scrollToLatest();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : t('orderLoadError');
  } finally {
    sending.value = false;
  }
}

function close() {
  emit('close');
}

function messageSide(message: OrderChatMessage) {
  return message.senderType === 'MERCHANT' ? 'other' : 'self';
}

function messageSender(message: OrderChatMessage) {
  return message.senderType === 'MERCHANT' ? t('merchant') : t('me');
}

function formatTime(value: string) {
  return new Date(value).toLocaleString();
}
</script>

<template>
  <view v-if="visible" class="chat-mask" @click.self="close">
    <view class="chat-card">
      <view class="chat-header">
        <view>
          <text class="chat-title">{{ t('orderChat') }}</text>
          <text class="chat-subtitle">{{ merchantDisplayName }} · #{{ order.orderNo }}</text>
        </view>
        <button class="close-button" @click="close">{{ t('close') }}</button>
      </view>

      <view v-if="error" class="chat-message error">{{ error }}</view>

      <view class="chat-body">
        <view class="chat-toolbar">
          <text>{{ t('chatHistory') }}</text>
          <text v-if="loading">{{ t('loadingMessages') }}</text>
          <text v-else-if="refreshing">{{ t('chatRefreshing') }}</text>
        </view>

        <scroll-view class="message-list" scroll-y :scroll-into-view="scrollIntoViewId">
          <view v-if="!loading && !messages.length" class="empty-state">
            <text>{{ t('noMessages') }}</text>
          </view>
          <view
            v-for="message in messages"
            :key="message.id"
            :id="`msg-${message.id}`"
            :class="['message-row', messageSide(message)]"
          >
            <view class="message-bubble">
              <view class="message-head">
                <text>{{ messageSender(message) }}</text>
                <text>{{ formatTime(message.createdAt) }}</text>
              </view>
              <text class="message-content">{{ message.content }}</text>
              <text class="message-state">{{ message.readAt ? t('read') : t('unread') }}</text>
            </view>
          </view>
        </scroll-view>

        <text v-if="showReadOnlyHint" class="chat-hint">{{ t('chatClosedHint') }}</text>

        <view class="composer">
          <textarea
            v-model="draft"
            class="composer-input"
            :disabled="!canSend || sending"
            :placeholder="t('messagePlaceholder')"
          />
          <view class="composer-actions">
            <text v-if="showReadOnlyHint" class="chat-hint">{{ t('chatClosedHint') }}</text>
            <button class="send-button" :disabled="!canSend || sending || !draft.trim()" @click="sendMessage">
              {{ sending ? t('sending') : t('sendMessage') }}
            </button>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.chat-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgb(16 28 19 / 48%);
}

.chat-card {
  width: 100%;
  max-height: 88vh;
  padding: 24rpx 24rpx calc(24rpx + env(safe-area-inset-bottom));
  border-radius: 28rpx 28rpx 0 0;
  background: #fff;
  box-shadow: 0 -16rpx 40rpx rgb(16 28 19 / 18%);
  box-sizing: border-box;
  display: grid;
  gap: 20rpx;
}

.chat-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20rpx;
}

.chat-title {
  display: block;
  font-size: 34rpx;
  font-weight: 800;
}

.chat-subtitle {
  display: block;
  margin-top: 6rpx;
  color: #6f7b73;
  font-size: 22rpx;
}

.close-button {
  min-width: 120rpx;
  padding: 14rpx 20rpx;
  border-radius: 999rpx;
  color: #35553e;
  background: #edf4ee;
  font-size: 24rpx;
}

.chat-message {
  padding: 18rpx 20rpx;
  border-radius: 18rpx;
  font-size: 22rpx;
}

.chat-message.error {
  color: #8a3a3a;
  background: #fff0f0;
}

.chat-body {
  display: grid;
  gap: 16rpx;
  min-height: 0;
}

.chat-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12rpx;
  color: #6f7b73;
  font-size: 22rpx;
}

.message-list {
  min-height: 50vh;
  max-height: 58vh;
  padding: 10rpx 4rpx;
  border: 1rpx solid #edf0f2;
  border-radius: 22rpx;
  background: #f9fbfa;
  box-sizing: border-box;
}

.empty-state {
  padding: 80rpx 0;
  color: #7d8980;
  text-align: center;
}

.message-row {
  display: flex;
  margin-bottom: 14rpx;
}

.message-row.self {
  justify-content: flex-end;
}

.message-row.other {
  justify-content: flex-start;
}

.message-bubble {
  width: 82%;
  padding: 18rpx 18rpx 14rpx;
  border-radius: 22rpx;
  background: #fff;
  box-shadow: 0 8rpx 22rpx rgb(31 45 36 / 6%);
}

.message-row.self .message-bubble {
  background: #eaf7ee;
}

.message-head {
  display: flex;
  justify-content: space-between;
  gap: 12rpx;
  color: #728077;
  font-size: 20rpx;
}

.message-content {
  display: block;
  margin-top: 10rpx;
  color: #1f2d24;
  font-size: 26rpx;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-state {
  display: block;
  margin-top: 10rpx;
  color: #7c857f;
  font-size: 20rpx;
}

.chat-hint {
  color: #7c857f;
  font-size: 22rpx;
  line-height: 1.5;
}

.composer {
  display: grid;
  gap: 14rpx;
}

.composer-input {
  width: 100%;
  min-height: 140rpx;
  padding: 18rpx 20rpx;
  border: 1rpx solid #dbe6de;
  border-radius: 20rpx;
  box-sizing: border-box;
  background: #fff;
  font-size: 26rpx;
}

.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
}

.send-button {
  min-width: 150rpx;
  padding: 16rpx 24rpx;
  border-radius: 999rpx;
  color: #fff;
  background: #43a047;
  font-size: 24rpx;
}

.send-button[disabled] {
  opacity: .55;
  background: #9ccaa3;
}
</style>
