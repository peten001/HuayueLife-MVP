<script setup lang="ts">
import { CheckCircle2, CircleAlert, Info, X } from '@lucide/vue';
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from '@/i18n';
import { useUiStore, type ToastTone } from '@/stores/ui';

const uiStore = useUiStore();
const { toasts } = storeToRefs(uiStore);
const { t } = useI18n();
const iconFor = computed(() => ({
  info: Info,
  success: CheckCircle2,
  warning: CircleAlert,
  error: CircleAlert,
} satisfies Record<ToastTone, typeof Info>));
</script>

<template>
  <section class="toast-region" aria-live="polite" aria-atomic="false">
    <article v-for="toast in toasts" :key="toast.id" :class="`cashier-toast cashier-toast--${toast.tone}`">
      <component :is="iconFor[toast.tone]" :size="19" aria-hidden="true" />
      <span>{{ toast.message }}</span>
      <button type="button" :aria-label="t('common.dismiss')" @click="uiStore.dismissToast(toast.id)">
        <X :size="17" aria-hidden="true" />
      </button>
    </article>
  </section>
</template>
