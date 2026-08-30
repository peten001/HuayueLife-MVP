<script setup lang="ts">
import {
  Bell,
  LoaderCircle,
  Printer,
  RefreshCw,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from '@lucide/vue';
import { computed } from 'vue';
import AccountMenu from '@/components/shell/AccountMenu.vue';
import { useI18n } from '@/i18n';
import type { CashierPrintingAvailability } from '@/types';
import type { CashierPresentationWorkspace } from './navigation';

type MobileOperationalFilter = {
  value: string;
  label: string;
};

const props = withDefaults(defineProps<{
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
}>(), {
  operationalFilters: () => [],
  activeOperationalFilter: 'ALL',
  activeMainTab: 'TABLES',
});

const emit = defineEmits<{
  logout: [];
  openNewOrders: [];
  toggleSound: [];
  selectTableFilter: [filter: 'ALL' | 'AVAILABLE' | 'IN_USE' | 'DISABLED'];
  selectMainTab: [tab: 'TABLES' | 'MENU'];
  selectOperationalFilter: [filter: string];
  refreshTables: [];
}>();

const { t } = useI18n();
const title = computed(() => t({
  tables: 'nav.tables',
  pickup: 'nav.pickup',
  delivery: 'nav.delivery',
  history: 'nav.history',
}[props.workspace]));
const contextLabel = computed(() => {
  if (props.workspace === 'tables' && props.currentTableLabel) {
    return t('cashierV2.currentTableCompact', { table: props.currentTableLabel });
  }
  return props.merchantName || t('shell.merchantFallback');
});
const networkStatus = computed(() => {
  if (!props.online) return { tone: 'danger', label: t('network.offline'), icon: WifiOff } as const;
  if (props.reconnecting || props.apiReachable === null) return { tone: 'warning', label: t('network.reconnecting'), icon: LoaderCircle } as const;
  if (!props.apiReachable) return { tone: 'danger', label: t('network.apiUnavailable'), icon: WifiOff } as const;
  return { tone: 'quiet', label: t('network.connected'), icon: Wifi } as const;
});
const printingStatus = computed(() => {
  if (props.printingAvailability === 'READY') return { tone: 'quiet', label: t('print.ready') } as const;
  if (props.printingAvailability === 'LOADING') return { tone: 'warning', label: t('print.checking') } as const;
  if (props.printingAvailability === 'NOT_CONFIGURED') return { tone: 'warning', label: t('print.configurationRequired') } as const;
  if (props.printingAvailability === 'DEVICE_OFFLINE') return { tone: 'warning', label: t('print.terminalOffline') } as const;
  return { tone: 'muted', label: t('print.disabled') } as const;
});
const tableFilters = computed(() => [
  { value: 'ALL' as const, label: t('common.all'), count: props.totalTableCount },
  { value: 'IN_USE' as const, label: t('table.status.inUse'), count: props.inUseTableCount },
  { value: 'AVAILABLE' as const, label: t('table.status.available'), count: props.availableTableCount },
]);
</script>

<template>
  <header class="mobile-v2-header">
    <div class="mobile-v2-header__identity">
      <span class="mobile-v2-header__eyebrow" :aria-label="t('cashierV2.previewLabel')" :title="t('cashierV2.previewLabel')"><span aria-hidden="true">V2</span></span>
      <div>
        <h1>{{ title }}</h1>
        <p>{{ contextLabel }}</p>
      </div>
    </div>

    <div class="mobile-v2-header__actions">
      <span class="mobile-v2-status" :class="`mobile-v2-status--${networkStatus.tone}`" :aria-label="networkStatus.label" :title="networkStatus.label">
        <component :is="networkStatus.icon" :size="17" :class="{ spinning: reconnecting }" aria-hidden="true" />
      </span>
      <span class="mobile-v2-status" :class="`mobile-v2-status--${printingStatus.tone}`" :aria-label="printingStatus.label" :title="printingStatus.label">
        <Printer :size="17" aria-hidden="true" />
      </span>
      <button type="button" class="mobile-v2-header__icon-button" :class="{ 'has-attention': newOrderCount > 0 }" :aria-label="t('orders.newTitle')" @click="emit('openNewOrders')">
        <Bell :size="18" aria-hidden="true" />
        <b v-if="newOrderCount">{{ newOrderCount > 99 ? '99+' : newOrderCount }}</b>
      </button>
      <button type="button" class="mobile-v2-header__icon-button" :disabled="!soundSupported" :aria-label="t(soundEnabled ? 'sound.enabled' : 'sound.enable')" @click="emit('toggleSound')">
        <Volume2 v-if="soundEnabled" :size="18" aria-hidden="true" />
        <VolumeX v-else :size="18" aria-hidden="true" />
      </button>
      <AccountMenu
        class="mobile-v2-account"
        :merchant-name="merchantName"
        :role="role"
        :logging-out="loggingOut"
        @logout="emit('logout')"
      />
    </div>

    <div v-if="workspace === 'tables'" class="mobile-v2-header__controls">
      <div class="mobile-v2-segmented" :aria-label="t('cashierV2.mainTabs')">
        <button type="button" :class="{ 'is-active': activeMainTab === 'TABLES' }" :aria-pressed="activeMainTab === 'TABLES'" @click="emit('selectMainTab', 'TABLES')">{{ t('cashierV2.tablesTab') }}</button>
        <button type="button" :class="{ 'is-active': activeMainTab === 'MENU' }" :aria-pressed="activeMainTab === 'MENU'" @click="emit('selectMainTab', 'MENU')">{{ t('cashierV2.menuTab') }}</button>
      </div>
      <div
        v-show="activeMainTab === 'MENU'"
        id="cashier-mobile-menu-search"
        class="mobile-v2-menu-search-target mobile-v2-menu-search-target--mobile"
        data-testid="cashier-mobile-menu-search"
      />
      <div
        v-show="activeMainTab === 'MENU'"
        id="cashier-toolbar-menu-search"
        class="mobile-v2-menu-search-target mobile-v2-menu-search-target--desktop"
        data-testid="cashier-toolbar-menu-search"
      />
      <div v-if="activeMainTab === 'TABLES'" class="mobile-v2-table-filter-row">
        <div class="mobile-v2-filter-strip" :aria-label="t('stats.title')">
          <button v-for="item in tableFilters" :key="item.value" type="button" :class="{ 'is-active': activeTableFilter === item.value }" :aria-pressed="activeTableFilter === item.value" @click="emit('selectTableFilter', item.value)">
            <span>{{ item.label }}</span><b>{{ item.count }}</b>
          </button>
        </div>
        <button type="button" class="mobile-v2-filter-strip__refresh" :disabled="refreshingTables" :aria-label="t('common.refresh')" @click="emit('refreshTables')"><RefreshCw :size="17" :class="{ spinning: refreshingTables }" aria-hidden="true" /></button>
      </div>
    </div>

    <div v-else-if="workspace === 'pickup' || workspace === 'delivery'" class="mobile-v2-header__controls">
      <div class="mobile-v2-filter-strip" :aria-label="title">
        <button v-for="item in operationalFilters" :key="item.value" type="button" :class="{ 'is-active': activeOperationalFilter === item.value }" :aria-pressed="activeOperationalFilter === item.value" @click="emit('selectOperationalFilter', item.value)">{{ item.label }}</button>
      </div>
    </div>
  </header>
</template>
