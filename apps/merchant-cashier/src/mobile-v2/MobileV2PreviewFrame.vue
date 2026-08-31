<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useMediaQuery } from '@/composables';
import type { CashierPrintingAvailability } from '@/types';
import OrientationNotice from '@/components/shell/OrientationNotice.vue';
import MobileV2Drawer from './MobileV2Drawer.vue';
import MobileV2Header from './MobileV2Header.vue';
import type { CashierPresentationWorkspace } from './navigation';
import './mobile-v2.css';

type MobileOperationalFilter = {
  value: string;
  label: string;
};

const props = withDefaults(defineProps<{
  workspace: CashierPresentationWorkspace;
  role?: string;
  loggingOut?: boolean;
  totalTableCount: number;
  availableTableCount: number;
  inUseTableCount: number;
  newOrderCount: number;
  online: boolean;
  apiReachable: boolean | null;
  reconnecting: boolean;
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
  selectTableFilter: [filter: 'ALL' | 'AVAILABLE' | 'IN_USE' | 'DISABLED'];
  selectOperationalFilter: [filter: string];
  refreshTables: [];
}>();

const route = useRoute();
const drawerOpen = ref(false);
const mobileLayout = useMediaQuery('(max-width: 899px)');
const isolatedMenuMode = computed(() => (
  mobileLayout.value && props.workspace === 'tables' && props.activeMainTab === 'MENU'
));
const isolatedTableDetailMode = computed(() => (
  mobileLayout.value && props.workspace === 'tables' && Boolean(route.params.tableId)
));
const hideWorkspaceHeader = computed(() => isolatedMenuMode.value || isolatedTableDetailMode.value);
const mobileV2RootClass = 'cashier-mobile-v2-preview-active';
const mobileV2MetaOverrides = [
  {
    selector: 'meta[name="viewport"]',
    content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content',
  },
  { selector: 'meta[name="theme-color"]', content: '#fbfcfa' },
  { selector: 'meta[name="apple-mobile-web-app-status-bar-style"]', content: 'default' },
] as const;
const previousMetaContent = new Map<HTMLMetaElement, string | null>();

function applyMobileV2AppShell() {
  document.documentElement.classList.add(mobileV2RootClass);
  document.body.classList.add(mobileV2RootClass);
  for (const override of mobileV2MetaOverrides) {
    const meta = document.head.querySelector<HTMLMetaElement>(override.selector);
    if (!meta) continue;
    if (!previousMetaContent.has(meta)) {
      previousMetaContent.set(
        meta,
        meta.hasAttribute('data-mobile-v2-original-content')
          ? meta.getAttribute('data-mobile-v2-original-content')
          : meta.getAttribute('content'),
      );
    }
    meta.setAttribute('content', override.content);
  }
}

function restoreDocumentShell() {
  document.documentElement.classList.remove(mobileV2RootClass);
  document.body.classList.remove(mobileV2RootClass);
  for (const [meta, previousContent] of previousMetaContent) {
    if (previousContent === null) meta.removeAttribute('content');
    else meta.setAttribute('content', previousContent);
    meta.removeAttribute('data-mobile-v2-original-content');
  }
  previousMetaContent.clear();
}

watch(() => route.fullPath, () => {
  drawerOpen.value = false;
});

onMounted(() => {
  applyMobileV2AppShell();
});

onBeforeUnmount(() => {
  restoreDocumentShell();
});
</script>

<template>
  <div
    class="mobile-v2-preview-frame"
    :class="{
      'is-menu-mode': isolatedMenuMode,
      'is-table-detail-mode': isolatedTableDetailMode,
    }"
    data-testid="mobile-v2-preview-frame"
  >
    <MobileV2Header
      v-if="!hideWorkspaceHeader"
      :workspace="workspace"
      :total-table-count="totalTableCount"
      :available-table-count="availableTableCount"
      :in-use-table-count="inUseTableCount"
      :new-order-count="newOrderCount"
      :online="online"
      :api-reachable="apiReachable"
      :reconnecting="reconnecting"
      :printing-availability="printingAvailability"
      :active-table-filter="activeTableFilter"
      :refreshing-tables="refreshingTables"
      :active-main-tab="activeMainTab"
      :operational-filters="operationalFilters"
      :active-operational-filter="activeOperationalFilter"
      @open-navigation="drawerOpen = true"
      @open-new-orders="$emit('openNewOrders')"
      @select-table-filter="$emit('selectTableFilter', $event)"
      @select-operational-filter="$emit('selectOperationalFilter', $event)"
      @refresh-tables="$emit('refreshTables')"
    />
    <main class="mobile-v2-preview-main">
      <OrientationNotice v-if="workspace !== 'tables'" />
      <slot />
    </main>
    <Transition name="mobile-v2-drawer-transition">
      <MobileV2Drawer
        v-if="drawerOpen"
        :role="role"
        :logging-out="loggingOut"
        :show-tables="showTables"
        :show-pickup="showPickup"
        :show-delivery="showDelivery"
        @close="drawerOpen = false"
        @logout="$emit('logout')"
      />
    </Transition>
  </div>
</template>
