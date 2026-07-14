<script setup lang="ts">
import { AlertTriangle } from '@lucide/vue';

defineProps<{
  open: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  loading?: boolean;
}>();

defineEmits<{
  cancel: [];
  confirm: [];
}>();
</script>

<template>
  <div v-if="open" class="dialog-backdrop" role="presentation" @click.self="$emit('cancel')">
    <section class="confirm-dialog" role="alertdialog" aria-modal="true" :aria-label="title">
      <span class="confirm-dialog__icon" aria-hidden="true">
        <AlertTriangle :size="26" />
      </span>
      <div>
        <h3>{{ title }}</h3>
        <p>{{ description }}</p>
      </div>
      <footer>
        <button type="button" class="secondary-action" :disabled="loading" @click="$emit('cancel')">
          {{ cancelLabel }}
        </button>
        <button type="button" class="primary-action" :disabled="loading" @click="$emit('confirm')">
          {{ confirmLabel }}
        </button>
      </footer>
    </section>
  </div>
</template>
