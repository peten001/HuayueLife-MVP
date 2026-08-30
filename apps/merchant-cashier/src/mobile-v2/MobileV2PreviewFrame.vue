<script setup lang="ts">
import type { CashierPrintingAvailability } from '@/types';
import OrientationNotice from '@/components/shell/OrientationNotice.vue';
import MobileV2Header from './MobileV2Header.vue';
import MobileV2Navigation from './MobileV2Navigation.vue';
import type { CashierPresentationWorkspace } from './navigation';
import './mobile-v2.css';

type MobileOperationalFilter = {
  value: string;
  label: string;
};

withDefaults(defineProps<{
  workspace: CashierPresentationWorkspace;
  merchantName?: string;
  role?: string;
  loggingOut?: boolean;
  currentTableLabel?: string;
  totalTableCount: number;
  availableTableCount: number;
  inUseTableCount: number;
  newOrderCount: number;
  online: boolean;
  apiReachable: boolean | null;
  reconnecting: boolean;
  soundEnabled: boolean;
  soundSupported: boolean;
  printingAvailability: CashierPrintingAvailability;
  activeTableFilter: 'ALL' | 'AVAILABLE' | 'IN_USE' | 'DISABLED';
  refreshingTables?: boolean;
  activeMainTab?: 'TABLES' | 'MENU';
  operationalFilters?: readonly MobileOperationalFilter[];
  activeOperationalFilter?: string;
  showTables?: boolean;
  showPickup?: boolean;
  showDelivery?: boolean;
}>(), {
  operationalFilters: () => [],
  activeOperationalFilter: 'ALL',
  activeMainTab: 'TABLES',
  showTables: true,
  showPickup: true,
  showDelivery: true,
});

defineEmits<{
  logout: [];
  openNewOrders: [];
  toggleSound: [];
  selectTableFilter: [filter: 'ALL' | 'AVAILABLE' | 'IN_USE' | 'DISABLED'];
  selectMainTab: [tab: 'TABLES' | 'MENU'];
  selectOperationalFilter: [filter: string];
  refreshTables: [];
}>();
</script>

<template>
  <div class="mobile-v2-preview-frame" data-testid="mobile-v2-preview-frame">
    <MobileV2Header
      :workspace="workspace"
      :merchant-name="merchantName"
      :role="role"
      :logging-out="loggingOut"
      :current-table-label="currentTableLabel"
      :total-table-count="totalTableCount"
      :available-table-count="availableTableCount"
      :in-use-table-count="inUseTableCount"
      :new-order-count="newOrderCount"
      :online="online"
      :api-reachable="apiReachable"
      :reconnecting="reconnecting"
      :sound-enabled="soundEnabled"
      :sound-supported="soundSupported"
      :printing-availability="printingAvailability"
      :active-table-filter="activeTableFilter"
      :refreshing-tables="refreshingTables"
      :active-main-tab="activeMainTab"
      :operational-filters="operationalFilters"
      :active-operational-filter="activeOperationalFilter"
      @logout="$emit('logout')"
      @open-new-orders="$emit('openNewOrders')"
      @toggle-sound="$emit('toggleSound')"
      @select-table-filter="$emit('selectTableFilter', $event)"
      @select-main-tab="$emit('selectMainTab', $event)"
      @select-operational-filter="$emit('selectOperationalFilter', $event)"
      @refresh-tables="$emit('refreshTables')"
    />
    <main class="mobile-v2-preview-main">
      <OrientationNotice v-if="workspace !== 'tables'" />
      <slot />
    </main>
    <MobileV2Navigation :show-tables="showTables" :show-pickup="showPickup" :show-delivery="showDelivery" />
  </div>
</template>
