<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { errorMessage } from '@/api/http';
import {
  getMerchantOrderChat,
  listMerchantOrderChatMessages,
  markMerchantOrderChatRead,
  sendMerchantOrderChatMessage,
  type MerchantChatConversation,
} from '@/api/order-chat';
import OrderStatusBadge from '@/components/OrderStatusBadge.vue';
import { useI18n } from '@/i18n';
import type { MerchantOrder, OrderChatMessage, OrderStatus } from '@/types/api';

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

const participantName = computed(
  () =>
    conversation.value?.customer.nickname?.trim() ||
    conversation.value?.customer.phone?.trim() ||
    t('customer'),
);

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
      loadedConversation.lastMessageId ??
      '';

    const readConversation = await markMerchantOrderChatRead(orderId);
    if (disposed || seq !== requestSeq) return;
    conversation.value = readConversation;
    const readAt = new Date().toISOString();
    messages.value = messages.value.map((message) =>
      message.senderType === 'CUSTOMER' && !message.readAt
        ? { ...message, readAt }
        : message,
    );
    emit('updated', readConversation);
    const nextLastMessageId =
      loadedMessages[loadedMessages.length - 1]?.id ??
      loadedConversation.lastMessageId ??
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
    error.value = errorMessage(err);
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
    error.value = errorMessage(err);
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
  <div class="modal-backdrop" @click.self="close">
    <section class="card modal-card order-chat-panel">
      <header class="chat-header">
        <div>
          <h2>{{ t('orderChat') }} · #{{ props.order.orderNo }}</h2>
          <p>
            <OrderStatusBadge :status="props.order.status" />
            <span class="chat-participant">{{ t('customer') }}：{{ participantName }}</span>
          </p>
        </div>
        <button type="button" class="secondary small" @click="close">{{ t('close') }}</button>
      </header>

      <p v-if="error" class="message chat-error">{{ error }}</p>

      <div class="chat-body">
        <div class="chat-toolbar">
          <span>{{ t('chatHistory') }}</span>
          <small v-if="loading">{{ t('loadingMessages') }}</small>
          <small v-else-if="refreshing">{{ t('chatRefreshing') }}</small>
        </div>

        <div ref="messageListRef" class="message-list" @scroll="handleMessageListScroll">
          <p v-if="!loading && !messages.length" class="empty chat-empty">
            {{ t('noMessages') }}
          </p>
          <template v-for="item in timelineItems" :key="item.key">
            <div v-if="item.type === 'date'" class="date-divider">
              <span>{{ item.label }}</span>
            </div>
            <article v-else :class="['message-row', messageSide(item.message)]">
              <div class="message-bubble">
                <header class="message-header">
                  <small>{{ formatMessageTime(item.message.createdAt) }}</small>
                </header>
                <div :class="['message-body', { self: isMerchantMessage(item.message) }]">
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
          ↓ 新消息
        </button>

        <p v-if="showReadOnlyHint" class="chat-hint">{{ t('chatClosedHint') }}</p>

        <form class="chat-form" @submit.prevent="sendMessage">
          <div class="quick-replies">
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
          <textarea
            v-model="draft"
            :disabled="!canSend || sending"
            :placeholder="t('messagePlaceholder')"
            @keydown.enter.exact.prevent="sendMessage"
          />
          <div class="chat-form-actions">
            <small v-if="showReadOnlyHint" class="chat-hint">{{ t('chatClosedHint') }}</small>
            <button type="submit" :disabled="!canSend || sending || !draft.trim()">
              {{ sending ? t('sending') : t('sendMessage') }}
            </button>
          </div>
        </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
.order-chat-panel {
  width: min(780px, 100%);
  height: min(90vh, 920px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

.chat-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.chat-header h2 {
  margin: 0;
  font-size: 20px;
}

.chat-header p {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 8px 0 0;
  color: #68707a;
}

.chat-participant {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.chat-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #68707a;
  font-size: 13px;
}

.message-list {
  display: grid;
  gap: 4px;
  min-height: 0;
  flex: 1;
  padding: 2px 2px 4px;
  overflow: auto;
  border: 1px solid #edf0f2;
  border-radius: 14px;
  background: #f9fbfa;
}

.date-divider {
  display: flex;
  justify-content: center;
  padding: 4px 0;
  color: #8a949b;
  font-size: 11px;
}

.date-divider span {
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2f0;
}

.chat-empty {
  margin: 0;
  padding: 20px;
}

.message-row {
  display: flex;
}

.message-row.self {
  justify-content: flex-end;
}

.message-row.other {
  justify-content: flex-start;
}

.message-bubble {
  width: fit-content;
  max-width: 70%;
  padding: 7px 10px;
  border-radius: 14px;
  background: white;
  box-shadow: 0 6px 20px rgb(31 45 36 / 6%);
}

.message-row.self .message-bubble {
  background: #eaf7ee;
}

.message-header,
.message-body {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.message-body {
  align-items: flex-end;
}

.message-header small,
.message-body small {
  color: #7b838b;
  font-size: 10px;
  line-height: 1.2;
}

.message-content {
  flex: 0 1 auto;
  min-width: 0;
  margin: 0;
  color: #1f2d24;
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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

.chat-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-form textarea {
  min-height: 90px;
}

.quick-replies {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.quick-reply {
  padding: 8px 10px;
  border-radius: 12px;
  background: #edf4ee;
  color: #35553e;
  font-size: 12px;
  line-height: 1.2;
}

.chat-form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.new-message-prompt {
  align-self: center;
  padding: 6px 12px;
  border-radius: 999px;
  color: #35553e;
  background: #edf4ee;
  font-size: 12px;
  line-height: 1;
}

.chat-hint {
  color: #68707a;
  font-size: 13px;
  line-height: 1.5;
}

.chat-error {
  margin: 0;
}

@media (max-width: 760px) {
  .order-chat-panel {
    width: min(100%, 680px);
  }

  .message-bubble {
    max-width: 75%;
  }

  .chat-form-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
