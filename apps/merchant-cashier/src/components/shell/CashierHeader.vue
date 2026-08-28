<script setup lang="ts">
import {
  Bell,
  Clock,
  LoaderCircle,
  Maximize,
  Minimize,
  Printer,
  RefreshCw,
  Search,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useMediaQuery } from '@/composables/useMediaQuery';
import { useI18n } from '@/i18n';
import type { CashierPrintingAvailability } from '@/types';

type MobileOperationalFilter = {
  value: string;
  label: string;
};

const props = defineProps<{
  totalTableCount: number;
  availableTableCount: number;
  inUseTableCount: number;
  disabledTableCount: number;
  newOrderCount: number;
  online: boolean;
  apiReachable: boolean | null;
  reconnecting: boolean;
  soundEnabled: boolean;
  soundSupported: boolean;
  printingAvailability: CashierPrintingAvailability;
  activeTableFilter: 'ALL' | 'AVAILABLE' | 'IN_USE' | 'DISABLED';
  refreshingTables?: boolean;
  showTableMetrics?: boolean;
  showMainTabs?: boolean;
  activeMainTab?: 'TABLES' | 'MENU';
  currentTableLabel?: string;
  mobileOperationalContext?: 'pickup' | 'delivery';
  mobileOperationalFilters?: readonly MobileOperationalFilter[];
  activeMobileOperationalFilter?: string;
  mobileOperationalFilterAriaLabel?: string;
}>();

const emit = defineEmits<{
  openNewOrders: [];
  toggleSound: [];
  fullscreenError: [];
  selectTableFilter: [filter: 'ALL' | 'AVAILABLE' | 'IN_USE' | 'DISABLED'];
  selectMainTab: [tab: 'TABLES' | 'MENU'];
  selectMobileOperationalFilter: [filter: string];
  refreshTables: [];
}>();

const { t, locale } = useI18n();
const mobileViewport = useMediaQuery('(max-width: 899px)');
const now = ref(new Date());
const fullscreen = ref(Boolean(document.fullscreenElement));
let timer: number | undefined;

const localeTag = computed(() =>
  locale.value === 'zh' ? 'zh-CN' : locale.value === 'vi' ? 'vi-VN' : 'en-US',
);
const timeText = computed(() =>
  new Intl.DateTimeFormat(localeTag.value, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now.value),
);
const dateText = computed(() =>
  new Intl.DateTimeFormat(localeTag.value, {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(now.value),
);
const networkStatus = computed(() => {
  if (!props.online) {
    return { label: t('network.offline'), shortLabel: t('network.offlineShort'), tone: 'danger', icon: WifiOff } as const;
  }
  if (props.reconnecting || props.apiReachable === null) {
    return { label: t('network.reconnecting'), shortLabel: t('network.reconnectingShort'), tone: 'warning', icon: LoaderCircle } as const;
  }
  if (!props.apiReachable) {
    return { label: t('network.apiUnavailable'), shortLabel: t('network.unavailableShort'), tone: 'danger', icon: WifiOff } as const;
  }
  return { label: t('network.connected'), shortLabel: t('network.connectedShort'), tone: 'ok', icon: Wifi } as const;
});
const printingStatus = computed(() => {
  if (props.printingAvailability === 'READY') {
    return { label: t('print.ready'), shortLabel: t('print.readyShort'), tone: 'ok' } as const;
  }
  if (props.printingAvailability === 'NOT_CONFIGURED') {
    return {
      label: t('print.configurationRequired'),
      shortLabel: t('print.configurationRequiredShort'),
      tone: 'warning',
    } as const;
  }
  if (props.printingAvailability === 'LOADING') {
    return { label: t('print.checking'), shortLabel: t('print.checkingShort'), tone: 'warning' } as const;
  }
  if (props.printingAvailability === 'DEVICE_OFFLINE') {
    return { label: t('print.terminalOffline'), shortLabel: t('print.terminalOfflineShort'), tone: 'warning' } as const;
  }
  return { label: t('print.disabled'), shortLabel: t('print.disabledShort'), tone: 'muted' } as const;
});
const stats = computed(() => [
  { key: 'all', filter: 'ALL' as const, label: t('stats.totalTables'), value: props.totalTableCount, tone: 'neutral' },
  { key: 'available', filter: 'AVAILABLE' as const, label: t('stats.availableTables'), value: props.availableTableCount, tone: 'success' },
  { key: 'in-use', filter: 'IN_USE' as const, label: t('stats.inUseTables'), value: props.inUseTableCount, tone: 'info' },
  { key: 'disabled', filter: 'DISABLED' as const, label: t('stats.disabledTables'), value: props.disabledTableCount, tone: 'muted' },
]);
const mobileTableStats = computed(() => [
  { key: 'all', filter: 'ALL' as const, label: t('common.all'), value: props.totalTableCount },
  { key: 'in-use', filter: 'IN_USE' as const, label: t('table.status.inUse'), value: props.inUseTableCount },
  { key: 'available', filter: 'AVAILABLE' as const, label: t('table.status.available'), value: props.availableTableCount },
]);

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    emit('fullscreenError');
  }
}

function syncFullscreen() {
  fullscreen.value = Boolean(document.fullscreenElement);
}

onMounted(() => {
  timer = window.setInterval(() => {
    now.value = new Date();
  }, 60_000);
  document.addEventListener('fullscreenchange', syncFullscreen);
});

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer);
  document.removeEventListener('fullscreenchange', syncFullscreen);
});
</script>

<template>
  <header
    class="cashier-header"
    :class="{
      'cashier-header--status-only': showTableMetrics === false && !showMainTabs,
      'cashier-header--main-tabs': showMainTabs,
      'cashier-header--table-route': showMainTabs && activeMainTab !== 'MENU',
      'cashier-header--menu-route': showMainTabs && activeMainTab === 'MENU',
      'cashier-header--operation-route': Boolean(mobileOperationalFilters?.length),
    }"
    data-testid="cashier-topbar"
  >
    <nav
      v-if="showMainTabs && activeMainTab !== 'MENU' && mobileViewport"
      class="cashier-mobile-route-filters cashier-mobile-table-filters"
      :aria-label="t('stats.title')"
      data-testid="cashier-mobile-table-filters"
    >
      <button
        v-for="item in mobileTableStats"
        :key="item.key"
        type="button"
        :class="{ 'is-active': activeTableFilter === item.filter }"
        :data-testid="`mobile-table-filter-${item.key}`"
        :aria-pressed="activeTableFilter === item.filter"
        @click="$emit('selectTableFilter', item.filter)"
      >
        <span>{{ item.label }}</span>
        <b>{{ item.value }}</b>
      </button>
    </nav>

    <nav
      v-if="mobileViewport && mobileOperationalFilters?.length"
      class="cashier-mobile-route-filters cashier-mobile-operational-filters"
      :class="`cashier-mobile-operational-filters--${mobileOperationalContext || 'route'}`"
      :aria-label="mobileOperationalFilterAriaLabel || t('stats.title')"
      :data-testid="`cashier-mobile-${mobileOperationalContext || 'route'}-filters`"
    >
      <button
        v-for="item in mobileOperationalFilters"
        :key="item.value"
        type="button"
        :class="{ 'is-active': activeMobileOperationalFilter === item.value }"
        :data-testid="`mobile-${mobileOperationalContext || 'route'}-filter-${item.value.toLowerCase()}`"
        :aria-pressed="activeMobileOperationalFilter === item.value"
        @click="$emit('selectMobileOperationalFilter', item.value)"
      >
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <div v-if="showMainTabs && activeMainTab === 'MENU'" class="cashier-mobile-ordering-toolbar" data-testid="cashier-mobile-ordering-toolbar">
      <div class="cashier-mobile-search-context">
        <div
          id="cashier-mobile-menu-search"
          class="cashier-mobile-menu-search"
          data-testid="cashier-mobile-menu-search"
        >
          <button
            v-if="!currentTableLabel"
            type="button"
            class="cashier-mobile-search-placeholder"
            :class="{ 'is-disabled': !currentTableLabel }"
            :disabled="!currentTableLabel"
            @click="$emit('selectMainTab', 'MENU')"
          >
            <Search :size="18" aria-hidden="true" />
            <span>{{ t('ordering.searchPlaceholder') }}</span>
          </button>
        </div>
        <output
          class="cashier-mobile-current-table"
          data-testid="cashier-mobile-current-table"
          :title="currentTableLabel ? t('cashierV2.currentTableCompact', { table: currentTableLabel }) : t('cashierV2.selectTable')"
          aria-live="polite"
        >
          <span>{{ currentTableLabel ? t('cashierV2.currentTableCompact', { table: currentTableLabel }) : t('cashierV2.selectTable') }}</span>
        </output>
      </div>
    </div>

    <div v-if="showMainTabs" class="cashier-toolbar-primary" data-testid="cashier-toolbar-primary">
      <nav class="cashier-primary-tabs" :aria-label="t('cashierV2.mainTabs')" data-testid="cashier-primary-tabs">
        <button
          type="button"
          data-testid="main-tab-tables"
          :class="{ 'is-active': activeMainTab !== 'MENU' }"
          :aria-pressed="activeMainTab !== 'MENU'"
          @click="$emit('selectMainTab', 'TABLES')"
        >{{ t('cashierV2.tablesTab') }}</button>
        <button
          type="button"
          data-testid="main-tab-menu"
          :class="{ 'is-active': activeMainTab === 'MENU' }"
          :aria-pressed="activeMainTab === 'MENU'"
          @click="$emit('selectMainTab', 'MENU')"
        >{{ t('cashierV2.menuTab') }}</button>
      </nav>
      <div
        v-show="activeMainTab === 'MENU'"
        id="cashier-toolbar-menu-search"
        class="cashier-toolbar-menu-search"
        data-testid="cashier-toolbar-menu-search"
      />
    </div>

    <section v-else-if="showTableMetrics !== false" class="cashier-top-metrics" :aria-label="t('stats.title')" data-testid="top-metrics">
      <button
        v-for="item in stats"
        :key="item.key"
        type="button"
        :class="[
          `cashier-top-metric cashier-top-metric--${item.tone}`,
          { 'is-active': activeTableFilter === item.filter },
        ]"
        :data-testid="`top-metric-${item.key}`"
        :aria-pressed="activeTableFilter === item.filter"
        @click="$emit('selectTableFilter', item.filter)"
      >
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </button>
      <button
        type="button"
        class="cashier-top-metrics__refresh"
        data-testid="top-table-refresh"
        :title="t('common.refresh')"
        :aria-label="t('common.refresh')"
        :aria-busy="refreshingTables"
        :disabled="refreshingTables"
        @click="$emit('refreshTables')"
      >
        <RefreshCw :size="20" :class="{ spinning: refreshingTables }" aria-hidden="true" />
      </button>
    </section>

    <section class="cashier-top-status" data-testid="top-status">
      <button
        v-if="!mobileViewport"
        type="button"
        class="top-status-item top-status-item--new-order"
        :class="{ 'top-status-item--active': newOrderCount > 0 }"
        :title="t('stats.newOrders')"
        data-testid="top-new-orders"
        @click="$emit('openNewOrders')"
      >
        <span class="top-status-item__icon"><Bell :size="28" :stroke-width="1.9" aria-hidden="true" /></span>
        <b v-if="newOrderCount">{{ newOrderCount > 99 ? '99+' : newOrderCount }}</b>
        <span>{{ t('stats.newOrders') }}</span>
      </button>

      <span
        :class="[
          'top-status-item',
          `top-status-item--${networkStatus.tone}`,
          { 'top-status-item--reconnecting': reconnecting || (online && apiReachable === null) },
        ]"
        :title="networkStatus.label"
        aria-live="polite"
        data-testid="top-network-status"
      >
        <span class="top-status-item__icon">
          <component :is="networkStatus.icon" :size="28" :stroke-width="1.9" aria-hidden="true" />
        </span>
        <span class="top-status-item__label top-status-item__label--full">{{ networkStatus.label }}</span>
        <span class="top-status-item__label top-status-item__label--short">{{ networkStatus.shortLabel }}</span>
        <span class="top-status-item__label top-status-item__label--mobile">{{ t('cashierV2.mobileNetwork') }}</span>
      </span>

      <button
        type="button"
        class="top-status-item top-status-item--interactive"
        :class="soundEnabled ? 'top-status-item--ok' : 'top-status-item--warning'"
        :disabled="!soundSupported"
        :aria-label="soundEnabled ? t('sound.enabled') : t('sound.disabled')"
        :aria-pressed="soundEnabled"
        :title="soundEnabled ? t('sound.enabled') : t('sound.disabled')"
        data-testid="top-sound-status"
        @click="$emit('toggleSound')"
      >
        <span class="top-status-item__icon">
          <Volume2 v-if="soundEnabled" :size="28" :stroke-width="1.9" aria-hidden="true" />
          <VolumeX v-else :size="28" :stroke-width="1.9" aria-hidden="true" />
        </span>
        <span class="top-status-item__label top-status-item__label--full">
          {{ soundEnabled ? t('sound.enabled') : t('sound.disabled') }}
        </span>
        <span class="top-status-item__label top-status-item__label--short">
          {{ soundEnabled ? t('sound.enabledShort') : t('sound.disabledShort') }}
        </span>
        <span class="top-status-item__label top-status-item__label--mobile">{{ t('cashierV2.mobileSound') }}</span>
      </button>

      <span
        :class="['top-status-item', `top-status-item--${printingStatus.tone}`]"
        :title="printingStatus.label"
        aria-disabled="true"
        data-testid="top-print-status"
        data-terminal-action="printer-diagnostics"
      >
        <span class="top-status-item__icon"><Printer :size="28" :stroke-width="1.9" aria-hidden="true" /></span>
        <span class="top-status-item__label top-status-item__label--full">{{ printingStatus.label }}</span>
        <span class="top-status-item__label top-status-item__label--short">{{ printingStatus.shortLabel }}</span>
        <span class="top-status-item__label top-status-item__label--mobile">{{ t('cashierV2.mobilePrint') }}</span>
      </span>

      <button
        v-if="!mobileViewport"
        type="button"
        class="top-status-item top-status-item--fullscreen"
        :aria-label="fullscreen ? t('shell.exitFullscreen') : t('shell.enterFullscreen')"
        :title="fullscreen ? t('shell.exitFullscreen') : t('shell.enterFullscreen')"
        data-testid="top-fullscreen"
        @click="toggleFullscreen"
      >
        <span class="top-status-item__icon">
          <Minimize v-if="fullscreen" :size="27" :stroke-width="1.9" aria-hidden="true" />
          <Maximize v-else :size="27" :stroke-width="1.9" aria-hidden="true" />
        </span>
        <span>{{ t('shell.fullscreenShort') }}</span>
      </button>

      <div
        v-if="!mobileViewport"
        class="top-status-item top-status-item--clock"
        :aria-label="t('shell.currentTime')"
        data-testid="top-clock"
      >
        <Clock :size="30" :stroke-width="1.9" aria-hidden="true" />
        <span><strong>{{ timeText }}</strong><small>{{ dateText }}</small></span>
      </div>
    </section>
  </header>
</template>
