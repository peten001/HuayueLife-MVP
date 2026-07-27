<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import type { MerchantOrderChatConversation, MerchantOrder } from '@/types';
import OrderStatusBadge from '@/components/common/OrderStatusBadge.vue';
import { estimatedReadyAt, formatVietnamTime, pickupCode } from '@/domain';
import { useI18n } from '@/i18n';
import { useChatStore } from '@/stores/chat';
import ChatComposer from './ChatComposer.vue';
import ChatMessageList from './ChatMessageList.vue';

const props = withDefaults(defineProps<{
  order: MerchantOrder;
  active?: boolean;
  compactContext?: boolean;
}>(), {
  active: true,
  compactContext: false,
});

const emit = defineEmits<{
  conversationUpdated: [conversation: MerchantOrderChatConversation | null];
}>();

const { t, locale } = useI18n();
const chatStore = useChatStore();
const composerRef = ref<InstanceType<typeof ChatComposer> | null>(null);
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
const compactPickupCode = computed(() => pickupCode(props.order) || props.order.orderNo);
const compactEstimate = computed(() => estimatedReadyAt(props.order));
const compactDeliveryAddress = computed(() => props.order.deliveryAddress?.trim() || '');

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
  try {
    const message = await chatStore.send(orderId, content);
    if (
      message
      && props.order.id === orderId
      && draft.value.trim() === content.trim()
    ) {
      draft.value = '';
    }
  } finally {
    await nextTick();
    composerRef.value?.focus();
  }
}

function blurComposer() {
  composerRef.value?.blur();
}

function retry() {
  void chatStore.refresh(props.order.id, { initial: !state.value.initialized });
}
</script>

<template>
  <section ref="rootRef" class="order-chat-workspace" :class="{ 'order-chat-workspace--compact': compactContext }" data-testid="order-chat-workspace">
    <header class="order-chat-workspace__header" :class="{ 'order-chat-workspace__header--compact': compactContext }">
      <div v-if="compactContext" class="order-chat-workspace__context">
        <strong>{{ compactPickupCode }}</strong>
        <span>{{ customerName }}</span>
        <OrderStatusBadge :status="order.status" />
        <small v-if="compactEstimate">{{ formatVietnamTime(compactEstimate, locale) }}</small>
        <small v-if="compactDeliveryAddress" class="order-chat-workspace__delivery-context">{{ compactDeliveryAddress }}</small>
      </div>
      <div v-else>
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
        @surface-interaction="blurComposer"
      />

      <p v-if="readOnly" class="order-chat-workspace__notice">
        {{ t('cashier.chat.closed') }}
      </p>

      <ChatComposer
        ref="composerRef"
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

.order-chat-workspace--compact {
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
}

.order-chat-workspace__header--compact {
  align-items: center;
  gap: 8px;
  min-height: 40px;
}

.order-chat-workspace__context {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px 7px;
}

.order-chat-workspace__context strong {
  color: #1d3025;
  font-size: 15px;
}

.order-chat-workspace__context > span,
.order-chat-workspace__context small {
  min-width: 0;
  overflow: hidden;
  color: #748078;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-chat-workspace--compact :deep(.chat-message-list) {
  min-height: 0;
  overflow-x: hidden;
  border-radius: 10px;
  padding: 10px;
}

.order-chat-workspace--compact :deep(.chat-composer) {
  align-items: stretch;
  gap: 8px;
}

.order-chat-workspace--compact :deep(.chat-composer__input) {
  height: 52px;
  min-height: 52px;
  max-height: 120px;
}

.order-chat-workspace--compact :deep(.chat-composer__send) {
  min-height: 52px;
  height: 100%;
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

  .order-chat-workspace--compact {
    gap: 6px;
    padding: 6px 8px;
  }

  .order-chat-workspace__header--compact {
    align-items: flex-start;
  }

  .order-chat-workspace__context {
    gap: 4px 6px;
  }

  .order-chat-workspace--compact :deep(.chat-composer__input) {
    height: 52px;
    min-height: 52px;
    max-height: 52px;
  }

  .order-chat-workspace--compact :deep(.chat-composer__send) {
    height: 52px;
    min-height: 52px;
  }
}
</style>
