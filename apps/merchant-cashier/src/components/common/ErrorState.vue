<script setup lang="ts">
import { AlertTriangle, RefreshCw } from '@lucide/vue';

defineProps<{
  title: string;
  description: string;
  retryLabel: string;
  loading?: boolean;
}>();

defineEmits<{
  retry: [];
}>();
</script>

<template>
  <section class="state-panel state-panel--error" role="alert">
    <span class="state-panel__icon" aria-hidden="true"><AlertTriangle :size="28" /></span>
    <strong>{{ title }}</strong>
    <p>{{ description }}</p>
    <button type="button" class="workspace-action-button" :disabled="loading" @click="$emit('retry')">
      <RefreshCw :size="18" :class="{ spinning: loading }" aria-hidden="true" />
      {{ retryLabel }}
    </button>
  </section>
</template>
