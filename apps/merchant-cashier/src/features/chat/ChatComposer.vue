<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from '@/i18n';

const props = defineProps<{
  disabled: boolean;
  sending: boolean;
}>();

const emit = defineEmits<{
  send: [content: string];
}>();

const draft = defineModel<string>({ default: '' });
const { t } = useI18n();
const inputRef = ref<HTMLTextAreaElement | null>(null);

function submit() {
  const content = draft.value.trim();
  if (!content || props.disabled || props.sending) return;
  emit('send', content);
}

function focus() {
  inputRef.value?.focus({ preventScroll: true });
}

function blur() {
  inputRef.value?.blur();
}

defineExpose({ focus, blur });
</script>

<template>
  <form class="chat-composer" @submit.prevent="submit">
    <textarea
      ref="inputRef"
      v-model="draft"
      class="chat-composer__input"
      rows="3"
      :disabled="disabled || sending"
      :placeholder="t('cashier.chat.messagePlaceholder')"
      @keydown.enter.exact.prevent="submit"
    />
    <button
      class="chat-composer__send"
      type="submit"
      :disabled="disabled || sending || !draft.trim()"
    >
      {{ sending ? t('cashier.chat.sending') : t('cashier.chat.send') }}
    </button>
  </form>
</template>

<style scoped>
.chat-composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px;
}

.chat-composer__input {
  width: 100%;
  min-height: 68px;
  max-height: 144px;
  resize: vertical;
  border: 1px solid #d8e2dc;
  border-radius: 12px;
  padding: 10px 12px;
  color: #1f2d24;
  background: #fff;
  font: inherit;
  line-height: 1.45;
  box-sizing: border-box;
}

.chat-composer__input:focus {
  border-color: #4b8f68;
  outline: 2px solid rgb(75 143 104 / 16%);
}

.chat-composer__input:disabled {
  color: #8b9790;
  background: #f3f5f4;
}

.chat-composer__send {
  min-width: 86px;
  min-height: 44px;
  border: 0;
  border-radius: 11px;
  padding: 0 16px;
  color: #fff;
  background: #287a4d;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.chat-composer__send:disabled {
  cursor: default;
  opacity: 0.48;
}

@media (max-width: 520px) {
  .chat-composer {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }

  .chat-composer__input {
    height: 62px;
    min-height: 62px;
    max-height: 62px;
    resize: none;
  }

  .chat-composer__send {
    width: 100%;
  }
}
</style>
