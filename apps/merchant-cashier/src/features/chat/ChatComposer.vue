<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from '@/i18n';

const props = defineProps<{
  disabled: boolean;
  sending: boolean;
}>();

const emit = defineEmits<{
  send: [content: string];
  image: [file: File];
  location: [];
}>();

const draft = defineModel<string>({ default: '' });
const { t } = useI18n();
const inputRef = ref<HTMLTextAreaElement | null>(null);
const imageInputRef = ref<HTMLInputElement | null>(null);

function selectImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file && !props.disabled && !props.sending) emit('image', file);
}

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
    <div class="chat-composer__attachments">
      <input ref="imageInputRef" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="selectImage" />
      <button type="button" :disabled="disabled || sending" @click="imageInputRef?.click()">{{ t('cashier.chat.image') }}</button>
      <button type="button" :disabled="disabled || sending" @click="emit('location')">{{ t('cashier.chat.location') }}</button>
    </div>
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

.chat-composer__attachments { grid-column: 1 / -1; display: flex; gap: 8px; }
.chat-composer__attachments button { min-width: 64px; min-height: 44px; padding: 0 12px; border: 0; border-radius: 10px; color: var(--cashier-action-primary); background: var(--cashier-green-soft); font: inherit; font-size: 13px; cursor: pointer; outline: 2px solid transparent; outline-offset: 2px; }
.chat-composer__attachments button:focus-visible { outline-color: var(--cashier-action-primary); }
.chat-composer__attachments button:active:not(:disabled) { transform: translateY(1px); }
.chat-composer__attachments button:disabled { opacity: .5; cursor: not-allowed; }
@media (hover: hover) { .chat-composer__attachments button:hover:not(:disabled) { background: var(--cashier-workspace-accent-border); } }

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
