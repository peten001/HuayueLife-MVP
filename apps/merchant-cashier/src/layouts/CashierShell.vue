<script setup lang="ts">
import { X } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from '@/i18n';
import {
  currentBusinessHoursRange,
  isWithinBusinessHours,
  resolveMediaUrl,
} from '@/domain';
import { apiErrorTranslationKey } from '@/api';
import {
  useAuthStore,
  useNetworkStore,
  useOrdersStore,
  useSoundStore,
  useTablesStore,
  useUiStore,
} from '@/stores';
import type { CashierOrderAction } from '@/components/common/view-models';
import CashierSidebar from '@/components/shell/CashierSidebar.vue';
import CashierHeader from '@/components/shell/CashierHeader.vue';
import CashierMobileNavigation from '@/components/shell/CashierMobileNavigation.vue';
import OrientationNotice from '@/components/shell/OrientationNotice.vue';
import OrderDetailPanel from '@/components/orders/OrderDetailPanel.vue';
import TableBillDetail from '@/components/bills/TableBillDetail.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ConfirmDialog from '@/components/common/ConfirmDialog.vue';
import ToastRegion from '@/components/common/ToastRegion.vue';

const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();
const authStore = useAuthStore();
const ordersStore = useOrdersStore();
const tablesStore = useTablesStore();
const networkStore = useNetworkStore();
const soundStore = useSoundStore();
const uiStore = useUiStore();
const { session, profile, isAuthenticated, demoMode } = storeToRefs(authStore);
const { pendingOrders, activeOrders, selectedOrder, actionLoadingId } = storeToRefs(ordersStore);
const { tableCards, selectedTable, selectedSessionDetail } = storeToRefs(tablesStore);
const { online, apiReachable } = storeToRefs(networkStore);
const { enabled: soundEnabled, supported: soundSupported, lastError: soundError } = storeToRefs(soundStore);
const { detailOpen } = storeToRefs(uiStore);
const loggingOut = ref(false);
const closingSession = ref(false);
const closeDialogOpen = ref(false);
const pendingOrderAction = ref<CashierOrderAction | null>(null);

const identity = computed(() => ({
  merchantName:
    (locale.value === 'vi' ? profile.value?.nameVi : locale.value === 'en' ? profile.value?.nameEn : profile.value?.nameZh)
    || profile.value?.nameZh
    || session.value?.merchant.nameZh
    || '',
  staffName: session.value?.displayName || session.value?.username || '',
  role: session.value?.role || 'STAFF',
  merchantLogoUrl: resolveMediaUrl(profile.value?.logoUrl),
}));
const availableTableCount = computed(
  () => tableCards.value.filter((table) => table.operationalStatus === 'AVAILABLE').length,
);
const inUseTableCount = computed(
  () => tableCards.value.filter((table) => table.operationalStatus === 'IN_USE').length,
);
const disabledTableCount = computed(
  () => tableCards.value.filter((table) => table.operationalStatus === 'DISABLED').length,
);
const showingTableDetail = computed(() => route.path === '/tables');
const plannedHoursRange = computed(() => currentBusinessHoursRange(profile.value?.businessHours));
const plannedBusinessOpen = computed<boolean | null>(() =>
  profile.value ? isWithinBusinessHours(profile.value.businessHours) : null,
);
const businessHoursLabel = computed(() => {
  if (!profile.value) return t('shell.businessHoursUnknown');
  if (!plannedHoursRange.value) return t('shell.businessClosed');
  return `${t(plannedBusinessOpen.value ? 'shell.businessOpen' : 'shell.businessClosed')} · ${plannedHoursRange.value}`;
});
const confirmationTitle = computed(() => {
  if (closeDialogOpen.value) return t('table.closeConfirmTitle');
  return t(pendingOrderAction.value === 'reject' ? 'order.rejectConfirmTitle' : 'order.completeConfirmTitle');
});
const confirmationDescription = computed(() => {
  if (closeDialogOpen.value) return t('table.closeConfirmDescription');
  return t(pendingOrderAction.value === 'reject' ? 'order.rejectConfirmDescription' : 'order.completeConfirmDescription');
});

async function logout() {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    ordersStore.stopLivePolling();
    tablesStore.stopLivePolling();
    ordersStore.clear();
    tablesStore.clear();
    uiStore.closeDetail();
    await authStore.logout();
    await router.replace('/login');
  } finally {
    loggingOut.value = false;
  }
}

async function toggleSound() {
  if (soundEnabled.value) {
    soundStore.disable();
    return;
  }
  await soundStore.enable();
}

function requestOrderAction(action: CashierOrderAction) {
  if (action === 'reject' || action === 'complete') {
    pendingOrderAction.value = action;
    return;
  }
  void executeOrderAction(action);
}

async function executeOrderAction(action: CashierOrderAction) {
  if (!selectedOrder.value || actionLoadingId.value) return;
  try {
    await ordersStore.runAction(selectedOrder.value.id, action);
    await Promise.allSettled([ordersStore.refreshLiveOrders(), tablesStore.fetchTables()]);
    uiStore.pushToast(t('order.actionSuccess'), 'success');
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'order.actionFailed')), 'error');
  } finally {
    pendingOrderAction.value = null;
  }
}

async function closeSession() {
  if (closingSession.value) return;
  closingSession.value = true;
  try {
    await tablesStore.closeSelectedSession();
    closeDialogOpen.value = false;
    tablesStore.clearSelection();
    uiStore.closeDetail();
    await router.replace({ path: '/tables', query: {} });
    uiStore.pushToast(t('table.closeSuccess'), 'success');
  } catch (caught) {
    uiStore.pushToast(t(apiErrorTranslationKey(caught, 'table.closeFailed')), 'error');
  } finally {
    closingSession.value = false;
  }
}

async function confirmCurrentAction() {
  if (closeDialogOpen.value) await closeSession();
  else if (pendingOrderAction.value) await executeOrderAction(pendingOrderAction.value);
}

function cancelConfirmation() {
  closeDialogOpen.value = false;
  pendingOrderAction.value = null;
}

async function openNewOrders() {
  await router.push('/orders/new');
}

async function recoverData() {
  await Promise.allSettled([
    ...(profile.value ? [] : [authStore.refreshProfile()]),
    ordersStore.refreshLiveOrders(),
    tablesStore.fetchTables(),
  ]);
}

watch(isAuthenticated, async (authenticated) => {
  if (!authenticated && !loggingOut.value) {
    ordersStore.clear();
    tablesStore.clear();
    uiStore.closeDetail();
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
  () => route.path,
  (nextPath, previousPath) => {
    if (nextPath === previousPath) return;
    uiStore.closeDetail();
    if (nextPath !== '/tables') void ordersStore.selectOrder(null);
  },
);

onMounted(async () => {
  networkStore.start();
  ordersStore.startLivePolling();
  tablesStore.startLivePolling();
  await Promise.allSettled([
    ordersStore.refreshLiveOrders(),
    ordersStore.fetchHistory(),
  ]);
});

onBeforeUnmount(() => {
  ordersStore.stopLivePolling();
  tablesStore.stopLivePolling();
  networkStore.stop();
});
</script>

<template>
  <div class="cashier-shell">
    <CashierSidebar
      :merchant-name="identity.merchantName"
      :merchant-logo-url="identity.merchantLogoUrl"
      :business-open="plannedBusinessOpen"
      :business-hours-label="businessHoursLabel"
      :demo-mode="demoMode"
      :staff-name="identity.staffName"
      :role="identity.role"
      :logging-out="loggingOut"
      :new-order-count="pendingOrders.length"
      :active-order-count="activeOrders.length"
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
      @open-new-orders="openNewOrders"
      @toggle-sound="toggleSound"
      @fullscreen-error="uiStore.pushToast(t('error.operationFailed'), 'warning')"
    />

    <main class="cashier-shell__route">
      <OrientationNotice />
      <RouterView />
    </main>

    <aside class="cashier-shell__detail" :class="{ 'cashier-shell__detail--open': detailOpen }">
      <button
        v-if="detailOpen"
        type="button"
        class="shell-detail-scrim"
        :aria-label="t('common.closeDetail')"
        @click="uiStore.closeDetail()"
      />
      <div class="cashier-shell__detail-panel">
        <button
          type="button"
          class="detail-close-button shell-detail-close"
          :aria-label="t('common.closeDetail')"
          @click="uiStore.closeDetail()"
        ><X :size="18" aria-hidden="true" /></button>
        <TableBillDetail
          v-if="showingTableDetail"
          :table="selectedTable"
          :session="selectedSessionDetail"
          :closing="closingSession"
          @close-session="closeDialogOpen = true"
        />
        <OrderDetailPanel
          v-else-if="selectedOrder"
          :order="selectedOrder"
          :action-loading="actionLoadingId === selectedOrder.id"
          @action="requestOrderAction"
        />
        <EmptyState
          v-else
          :title="t('common.detailEmptyTitle')"
          :description="t('common.detailEmptyDescription')"
        />
      </div>
    </aside>

    <CashierMobileNavigation />

    <ToastRegion />

    <ConfirmDialog
      :open="closeDialogOpen || Boolean(pendingOrderAction)"
      :title="confirmationTitle"
      :description="confirmationDescription"
      :cancel-label="t('common.cancel')"
      :confirm-label="t('common.confirm')"
      :loading="closingSession || Boolean(actionLoadingId)"
      @cancel="cancelConfirmation"
      @confirm="confirmCurrentAction"
    />
  </div>
</template>
