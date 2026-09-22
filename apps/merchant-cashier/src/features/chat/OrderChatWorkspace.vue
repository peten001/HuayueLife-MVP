<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { X } from '@lucide/vue';
import type { MerchantOrderChatConversation, MerchantOrder } from '@/types';
import OrderStatusBadge from '@/components/common/OrderStatusBadge.vue';
import { estimatedReadyAt, formatVietnamTime, pickupCode } from '@/domain';
import { useI18n } from '@/i18n';
import { useChatStore } from '@/stores/chat';
import ChatComposer from './ChatComposer.vue';
import ChatLocationPreview from './ChatLocationPreview.vue';
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
const messageListRef = ref<InstanceType<typeof ChatMessageList> | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const draft = ref('');
const mediaError = ref('');
const locationResolving = ref(false);
const pendingLocation = ref<{ latitude: number; longitude: number } | null>(null);
const intersecting = ref(
  typeof window === 'undefined' || !('IntersectionObserver' in window),
);
const composerFocused = ref(false);
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
    if (orderId !== previousOrderId) {
      draft.value = '';
      pendingLocation.value = null;
    }
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
  window.visualViewport?.addEventListener('resize', keepLatestMessageVisible);
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
  window.visualViewport?.removeEventListener('resize', keepLatestMessageVisible);
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
    await messageListRef.value?.scrollToBottom();
    composerRef.value?.focus();
  }
}

function keepLatestMessageVisible() {
  if (!composerFocused.value) return;
  void messageListRef.value?.scrollToBottom();
}

async function handleComposerFocus() {
  composerFocused.value = true;
  await messageListRef.value?.scrollToBottom();
}

function handleComposerBlur() {
  composerFocused.value = false;
}

async function sendImage(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    mediaError.value = t('cashier.chat.imageFailed');
    return;
  }
  mediaError.value = '';
  await chatStore.sendImage(props.order.id, file);
}

async function requestLocation() {
  if (locationResolving.value || state.value.sending) return;
  if (!navigator.geolocation) { mediaError.value = t('cashier.chat.locationFailed'); return; }
  const requestedOrderId = props.order.id;
  locationResolving.value = true;
  mediaError.value = '';
  try {
    let point: GeolocationPosition;
    try {
      point = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 }),
      );
    } catch { mediaError.value = t('cashier.chat.locationFailed'); return; }
    if (props.order.id === requestedOrderId && shouldActivate.value && !readOnly.value) {
      pendingLocation.value = {
        latitude: point.coords.latitude,
        longitude: point.coords.longitude,
      };
      blurComposer();
    }
  } catch { mediaError.value = t('cashier.chat.locationFailed'); }
  finally { locationResolving.value = false; }
}

function cancelLocation() {
  pendingLocation.value = null;
}

async function confirmLocation() {
  const location = pendingLocation.value;
  if (!location || state.value.sending || readOnly.value) return;
  const orderId = props.order.id;
  mediaError.value = '';
  try {
    await chatStore.sendLocation(orderId, location.latitude, location.longitude);
    if (props.order.id === orderId) {
      pendingLocation.value = null;
      await nextTick();
      await messageListRef.value?.scrollToBottom();
    }
  } catch {
    mediaError.value = t('cashier.chat.sendError');
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
      <div v-if="mediaError" class="order-chat-workspace__error" role="alert">{{ mediaError }}</div>

      <ChatMessageList
        ref="messageListRef"
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
        :sending="state.sending || locationResolving"
        @send="sendMessage"
        @image="sendImage"
        @location="requestLocation"
        @focus="handleComposerFocus"
        @blur="handleComposerBlur"
      />
    </template>

    <Teleport to="body">
      <div
        v-if="pendingLocation"
        class="location-confirm-backdrop"
        role="presentation"
        @click.self="cancelLocation"
      >
        <section
          class="location-confirm-sheet"
          role="dialog"
          aria-modal="true"
          :aria-label="t('cashier.chat.confirmLocation')"
        >
          <span class="location-confirm-sheet__handle" aria-hidden="true" />
          <header class="location-confirm-sheet__header">
            <div>
              <h3>{{ t('cashier.chat.confirmLocation') }}</h3>
              <p>{{ t('cashier.chat.selectedLocation') }}</p>
            </div>
            <button type="button" :aria-label="t('common.cancel')" @click="cancelLocation">
              <X :size="22" stroke-width="2" aria-hidden="true" />
            </button>
          </header>

          <ChatLocationPreview
            :latitude="pendingLocation.latitude"
            :longitude="pendingLocation.longitude"
            expanded
            disabled
          />

          <div class="location-confirm-sheet__actions">
            <button type="button" class="location-confirm-sheet__cancel" @click="cancelLocation">
              {{ t('common.cancel') }}
            </button>
            <button
              type="button"
              class="location-confirm-sheet__send"
              :disabled="state.sending"
              @click="confirmLocation"
            >
              {{ state.sending ? t('cashier.chat.sending') : t('cashier.chat.sendLocation') }}
            </button>
          </div>
        </section>
      </div>
    </Teleport>
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
  background: var(--cashier-surface);
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

.location-confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 420;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(20 37 27 / 42%);
  overscroll-behavior: contain;
}

.location-confirm-sheet {
  display: grid;
  width: min(440px, 100%);
  gap: 16px;
  border: 1px solid #d9e4dc;
  border-radius: 22px;
  padding: 20px;
  background: #f8fbf9;
  box-shadow: 0 24px 70px rgb(17 49 30 / 25%);
}

.location-confirm-sheet__handle {
  display: none;
}

.location-confirm-sheet__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.location-confirm-sheet__header h3,
.location-confirm-sheet__header p {
  margin: 0;
}

.location-confirm-sheet__header h3 {
  color: #1f3528;
  font-size: 18px;
}

.location-confirm-sheet__header p {
  margin-top: 5px;
  color: #6a786f;
  font-size: 12px;
  line-height: 1.4;
}

.location-confirm-sheet__header button {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: 13px;
  color: #4d6155;
  background: #eaf1ec;
  cursor: pointer;
}

.location-confirm-sheet__actions {
  display: grid;
  grid-template-columns: 1fr 1.35fr;
  gap: 10px;
}

.location-confirm-sheet__actions button {
  min-height: 48px;
  border: 0;
  border-radius: 14px;
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}

.location-confirm-sheet__cancel {
  color: #415549;
  background: #e8efea;
}

.location-confirm-sheet__send {
  color: #f7fbf8;
  background: #217a48;
}

.location-confirm-sheet__send:disabled {
  cursor: wait;
  opacity: .62;
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

@media (max-width: 899px) {
  .order-chat-workspace--compact {
    gap: 0;
    overflow: hidden;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: #f7faf8;
  }

  .order-chat-workspace__header--compact {
    min-height: 44px;
    flex: 0 0 auto;
    align-items: center;
    padding: 7px 12px;
    border-bottom: 1px solid #e5ebe7;
    background: var(--cashier-surface);
  }

  .order-chat-workspace__context {
    width: 100%;
    flex-wrap: nowrap;
    gap: 7px;
    overflow: hidden;
  }

  .order-chat-workspace__context > span {
    max-width: 24vw;
  }

  .order-chat-workspace__context small {
    margin-left: auto;
  }

  .order-chat-workspace--compact > .order-chat-workspace__notice,
  .order-chat-workspace--compact > .order-chat-workspace__error {
    margin: 6px 10px 0;
  }

  .order-chat-workspace--compact :deep(.chat-message-list-shell) {
    background: #f7faf8;
  }

  .order-chat-workspace--compact :deep(.chat-message-list) {
    border: 0;
    border-radius: 0;
    padding: 9px 12px 12px;
    background: #f7faf8;
  }

  .order-chat-workspace--compact :deep(.chat-composer) {
    gap: 0;
    flex: 0 0 auto;
    padding: 6px 8px max(6px, env(safe-area-inset-bottom, 0px));
    border-top: 1px solid #e4ebe6;
    background: var(--cashier-surface);
    box-shadow: 0 -5px 18px rgb(31 45 36 / 5%);
  }

  .order-chat-workspace--compact :deep(.chat-composer.is-input-focused) {
    padding-bottom: 6px;
  }

  .order-chat-workspace--compact :deep(.chat-composer__input) {
    height: 44px;
    min-height: 44px;
    max-height: 44px;
  }

  .order-chat-workspace--compact :deep(.chat-composer__send) {
    height: 44px;
    min-height: 44px;
  }
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
    gap: 0;
    padding: 0;
  }

  .order-chat-workspace__header--compact {
    align-items: center;
  }

  .order-chat-workspace__context {
    gap: 6px;
  }

  .order-chat-workspace__context small,
  .order-chat-workspace__delivery-context {
    display: none;
  }

  .order-chat-workspace--compact :deep(.chat-composer__input) {
    height: 44px;
    min-height: 44px;
    max-height: 44px;
  }

  .order-chat-workspace--compact :deep(.chat-composer__send) {
    height: 44px;
    min-height: 44px;
  }

  .location-confirm-backdrop {
    align-items: end;
    padding: 0;
  }

  .location-confirm-sheet {
    width: 100%;
    gap: 14px;
    border-width: 1px 0 0;
    border-radius: 22px 22px 0 0;
    padding: 8px 14px max(14px, env(safe-area-inset-bottom, 0px));
  }

  .location-confirm-sheet__handle {
    display: block;
    width: 42px;
    height: 4px;
    justify-self: center;
    border-radius: 999px;
    background: #cbd7cf;
  }

  .location-confirm-sheet__header h3 {
    font-size: 17px;
  }
}
</style>
