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
    if (initial) {
      await scrollToBottom();
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

function formatTime(value: string) {
  return new Date(value).toLocaleString();
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

        <div ref="messageListRef" class="message-list">
          <p v-if="!loading && !messages.length" class="empty chat-empty">
            {{ t('noMessages') }}
          </p>
          <article
            v-for="message in messages"
            :key="message.id"
            :class="['message-row', messageSide(message)]"
          >
            <div class="message-bubble">
              <header class="message-header">
                <small>{{ formatTime(message.createdAt) }}</small>
              </header>
              <p class="message-content">{{ message.content }}</p>
              <footer class="message-footer">
                <small>{{ message.readAt ? t('read') : t('unread') }}</small>
              </footer>
            </div>
          </article>
        </div>

        <p v-if="showReadOnlyHint" class="chat-hint">{{ t('chatClosedHint') }}</p>

        <form class="chat-form" @submit.prevent="sendMessage">
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
  max-height: min(90vh, 920px);
  display: grid;
  gap: 12px;
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
  display: grid;
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
  gap: 8px;
  min-height: 320px;
  max-height: 52vh;
  padding: 4px 2px;
  overflow: auto;
  border: 1px solid #edf0f2;
  border-radius: 14px;
  background: #f9fbfa;
}

.chat-empty {
  margin: 0;
  padding: 20px;
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

.message-bubble {
  width: min(78%, 560px);
  padding: 9px 12px;
  border-radius: 14px;
  background: white;
  box-shadow: 0 6px 20px rgb(31 45 36 / 6%);
}

.message-row.self .message-bubble {
  background: #eaf7ee;
}

.message-header,
.message-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.message-header small,
.message-footer small {
  color: #7b838b;
  font-size: 11px;
  line-height: 1.2;
}

.message-content {
  margin: 4px 0 0;
  color: #1f2d24;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.message-footer {
  margin-top: 4px;
}

.chat-form {
  display: grid;
  gap: 10px;
}

.chat-form textarea {
  min-height: 90px;
}

.chat-form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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
    width: min(92%, 560px);
  }

  .chat-form-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
