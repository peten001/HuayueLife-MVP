<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRouter } from 'vue-router';
import { useI18n } from '@/i18n';
import {
  cashierWorkspaceEnabled,
  firstEnabledCashierWorkspace,
  formatBusinessHoursRange,
  isWithinBusinessHours,
  resolveCashierWorkspaceCapabilities,
  resolveMerchantImageCandidates,
  resolveMediaUrl,
} from '@/domain';
import { resolveOrderLocation } from '@/domain/order-location';
import {
  useAuthStore,
  useNetworkStore,
  useOrdersStore,
  usePrintingStore,
  useSoundStore,
  useTablesStore,
  useUiStore,
} from '@/stores';
import type { MerchantOrder } from '@/types';
import CashierSidebar from '@/components/shell/CashierSidebar.vue';
import CashierHeader from '@/components/shell/CashierHeader.vue';
import CashierMobileNavigation from '@/components/shell/CashierMobileNavigation.vue';
import ToastRegion from '@/components/common/ToastRegion.vue';
import NewOrderInbox from '@/features/inbox/NewOrderInbox.vue';

const router = useRouter();
const { t, locale } = useI18n();
const authStore = useAuthStore();
const ordersStore = useOrdersStore();
const printingStore = usePrintingStore();
const tablesStore = useTablesStore();
const networkStore = useNetworkStore();
const soundStore = useSoundStore();
const uiStore = useUiStore();
const { session, profile, isAuthenticated, demoMode } = storeToRefs(authStore);
const { pendingOrders } = storeToRefs(ordersStore);
const { tableCards } = storeToRefs(tablesStore);
const { online, apiReachable } = storeToRefs(networkStore);
const { enabled: soundEnabled, supported: soundSupported, lastError: soundError } = storeToRefs(soundStore);
const { availability: printingAvailability } = storeToRefs(printingStore);
const loggingOut = ref(false);
const inboxOpen = ref(false);
const refreshingTables = ref(false);
let printingStatusTimer: number | undefined;

const identity = computed(() => ({
  merchantName:
    (locale.value === 'vi' ? profile.value?.nameVi : locale.value === 'en' ? profile.value?.nameEn : profile.value?.nameZh)
    || profile.value?.nameZh
    || session.value?.merchant.nameZh
    || '',
  role: session.value?.role,
  merchantImageUrls: resolveMerchantImageCandidates(profile.value).map(resolveMediaUrl).filter(Boolean),
}));
const capabilities = computed(() => resolveCashierWorkspaceCapabilities(
  profile.value,
  session.value?.merchant,
));
const availableTableCount = computed(() => tableCards.value.filter((table) => table.operationalStatus === 'AVAILABLE').length);
const inUseTableCount = computed(() => tableCards.value.filter((table) => table.operationalStatus === 'IN_USE').length);
const disabledTableCount = computed(() => tableCards.value.filter((table) => table.operationalStatus === 'DISABLED').length);
const tableAttentionCount = computed(() => tableCards.value.filter((table) => Number(table.currentSession?.pendingOrderCount || 0) > 0).length);
const pickupAttentionCount = computed(() => pendingOrders.value.filter((order) => order.orderType === 'PICKUP').length);
const deliveryAttentionCount = computed(() => pendingOrders.value.filter((order) => order.orderType === 'DELIVERY').length);
const plannedHoursRange = computed(() =>
  formatBusinessHoursRange(profile.value?.businessHours, t('shell.nextDay')),
);
const plannedBusinessOpen = computed<boolean | null>(() => profile.value ? isWithinBusinessHours(profile.value.businessHours) : null);
const businessHoursLabel = computed(() => {
  if (!profile.value) return t('shell.businessHoursUnknown');
  if (!plannedHoursRange.value) return t('shell.businessClosed');
  return `${t(plannedBusinessOpen.value ? 'shell.businessOpen' : 'shell.businessClosed')} · ${plannedHoursRange.value}`;
});
const activeTableFilter = computed<'ALL' | 'AVAILABLE' | 'IN_USE' | 'DISABLED'>(() => {
  const filter = router.currentRoute.value.query.status;
  return filter === 'AVAILABLE' || filter === 'IN_USE' || filter === 'DISABLED' ? filter : 'ALL';
});
const showOrientationNotice = computed(() => router.currentRoute.value.name !== 'tables');
const showTableMetrics = computed(() => router.currentRoute.value.name !== 'tables');
const showMainTabs = computed(() => router.currentRoute.value.name === 'tables');
const activeMainTab = computed<'TABLES' | 'MENU'>(() =>
  router.currentRoute.value.query.view === 'menu' ? 'MENU' : 'TABLES',
);

async function logout() {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    ordersStore.stopLivePolling();
    tablesStore.stopLivePolling();
    ordersStore.clear();
    tablesStore.clear();
    printingStore.clear();
    inboxOpen.value = false;
    await authStore.logout();
    await router.replace('/login');
  } finally {
    loggingOut.value = false;
  }
}

async function toggleSound() {
  if (soundEnabled.value && soundStore.unlocked) soundStore.disable();
  else await soundStore.enable();
}

async function openNewOrders() {
  if (!pendingOrders.value.length) return;
  const [onlyOrder] = pendingOrders.value;
  if (pendingOrders.value.length === 1 && onlyOrder) {
    await openInboxOrder(onlyOrder);
    return;
  }
  inboxOpen.value = true;
}

async function openInboxOrder(order: MerchantOrder) {
  inboxOpen.value = false;
  await router.push(resolveOrderLocation(order));
}

async function recoverData() {
  await Promise.allSettled([
    ...(profile.value ? [] : [authStore.refreshProfile()]),
    ordersStore.refreshLiveOrders(),
    tablesStore.fetchTables(),
    printingStore.refreshStatus(),
  ]);
}

async function selectTableFilter(filter: 'ALL' | 'AVAILABLE' | 'IN_USE' | 'DISABLED') {
  await router.push({
    name: 'tables',
    query: filter === 'ALL' ? {} : { status: filter },
  });
}

async function selectMainTab(tab: 'TABLES' | 'MENU') {
  const current = router.currentRoute.value;
  const query = { ...current.query };
  if (tab === 'MENU') query.view = 'menu';
  else delete query.view;
  await router.replace({ name: 'tables', params: current.params, query });
}

async function refreshTables() {
  if (refreshingTables.value) return;
  refreshingTables.value = true;
  try {
    await Promise.all([
      tablesStore.fetchTables({ force: true }),
      ordersStore.refreshLiveOrders({ force: true }),
    ]);
  } catch {
    uiStore.pushToast(t('error.refreshFailed'), 'error');
  } finally {
    refreshingTables.value = false;
  }
}

watch(isAuthenticated, async (authenticated) => {
  if (!authenticated && !loggingOut.value) {
    ordersStore.clear();
    tablesStore.clear();
    inboxOpen.value = false;
    await router.replace({ path: '/login', query: { expired: '1' } });
  }
});

watch(
  () => [online.value, apiReachable.value] as const,
  ([nextOnline, nextApi], previous) => {
    const recovered = nextOnline && nextApi !== false && previous && (!previous[0] || previous[1] === false);
    if (recovered) void recoverData();
  },
);

watch(soundError, (error) => {
  if (error) uiStore.pushToast(t('sound.unlockFailed'), 'warning');
});

watch(
  () => [
    capabilities.value.tables,
    capabilities.value.pickup,
    capabilities.value.delivery,
    router.currentRoute.value.name,
  ] as const,
  ([tables, pickup, delivery, routeName]) => {
    const nextCapabilities = { tables, pickup, delivery };
    if (!cashierWorkspaceEnabled(routeName, nextCapabilities)) {
      void router.replace({ name: firstEnabledCashierWorkspace(nextCapabilities) });
    }
  },
  { immediate: true },
);

onMounted(async () => {
  networkStore.start();
  ordersStore.startLivePolling();
  tablesStore.startLivePolling();
  await Promise.allSettled([
    ordersStore.refreshLiveOrders(),
    tablesStore.fetchTables(),
    printingStore.refreshStatus(),
  ]);
  printingStatusTimer = window.setInterval(() => {
    if (online.value) void printingStore.refreshStatus().catch(() => undefined);
  }, 15_000);
});

onBeforeUnmount(() => {
  ordersStore.stopLivePolling();
  tablesStore.stopLivePolling();
  networkStore.stop();
  if (printingStatusTimer !== undefined) window.clearInterval(printingStatusTimer);
});
</script>

<template>
  <div
    class="cashier-shell cashier-shell--workflow"
    :class="{ 'cashier-shell--table-toolbar': showMainTabs }"
  >
    <CashierSidebar
      :merchant-name="identity.merchantName"
      :merchant-image-urls="identity.merchantImageUrls"
      :business-open="plannedBusinessOpen"
      :business-hours-label="businessHoursLabel"
      :demo-mode="demoMode"
      :role="identity.role"
      :logging-out="loggingOut"
      :table-attention-count="tableAttentionCount"
      :pickup-attention-count="pickupAttentionCount"
      :delivery-attention-count="deliveryAttentionCount"
      :show-tables="capabilities.tables"
      :show-pickup="capabilities.pickup"
      :show-delivery="capabilities.delivery"
      @logout="logout"
    />

    <CashierHeader
      :total-table-count="tableCards.length"
      :available-table-count="availableTableCount"
      :in-use-table-count="inUseTableCount"
      :disabled-table-count="disabledTableCount"
      :new-order-count="pendingOrders.length"
      :online="online"
      :api-reachable="apiReachable"
      :reconnecting="online && apiReachable === null"
      :sound-enabled="soundEnabled"
      :sound-supported="soundSupported"
      :printing-availability="printingAvailability"
      :active-table-filter="activeTableFilter"
      :refreshing-tables="refreshingTables"
      :show-table-metrics="showTableMetrics"
      :show-main-tabs="showMainTabs"
      :active-main-tab="activeMainTab"
      @open-new-orders="openNewOrders"
      @toggle-sound="toggleSound"
      @fullscreen-error="uiStore.pushToast(t('error.operationFailed'), 'warning')"
      @select-table-filter="selectTableFilter"
      @select-main-tab="selectMainTab"
      @refresh-tables="refreshTables"
    />

    <main class="cashier-shell__route cashier-shell__route--workflow">
      <OrientationNotice v-if="showOrientationNotice" />
      <RouterView />
    </main>

    <CashierMobileNavigation
      :show-tables="capabilities.tables"
      :show-pickup="capabilities.pickup"
      :show-delivery="capabilities.delivery"
    />
    <NewOrderInbox :open="inboxOpen" :orders="pendingOrders" @close="inboxOpen = false" @select="openInboxOrder" />
    <ToastRegion />
  </div>
</template>
