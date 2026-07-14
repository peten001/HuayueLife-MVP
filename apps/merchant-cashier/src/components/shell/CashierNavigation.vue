<script setup lang="ts">
import { ClipboardClock, History, LayoutGrid, ListChecks } from '@lucide/vue';
import { useI18n } from '@/i18n';

const props = defineProps<{
  newOrderCount?: number;
  activeOrderCount?: number;
  occupiedTableCount?: number;
}>();

const { t } = useI18n();

const items = [
  { to: '/tables', labelKey: 'nav.tables', icon: LayoutGrid, countKey: 'none' },
  { to: '/orders/new', labelKey: 'nav.newOrders', icon: ClipboardClock, countKey: 'new' },
  { to: '/orders/active', labelKey: 'nav.activeOrders', icon: ListChecks, countKey: 'active' },
  { to: '/orders/history', labelKey: 'nav.history', icon: History, countKey: 'history' },
] as const;

function badge(item: (typeof items)[number]) {
  if (item.countKey === 'new') return props.newOrderCount || 0;
  if (item.countKey === 'active') return props.activeOrderCount || 0;
  return 0;
}
</script>

<template>
  <nav class="cashier-navigation" :aria-label="t('nav.primary')">
    <RouterLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="cashier-navigation__item"
      :title="t(item.labelKey)"
    >
      <span class="cashier-navigation__icon" aria-hidden="true">
        <component :is="item.icon" :size="22" />
      </span>
      <span>{{ t(item.labelKey) }}</span>
      <strong v-if="badge(item) > 0" class="cashier-navigation__badge">
        {{ badge(item) > 99 ? t('common.countOverflow') : badge(item) }}
      </strong>
    </RouterLink>
  </nav>
</template>
