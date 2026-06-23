<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { useI18n, usePageTitle } from '@/i18n';
import {
  getOrderChat,
  listOrderChatMessages,
  markOrderChatRead,
  sendOrderChatMessage,
  type UserChatConversation,
} from '@/api/order-chat';
import { useAuthStore } from '@/stores/auth';
import type { OrderChatMessage } from '@/types/api';

const auth = useAuthStore();
const { t, locale } = useI18n();
const orderId = ref('');
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
const shouldStickToBottom = ref(true);
const keyboardHeight = ref(0);
const viewportHeight = ref(getViewportHeight());
const keyboardSpacingPx = 8;
let timer: ReturnType<typeof setInterval> | undefined;
let stickToBottomTimer: ReturnType<typeof setTimeout> | undefined;
let requestSeq = 0;
let disposed = false;
let suppressScrollTracking = false;

const canSend = computed(() => {
  const current = conversation.value;
  if (!current) return false;
  return !['COMPLETED', 'CANCELLED'].includes(current.order.status) && current.status !== 'CLOSED';
});

const showReadOnlyHint = computed(
  () =>
    ['COMPLETED', 'CANCELLED'].includes(conversation.value?.order.status ?? '') ||
    conversation.value?.status === 'CLOSED',
);

const merchantDisplayName = computed(() => {
  if (locale.value === 'vi') return conversation.value?.merchant.nameVi || conversation.value?.merchant.nameZh || '';
  return conversation.value?.merchant.nameZh || '';
});

type TimelineItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'message'; key: string; message: OrderChatMessage };

const timelineItems = computed<TimelineItem[]>(() => buildTimelineItems(messages.value));
const chatShellStyle = computed(() => ({
  height: `${Math.max(0, viewportHeight.value - keyboardHeight.value - (keyboardHeight.value > 0 ? keyboardSpacingPx : 0))}px`,
  maxHeight: `${Math.max(0, viewportHeight.value - keyboardHeight.value - (keyboardHeight.value > 0 ? keyboardSpacingPx : 0))}px`,
  paddingBottom: keyboardHeight.value > 0 ? '0px' : 'calc(18rpx + env(safe-area-inset-bottom))',
  '--composer-bottom-gap': keyboardHeight.value > 0
    ? '0px'
    : 'calc(env(safe-area-inset-bottom) + 2rpx)',
  '--message-list-bottom-gap': keyboardHeight.value > 0
    ? '8rpx'
    : 'calc(18rpx + env(safe-area-inset-bottom))',
}));

function logChat(step: string, payload?: unknown) {
  console.log(`[miniapp][order-chat-page] ${step}`, payload ?? '');
}

function getViewportHeight() {
  const info = typeof uni.getWindowInfo === 'function' ? uni.getWindowInfo() : uni.getSystemInfoSync();
  return info.windowHeight ?? 0;
}

function updateKeyboardHeight(nextHeight: number) {
  const normalized = Number.isFinite(nextHeight) && nextHeight > 0 ? Math.round(nextHeight) : 0;
  if (normalized === keyboardHeight.value) return;
  keyboardHeight.value = normalized;
}

function handleComposerFocus(event: { detail?: { height?: number } }) {
  updateKeyboardHeight(event.detail?.height ?? keyboardHeight.value);
  if (shouldStickToBottom.value) {
    void scheduleStickToBottom();
  }
}

function handleComposerBlur() {
  updateKeyboardHeight(0);
}

function handleKeyboardHeightChange(event: { detail?: { height?: number } }) {
  updateKeyboardHeight(event.detail?.height ?? 0);
  if (shouldStickToBottom.value) {
    void scheduleStickToBottom(80);
  }
}

function handleScroll() {
  if (suppressScrollTracking) return;
  if (keyboardHeight.value > 0 && shouldStickToBottom.value) return;
  isNearBottom.value = false;
  shouldStickToBottom.value = false;
}

function handleScrollToLower() {
  if (suppressScrollTracking) return;
  isNearBottom.value = true;
  shouldStickToBottom.value = true;
  showNewMessagePrompt.value = false;
}

function handleNewMessagePrompt() {
  void scrollToBottom();
}

function clearTimer() {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

function clearStickToBottomTimer() {
  if (stickToBottomTimer !== undefined) {
    clearTimeout(stickToBottomTimer);
    stickToBottomTimer = undefined;
  }
}

async function scheduleStickToBottom(delay = 60) {
  if (!shouldStickToBottom.value || disposed) return;
  clearStickToBottomTimer();
  stickToBottomTimer = setTimeout(async () => {
    if (!shouldStickToBottom.value || disposed) return;
    await nextTick();
    await scrollToBottom();
  }, delay);
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

async function loadAllMessages(chatOrderId: string) {
  const all: OrderChatMessage[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await listOrderChatMessages(
      chatOrderId,
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

async function scrollToBottom() {
  await nextTick();
  suppressScrollTracking = true;
  scrollIntoViewId.value = '';
  await nextTick();
  scrollIntoViewId.value = 'chat-bottom-anchor';
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

function markReadInBackground(chatOrderId: string, seq: number, phase: string) {
  const startedAt = Date.now();
  logChat('markRead background start', { chatOrderId, seq, phase });
  void markOrderChatRead(chatOrderId)
    .then((readConversation) => {
      logChat('markRead background success', {
        chatOrderId,
        seq,
        phase,
        durationMs: Date.now() - startedAt,
        unread: readConversation.customerUnreadCount,
      });
      if (disposed || seq !== requestSeq) return;
      conversation.value = readConversation;
      syncReadState();
    })
    .catch((caught) => {
      logChat('markRead background fail', {
        chatOrderId,
        seq,
        phase,
        durationMs: Date.now() - startedAt,
        error: caught instanceof Error ? caught.message : String(caught ?? 'unknown'),
      });
    });
}

async function scrollToLatest() {
  await nextTick();
  await scrollToBottom();
}

async function loadConversation(initial = false) {
  if (!orderId.value || disposed) return;

  const chatOrderId = orderId.value;
  const seq = ++requestSeq;
  logChat('loadConversation start', { chatOrderId, initial, seq });

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
      getOrderChat(chatOrderId),
      loadAllMessages(chatOrderId),
    ]);

    logChat('loadConversation loaded', {
      chatOrderId,
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
    markReadInBackground(chatOrderId, seq, 'loadConversation');

    const nextLastMessageId =
      loadedMessages[loadedMessages.length - 1]?.id ??
      loadedConversation.lastMessageId ??
      '';
    if (initial) {
      await scrollToLatest();
      shouldStickToBottom.value = true;
    } else if (nextLastMessageId !== previousLastMessageId) {
      if (wasNearBottom) {
        await scrollToLatest();
        shouldStickToBottom.value = true;
      } else {
        showNewMessagePrompt.value = true;
        shouldStickToBottom.value = false;
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
  if (disposed || !conversation.value || !orderId.value) return;

  const chatOrderId = orderId.value;
  const seq = ++requestSeq;
  const wasNearBottom = isNearBottom.value;
  const previousLastMessageId = lastMessageId.value;
  refreshing.value = true;
  logChat('refreshConversation start', {
    chatOrderId,
    seq,
    lastMessageId: lastMessageId.value || null,
  });

  try {
    const [loadedConversation, page] = await Promise.all([
      getOrderChat(chatOrderId),
      lastMessageId.value
        ? listOrderChatMessages(chatOrderId, {
            cursor: lastMessageId.value,
            limit: 50,
          })
        : listOrderChatMessages(chatOrderId, { limit: 50 }),
    ]);

    if (disposed || seq !== requestSeq) return;

    conversation.value = loadedConversation;
    logChat('refreshConversation loaded', {
      chatOrderId,
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
      markReadInBackground(chatOrderId, seq, 'refreshConversation');
      const nextLastMessageId = page.items[page.items.length - 1]?.id ?? loadedConversation.lastMessageId ?? '';
      if (nextLastMessageId !== previousLastMessageId) {
        if (wasNearBottom) {
          await scrollToLatest();
          shouldStickToBottom.value = true;
        } else {
          showNewMessagePrompt.value = true;
          shouldStickToBottom.value = false;
        }
      }
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
  if (!content || !canSend.value || sending.value || !orderId.value) return;

  sending.value = true;
  error.value = '';
  logChat('sendMessage start', { chatOrderId: orderId.value, length: content.length });

  try {
    const message = await sendOrderChatMessage(orderId.value, content);
    logChat('sendMessage success', {
      chatOrderId: orderId.value,
      messageId: message.id,
      contentLength: message.content.length,
    });
    draft.value = '';
    messages.value = mergeMessages(messages.value, [message]);
    lastMessageId.value = message.id;
    showNewMessagePrompt.value = false;
    shouldStickToBottom.value = true;
    if (conversation.value) {
      conversation.value = {
        ...conversation.value,
        lastMessage: message,
        lastMessageId: message.id,
        lastMessageAt: message.createdAt,
      };
    }
    await scrollToLatest();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : t('orderLoadError');
  } finally {
    sending.value = false;
  }
}

function updateOrderId(nextOrderId: string) {
  orderId.value = nextOrderId;
}

function bindKeyboardListener() {
  uni.onKeyboardHeightChange(handleGlobalKeyboardHeightChange);
}

function unbindKeyboardListener() {
  if (typeof uni.offKeyboardHeightChange === 'function') {
    uni.offKeyboardHeightChange(handleGlobalKeyboardHeightChange);
  }
}

function handleGlobalKeyboardHeightChange(result: { height?: number }) {
  updateKeyboardHeight(result.height ?? 0);
  if (keyboardHeight.value > 0 && isNearBottom.value && conversation.value) {
    void scrollToLatest();
  }
}

onLoad((options) => {
  updateOrderId(String(options?.orderId ?? ''));
  bindKeyboardListener();
  void loadConversation(true);
});

onShow(() => {
  if (conversation.value && !timer) {
    startTimer();
  }
});

onHide(() => {
  clearTimer();
});

onBeforeUnmount(() => {
  disposed = true;
  clearTimer();
  clearStickToBottomTimer();
  unbindKeyboardListener();
});

onUnload(() => {
  disposed = true;
  clearTimer();
  clearStickToBottomTimer();
  unbindKeyboardListener();
});

usePageTitle(() => conversation.value ? `${t('orderChat')} · #${conversation.value.order.orderNo}` : t('orderChat'));

watch(draft, () => {
  if (!shouldStickToBottom.value || !keyboardHeight.value) return;
  void scheduleStickToBottom(50);
});

watch(keyboardHeight, (nextHeight, prevHeight) => {
  if (nextHeight === prevHeight) return;
  if (nextHeight > 0 && shouldStickToBottom.value) {
    void scheduleStickToBottom(80);
  }
});
</script>

<template>
  <view class="page">
    <view class="chat-shell" :style="chatShellStyle">
      <view class="chat-header">
        <view>
          <text class="chat-title">{{ t('orderChat') }}</text>
          <text class="chat-subtitle">
            <template v-if="conversation">
              {{ merchantDisplayName }} · #{{ conversation.order.orderNo }}
            </template>
            <template v-else>
              {{ t('loading') }}
            </template>
          </text>
        </view>
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
            <view v-else :id="`msg-${item.message.id}`" :class="['message-row', item.message.senderType === 'CUSTOMER' ? 'self' : 'other']">
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
            :cursor-spacing="0"
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
.page {
  width: 100%;
  height: 100vh;
  background: #f6faf7;
  box-sizing: border-box;
  overflow: hidden;
}

.chat-shell {
  width: 100%;
  padding: 20rpx 20rpx calc(18rpx + env(safe-area-inset-bottom));
  background: #f6faf7;
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
  color: #1f2d24;
}

.chat-subtitle {
  display: block;
  margin-top: 6rpx;
  color: #6f7b73;
  font-size: 22rpx;
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
  background: #f6faf7;
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
