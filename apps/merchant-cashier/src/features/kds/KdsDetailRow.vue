<script setup lang="ts">
defineProps<{ title: string; selected?: boolean }>();
</script>

<template>
  <article class="kds-detail-card" :class="{ selected, 'kds-detail-card--readonly': !$slots.controls }">
    <div class="kds-detail-main">
      <header><strong>{{ title }}</strong><slot name="badges" /></header>
      <div class="kds-task-progress"><slot name="progress" /></div>
      <slot name="notes" />
    </div>
    <div v-if="$slots.controls" class="kds-quantity-row"><slot name="controls" /></div>
  </article>
</template>
