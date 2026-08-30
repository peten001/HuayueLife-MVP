<script setup lang="ts">
import { Bike, History, LayoutGrid, ShoppingBag } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import { mobileV2PreviewRouteNames } from './navigation';

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
const destinations = computed(() => [
  ...(props.showTables ? [{ name: mobileV2PreviewRouteNames.tables, label: t('nav.tables'), icon: LayoutGrid }] : []),
  ...(props.showPickup ? [{ name: mobileV2PreviewRouteNames.pickup, label: t('nav.pickup'), icon: ShoppingBag }] : []),
  ...(props.showDelivery ? [{ name: mobileV2PreviewRouteNames.delivery, label: t('nav.delivery'), icon: Bike }] : []),
  { name: mobileV2PreviewRouteNames.history, label: t('nav.history'), icon: History },
]);
</script>

<template>
  <nav
    class="mobile-v2-navigation"
    :aria-label="t('nav.primary')"
    :style="{ '--mobile-v2-destination-count': destinations.length }"
  >
    <RouterLink
      v-for="destination in destinations"
      :key="destination.name"
      :to="{ name: destination.name }"
      custom
      v-slot="{ href, isActive, navigate }"
    >
      <a
        :href="href"
        :class="{ 'router-link-active': isActive }"
        :aria-current="isActive ? 'page' : undefined"
        @click="navigate"
      >
        <component :is="destination.icon" :size="21" :stroke-width="1.9" aria-hidden="true" />
        <span>{{ destination.label }}</span>
      </a>
    </RouterLink>
  </nav>
</template>
