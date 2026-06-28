<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { merchantName, useI18n } from '@/i18n';
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
const showNewMessagePrompt = ref(false);
const isNearBottom = ref(true);
const keyboardHeight = ref(0);
const viewportHeight = ref(getViewportHeight());
let timer: ReturnType<typeof setInterval> | undefined;
let requestSeq = 0;
let disposed = false;
let suppressScrollTracking = false;

const canSend = computed(() => {
  const current = conversation.value;
  if (!current) return false;
  return !['COMPLETED', 'CANCELLED'].includes(props.order.status) && current.status !== 'CLOSED';
});

const showReadOnlyHint = computed(
  () => ['COMPLETED', 'CANCELLED'].includes(props.order.status) || conversation.value?.status === 'CLOSED',
);

const merchantDisplayName = computed(() => {
  return merchantName(props.order.merchant, locale.value);
});

type TimelineItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'message'; key: string; message: OrderChatMessage };

const timelineItems = computed<TimelineItem[]>(() => buildTimelineItems(messages.value));
const chatCardStyle = computed(() => ({
  height: `${Math.max(0, viewportHeight.value - keyboardHeight.value)}px`,
  maxHeight: `${Math.max(0, viewportHeight.value - keyboardHeight.value)}px`,
  '--composer-bottom-gap': keyboardHeight.value > 0
    ? '2rpx'
    : 'calc(env(safe-area-inset-bottom) + 2rpx)',
  '--message-list-bottom-gap': keyboardHeight.value > 0
    ? '18rpx'
    : 'calc(18rpx + env(safe-area-inset-bottom))',
}));

function logChat(step: string, payload?: unknown) {
  console.log(`[miniapp][order-chat] ${step}`, payload ?? '');
}

function getViewportHeight() {
  const info = typeof uni.getWindowInfo === 'function'
    ? uni.getWindowInfo()
    : uni.getSystemInfoSync();
  return info.windowHeight ?? 0;
}

watch(
  () => [props.visible, props.order.id],
  ([visible]) => {
    if (visible) {
      updateKeyboardHeight(0);
      void loadConversation(true);
      return;
    }
    updateKeyboardHeight(0);
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
    if (loading.value || refreshing.value || sending.value) return;
    void refreshConversation();
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

function buildTimelineItems(list: OrderChatMessage[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let lastKey = '';
  for (const message of list) {
    const key = dayKeyFromDate(new Date(message.createdAt));
    if (key !== lastKey) {
      items.push({
        type: 'date',
        key: `date-${key}`,
        label: formatDayLabel(message.createdAt),
      });
      lastKey = key;
    }
    items.push({ type: 'message', key: message.id, message });
  }
  return items;
}

function dayKeyFromDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatDayLabel(value: string) {
  const current = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const currentKey = dayKeyFromDate(current);
  const todayKey = dayKeyFromDate(today);
  const yesterdayKey = dayKeyFromDate(yesterday);

  if (currentKey === todayKey) return '今天';
  if (currentKey === yesterdayKey) return '昨天';
  return `${current.getFullYear()}/${String(current.getMonth() + 1).padStart(2, '0')}/${String(current.getDate()).padStart(2, '0')}`;
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function isOwnMessage(message: OrderChatMessage) {
  return message.senderType === 'CUSTOMER';
}

async function loadAllMessages(orderId: string) {
  const all: OrderChatMessage[] = [];
  let cursor: string | undefined;

  while (true) {
    logChat('loadAllMessages request', {
      orderId,
      cursor: cursor || null,
      limit: 50,
    });
    const page = await listOrderChatMessages(
      orderId,
      cursor ? { cursor, limit: 50 } : { limit: 50 },
    );
    logChat('loadAllMessages response', {
      orderId,
      count: page.items.length,
      hasMore: page.pageInfo.hasMore,
      nextCursor: page.pageInfo.nextCursor,
    });
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

function scrollToBottom() {
  suppressScrollTracking = true;
  scrollIntoViewId.value = '';
  void nextTick().then(() => {
    scrollIntoViewId.value = 'chat-bottom-anchor';
  });
  isNearBottom.value = true;
  showNewMessagePrompt.value = false;
  setTimeout(() => {
    suppressScrollTracking = false;
  }, 120);
}

function applyOptimisticReadState(
  currentConversation: UserChatConversation,
  now = new Date().toISOString(),
) {
  return {
    ...currentConversation,
    customerUnreadCount: 0,
    customerLastReadAt: now,
  };
}

function markReadInBackground(orderId: string, seq: number, phase: string) {
  const startedAt = Date.now();
  logChat('markRead background start', { orderId, seq, phase });
  void markOrderChatRead(orderId)
    .then((readConversation) => {
      logChat('markRead background success', {
        orderId,
        seq,
        phase,
        durationMs: Date.now() - startedAt,
        unread: readConversation.customerUnreadCount,
      });
      if (disposed || seq !== requestSeq) return;
      conversation.value = readConversation;
      syncReadState();
      emit('updated', readConversation);
    })
    .catch((caught) => {
      logChat('markRead background fail', {
        orderId,
        seq,
        phase,
        durationMs: Date.now() - startedAt,
        error:
          caught instanceof Error ? caught.message : String(caught ?? 'unknown'),
      });
    });
}

async function scrollToLatest() {
  await nextTick();
  scrollToBottom();
}

function handleScroll() {
  if (suppressScrollTracking) return;
  isNearBottom.value = false;
}

function handleScrollToLower() {
  if (suppressScrollTracking) return;
  isNearBottom.value = true;
  showNewMessagePrompt.value = false;
}

function handleNewMessagePrompt() {
  scrollToBottom();
}

function updateKeyboardHeight(nextHeight: number) {
  const normalized = Number.isFinite(nextHeight) && nextHeight > 0 ? Math.round(nextHeight) : 0;
  if (normalized === keyboardHeight.value) return;
  keyboardHeight.value = normalized;
}

function readKeyboardHeight(event: unknown) {
  const detail = event && typeof event === 'object' && 'detail' in event
    ? (event as { detail?: { height?: number } }).detail
    : undefined;
  return detail?.height ?? 0;
}

function handleComposerFocus(event: unknown) {
  updateKeyboardHeight(readKeyboardHeight(event) || keyboardHeight.value);
}

function handleComposerBlur() {
  updateKeyboardHeight(0);
}

function handleKeyboardHeightChange(event: unknown) {
  updateKeyboardHeight(readKeyboardHeight(event));
}

async function loadConversation(initial = false) {
  if (!props.visible || disposed) return;

  const orderId = props.order.id;
  const seq = ++requestSeq;
  logChat('loadConversation start', { orderId, initial, seq });

  if (initial) {
    loading.value = true;
    error.value = '';
  } else {
    refreshing.value = true;
  }

  try {
    const wasNearBottom = isNearBottom.value;
    const previousLastMessageId = lastMessageId.value;
    const [loadedConversation, loadedMessages] = await Promise.all([
      getOrderChat(orderId),
      loadAllMessages(orderId),
    ]);
    logChat('loadConversation loaded', {
      orderId,
      seq,
      messages: loadedMessages.length,
      conversationId: loadedConversation.id,
    });

    if (disposed || seq !== requestSeq) return;

    conversation.value = applyOptimisticReadState(loadedConversation);
    messages.value = loadedMessages;
    lastMessageId.value =
      loadedMessages[loadedMessages.length - 1]?.id ??
      loadedConversation.lastMessageId ??
      '';
    syncReadState();
    emit('updated', conversation.value);
    markReadInBackground(orderId, seq, 'loadConversation');
    const nextLastMessageId =
      loadedMessages[loadedMessages.length - 1]?.id ??
      loadedConversation.lastMessageId ??
      '';
    if (initial) {
      await scrollToLatest();
    } else if (nextLastMessageId !== previousLastMessageId) {
      if (wasNearBottom) {
        await scrollToLatest();
      } else {
        showNewMessagePrompt.value = true;
      }
    }
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
  logChat('refreshConversation start', { orderId, seq, lastMessageId: lastMessageId.value || null });

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
    logChat('refreshConversation loaded', {
      orderId,
      seq,
      items: page.items.length,
      hasMore: page.pageInfo.hasMore,
      nextCursor: page.pageInfo.nextCursor,
    });
    if (page.items.length) {
      messages.value = mergeMessages(messages.value, page.items);
      lastMessageId.value = page.items[page.items.length - 1]?.id ?? lastMessageId.value;
      conversation.value = applyOptimisticReadState(loadedConversation);
      syncReadState();
      emit('updated', conversation.value);
      markReadInBackground(orderId, seq, 'refreshConversation');
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
  logChat('sendMessage start', { orderId: props.order.id, length: content.length });

  try {
    const message = await sendOrderChatMessage(props.order.id, content);
    logChat('sendMessage success', {
      orderId: props.order.id,
      messageId: message.id,
      contentLength: message.content.length,
    });
    draft.value = '';
    messages.value = mergeMessages(messages.value, [message]);
    lastMessageId.value = message.id;
    showNewMessagePrompt.value = false;
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

</script>

<template>
  <view v-if="visible" class="chat-mask" @tap="close">
    <view class="chat-card" :style="chatCardStyle" @tap.stop>
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

        <scroll-view
          class="message-list"
          scroll-y
          :scroll-into-view="scrollIntoViewId"
          @scroll="handleScroll"
          @scrolltolower="handleScrollToLower"
        >
          <view v-if="!loading && !messages.length" class="empty-state">
            <text>{{ t('noMessages') }}</text>
          </view>
          <template v-for="item in timelineItems" :key="item.key">
            <view v-if="item.type === 'date'" class="date-divider">
              <text>{{ item.label }}</text>
            </view>
            <view v-else :id="`msg-${item.message.id}`" :class="['message-row', messageSide(item.message)]">
              <view class="message-bubble">
                <view class="message-head">
                  <text>{{ formatMessageTime(item.message.createdAt) }}</text>
                </view>
                <view :class="['message-body', { self: isOwnMessage(item.message) }]">
                  <text class="message-content">{{ item.message.content }}</text>
                  <text
                    v-if="isOwnMessage(item.message)"
                    :class="['message-status', item.message.readAt ? 'read' : 'unread']"
                    aria-hidden="true"
                  >
                    {{ item.message.readAt ? '✓✓' : '✓' }}
                  </text>
                </view>
              </view>
            </view>
          </template>
          <view id="chat-bottom-anchor" class="bottom-anchor" />
        </scroll-view>

        <view v-if="showNewMessagePrompt" class="new-message-wrap">
          <button class="new-message-prompt" @click="handleNewMessagePrompt">↓ 新消息</button>
        </view>

        <text v-if="showReadOnlyHint" class="chat-hint">{{ t('chatClosedHint') }}</text>

        <view class="composer">
          <textarea
            v-model="draft"
            class="composer-input"
            :disabled="!canSend || sending"
            :placeholder="t('messagePlaceholder')"
            :auto-height="false"
            :adjust-position="false"
            :show-confirm-bar="false"
            :cursor-spacing="16"
            confirm-type="send"
            @focus="handleComposerFocus"
            @blur="handleComposerBlur"
            @keyboardheightchange="handleKeyboardHeightChange"
            @confirm="sendMessage"
            maxlength="500"
          />
          <button
            :class="['send-button', { disabled: !canSend || sending || !draft.trim() }]"
            :disabled="!canSend || sending || !draft.trim()"
            @click="sendMessage"
          >
            {{ sending ? t('sending') : t('sendMessage') }}
          </button>
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
  height: 88vh;
  max-height: 88vh;
  padding: 20rpx 20rpx calc(18rpx + env(safe-area-inset-bottom));
  border-radius: 28rpx 28rpx 0 0;
  background: #fff;
  box-shadow: 0 -16rpx 40rpx rgb(16 28 19 / 18%);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  overflow: hidden;
  transition: height 0.18s ease, max-height 0.18s ease;
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
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10rpx;
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
  flex: 1;
  min-height: 0;
  padding: 6rpx 4rpx var(--message-list-bottom-gap, calc(18rpx + env(safe-area-inset-bottom)));
  border: 1rpx solid #edf0f2;
  border-radius: 18rpx;
  background: #f9fbfa;
  box-sizing: border-box;
}

.empty-state {
  padding: 80rpx 0;
  color: #7d8980;
  text-align: center;
}

.date-divider {
  display: flex;
  justify-content: center;
  padding: 8rpx 0 6rpx;
  color: #8a949b;
  font-size: 20rpx;
}

.date-divider text {
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  background: #eef2f0;
}

.message-row {
  display: flex;
  margin-bottom: 8rpx;
}

.message-row.self {
  justify-content: flex-end;
}

.message-row.other {
  justify-content: flex-start;
}

.message-bubble {
  width: fit-content;
  max-width: 75%;
  padding: 8rpx 10rpx 6rpx;
  border-radius: 18rpx;
  background: #fff;
  box-shadow: 0 8rpx 22rpx rgb(31 45 36 / 6%);
  box-sizing: border-box;
}

.message-row.self .message-bubble {
  background: #def4e4;
  border-bottom-right-radius: 6rpx;
}

.message-row.other .message-bubble {
  border-bottom-left-radius: 6rpx;
}

.message-head {
  display: flex;
  justify-content: flex-end;
  color: #8b949a;
  font-size: 16rpx;
  line-height: 1.15;
}

.message-body {
  display: flex;
  align-items: flex-end;
  gap: 4rpx;
}

.message-content {
  display: block;
  margin-top: 2rpx;
  color: #1f2d24;
  font-size: 26rpx;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
  min-width: 0;
}

.message-status {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 20rpx;
  font-size: 18rpx;
  font-weight: 700;
  line-height: 1;
  flex: none;
}

.message-status.unread {
  color: #a6b0b8;
}

.message-status.read {
  color: #24a148;
}

.bottom-anchor {
  width: 100%;
  height: 1rpx;
}

.new-message-wrap {
  display: flex;
  justify-content: center;
}

.new-message-prompt {
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  color: #35553e;
  background: #edf4ee;
  font-size: 22rpx;
  line-height: 1;
}

.chat-hint {
  color: #7c857f;
  font-size: 22rpx;
  line-height: 1.5;
}

.composer {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 12rpx;
  padding-top: 6rpx;
  padding-bottom: var(--composer-bottom-gap, calc(env(safe-area-inset-bottom) + 2rpx));
  background: #fff;
}

.composer-input {
  flex: 1;
  width: auto;
  height: 80rpx;
  max-height: 80rpx;
  min-height: 80rpx;
  padding: 16rpx 18rpx;
  border: 1rpx solid #dbe6de;
  border-radius: 18rpx;
  box-sizing: border-box;
  background: #fff;
  font-size: 26rpx;
  line-height: 1.35;
  overflow: hidden;
}

.send-button {
  flex: none;
  min-width: 150rpx;
  height: 80rpx;
  padding: 0 24rpx;
  border-radius: 18rpx;
  color: #fff;
  background: #43a047;
  font-size: 24rpx;
  line-height: 80rpx;
}

.send-button.disabled {
  opacity: .55;
  background: #9ccaa3;
}
</style>
