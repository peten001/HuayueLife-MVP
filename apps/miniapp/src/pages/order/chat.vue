<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { merchantName, translateApiError, useI18n, usePageTitle } from '@/i18n';
import {
  getOrderChat,
  listOrderChatMessages,
  markOrderChatRead,
  sendOrderChatMessage,
  sendOrderChatImage,
  sendOrderChatLocation,
  type UserChatConversation,
} from '@/api/order-chat';
import { useAuthStore } from '@/stores/auth';
import type { OrderChatMessage } from '@/types/api';
import { resolveMediaUrl } from '@/utils/media';
import OrderChatLocationPreview from '@/components/OrderChatLocationPreview.vue';
import {
  chatMediaLabel,
  chooseChatImage,
  chooseChatLocation,
  previewChatImage,
  type ChatLocationSelection,
} from '@/utils/order-chat-media';

const auth = useAuthStore();
const { t, locale } = useI18n();
const orderId = ref('');
const readonly = ref(false);
const loading = ref(false);
const refreshing = ref(false);
const sending = ref(false);
const error = ref('');
const draft = ref('');
const conversation = ref<UserChatConversation | null>(null);
const messages = ref<OrderChatMessage[]>([]);
const failedImageIds = ref<string[]>([]);
const lastMessageId = ref('');
const scrollIntoViewId = ref('');
const showNewMessagePrompt = ref(false);
const isNearBottom = ref(true);
const shouldStickToBottom = ref(true);
const isUserScrollingHistory = ref(false);
const keyboardHeight = ref(0);
const viewportHeight = ref(getViewportHeight());
const attachmentPanelOpen = ref(false);
const pendingLocation = ref<ChatLocationSelection | null>(null);
const selectingLocation = ref(false);
const keyboardSpacingPx = 8;
const composerSafeAreaGapPx = getComposerSafeAreaGap();
let timer: ReturnType<typeof setInterval> | undefined;
let stickToBottomTimer: ReturnType<typeof setTimeout> | undefined;
let requestSeq = 0;
let disposed = false;
let suppressScrollTracking = false;

const canSend = computed(() => {
  const currentOrderStatus = order.value?.status;
  const currentConversationStatus = conversation.value?.status;
  if (!currentOrderStatus) return false;
  return !readonly.value && !isClosedOrderStatus(currentOrderStatus) && currentConversationStatus !== 'CLOSED';
});

const showReadOnlyHint = computed(
  () =>
    readonly.value ||
    isClosedOrderStatus(order.value?.status ?? '') ||
    conversation.value?.status === 'CLOSED',
);

const merchantDisplayName = computed(() => {
  return merchantName(conversation.value?.merchant, locale.value);
});

const order = computed(() => conversation.value?.order ?? null);

type TimelineItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'message'; key: string; message: OrderChatMessage };

const timelineItems = computed<TimelineItem[]>(() => buildTimelineItems(messages.value));
const chatShellStyle = computed(() => ({
  height: `${Math.max(0, viewportHeight.value - keyboardHeight.value - (keyboardHeight.value > 0 ? keyboardSpacingPx : 0))}px`,
  maxHeight: `${Math.max(0, viewportHeight.value - keyboardHeight.value - (keyboardHeight.value > 0 ? keyboardSpacingPx : 0))}px`,
  '--composer-bottom-gap': keyboardHeight.value > 0
    ? '4rpx'
    : `${composerSafeAreaGapPx}px`,
}));

const sendButtonDisabled = computed(() => !canSend.value || sending.value || !draft.value.trim());

function getViewportHeight() {
  const info = typeof uni.getWindowInfo === 'function' ? uni.getWindowInfo() : uni.getSystemInfoSync();
  return info.windowHeight ?? 0;
}

function getComposerSafeAreaGap() {
  const info = typeof uni.getWindowInfo === 'function' ? uni.getWindowInfo() : uni.getSystemInfoSync();
  const screenHeight = info.screenHeight ?? info.windowHeight ?? 0;
  const safeAreaBottom = info.safeArea?.bottom ?? screenHeight;
  return Math.max(8, screenHeight - safeAreaBottom - 14);
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

function handleInputFocus(event: unknown) {
  attachmentPanelOpen.value = false;
  updateKeyboardHeight(readKeyboardHeight(event) || keyboardHeight.value);
  if (shouldStickToBottom.value) {
    scheduleScrollToBottom('focus');
  }
}

function handleInputBlur() {
  updateKeyboardHeight(0);
}

function handleKeyboardHeightChange(event: unknown) {
  updateKeyboardHeight(readKeyboardHeight(event));
  if (shouldStickToBottom.value) {
    scheduleScrollToBottom('keyboardheightchange');
  }
}

function handleScroll() {
  if (suppressScrollTracking) return;
  if (keyboardHeight.value > 0 && shouldStickToBottom.value) return;
  isNearBottom.value = false;
  shouldStickToBottom.value = false;
  isUserScrollingHistory.value = true;
}

function handleScrollToLower() {
  if (suppressScrollTracking) return;
  isNearBottom.value = true;
  shouldStickToBottom.value = true;
  isUserScrollingHistory.value = false;
  showNewMessagePrompt.value = false;
}

function handleChatContentTap() {
  uni.hideKeyboard();
  attachmentPanelOpen.value = false;
}

function toggleAttachmentPanel() {
  if (!canSend.value || sending.value) return;
  uni.hideKeyboard();
  updateKeyboardHeight(0);
  attachmentPanelOpen.value = !attachmentPanelOpen.value;
  if (attachmentPanelOpen.value) scheduleScrollToBottom('attachment-panel', true);
}

function handleNewMessagePrompt() {
  scheduleScrollToBottom('new-message', true);
}

function handleSendButtonTap() {
  void sendMessage();
}

function handleConfirmSend() {
  void sendMessage();
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

function scheduleScrollToBottom(reason: string, force = false) {
  if (!force && !shouldStickToBottom.value) return;
  clearStickToBottomTimer();
  stickToBottomTimer = setTimeout(async () => {
    if (disposed) return;
    if (!force && !shouldStickToBottom.value) return;
    suppressScrollTracking = true;
    await nextTick();
    scrollIntoViewId.value = '';
    await nextTick();
    setTimeout(() => {
      if (disposed) return;
      if (!force && !shouldStickToBottom.value) return;
      scrollIntoViewId.value = 'chat-bottom-anchor';
      isNearBottom.value = true;
      shouldStickToBottom.value = true;
      isUserScrollingHistory.value = false;
      showNewMessagePrompt.value = false;
      setTimeout(() => {
        suppressScrollTracking = false;
      }, 120);
    }, 50);
  }, force ? 0 : 60);
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

  if (currentKey === todayKey) {
    return locale.value === 'vi' ? 'Hôm nay' : locale.value === 'en' ? 'Today' : '今天';
  }
  if (currentKey === yesterdayKey) {
    return locale.value === 'vi' ? 'Hôm qua' : locale.value === 'en' ? 'Yesterday' : '昨天';
  }
  return `${current.getFullYear()}/${String(current.getMonth() + 1).padStart(2, '0')}/${String(current.getDate()).padStart(2, '0')}`;
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function isOwnMessage(message: OrderChatMessage) {
  return message.senderType === 'CUSTOMER';
}

function isClosedOrderStatus(status: string | undefined | null) {
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
  void markOrderChatRead(chatOrderId)
    .then((readConversation) => {
      if (disposed || seq !== requestSeq) return;
      conversation.value = readConversation;
      syncReadState();
    })
    .catch((caught) => {
      void caught;
    });
}

async function loadConversation(initial = false) {
  if (!orderId.value || disposed) return;

  const chatOrderId = orderId.value;
  const seq = ++requestSeq;
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
      scheduleScrollToBottom('initial-load', true);
      shouldStickToBottom.value = true;
    } else if (nextLastMessageId !== previousLastMessageId) {
      if (wasNearBottom) {
        scheduleScrollToBottom('load-conversation', false);
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
    if (page.items.length) {
      messages.value = mergeMessages(messages.value, page.items);
      lastMessageId.value = page.items[page.items.length - 1]?.id ?? lastMessageId.value;
      conversation.value = applyOptimisticReadState(loadedConversation);
      syncReadState();
      markReadInBackground(chatOrderId, seq, 'refreshConversation');
      const nextLastMessageId = page.items[page.items.length - 1]?.id ?? loadedConversation.lastMessageId ?? '';
      if (nextLastMessageId !== previousLastMessageId) {
        if (wasNearBottom) {
          scheduleScrollToBottom('polling', false);
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
  if (!content || sending.value || !orderId.value) {
    return;
  }
  if (!canSend.value) {
    uni.showToast({ title: t('chatClosedHint'), icon: 'none' });
    return;
  }

  sending.value = true;
  error.value = '';

  try {
    const message = await sendOrderChatMessage(orderId.value, content);
    draft.value = '';
    acceptSentMessage(message);
  } catch (caught) {
    reportSendError(caught);
  } finally {
    sending.value = false;
  }
}

function acceptSentMessage(message: OrderChatMessage) {
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
  scheduleScrollToBottom('send', true);
}

function reportSendError(caught: unknown) {
  const message = caught instanceof Error ? translateApiError(caught.message) : t('orderLoadError');
  error.value = message;
  uni.showToast({ title: message, icon: 'none' });
}

async function sendImage() {
  if (!canSend.value || sending.value || !orderId.value) return;
  attachmentPanelOpen.value = false;
  const selected = await chooseChatImage();
  if (!selected || disposed || !canSend.value || sending.value) return;
  if (selected.size != null && selected.size > 5 * 1024 * 1024) {
    reportSendError(new Error(chatMediaLabel(locale.value, 'imageTooLarge')));
    return;
  }
  const activeOrderId = orderId.value;
  sending.value = true;
  error.value = '';
  try {
    const message = await sendOrderChatImage(activeOrderId, selected.path);
    if (orderId.value === activeOrderId) acceptSentMessage(message);
  } catch (caught) {
    reportSendError(caught);
  } finally {
    sending.value = false;
  }
}

async function chooseLocationForChat() {
  if (!canSend.value || sending.value || !orderId.value) return;
  attachmentPanelOpen.value = false;
  selectingLocation.value = true;
  error.value = '';
  try {
    pendingLocation.value = await chooseChatLocation();
  } catch (caught) {
    reportSendError(new Error(chatMediaLabel(locale.value, 'locationFailed')));
  } finally {
    selectingLocation.value = false;
  }
}

async function confirmSendLocation() {
  if (!pendingLocation.value || !canSend.value || sending.value || !orderId.value) return;
  const activeOrderId = orderId.value;
  const point = pendingLocation.value;
  sending.value = true;
  error.value = '';
  try {
    const message = await sendOrderChatLocation(activeOrderId, point.latitude, point.longitude);
    if (orderId.value !== activeOrderId) return;
    pendingLocation.value = null;
    acceptSentMessage(message);
  } catch (caught) {
    reportSendError(caught);
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
    scheduleScrollToBottom('global-keyboardheightchange');
  }
}

onLoad((options) => {
  updateOrderId(String(options?.orderId ?? ''));
  readonly.value = String(options?.readonly ?? '') === '1';
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
          @tap="handleChatContentTap"
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
              <view :class="['message-bubble', { location: item.message.messageType === 'LOCATION' }]">
                <view class="message-head">
                  <text>{{ formatMessageTime(item.message.createdAt) }}</text>
                </view>
                <view :class="['message-body', { self: isOwnMessage(item.message) }]">
                  <image
                    v-if="item.message.messageType === 'IMAGE' && item.message.mediaUrl && !failedImageIds.includes(item.message.id)"
                    class="message-image" :src="resolveMediaUrl(item.message.mediaUrl)" mode="aspectFill"
                    @tap.stop="previewChatImage(item.message.mediaUrl)"
                    @error="failedImageIds.push(item.message.id)"
                  />
                  <view
                    v-else-if="item.message.messageType === 'LOCATION' && item.message.latitude != null && item.message.longitude != null"
                    class="message-location"
                  >
                    <OrderChatLocationPreview
                      :latitude="item.message.latitude"
                      :longitude="item.message.longitude"
                      :locale="locale"
                      compact
                    />
                  </view>
                  <text v-else class="message-content">{{ item.message.messageType === 'IMAGE' ? chatMediaLabel(locale, 'imageFailed') : item.message.content }}</text>
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
          <button class="new-message-prompt" @click="handleNewMessagePrompt">
            ↓ {{ locale === 'vi' ? 'Tin nhắn mới' : locale === 'en' ? 'New messages' : '新消息' }}
          </button>
        </view>

        <text v-if="showReadOnlyHint" class="chat-hint">{{ t('chatClosedHint') }}</text>

        <view v-if="!readonly" class="composer-dock">
          <view class="composer">
            <input
              v-model="draft"
              class="composer-input"
              :placeholder="t('messagePlaceholder')"
              :adjust-position="false"
              :cursor-spacing="8"
              placeholder-style="line-height: 88rpx; color: #8b9490;"
              confirm-type="send"
              confirm-hold="true"
              hold-keyboard="true"
              @focus="handleInputFocus"
              @blur="handleInputBlur"
              @keyboardheightchange="handleKeyboardHeightChange"
              @confirm="handleConfirmSend"
              maxlength="500"
            />
            <view
              v-if="draft.trim()"
              :class="['send-button', { disabled: sendButtonDisabled }]"
              @tap.stop="handleSendButtonTap"
            >
              {{ sending ? t('sending') : t('sendMessage') }}
            </view>
            <view
              v-else
              :class="['more-button', { active: attachmentPanelOpen, disabled: !canSend || sending }]"
              role="button"
              :aria-label="chatMediaLabel(locale, 'more')"
              @tap.stop="toggleAttachmentPanel"
            >
              <text class="more-symbol">＋</text>
            </view>
          </view>

          <view v-if="attachmentPanelOpen" class="attachment-panel">
            <view class="attachment-action" role="button" @tap.stop="sendImage">
              <view class="attachment-icon photo-icon">
                <view class="photo-sun" />
                <view class="photo-mountain left" />
                <view class="photo-mountain right" />
              </view>
              <text>{{ chatMediaLabel(locale, 'choosePhoto') }}</text>
            </view>
            <view class="attachment-action" role="button" @tap.stop="chooseLocationForChat">
              <view class="attachment-icon">
                <view class="pin-icon"><view class="pin-dot" /></view>
              </view>
              <text>{{ selectingLocation ? t('loading') : chatMediaLabel(locale, 'chooseLocation') }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view v-if="pendingLocation" class="location-confirm-mask" @tap="pendingLocation = null">
      <view class="location-confirm-sheet" @tap.stop>
        <view class="sheet-handle" aria-hidden="true" />
        <view class="location-confirm-head">
          <view>
            <text class="location-confirm-title">{{ chatMediaLabel(locale, 'confirmLocation') }}</text>
            <text class="location-confirm-subtitle">{{ pendingLocation.name || chatMediaLabel(locale, 'selectedLocation') }}</text>
          </view>
          <view class="location-confirm-close" role="button" @tap="pendingLocation = null">×</view>
        </view>
        <OrderChatLocationPreview
          :latitude="pendingLocation.latitude"
          :longitude="pendingLocation.longitude"
          :locale="locale"
          :title="pendingLocation.name"
          :address="pendingLocation.address"
        />
        <view class="location-confirm-actions">
          <button class="location-cancel-button" @tap="pendingLocation = null">{{ t('cancel') }}</button>
          <button class="location-send-button" :disabled="sending" @tap="confirmSendLocation">
            {{ chatMediaLabel(locale, 'sendLocation') }}
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
  padding: 20rpx 20rpx 0;
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
  padding: 6rpx 4rpx 10rpx;
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

.message-bubble.location {
  padding: 0;
  overflow: hidden;
}

.message-bubble.location .message-head {
  padding: 8rpx 10rpx 4rpx;
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

.message-image { width: 350rpx; height: 260rpx; border-radius: 12rpx; background: #eaf2ec; }
.message-location { display: block; min-width: 390rpx; }

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

.composer-dock {
  flex: none;
  margin: 0 -20rpx;
  padding: 10rpx 20rpx var(--composer-bottom-gap, calc(env(safe-area-inset-bottom) + 8rpx));
  border-top: 1rpx solid #e8eeea;
  background: #f7f8f7;
  box-shadow: 0 -8rpx 24rpx rgb(31 45 36 / 4%);
}

.composer {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.composer-input {
  flex: 1;
  width: auto;
  height: 88rpx;
  max-height: 88rpx;
  min-height: 88rpx;
  padding: 0 18rpx;
  border: 1rpx solid #dbe6de;
  border-radius: 16rpx;
  box-sizing: border-box;
  background: #fff;
  font-size: 26rpx;
  line-height: 88rpx;
  overflow: hidden;
}

.send-button {
  flex: none;
  width: 120rpx;
  min-width: 120rpx;
  height: 88rpx;
  padding: 0 18rpx;
  border: 0;
  border-radius: 15px;
  box-sizing: border-box;
  color: #fff;
  background: #4f9b67;
  font-size: 15px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.send-button.disabled {
  opacity: .62;
  background: #b8d6c0;
}

.more-button {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 88rpx;
  height: 88rpx;
  border: 0;
  color: #34463b;
  background: transparent;
  box-sizing: border-box;
  transition: transform .18s ease, background-color .18s ease;
}

.more-button::before {
  position: absolute;
  inset: 10rpx;
  border: 3rpx solid #34463b;
  border-radius: 50%;
  background: #fff;
  content: '';
}

.more-button.active { transform: rotate(45deg); }
.more-button.active::before { background: #e6ece8; }
.more-button.disabled { opacity: .4; }
.more-symbol { position: relative; z-index: 1; font-size: 46rpx; font-weight: 300; line-height: 1; transform: translateY(-1rpx); }

.attachment-panel {
  display: flex;
  gap: 38rpx;
  min-height: 176rpx;
  padding: 24rpx 14rpx 4rpx;
  box-sizing: border-box;
}

.attachment-action {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 10rpx;
  min-width: 108rpx;
  color: #526058;
  font-size: 21rpx;
}

.attachment-icon {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 104rpx;
  height: 104rpx;
  overflow: hidden;
  border: 1rpx solid #e1e7e3;
  border-radius: 22rpx;
  background: #fff;
}

.attachment-action:active .attachment-icon { background: #edf2ee; }

.photo-icon::before {
  position: absolute;
  width: 54rpx;
  height: 42rpx;
  border: 4rpx solid #263a2d;
  border-radius: 7rpx;
  content: '';
  box-sizing: border-box;
}

.photo-sun {
  position: absolute;
  top: 34rpx;
  right: 30rpx;
  width: 9rpx;
  height: 9rpx;
  border-radius: 50%;
  background: #263a2d;
}

.photo-mountain {
  position: absolute;
  bottom: 34rpx;
  width: 25rpx;
  height: 4rpx;
  border-radius: 999rpx;
  background: #263a2d;
  transform-origin: left center;
}

.photo-mountain.left { left: 29rpx; transform: rotate(-45deg); }
.photo-mountain.right { left: 45rpx; transform: rotate(40deg); }

.pin-icon {
  position: relative;
  width: 34rpx;
  height: 34rpx;
  border: 5rpx solid #263a2d;
  border-radius: 50% 50% 50% 0;
  transform: rotate(-45deg);
}

.pin-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 9rpx;
  height: 9rpx;
  border-radius: 50%;
  background: #263a2d;
  transform: translate(-50%, -50%);
}

.location-confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: flex-end;
  background: rgb(20 29 23 / 48%);
}

.location-confirm-sheet {
  width: 100%;
  padding: 28rpx 28rpx calc(24rpx + env(safe-area-inset-bottom));
  border-radius: 30rpx 30rpx 0 0;
  background: #fff;
  box-shadow: 0 -18rpx 50rpx rgb(16 28 19 / 18%);
  box-sizing: border-box;
}

.sheet-handle { width: 70rpx; height: 7rpx; margin: -12rpx auto 22rpx; border-radius: 999rpx; background: #d4dcd6; }

.location-confirm-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20rpx;
  margin-bottom: 22rpx;
}

.location-confirm-title { display: block; color: #1f2d24; font-size: 31rpx; font-weight: 800; }
.location-confirm-subtitle { display: block; max-width: 570rpx; margin-top: 7rpx; overflow: hidden; color: #738078; font-size: 22rpx; text-overflow: ellipsis; white-space: nowrap; }
.location-confirm-close { display: flex; align-items: center; justify-content: center; width: 56rpx; height: 56rpx; border-radius: 50%; color: #657269; background: #f0f3f1; font-size: 38rpx; line-height: 1; }

.location-confirm-actions { display: flex; gap: 16rpx; margin-top: 22rpx; }
.location-cancel-button,
.location-send-button { flex: 1; height: 88rpx; margin: 0; border: 0; border-radius: 16rpx; font-size: 25rpx; line-height: 88rpx; }
.location-cancel-button::after,
.location-send-button::after { border: 0; }
.location-cancel-button { color: #3e4c43; background: #eef2ef; }
.location-send-button { color: #fff; background: #2e7d32; }
.location-cancel-button:active { background: #e0e7e2; }
.location-send-button:active { background: #246a29; }
.location-send-button[disabled] { opacity: .55; }
</style>
