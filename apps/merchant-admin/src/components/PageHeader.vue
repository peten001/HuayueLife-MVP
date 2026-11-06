<script setup lang="ts">
import { useRoute } from 'vue-router';
import { platformText } from '@/composables/usePlatformLocale';
defineProps<{ title: string; description?: string }>();
const route = useRoute();
</script>

<template>
  <header class="page-header">
    <div>
      <h1>{{ route.meta.area === 'platform' ? platformText(title) : title }}</h1>
      <p v-if="description">{{ route.meta.area === 'platform' ? platformText(description) : description }}</p>
    </div>
    <slot />
  </header>
</template>
