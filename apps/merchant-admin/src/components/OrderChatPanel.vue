<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
  getMerchantOrderChat,
  listMerchantOrderChatMessages,
  markMerchantOrderChatRead,
  sendMerchantOrderChatMessage,
  type MerchantChatConversation,
} from '@/api/order-chat';
import MerchantIcon from '@/components/MerchantIcon.vue';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import { useI18n } from '@/i18n';
import type { MerchantOrder, OrderChatMessage } from '@/types/api';

const props = defineProps<{
  order: MerchantOrder;
}>();

const emit = defineEmits<{
  close: [];
  updated: [conversation: MerchantOrder['chatConversation'] | null];
}>();

const { t } = useI18n();
const loading = ref(false);
const refreshing = ref(false);
const sending = ref(false);
const error = ref('');
const draft = ref('');
const conversation = ref<MerchantChatConversation | null>(null);
const messages = ref<OrderChatMessage[]>([]);
const messageListRef = ref<HTMLElement | null>(null);
const lastMessageId = ref('');

let requestSeq = 0;
let pollTimer: number | undefined;
let disposed = false;

const isFinalOrder = computed(() =>
  ['COMPLETED', 'CANCELLED'].includes(props.order.status),
);

const canSend = computed(
  () => {
    const currentConversation = conversation.value;
    if (!currentConversation) return false;
    return !isFinalOrder.value && currentConversation.status !== 'CLOSED';
  },
);

const showReadOnlyHint = computed(
  () => isFinalOrder.value || conversation.value?.status === 'CLOSED',
);

const participantName = computed(() => {
  const customer = conversation.value?.customer;
  return customer?.nickname?.trim() || customer?.phone?.trim() || t('customer');
});

const quickReplies = [
  '您好，请问几位用餐？',
  '可以吃辣吗？',
  '预计20分钟送达',
  '好的，稍等',
  '已经出餐',
  '配送员已出发',
];

type TimelineItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'message'; key: string; message: OrderChatMessage };

const timelineItems = computed<TimelineItem[]>(() => buildTimelineItems(messages.value));
const showNewMessagePrompt = ref(false);
const isNearBottom = ref(true);

watch(
  () => props.order.id,
  () => {
    void loadConversation(true);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  disposed = true;
  clearPollTimer();
});

function clearPollTimer() {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function startPolling() {
  clearPollTimer();
  pollTimer = window.setInterval(() => {
    void loadConversation(false);
  }, 5000);
}

function mergeMessages(
  current: OrderChatMessage[],
  incoming: OrderChatMessage[],
) {
  const map = new Map<string, OrderChatMessage>();
  for (const message of current) {
    map.set(message.id, message);
  }
  for (const message of incoming) {
    map.set(message.id, message);
  }
  return [...map.values()].sort((left, right) => {
    if (left.id === right.id) return 0;
    return BigInt(left.id) > BigInt(right.id) ? 1 : -1;
  });
}

async function scrollToBottom() {
  await nextTick();
  const el = messageListRef.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  isNearBottom.value = true;
  showNewMessagePrompt.value = false;
}

async function loadAllMessages(orderId: string) {
  const all: OrderChatMessage[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await listMerchantOrderChatMessages(
      orderId,
      cursor ? { cursor, limit: 50 } : { limit: 50 },
    );
    all.push(...page.items);
    if (!page.pageInfo.hasMore || !page.pageInfo.nextCursor) {
      break;
    }
    cursor = page.pageInfo.nextCursor;
  }

  return all;
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

function handleMessageListScroll(event: Event) {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;
  const threshold = 48;
  const nearBottom = target.scrollHeight - (target.scrollTop + target.clientHeight) <= threshold;
  isNearBottom.value = nearBottom;
  if (nearBottom) {
    showNewMessagePrompt.value = false;
  }
}

function handleNewMessagePrompt() {
  void scrollToBottom();
}

async function loadConversation(initial = false) {
  const orderId = props.order.id;
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
      getMerchantOrderChat(orderId),
      loadAllMessages(orderId),
    ]);

    if (disposed || seq !== requestSeq) return;

    conversation.value = loadedConversation;
    messages.value = loadedMessages;

    lastMessageId.value =
      loadedMessages[loadedMessages.length - 1]?.id ??
      loadedConversation?.lastMessageId ??
      '';

    if (loadedConversation) {
      const readConversation = await markMerchantOrderChatRead(orderId);
      if (disposed || seq !== requestSeq) return;
      if (readConversation) {
        conversation.value = readConversation;
        const readAt = new Date().toISOString();
        messages.value = messages.value.map((message) =>
          message.senderType === 'CUSTOMER' && !message.readAt
            ? { ...message, readAt }
            : message,
        );
        emit('updated', readConversation);
      }
    }
    const nextLastMessageId =
      loadedMessages[loadedMessages.length - 1]?.id ??
      loadedConversation?.lastMessageId ??
      '';
    if (initial) {
      await scrollToBottom();
    } else if (nextLastMessageId !== previousLastMessageId) {
      if (wasNearBottom) {
        await scrollToBottom();
      } else {
        showNewMessagePrompt.value = true;
      }
    }

    startPolling();
  } catch (err) {
    if (disposed || seq !== requestSeq) return;
    error.value = t('chatLoadFailed');
  } finally {
    if (disposed || seq !== requestSeq) return;
    loading.value = false;
    refreshing.value = false;
  }
}

async function sendMessage() {
  const content = draft.value.trim();
  if (!content || sending.value || !canSend.value) {
    return;
  }

  sending.value = true;
  error.value = '';

  try {
    const message = await sendMerchantOrderChatMessage(props.order.id, content);
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
    await scrollToBottom();
  } catch (err) {
    error.value = t('chatSendFailed');
  } finally {
    sending.value = false;
  }
}

function close() {
  emit('close');
}

function messageSide(message: OrderChatMessage) {
  return message.senderType === 'MERCHANT' ? 'self' : 'other';
}

function isMerchantMessage(message: OrderChatMessage) {
  return message.senderType === 'MERCHANT';
}
</script>

<template>
  <Teleport to="body">
    <div class="chat-modal-backdrop" @click.self="close">
      <section class="order-chat-panel" role="dialog" aria-modal="true" :aria-label="t('orderChat')">
        <header class="chat-header">
          <button type="button" class="chat-back" :aria-label="t('close')" @click="close">
            <MerchantIcon name="back" />
          </button>
          <div class="chat-heading">
            <h2>{{ t('orderChat') }}</h2>
            <p>
              <span>#{{ props.order.orderNo }}</span>
              <i aria-hidden="true"></i>
              <span class="chat-participant">{{ participantName }}</span>
            </p>
          </div>
          <OrderStatusBadge class="chat-order-status" :status="props.order.status" />
        </header>

        <div class="chat-body">
          <div class="chat-toolbar" aria-live="polite">
            <span>{{ t('chatHistory') }}</span>
            <small v-if="loading">{{ t('loadingMessages') }}</small>
            <small v-else-if="refreshing">{{ t('chatRefreshing') }}</small>
          </div>

          <div v-if="error" class="chat-error" role="alert">
            <span>{{ error }}</span>
            <button type="button" @click="loadConversation(true)">{{ t('retry') }}</button>
          </div>

          <div ref="messageListRef" class="message-list" @scroll="handleMessageListScroll">
            <div v-if="!loading && !messages.length" class="chat-empty">
              <span class="chat-empty-icon" aria-hidden="true"></span>
              <strong>{{ t('noMessages') }}</strong>
              <small>{{ t('chatEmptyHint') }}</small>
            </div>
            <template v-for="item in timelineItems" :key="item.key">
              <div v-if="item.type === 'date'" class="date-divider">
                <span class="date-divider-label">{{ item.label }}</span>
              </div>
              <article v-else :class="['message-row', messageSide(item.message)]">
                <div class="message-stack">
                  <small class="message-time">{{ formatMessageTime(item.message.createdAt) }}</small>
                  <div :class="['message-bubble', { self: isMerchantMessage(item.message) }]">
                    <p class="message-content">{{ item.message.content }}</p>
                    <small
                      v-if="isMerchantMessage(item.message)"
                      :class="['message-status', item.message.readAt ? 'read' : 'unread']"
                      aria-hidden="true"
                    >
                      {{ item.message.readAt ? '✓✓' : '✓' }}
                    </small>
                  </div>
                </div>
              </article>
            </template>
          </div>

          <button
            v-if="showNewMessagePrompt"
            type="button"
            class="new-message-prompt"
            @click="handleNewMessagePrompt"
          >
            ↓ {{ t('newMessages') }}
          </button>

          <div class="chat-composer-shell">
            <p v-if="showReadOnlyHint" class="chat-hint">{{ t('chatClosedHint') }}</p>
            <form v-else class="chat-form" @submit.prevent="sendMessage">
              <div class="quick-replies" :aria-label="t('quickReply')">
                <button
                  v-for="reply in quickReplies"
                  :key="reply"
                  type="button"
                  class="quick-reply"
                  @click="draft = reply"
                >
                  {{ reply }}
                </button>
              </div>
              <div class="chat-compose-row">
                <textarea
                  v-model="draft"
                  rows="1"
                  :disabled="!canSend || sending"
                  :placeholder="t('messagePlaceholder')"
                  @keydown.enter.exact.prevent="sendMessage"
                />
                <button
                  type="submit"
                  class="chat-send"
                  :disabled="!canSend || sending || !draft.trim()"
                >
                  {{ sending ? t('sending') : t('sendMessage') }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.chat-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 240;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(14 31 21 / 38%);
  overscroll-behavior: none;
}

.order-chat-panel {
  width: min(680px, 100%);
  height: min(82vh, 780px);
  height: min(82dvh, 780px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgb(213 226 217 / 92%);
  border-radius: 24px;
  background: #f4f8f5;
  box-shadow: 0 28px 80px rgb(13 34 21 / 24%);
}

.chat-header {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 72px;
  padding: 10px 18px;
  border-bottom: 1px solid #e0e9e2;
  background: rgb(255 255 255 / 94%);
}

.chat-back {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #173b2a;
  background: transparent;
}

.chat-back:hover {
  background: #edf4ef;
}

.chat-heading {
  min-width: 0;
}

.chat-heading h2 {
  margin: 0;
  color: #163626;
  font-size: 17px;
  font-weight: 720;
  line-height: 1.2;
}

.chat-heading p {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  margin: 4px 0 0;
  color: #78877e;
  font-size: 12px;
  line-height: 1.2;
}

.chat-heading p i {
  width: 3px;
  height: 3px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #a4aea8;
}

.chat-participant {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-body {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.chat-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 36px;
  padding: 0 22px;
  color: #7a8980;
  font-size: 12px;
}

.message-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 9px;
  min-height: 0;
  padding: 10px 22px 18px;
  overflow: auto;
  overscroll-behavior: contain;
  background: #f4f8f5;
}

.date-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 4px 0;
}

.date-divider-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  color: #8a949b;
  background: #eef2f0;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

.chat-empty {
  display: grid;
  flex: 1;
  place-content: center;
  justify-items: center;
  gap: 7px;
  min-height: 180px;
  padding: 24px;
  color: #7e8c83;
  text-align: center;
}

.chat-empty-icon {
  position: relative;
  width: 44px;
  height: 36px;
  margin-bottom: 5px;
  border: 1.5px solid #b9c9be;
  border-radius: 15px;
  background: #fff;
}

.chat-empty-icon::after {
  position: absolute;
  right: 7px;
  bottom: -6px;
  width: 10px;
  height: 10px;
  border-right: 1.5px solid #b9c9be;
  border-bottom: 1.5px solid #b9c9be;
  background: #fff;
  content: '';
  transform: rotate(45deg);
}

.chat-empty strong {
  color: #53665a;
  font-size: 14px;
}

.chat-empty small {
  max-width: 260px;
  font-size: 12px;
  line-height: 1.45;
}

.message-row {
  display: flex;
  margin-bottom: 2px;
}

.message-row.self {
  justify-content: flex-end;
}

.message-row.other {
  justify-content: flex-start;
}

.message-stack {
  display: flex;
  max-width: 72%;
  flex-direction: column;
  align-items: flex-start;
}

.message-row.self .message-stack {
  align-items: flex-end;
}

.message-time {
  margin-bottom: 3px;
  color: #98a2b3;
  font-size: 11px;
  line-height: 1.2;
}

.message-bubble {
  display: inline-flex;
  width: auto;
  max-width: 100%;
  min-height: 0;
  height: auto;
  align-items: flex-end;
  gap: 6px;
  padding: 9px 12px;
  border: 1px solid #e0e8e2;
  border-radius: 16px 16px 16px 5px;
  color: #183127;
  background: #fff;
  box-shadow: 0 3px 10px rgb(31 45 36 / 4%);
  box-sizing: border-box;
}

.message-bubble.self {
  border-color: #cfe5d3;
  border-radius: 16px 16px 5px;
  background: #e7f4ea;
}

.message-content {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  margin: 0;
  color: #1f2d24;
  font-size: 14px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.message-status {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 14px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.message-status.unread {
  color: #97a0aa;
}

.message-status.read {
  color: #24a148;
}

.chat-composer-shell {
  flex: 0 0 auto;
  padding: 10px 16px max(12px, env(safe-area-inset-bottom));
  border-top: 1px solid #dfe8e1;
  background: rgb(255 255 255 / 96%);
}

.chat-form {
  display: grid;
  gap: 9px;
}

.quick-replies {
  display: flex;
  gap: 7px;
  margin: 0 -2px;
  padding: 0 2px 2px;
  overflow-x: auto;
  scrollbar-width: none;
}

.quick-replies::-webkit-scrollbar {
  display: none;
}

.quick-reply {
  flex: 0 0 auto;
  min-height: 31px;
  padding: 6px 10px;
  border: 1px solid #dce8df;
  border-radius: 999px;
  background: #f6faf7;
  color: #42604d;
  font-size: 12px;
  line-height: 1.2;
}

.chat-compose-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.chat-compose-row textarea {
  width: auto;
  min-width: 0;
  min-height: 44px;
  max-height: 104px;
  flex: 1 1 auto;
  resize: none;
  padding: 11px 13px;
  border: 1px solid #d8e3db;
  border-radius: 14px;
  color: #173426;
  background: #f8faf9;
  font-size: 14px;
  line-height: 1.4;
}

.chat-send {
  flex: 0 0 auto;
  min-width: 68px;
  min-height: 44px;
  padding: 0 14px;
  border-radius: 14px;
  font-size: 13px;
}

.new-message-prompt {
  position: absolute;
  right: 18px;
  bottom: 104px;
  z-index: 2;
  align-self: center;
  padding: 6px 12px;
  border-radius: 999px;
  color: #35553e;
  background: #edf4ee;
  font-size: 12px;
  line-height: 1;
}

.chat-hint {
  display: block;
  margin: 0;
  padding: 8px 10px;
  border-radius: 12px;
  color: #68707a;
  background: #f3f6f4;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}

.chat-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 22px 8px;
  padding: 9px 11px;
  border-radius: 12px;
  color: #9f3131;
  background: #fff1f1;
  font-size: 13px;
}

.chat-error button {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 4px 9px;
  border: 0;
  color: #9f3131;
  background: transparent;
  font-size: 12px;
  font-weight: 700;
}

@media (max-width: 760px) {
  .chat-modal-backdrop {
    display: block;
    padding: 0;
    background: #f4f8f5;
  }

  .order-chat-panel {
    width: 100%;
    height: 100vh;
    height: 100dvh;
    max-height: none;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .chat-header {
    min-height: 66px;
    padding: max(7px, env(safe-area-inset-top)) 14px 7px;
  }

  .chat-heading h2 {
    font-size: 16px;
  }

  .chat-order-status {
    font-size: 11px;
  }

  .chat-toolbar {
    min-height: 32px;
    padding: 0 16px;
  }

  .message-list {
    padding: 8px 16px 14px;
  }

  .message-stack {
    max-width: 82%;
  }

  .message-bubble {
    padding: 8px 10px;
  }

  .chat-composer-shell {
    padding-right: 12px;
    padding-left: 12px;
  }

  .chat-error {
    margin-right: 16px;
    margin-left: 16px;
  }
}
</style>
