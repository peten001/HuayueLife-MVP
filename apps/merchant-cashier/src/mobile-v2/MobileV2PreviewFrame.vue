<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
  pushSettingsAvailable?: boolean;
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
  openPushSettings: [];
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
const fulfillmentDetailMode = computed(() => (
  mobileLayout.value
  && (props.workspace === 'pickup' || props.workspace === 'delivery')
  && Boolean(route.params.orderId)
));
const hideWorkspaceHeader = computed(() => isolatedMenuMode.value || isolatedTableDetailMode.value);
const mobileV2RootClass = 'cashier-mobile-v2-preview-active';
const mobileV2LogicalViewportWidth = 390;
const mobileV2LayoutScaleProperty = '--mobile-v2-layout-scale';
const mobileV2LayoutHeightProperty = '--mobile-v2-layout-height';
const mobileV2MetaOverrides = [
  {
    selector: 'meta[name="viewport"]',
    content: `width=${mobileV2LogicalViewportWidth}, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content`,
  },
  { selector: 'meta[name="theme-color"]', content: '#fbfcfa' },
  { selector: 'meta[name="apple-mobile-web-app-status-bar-style"]', content: 'default' },
] as const;
const previousMetaContent = new Map<HTMLMetaElement, string | null>();
let layoutSyncFrame: number | null = null;
let focusCorrectionTimer: number | null = null;

function restoreMobileV2DocumentOrigin() {
  if (window.scrollX !== 0 || window.scrollY !== 0) {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }
  document.documentElement.scrollTop = 0;
  document.documentElement.scrollLeft = 0;
  document.body.scrollTop = 0;
  document.body.scrollLeft = 0;
}

function syncMobileV2LogicalCanvas() {
  const viewportWidth = window.visualViewport?.width || window.innerWidth;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const layoutScale = Math.max(0.5, viewportWidth / mobileV2LogicalViewportWidth);
  document.documentElement.style.setProperty(mobileV2LayoutScaleProperty, String(layoutScale));
  document.documentElement.style.setProperty(
    mobileV2LayoutHeightProperty,
    `${Math.max(1, viewportHeight / layoutScale)}px`,
  );
  restoreMobileV2DocumentOrigin();
}

function scheduleMobileV2LogicalCanvasSync() {
  if (layoutSyncFrame !== null) window.cancelAnimationFrame(layoutSyncFrame);
  layoutSyncFrame = window.requestAnimationFrame(() => {
    layoutSyncFrame = null;
    syncMobileV2LogicalCanvas();
  });
}

function handleMobileV2FocusIn(event: FocusEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches('input, textarea, select, [contenteditable="true"]')) return;
  scheduleMobileV2LogicalCanvasSync();
  if (focusCorrectionTimer !== null) window.clearTimeout(focusCorrectionTimer);
  focusCorrectionTimer = window.setTimeout(() => {
    focusCorrectionTimer = null;
    scheduleMobileV2LogicalCanvasSync();
  }, 320);
}

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
  document.documentElement.style.removeProperty(mobileV2LayoutScaleProperty);
  document.documentElement.style.removeProperty(mobileV2LayoutHeightProperty);
}

async function resetWorkspaceScroll() {
  await nextTick();
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  document.querySelectorAll<HTMLElement>([
    '.mobile-v2-preview-main',
    '.fulfillment-queue__list',
    '.fulfillment-main__body',
    '.history-queue__list',
    '.history-detail',
  ].join(',')).forEach((element) => {
    element.scrollTop = 0;
    element.scrollLeft = 0;
  });
}

watch(() => route.fullPath, () => {
  drawerOpen.value = false;
  void resetWorkspaceScroll();
  scheduleMobileV2LogicalCanvasSync();
});

onMounted(() => {
  applyMobileV2AppShell();
  window.addEventListener('resize', scheduleMobileV2LogicalCanvasSync);
  window.visualViewport?.addEventListener('resize', scheduleMobileV2LogicalCanvasSync);
  window.visualViewport?.addEventListener('scroll', scheduleMobileV2LogicalCanvasSync);
  document.addEventListener('focusin', handleMobileV2FocusIn);
  scheduleMobileV2LogicalCanvasSync();
  void resetWorkspaceScroll();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', scheduleMobileV2LogicalCanvasSync);
  window.visualViewport?.removeEventListener('resize', scheduleMobileV2LogicalCanvasSync);
  window.visualViewport?.removeEventListener('scroll', scheduleMobileV2LogicalCanvasSync);
  document.removeEventListener('focusin', handleMobileV2FocusIn);
  if (layoutSyncFrame !== null) window.cancelAnimationFrame(layoutSyncFrame);
  if (focusCorrectionTimer !== null) window.clearTimeout(focusCorrectionTimer);
  restoreDocumentShell();
});
</script>

<template>
  <div
    class="mobile-v2-preview-frame"
    :class="{
      'is-menu-mode': isolatedMenuMode,
      'is-table-detail-mode': isolatedTableDetailMode,
      'is-fulfillment-detail-mode': fulfillmentDetailMode,
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
      :detail-mode="fulfillmentDetailMode"
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
        :push-settings-available="pushSettingsAvailable"
        @close="drawerOpen = false"
        @logout="$emit('logout')"
        @open-push-settings="$emit('openPushSettings')"
      />
    </Transition>
  </div>
</template>
