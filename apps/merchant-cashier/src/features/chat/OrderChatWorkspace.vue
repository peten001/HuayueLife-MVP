<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import type { MerchantOrderChatConversation, MerchantOrder } from '@/types';
import { useI18n } from '@/i18n';
import { useChatStore } from '@/stores/chat';
import ChatComposer from './ChatComposer.vue';
import ChatMessageList from './ChatMessageList.vue';

const props = withDefaults(defineProps<{
  order: MerchantOrder;
  active?: boolean;
}>(), {
  active: true,
});

const emit = defineEmits<{
  conversationUpdated: [conversation: MerchantOrderChatConversation | null];
}>();

const { t } = useI18n();
const chatStore = useChatStore();
const rootRef = ref<HTMLElement | null>(null);
const draft = ref('');
const intersecting = ref(
  typeof window === 'undefined' || !('IntersectionObserver' in window),
);
let observer: IntersectionObserver | undefined;
let activeOrderId = '';

const state = computed(() => chatStore.getState(props.order.id));
const chatAvailable = computed(() => props.order.userId !== null);
const shouldActivate = computed(
  () => props.active && intersecting.value && chatAvailable.value,
);
const readOnly = computed(() => chatStore.isReadOnly(props.order.id));
const customerName = computed(() =>
  state.value.conversation?.customer.nickname?.trim()
  || state.value.conversation?.customer.phone?.trim()
  || props.order.contactName?.trim()
  || props.order.contactPhone?.trim()
  || t('cashier.chat.customer'),
);

watch(
  [() => props.order.id, shouldActivate],
  ([orderId, active], [previousOrderId] = ['', false]) => {
    if (orderId !== previousOrderId) draft.value = '';
    syncActivation(orderId, active);
  },
  { immediate: true },
);

watch(
  [() => props.order.id, () => props.order.status],
  ([orderId, status]) => chatStore.setOrderStatus(orderId, status),
  { immediate: true },
);

watch(
  () => state.value.conversation,
  (conversation) => {
    // A newly selected order owns an empty chat state until it is activated.
    // Do not erase the order-list unread summary before a real conversation
    // snapshot (and, when visible, the mark-read response) has arrived.
    if (conversation) emit('conversationUpdated', conversation);
  },
  { immediate: true },
);

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || !rootRef.value) {
    intersecting.value = true;
    return;
  }
  observer = new IntersectionObserver(([entry]) => {
    intersecting.value = entry?.isIntersecting ?? false;
  }, { threshold: 0.01 });
  observer.observe(rootRef.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  if (activeOrderId) chatStore.deactivate(activeOrderId);
  activeOrderId = '';
});

function syncActivation(orderId: string, active: boolean) {
  if (activeOrderId && (activeOrderId !== orderId || !active)) {
    chatStore.deactivate(activeOrderId);
    activeOrderId = '';
  }
  if (active && !activeOrderId) {
    activeOrderId = orderId;
    void chatStore.activate(orderId, props.order.status);
  }
}

async function sendMessage(content: string) {
  const orderId = props.order.id;
  const message = await chatStore.send(orderId, content);
  if (
    message
    && props.order.id === orderId
    && draft.value.trim() === content.trim()
  ) {
    draft.value = '';
  }
}

function retry() {
  void chatStore.refresh(props.order.id, { initial: !state.value.initialized });
}
</script>

<template>
  <section ref="rootRef" class="order-chat-workspace" data-testid="order-chat-workspace">
    <header class="order-chat-workspace__header">
      <div>
        <h3>{{ t('cashier.chat.title') }} · #{{ order.orderNo }}</h3>
        <p>{{ t('cashier.chat.customer') }} · {{ customerName }}</p>
      </div>
    </header>

    <div v-if="!chatAvailable" class="order-chat-workspace__notice">
      {{ t('cashier.chat.unavailable') }}
    </div>

    <template v-else>
      <div v-if="state.errorKey" class="order-chat-workspace__error" role="alert">
        <span>{{ t(state.errorKey) }}</span>
        <button type="button" @click="retry">{{ t('cashier.chat.retry') }}</button>
      </div>

      <ChatMessageList
        :messages="state.messages"
        :loading="state.loading"
        :refreshing="state.refreshing"
        :has-more="state.hasMore"
        @load-more="chatStore.loadNextPage(order.id)"
      />

      <p v-if="readOnly" class="order-chat-workspace__notice">
        {{ t('cashier.chat.closed') }}
      </p>

      <ChatComposer
        v-model="draft"
        :disabled="readOnly || !shouldActivate"
        :sending="state.sending"
        @send="sendMessage"
      />
    </template>
  </section>
</template>

<style scoped>
.order-chat-workspace {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid #dde6e0;
  border-radius: 16px;
  background: #fff;
}

.order-chat-workspace__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.order-chat-workspace__header h3 {
  margin: 0;
  color: #1d3025;
  font-size: 18px;
}

.order-chat-workspace__header p {
  margin: 5px 0 0;
  color: #6e7a73;
  font-size: 12px;
}

.order-chat-workspace__notice,
.order-chat-workspace__error {
  margin: 0;
  border-radius: 10px;
  padding: 9px 11px;
  color: #66726b;
  background: #f1f4f2;
  font-size: 12px;
}

.order-chat-workspace__error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #9a3e35;
  background: #fff0ed;
}

.order-chat-workspace__error button {
  flex: 0 0 auto;
  border: 0;
  padding: 4px 7px;
  color: inherit;
  background: transparent;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

@media (max-width: 520px) {
  .order-chat-workspace {
    height: 100%;
    min-height: 0;
    gap: 8px;
    padding: 8px 12px;
    border-right: 0;
    border-left: 0;
    border-radius: 0;
  }

  .order-chat-workspace__header h3 {
    font-size: 16px;
  }
}
</style>
