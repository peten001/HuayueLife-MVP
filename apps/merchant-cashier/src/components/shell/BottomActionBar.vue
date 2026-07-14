<script setup lang="ts">
import {
  ClipboardPlus,
  History,
  LayoutGrid,
  ListTodo,
  Printer,
  Receipt,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from '@lucide/vue';
import { useI18n } from '@/i18n';

defineProps<{
  online: boolean;
  apiReachable: boolean;
  soundEnabled: boolean;
  soundSupported: boolean;
  selectedTableId?: string;
}>();

defineEmits<{
  toggleSound: [];
  openTableBill: [];
}>();

const { t } = useI18n();
const mobileRoutes = [
  { to: '/tables', labelKey: 'nav.tables', icon: LayoutGrid },
  { to: '/orders/new', labelKey: 'nav.newOrders', icon: ClipboardPlus },
  { to: '/orders/active', labelKey: 'nav.activeOrders', icon: ListTodo },
  { to: '/orders/history', labelKey: 'nav.history', icon: History },
] as const;
</script>

<template>
  <footer class="cashier-bottom-bar">
    <nav class="cashier-quick-actions" :aria-label="t('nav.shortcuts')">
      <RouterLink to="/orders/new" class="quick-action quick-action--green">
        <span><ClipboardPlus :size="23" aria-hidden="true" /></span>
        <b>{{ t('quickbar.newOrders') }}</b>
        <small>{{ t('quickbar.newOrdersSubtitle') }}</small>
      </RouterLink>
      <RouterLink to="/orders/active" class="quick-action quick-action--blue">
        <span><ListTodo :size="23" aria-hidden="true" /></span>
        <b>{{ t('quickbar.activeOrders') }}</b>
        <small>{{ t('quickbar.activeOrdersSubtitle') }}</small>
      </RouterLink>
      <button
        type="button"
        class="quick-action quick-action--cyan"
        :disabled="!selectedTableId"
        @click="$emit('openTableBill')"
      >
        <span><Receipt :size="23" aria-hidden="true" /></span>
        <b>{{ t('quickbar.tableBill') }}</b>
        <small>{{ t('quickbar.tableBillSubtitle') }}</small>
      </button>
      <button type="button" class="quick-action quick-action--pending" disabled>
        <span><Printer :size="23" aria-hidden="true" /></span>
        <b>{{ t('quickbar.printStatus') }}</b>
        <small>{{ t('quickbar.printSubtitle') }}</small>
      </button>
    </nav>

    <nav class="cashier-mobile-nav" :aria-label="t('nav.primary')">
      <RouterLink v-for="item in mobileRoutes" :key="item.to" :to="item.to">
        <component :is="item.icon" :size="21" aria-hidden="true" />
        <span>{{ t(item.labelKey) }}</span>
      </RouterLink>
    </nav>

    <section class="cashier-status-strip" aria-live="polite">
      <span :class="['status-strip-item', { 'status-strip-item--ok': online && apiReachable }]">
        <Wifi v-if="online && apiReachable" :size="15" aria-hidden="true" />
        <WifiOff v-else :size="15" aria-hidden="true" />
        {{ online && apiReachable ? t('network.connected') : online ? t('network.apiUnavailable') : t('network.offline') }}
      </span>
      <button
        type="button"
        class="status-strip-item"
        :class="{ 'status-strip-item--ok': soundEnabled }"
        :disabled="!soundSupported"
        @click="$emit('toggleSound')"
      >
        <Volume2 v-if="soundEnabled" :size="15" aria-hidden="true" />
        <VolumeX v-else :size="15" aria-hidden="true" />
        {{ soundEnabled ? t('sound.enabled') : t('sound.enable') }}
      </button>
      <span class="status-strip-item status-strip-item--pending">
        <Printer :size="15" aria-hidden="true" />
        {{ t('print.pending') }}
      </span>
    </section>
  </footer>
</template>
