import { ref } from 'vue';
import { defineStore } from 'pinia';
import {
  getMerchantOrderChat,
  listMerchantOrderChatMessages,
  markMerchantOrderChatRead,
  sendMerchantOrderChatMessage,
  type MerchantOrderChat,
  type OrderChatMessage,
} from '@/api/order-chat';
import type { OrderStatus } from '@/types';

const CHAT_POLL_INTERVAL_MS = 5_000;
const CHAT_PAGE_SIZE = 50;

export type ChatErrorKey =
  | ''
  | 'cashier.chat.loadError'
  | 'cashier.chat.sendError';

export interface OrderChatState {
  orderId: string;
  orderStatus: OrderStatus;
  conversation: MerchantOrderChat | null;
  messages: OrderChatMessage[];
  initialized: boolean;
  loading: boolean;
  refreshing: boolean;
  sending: boolean;
  markingRead: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  errorKey: ChatErrorKey;
  requestSeq: number;
}

export const useChatStore = defineStore('cashier-chat', () => {
  const states = ref<Record<string, OrderChatState>>({});
  const activeCounts = new Map<string, number>();
  const refreshControllers = new Map<string, AbortController>();
  let pollTimer: number | undefined;
  let pollRunning = false;
  let runtimeListenersAttached = false;

  function ensureState(orderId: string, orderStatus: OrderStatus = 'PENDING_ACCEPTANCE') {
    const existing = states.value[orderId];
    if (existing) return existing;
    const created: OrderChatState = {
      orderId,
      orderStatus,
      conversation: null,
      messages: [],
      initialized: false,
      loading: false,
      refreshing: false,
      sending: false,
      markingRead: false,
      hasMore: false,
      nextCursor: null,
      errorKey: '',
      requestSeq: 0,
    };
    states.value[orderId] = created;
    return created;
  }

  function getState(orderId: string) {
    return ensureState(orderId);
  }

  function setOrderStatus(orderId: string, status: OrderStatus) {
    ensureState(orderId, status).orderStatus = status;
  }

  function isReadOnly(orderId: string) {
    const state = ensureState(orderId);
    return state.orderStatus === 'COMPLETED'
      || state.orderStatus === 'CANCELLED'
      || state.conversation?.status === 'CLOSED';
  }

  async function activate(orderId: string, orderStatus: OrderStatus) {
    const state = ensureState(orderId, orderStatus);
    state.orderStatus = orderStatus;
    activeCounts.set(orderId, (activeCounts.get(orderId) ?? 0) + 1);
    attachRuntimeListeners();
    const refreshed = await refresh(orderId, { initial: !state.initialized });
    schedulePoll();
    return refreshed;
  }

  function deactivate(orderId: string) {
    const remaining = Math.max(0, (activeCounts.get(orderId) ?? 0) - 1);
    if (remaining > 0) {
      activeCounts.set(orderId, remaining);
      return;
    }

    activeCounts.delete(orderId);
    const state = states.value[orderId];
    if (state) {
      state.requestSeq += 1;
      state.loading = false;
      state.refreshing = false;
      state.markingRead = false;
    }
    refreshControllers.get(orderId)?.abort('chat-inactive');
    refreshControllers.delete(orderId);

    if (activeCounts.size === 0) {
      clearPollTimer();
      detachRuntimeListeners();
    } else {
      schedulePoll();
    }
  }

  async function refresh(
    orderId: string,
    options: { initial?: boolean } = {},
  ) {
    const state = ensureState(orderId);
    const initial = options.initial ?? !state.initialized;
    const requestSeq = state.requestSeq + 1;
    state.requestSeq = requestSeq;
    state.errorKey = '';
    if (initial) state.loading = true;
    else state.refreshing = true;

    refreshControllers.get(orderId)?.abort('chat-refresh-replaced');
    const controller = new AbortController();
    refreshControllers.set(orderId, controller);

    try {
      const [conversation, incoming] = await Promise.all([
        getMerchantOrderChat(orderId, { signal: controller.signal }),
        initial
          ? loadAllMessages(orderId, controller.signal)
          : loadMessagesAfter(orderId, lastMessageId(state), controller.signal),
      ]);
      if (!isCurrentRequest(state, orderId, requestSeq)) return false;

      state.conversation = conversation;
      if (!isFinalStatus(state.orderStatus)) {
        state.orderStatus = conversation.order.status;
      }
      state.messages = mergeChatMessages(state.messages, incoming.items);
      state.conversation = reconcileConversationWithMessages(
        state.conversation,
        state.messages,
      );
      state.hasMore = incoming.hasMore;
      state.nextCursor = incoming.nextCursor;
      state.initialized = true;

      const hasUnreadCustomerMessage = state.messages.some(
        (message) => message.senderType === 'CUSTOMER' && !message.readAt,
      );
      if (
        (conversation.merchantUnreadCount > 0 || hasUnreadCustomerMessage)
        && isActuallyVisible(orderId)
      ) {
        await markReadForVisibleOrder(orderId, state, requestSeq, controller.signal);
      }
      return true;
    } catch {
      if (!isCurrentRequest(state, orderId, requestSeq)) return false;
      state.errorKey = 'cashier.chat.loadError';
      return false;
    } finally {
      if (isCurrentRequest(state, orderId, requestSeq)) {
        state.loading = false;
        state.refreshing = false;
        state.markingRead = false;
      }
      if (refreshControllers.get(orderId) === controller) {
        refreshControllers.delete(orderId);
      }
    }
  }

  async function loadNextPage(orderId: string) {
    const state = ensureState(orderId);
    const cursor = state.nextCursor;
    if (!state.hasMore || !cursor || state.loading || state.refreshing) return false;
    const requestSeq = state.requestSeq + 1;
    state.requestSeq = requestSeq;
    state.refreshing = true;
    state.errorKey = '';

    refreshControllers.get(orderId)?.abort('chat-page-replaced');
    const controller = new AbortController();
    refreshControllers.set(orderId, controller);
    try {
      const page = await listMerchantOrderChatMessages(orderId, {
        cursor,
        limit: CHAT_PAGE_SIZE,
        signal: controller.signal,
      });
      if (!isCurrentRequest(state, orderId, requestSeq)) return false;
      state.messages = mergeChatMessages(state.messages, page.items);
      state.hasMore = page.pageInfo.hasMore;
      state.nextCursor = page.pageInfo.nextCursor;
      return true;
    } catch {
      if (!isCurrentRequest(state, orderId, requestSeq)) return false;
      state.errorKey = 'cashier.chat.loadError';
      return false;
    } finally {
      if (isCurrentRequest(state, orderId, requestSeq)) state.refreshing = false;
      if (refreshControllers.get(orderId) === controller) {
        refreshControllers.delete(orderId);
      }
    }
  }

  async function send(orderId: string, content: string) {
    const state = ensureState(orderId);
    const normalized = content.trim();
    if (!normalized || state.sending || isReadOnly(orderId)) return null;
    state.sending = true;
    state.errorKey = '';
    try {
      const message = await sendMerchantOrderChatMessage(orderId, normalized);
      state.messages = mergeChatMessages(state.messages, [message]);
      if (state.conversation) {
        state.conversation = {
          ...state.conversation,
          lastMessage: message,
          lastMessageId: message.id,
          lastMessageAt: message.createdAt,
        };
      }
      return message;
    } catch {
      state.errorKey = 'cashier.chat.sendError';
      return null;
    } finally {
      state.sending = false;
    }
  }

  function clearError(orderId: string) {
    ensureState(orderId).errorKey = '';
  }

  function clear() {
    for (const controller of refreshControllers.values()) controller.abort('chat-store-cleared');
    refreshControllers.clear();
    activeCounts.clear();
    clearPollTimer();
    detachRuntimeListeners();
    pollRunning = false;
    states.value = {};
  }

  async function markReadForVisibleOrder(
    orderId: string,
    state: OrderChatState,
    requestSeq: number,
    signal: AbortSignal,
  ) {
    if (!isActuallyVisible(orderId)) return;
    state.markingRead = true;
    const conversation = await markMerchantOrderChatRead(orderId, { signal });
    if (!isCurrentRequest(state, orderId, requestSeq) || !isActuallyVisible(orderId)) return;
    state.conversation = conversation;
    const readAt = conversation.merchantLastReadAt ?? new Date().toISOString();
    state.messages = state.messages.map((message) =>
      message.senderType === 'CUSTOMER' && !message.readAt
        ? { ...message, readAt }
        : message,
    );
  }

  function isActuallyVisible(orderId: string) {
    return activeCounts.has(orderId)
      && (typeof document === 'undefined' || !document.hidden);
  }

  function attachRuntimeListeners() {
    if (runtimeListenersAttached || typeof window === 'undefined') return;
    runtimeListenersAttached = true;
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

  function detachRuntimeListeners() {
    if (!runtimeListenersAttached || typeof window === 'undefined') return;
    runtimeListenersAttached = false;
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  }

  function handleVisibilityChange() {
    if (document.hidden) clearPollTimer();
    else schedulePoll(0);
  }

  function handleOnline() {
    schedulePoll(0);
  }

  function handleOffline() {
    clearPollTimer();
  }

  function canPoll() {
    if (activeCounts.size === 0) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
    return true;
  }

  function clearPollTimer() {
    if (pollTimer !== undefined && typeof window !== 'undefined') {
      window.clearTimeout(pollTimer);
    }
    pollTimer = undefined;
  }

  function schedulePoll(delay = CHAT_POLL_INTERVAL_MS) {
    clearPollTimer();
    if (!canPoll() || typeof window === 'undefined') return;
    pollTimer = window.setTimeout(() => {
      void runPoll();
    }, delay);
  }

  async function runPoll() {
    if (pollRunning || !canPoll()) {
      schedulePoll();
      return;
    }
    pollRunning = true;
    try {
      await Promise.all(
        [...activeCounts.keys()].map((orderId) => refresh(orderId, { initial: false })),
      );
    } finally {
      pollRunning = false;
      schedulePoll();
    }
  }

  return {
    states,
    ensureState,
    getState,
    setOrderStatus,
    isReadOnly,
    activate,
    deactivate,
    refresh,
    loadNextPage,
    send,
    clearError,
    clear,
  };
});

function isCurrentRequest(
  state: OrderChatState,
  orderId: string,
  requestSeq: number,
) {
  return state.orderId === orderId && state.requestSeq === requestSeq;
}

function lastMessageId(state: OrderChatState) {
  return state.messages[state.messages.length - 1]?.id
    ?? state.conversation?.lastMessageId
    ?? undefined;
}

async function loadAllMessages(orderId: string, signal: AbortSignal) {
  return loadMessagePages(orderId, undefined, signal);
}

async function loadMessagesAfter(
  orderId: string,
  cursor: string | undefined,
  signal: AbortSignal,
) {
  return loadMessagePages(orderId, cursor, signal);
}

async function loadMessagePages(
  orderId: string,
  initialCursor: string | undefined,
  signal: AbortSignal,
) {
  const items: OrderChatMessage[] = [];
  let cursor = initialCursor;
  let hasMore = false;
  let nextCursor: string | null = null;
  do {
    const page = await listMerchantOrderChatMessages(orderId, {
      cursor,
      limit: CHAT_PAGE_SIZE,
      signal,
    });
    items.push(...page.items);
    hasMore = page.pageInfo.hasMore;
    nextCursor = page.pageInfo.nextCursor;
    if (hasMore && (!nextCursor || nextCursor === cursor)) break;
    cursor = nextCursor ?? undefined;
  } while (hasMore);
  return { items, hasMore, nextCursor };
}

export function mergeChatMessages(
  current: OrderChatMessage[],
  incoming: OrderChatMessage[],
) {
  const byId = new Map<string, OrderChatMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(compareChatMessages);
}

function compareChatMessages(left: OrderChatMessage, right: OrderChatMessage) {
  const leftId = numericId(left.id);
  const rightId = numericId(right.id);
  if (leftId !== null && rightId !== null && leftId !== rightId) {
    return leftId < rightId ? -1 : 1;
  }
  const createdAtDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  if (Number.isFinite(createdAtDifference) && createdAtDifference !== 0) {
    return createdAtDifference;
  }
  return left.id.localeCompare(right.id);
}

function numericId(value: string) {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function isFinalStatus(status: OrderStatus) {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

function reconcileConversationWithMessages(
  conversation: MerchantOrderChat,
  messages: OrderChatMessage[],
) {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return conversation;
  if (
    conversation.lastMessageId
    && compareMessageIds(conversation.lastMessageId, lastMessage.id) > 0
  ) {
    return conversation;
  }
  return {
    ...conversation,
    lastMessage,
    lastMessageId: lastMessage.id,
    lastMessageAt: lastMessage.createdAt,
  };
}

function compareMessageIds(left: string, right: string) {
  const leftId = numericId(left);
  const rightId = numericId(right);
  if (leftId !== null && rightId !== null) {
    if (leftId === rightId) return 0;
    return leftId < rightId ? -1 : 1;
  }
  return left.localeCompare(right);
}
