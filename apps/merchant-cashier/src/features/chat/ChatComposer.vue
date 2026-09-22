<script setup lang="ts">
import { Image as ImageIcon, MapPin, Plus } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from '@/i18n';

const props = defineProps<{
  disabled: boolean;
  sending: boolean;
}>();

const emit = defineEmits<{
  send: [content: string];
  image: [file: File];
  location: [];
  focus: [];
  blur: [];
}>();

const draft = defineModel<string>({ default: '' });
const { t } = useI18n();
const inputRef = ref<HTMLTextAreaElement | null>(null);
const imageInputRef = ref<HTMLInputElement | null>(null);
const attachmentsOpen = ref(false);
const inputFocused = ref(false);
const hasDraft = computed(() => Boolean(draft.value.trim()));

function selectImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file && !props.disabled && !props.sending) {
    attachmentsOpen.value = false;
    emit('image', file);
  }
}

function sendLocation() {
  if (props.disabled || props.sending) return;
  attachmentsOpen.value = false;
  emit('location');
}

function toggleAttachments() {
  if (props.disabled || props.sending) return;
  inputRef.value?.blur();
  attachmentsOpen.value = !attachmentsOpen.value;
}

function submit() {
  const content = draft.value.trim();
  if (!content || props.disabled || props.sending) return;
  attachmentsOpen.value = false;
  emit('send', content);
}

function handleEnter(event: KeyboardEvent) {
  if (event.isComposing) return;
  event.preventDefault();
  submit();
}

function handleInputFocus() {
  inputFocused.value = true;
  attachmentsOpen.value = false;
  emit('focus');
}

function handleInputBlur() {
  inputFocused.value = false;
  emit('blur');
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
  <form class="chat-composer" :class="{ 'is-input-focused': inputFocused }" @submit.prevent="submit">
    <div
      class="chat-composer__attachments"
      :class="{ 'is-open': attachmentsOpen }"
    >
      <input ref="imageInputRef" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="selectImage" />
      <button class="chat-composer__attachment" type="button" :disabled="disabled || sending" @click="imageInputRef?.click()">
        <span class="chat-composer__attachment-icon" aria-hidden="true"><ImageIcon :size="21" :stroke-width="1.8" /></span>
        <span>{{ t('cashier.chat.image') }}</span>
      </button>
      <button class="chat-composer__attachment" type="button" :disabled="disabled || sending" @click="sendLocation">
        <span class="chat-composer__attachment-icon" aria-hidden="true"><MapPin :size="21" :stroke-width="1.8" /></span>
        <span>{{ t('cashier.chat.location') }}</span>
      </button>
    </div>

    <div class="chat-composer__row">
      <textarea
        ref="inputRef"
        v-model="draft"
        class="chat-composer__input"
        rows="1"
        enterkeyhint="send"
        inputmode="text"
        :disabled="disabled"
        :placeholder="t('cashier.chat.messagePlaceholder')"
        @focus="handleInputFocus"
        @blur="handleInputBlur"
        @keydown.enter.exact="handleEnter"
      />
      <button
        class="chat-composer__more"
        :class="{ 'is-open': attachmentsOpen }"
        type="button"
        :disabled="disabled || sending"
        :aria-label="t('cashier.chat.more')"
        :aria-expanded="attachmentsOpen"
        @click="toggleAttachments"
      >
        <Plus :size="22" :stroke-width="1.8" aria-hidden="true" />
      </button>
      <button
        class="chat-composer__send"
        :class="{ 'is-empty': !hasDraft }"
        type="submit"
        :disabled="disabled || sending || !hasDraft"
      >
        {{ sending ? t('cashier.chat.sending') : t('cashier.chat.send') }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.chat-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-composer__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px;
}

.chat-composer__attachments {
  display: flex;
  gap: 8px;
}

.chat-composer__attachment {
  display: inline-flex;
  min-width: 72px;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 0;
  border-radius: 10px;
  padding: 0 12px;
  color: var(--cashier-action-primary);
  background: var(--cashier-green-soft);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  outline: 2px solid transparent;
  outline-offset: 2px;
}

.chat-composer__attachment-icon {
  display: inline-flex;
}

.chat-composer__attachment:focus-visible,
.chat-composer__more:focus-visible,
.chat-composer__send:focus-visible {
  outline: 2px solid rgb(40 122 77 / 34%);
  outline-offset: 2px;
}

.chat-composer__attachment:active:not(:disabled),
.chat-composer__more:active:not(:disabled),
.chat-composer__send:active:not(:disabled) {
  transform: scale(.96);
}

.chat-composer__attachment:disabled,
.chat-composer__more:disabled {
  opacity: .5;
  cursor: not-allowed;
}

@media (hover: hover) {
  .chat-composer__attachment:hover:not(:disabled) { background: var(--cashier-workspace-accent-border); }
}

.chat-composer__input {
  width: 100%;
  min-height: 52px;
  max-height: 144px;
  resize: vertical;
  border: 1px solid #d8e2dc;
  border-radius: 12px;
  padding: 10px 12px;
  color: #1f2d24;
  background: var(--cashier-surface);
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
  color: var(--cashier-white);
  background: #287a4d;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: transform 140ms ease, opacity 140ms ease, background-color 140ms ease;
}

.chat-composer__send:disabled {
  cursor: default;
  opacity: 0.48;
}

.chat-composer__more {
  display: none;
}

@media (max-width: 520px) {
  .chat-composer {
    gap: 0;
  }

  .chat-composer__row {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
  }

  .chat-composer__attachments {
    display: none;
    gap: 20px;
    padding: 4px 4px 12px;
  }

  .chat-composer__attachments.is-open {
    display: flex;
  }

  .chat-composer__attachment {
    min-width: 58px;
    min-height: 68px;
    flex-direction: column;
    gap: 5px;
    padding: 0;
    color: #526058;
    background: transparent;
    font-size: 11px;
  }

  .chat-composer__attachment-icon {
    display: grid;
    width: 46px;
    height: 46px;
    place-items: center;
    border: 1px solid #e1e7e3;
    border-radius: 13px;
    color: #294033;
    background: var(--cashier-surface);
  }

  .chat-composer__input {
    height: 48px;
    min-height: 48px;
    max-height: 48px;
    resize: none;
    border-radius: 12px;
    padding: 12px;
    font-size: 16px;
    line-height: 22px;
    overflow-y: auto;
  }

  .chat-composer__send {
    display: none;
  }

  .chat-composer__more {
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 1px solid #d7e1da;
    border-radius: 50%;
    padding: 0;
    color: #34463b;
    background: var(--cashier-surface);
    cursor: pointer;
    transition: transform 160ms ease, background-color 160ms ease;
  }

  .chat-composer__more.is-open {
    background: #e7ede9;
    transform: rotate(45deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-composer__attachment,
  .chat-composer__more,
  .chat-composer__send {
    transition-duration: .01ms;
  }
}
</style>
