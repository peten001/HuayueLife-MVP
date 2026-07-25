<script setup lang="ts">
import { Bike, History, LayoutGrid, ShoppingBag } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from '@/i18n';

const props = withDefaults(defineProps<{
  showTables?: boolean;
  showPickup?: boolean;
  showDelivery?: boolean;
}>(), {
  showTables: true,
  showPickup: true,
  showDelivery: true,
});

const { t } = useI18n();
const allRoutes = [
  { to: '/tables', labelKey: 'nav.tables', icon: LayoutGrid },
  { to: '/pickup', labelKey: 'nav.pickup', icon: ShoppingBag },
  { to: '/delivery', labelKey: 'nav.delivery', icon: Bike },
  { to: '/orders/history', labelKey: 'nav.history', icon: History },
] as const;
const routes = computed(() => allRoutes.filter((item) => {
  if (item.to === '/tables') return props.showTables;
  if (item.to === '/pickup') return props.showPickup;
  if (item.to === '/delivery') return props.showDelivery;
  return true;
}));
</script>

<template>
  <nav class="cashier-mobile-navigation" :aria-label="t('nav.primary')">
    <RouterLink v-for="item in routes" :key="item.to" :to="item.to">
      <component :is="item.icon" :size="21" aria-hidden="true" />
      <span>{{ t(item.labelKey) }}</span>
    </RouterLink>
  </nav>
</template>
