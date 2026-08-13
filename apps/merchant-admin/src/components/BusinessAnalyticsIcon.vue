<script setup lang="ts">
defineProps<{
  name: 'revenue' | 'orders' | 'average' | 'dish' | 'growth' | 'promote' | 'clock' | 'insight';
}>();
</script>

<template>
  <svg class="business-analytics-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name === 'revenue'">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 9.2c.8-.8 2-1.2 3.1-1.2 1.7 0 3 .8 3 2s-1.2 2-3.1 2-3.1.8-3.1 2 1.3 2 3 2c1.2 0 2.4-.4 3.2-1.2M12 6.2v11.6" />
    </template>
    <template v-else-if="name === 'orders'">
      <rect x="5" y="3" width="14" height="18" rx="2.5" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
    </template>
    <template v-else-if="name === 'average'">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 9h8M8 15h8M9 8v2M15 14v2" />
    </template>
    <template v-else-if="name === 'dish'">
      <path d="M4 16h16M6 16a6 6 0 0 1 12 0M12 8V6" />
      <circle cx="12" cy="5" r="1" />
    </template>
    <template v-else-if="name === 'growth'">
      <path d="M4 17 9 12l3 3 7-8" />
      <path d="M14 7h5v5" />
    </template>
    <template v-else-if="name === 'promote'">
      <path d="m4 13 10-5v8L4 13Z" />
      <path d="M14 10.5 19 9v6l-5-1.5M6 14l1 5h3l-1-4" />
    </template>
    <template v-else-if="name === 'clock'">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </template>
    <template v-else>
      <path d="M5 15.5a7 7 0 1 1 14 0" />
      <path d="M8 17h8M10 20h4M12 7v3M7.8 9l2.1 2M16.2 9l-2.1 2" />
    </template>
  </svg>
</template>

<style scoped>
.business-analytics-icon {
  display: block;
  width: 16px;
  height: 16px;
}
</style>
