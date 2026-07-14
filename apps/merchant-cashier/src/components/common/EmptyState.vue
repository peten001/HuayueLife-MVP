<script setup lang="ts">
import { Inbox } from '@lucide/vue';

defineProps<{
  title: string;
  description: string;
}>();
</script>

<template>
  <div class="state-panel state-panel--empty">
    <span class="state-panel__icon" aria-hidden="true">
      <Inbox :size="30" />
    </span>
    <strong>{{ title }}</strong>
    <p>{{ description }}</p>
  </div>
</template>
