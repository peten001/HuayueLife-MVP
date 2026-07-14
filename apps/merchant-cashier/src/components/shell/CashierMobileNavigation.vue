<script setup lang="ts">
import { ClipboardPlus, History, LayoutGrid, ListTodo } from '@lucide/vue';
import { useI18n } from '@/i18n';

const { t } = useI18n();
const routes = [
  { to: '/tables', labelKey: 'nav.tables', icon: LayoutGrid },
  { to: '/orders/new', labelKey: 'nav.newOrders', icon: ClipboardPlus },
  { to: '/orders/active', labelKey: 'nav.activeOrders', icon: ListTodo },
  { to: '/orders/history', labelKey: 'nav.history', icon: History },
] as const;
</script>

<template>
  <nav class="cashier-mobile-navigation" :aria-label="t('nav.primary')">
    <RouterLink v-for="item in routes" :key="item.to" :to="item.to">
      <component :is="item.icon" :size="21" aria-hidden="true" />
      <span>{{ t(item.labelKey) }}</span>
    </RouterLink>
  </nav>
</template>
