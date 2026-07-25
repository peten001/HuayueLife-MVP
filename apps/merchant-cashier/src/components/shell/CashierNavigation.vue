<script setup lang="ts">
import { Bike, History, LayoutGrid, ShoppingBag } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from '@/i18n';

const props = defineProps<{
  tableAttentionCount?: number;
  pickupAttentionCount?: number;
  deliveryAttentionCount?: number;
  showTables?: boolean;
  showPickup?: boolean;
  showDelivery?: boolean;
}>();

const { t } = useI18n();

const allItems = [
  { to: '/tables', labelKey: 'nav.tables', icon: LayoutGrid, countKey: 'tables' },
  { to: '/pickup', labelKey: 'nav.pickup', icon: ShoppingBag, countKey: 'pickup' },
  { to: '/delivery', labelKey: 'nav.delivery', icon: Bike, countKey: 'delivery' },
  { to: '/orders/history', labelKey: 'nav.history', icon: History, countKey: 'history' },
] as const;

const items = computed(() => allItems.filter((item) => {
  if (item.countKey === 'tables') return props.showTables !== false;
  if (item.countKey === 'pickup') return props.showPickup !== false;
  if (item.countKey === 'delivery') return props.showDelivery !== false;
  return true;
}));

function badge(item: (typeof allItems)[number]) {
  if (item.countKey === 'tables') return props.tableAttentionCount || 0;
  if (item.countKey === 'pickup') return props.pickupAttentionCount || 0;
  if (item.countKey === 'delivery') return props.deliveryAttentionCount || 0;
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
