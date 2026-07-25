<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { OrderChatMessage } from '@/api/order-chat';
import { useI18n } from '@/i18n';

const props = defineProps<{
  messages: OrderChatMessage[];
  loading: boolean;
  refreshing: boolean;
  hasMore: boolean;
}>();

const emit = defineEmits<{
  loadMore: [];
}>();

const { locale, t } = useI18n();
const listRef = ref<HTMLElement | null>(null);
const nearBottom = ref(true);
const showNewMessages = ref(false);

type TimelineItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'message'; key: string; message: OrderChatMessage };

const timeline = computed<TimelineItem[]>(() => {
  const result: TimelineItem[] = [];
  let previousDay = '';
  for (const message of props.messages) {
    const day = dayKey(message.createdAt);
    if (day !== previousDay) {
      result.push({
        type: 'date',
        key: `date-${day}`,
        label: formatDay(message.createdAt),
      });
      previousDay = day;
    }
    result.push({ type: 'message', key: `message-${message.id}`, message });
  }
  return result;
});

watch(
  () => props.messages[props.messages.length - 1]?.id,
  async (nextId, previousId) => {
    if (!nextId || nextId === previousId) return;
    const newest = props.messages[props.messages.length - 1];
    if (!previousId || nearBottom.value || newest?.senderType === 'MERCHANT') {
      await scrollToBottom();
    } else {
      showNewMessages.value = true;
    }
  },
);

function handleScroll() {
  const element = listRef.value;
  if (!element) return;
  nearBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
  if (nearBottom.value) showNewMessages.value = false;
}

async function scrollToBottom() {
  await nextTick();
  const element = listRef.value;
  if (!element) return;
  element.scrollTop = element.scrollHeight;
  nearBottom.value = true;
  showNewMessages.value = false;
}

function dayKey(value: string) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatDay(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(value) === dayKey(today.toISOString())) return t('cashier.chat.today');
  if (dayKey(value) === dayKey(yesterday.toISOString())) return t('cashier.chat.yesterday');
  return new Intl.DateTimeFormat(intlLocale.value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const intlLocale = computed(() => ({
  zh: 'zh-CN',
  vi: 'vi-VN',
  en: 'en-US',
})[locale.value]);

function formatTime(value: string) {
  return new Intl.DateTimeFormat(intlLocale.value, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

defineExpose({ scrollToBottom });
</script>

<template>
  <div class="chat-message-list-shell">
    <div class="chat-message-list__toolbar">
      <span>{{ t('cashier.chat.history') }}</span>
      <span v-if="loading">{{ t('cashier.chat.loading') }}</span>
      <span v-else-if="refreshing">{{ t('cashier.chat.refreshing') }}</span>
    </div>

    <div
      ref="listRef"
      class="chat-message-list"
      role="log"
      aria-live="polite"
      :aria-label="t('cashier.chat.messageListLabel')"
      @scroll="handleScroll"
    >
      <button
        v-if="hasMore"
        class="chat-message-list__more"
        type="button"
        :disabled="refreshing"
        @click="emit('loadMore')"
      >
        {{ t('cashier.chat.loadMore') }}
      </button>

      <p v-if="!loading && !messages.length" class="chat-message-list__empty">
        {{ t('cashier.chat.empty') }}
      </p>

      <template v-for="item in timeline" :key="item.key">
        <div v-if="item.type === 'date'" class="chat-message-list__date">
          <span>{{ item.label }}</span>
        </div>
        <article
          v-else
          class="chat-message-list__row"
          :class="{ 'chat-message-list__row--merchant': item.message.senderType === 'MERCHANT' }"
        >
          <div class="chat-message-list__stack">
            <time :datetime="item.message.createdAt">{{ formatTime(item.message.createdAt) }}</time>
            <div class="chat-message-list__bubble">
              <p>{{ item.message.content }}</p>
              <span
                v-if="item.message.senderType === 'MERCHANT'"
                class="chat-message-list__receipt"
                :aria-label="item.message.readAt ? t('cashier.chat.read') : t('cashier.chat.delivered')"
              >
                {{ item.message.readAt ? '✓✓' : '✓' }}
              </span>
            </div>
          </div>
        </article>
      </template>
    </div>

    <button
      v-if="showNewMessages"
      type="button"
      class="chat-message-list__new"
      @click="scrollToBottom"
    >
      {{ t('cashier.chat.newMessages') }}
    </button>
  </div>
</template>

<style scoped>
.chat-message-list-shell {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 220px;
  flex-direction: column;
  gap: 8px;
}

.chat-message-list__toolbar {
  display: flex;
  min-height: 20px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #6f7d75;
  font-size: 12px;
}

.chat-message-list {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  padding: 12px;
  border: 1px solid #e1e8e3;
  border-radius: 14px;
  background: #f7faf8;
  overscroll-behavior: contain;
}

.chat-message-list__more,
.chat-message-list__new {
  align-self: center;
  border: 1px solid #d4e1d8;
  border-radius: 999px;
  padding: 6px 12px;
  color: #356047;
  background: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.chat-message-list__empty {
  margin: auto;
  color: #7a8780;
  text-align: center;
}

.chat-message-list__date {
  display: flex;
  justify-content: center;
  margin: 4px 0;
}

.chat-message-list__date span {
  border-radius: 999px;
  padding: 4px 10px;
  color: #7d8982;
  background: #e8eeea;
  font-size: 11px;
  font-weight: 600;
}

.chat-message-list__row {
  display: flex;
  justify-content: flex-start;
}

.chat-message-list__row--merchant {
  justify-content: flex-end;
}

.chat-message-list__stack {
  display: flex;
  max-width: min(76%, 480px);
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}

.chat-message-list__row--merchant .chat-message-list__stack {
  align-items: flex-end;
}

.chat-message-list__stack time {
  color: #929d97;
  font-size: 10px;
}

.chat-message-list__bubble {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  border: 1px solid #e1e7e3;
  border-radius: 13px 13px 13px 4px;
  padding: 8px 11px;
  color: #203128;
  background: #fff;
  box-shadow: 0 3px 10px rgb(33 61 45 / 5%);
}

.chat-message-list__row--merchant .chat-message-list__bubble {
  border-color: #cae5d4;
  border-radius: 13px 13px 4px;
  background: #e6f5eb;
}

.chat-message-list__bubble p {
  min-width: 0;
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.45;
}

.chat-message-list__receipt {
  flex: 0 0 auto;
  color: #2f7d51;
  font-size: 10px;
  font-weight: 800;
}

.chat-message-list__new {
  position: absolute;
  bottom: 12px;
  left: 50%;
  z-index: 1;
  box-shadow: 0 5px 16px rgb(27 65 43 / 16%);
  transform: translateX(-50%);
}

@media (max-width: 520px) {
  .chat-message-list-shell {
    min-height: 0;
  }

  .chat-message-list {
    min-height: 44px;
    padding: 8px;
  }

  .chat-message-list__stack {
    max-width: 86%;
  }
}
</style>
