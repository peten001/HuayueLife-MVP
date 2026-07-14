<script setup lang="ts">
defineProps<{
  label: string;
}>();
</script>

<template>
  <div class="loading-skeleton" role="status" aria-live="polite" :aria-label="label">
    <span v-for="item in 8" :key="item" class="loading-skeleton__card" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
    <span class="sr-only">{{ label }}</span>
  </div>
</template>
