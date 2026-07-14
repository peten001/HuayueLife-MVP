<script setup lang="ts">
import {
  BellRing,
  Clock3,
  Expand,
  LoaderCircle,
  Minimize,
  Printer,
  Store,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from '@/i18n';
import AccountMenu from './AccountMenu.vue';

const props = defineProps<{
  merchantName?: string;
  merchantLogoUrl?: string;
  businessOpen: boolean;
  businessHoursLabel?: string;
  staffName?: string;
  role?: string;
  totalTableCount: number;
  availableTableCount: number;
  newOrderCount: number;
  activeOrderCount: number;
  online: boolean;
  apiReachable: boolean | null;
  reconnecting: boolean;
  soundEnabled: boolean;
  soundSupported: boolean;
  demoMode?: boolean;
  loggingOut?: boolean;
}>();

const emit = defineEmits<{
  logout: [];
  openNewOrders: [];
  toggleSound: [];
  fullscreenError: [];
}>();

const { t, locale } = useI18n();
const now = ref(new Date());
const fullscreen = ref(Boolean(document.fullscreenElement));
const logoFailed = ref(false);
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
    return {
      label: t('network.offline'),
      tone: 'danger',
      icon: WifiOff,
    } as const;
  }

  if (props.reconnecting || props.apiReachable === null) {
    return {
      label: t('network.reconnecting'),
      tone: 'warning',
      icon: LoaderCircle,
    } as const;
  }

  if (!props.apiReachable) {
    return {
      label: t('network.apiUnavailable'),
      tone: 'danger',
      icon: WifiOff,
    } as const;
  }

  return {
    label: t('network.connected'),
    tone: 'ok',
    icon: Wifi,
  } as const;
});
const stats = computed(() => [
  { key: 'all', label: t('stats.totalTables'), value: props.totalTableCount, tone: 'neutral' },
  { key: 'available', label: t('stats.availableTables'), value: props.availableTableCount, tone: 'muted' },
  { key: 'new', label: t('stats.newOrders'), value: props.newOrderCount, tone: 'success' },
  { key: 'active', label: t('stats.activeOrders'), value: props.activeOrderCount, tone: 'info' },
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
  }, 30_000);
  document.addEventListener('fullscreenchange', syncFullscreen);
});

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer);
  document.removeEventListener('fullscreenchange', syncFullscreen);
});
</script>

<template>
  <header class="cashier-header">
    <section class="merchant-summary-card">
      <span class="merchant-summary-card__image" aria-hidden="true">
        <img
          v-if="merchantLogoUrl && !logoFailed"
          :src="merchantLogoUrl"
          alt=""
          loading="eager"
          @error="logoFailed = true"
        />
        <Store v-else :size="21" :stroke-width="1.9" />
      </span>
      <div class="merchant-summary-card__copy">
        <strong>{{ merchantName || t('shell.merchantFallback') }}</strong>
        <span :class="['business-state', { 'business-state--closed': !businessOpen }]">
          <i aria-hidden="true" />
          {{ businessHoursLabel || t('shell.businessHoursUnknown') }}
        </span>
      </div>
      <span v-if="demoMode" class="demo-badge">{{ t('demo.badge') }}</span>
    </section>

    <section class="cashier-stats" :aria-label="t('stats.title')">
      <article v-for="item in stats" :key="item.key" :class="`cashier-stat cashier-stat--${item.tone}`">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </article>
    </section>

    <section class="cashier-header__tools">
      <button
        type="button"
        class="order-reminder"
        :class="{ 'order-reminder--active': newOrderCount > 0 }"
        @click="$emit('openNewOrders')"
      >
        <BellRing :size="19" aria-hidden="true" />
        <span>{{ t('stats.newOrders') }}</span>
        <b v-if="newOrderCount">{{ newOrderCount > 99 ? '99+' : newOrderCount }}</b>
      </button>

      <section class="cashier-header-statuses" aria-live="polite">
        <span
          :class="[
            'header-status-item',
            `header-status-item--${networkStatus.tone}`,
            { 'header-status-item--reconnecting': reconnecting || (online && apiReachable === null) },
          ]"
          :title="networkStatus.label"
        >
          <component :is="networkStatus.icon" :size="16" aria-hidden="true" />
          <span class="header-status-item__label">{{ networkStatus.label }}</span>
        </span>

        <button
          type="button"
          class="header-status-item header-status-item--interactive"
          :class="soundEnabled ? 'header-status-item--ok' : 'header-status-item--warning'"
          :disabled="!soundSupported"
          :aria-label="soundEnabled ? t('sound.enabled') : t('sound.disabled')"
          :aria-pressed="soundEnabled"
          :title="soundEnabled ? t('sound.enabled') : t('sound.disabled')"
          @click="$emit('toggleSound')"
        >
          <Volume2 v-if="soundEnabled" :size="16" aria-hidden="true" />
          <VolumeX v-else :size="16" aria-hidden="true" />
          <span class="header-status-item__label">
            {{ soundEnabled ? t('sound.enabled') : t('sound.disabled') }}
          </span>
        </button>

        <span
          class="header-status-item header-status-item--pending"
          :title="t('print.pending')"
        >
          <Printer :size="16" aria-hidden="true" />
          <span class="header-status-item__label">{{ t('print.pending') }}</span>
        </span>
      </section>

      <button
        type="button"
        class="icon-touch-button"
        :aria-label="fullscreen ? t('shell.exitFullscreen') : t('shell.enterFullscreen')"
        :title="fullscreen ? t('shell.exitFullscreen') : t('shell.enterFullscreen')"
        @click="toggleFullscreen"
      >
        <Minimize v-if="fullscreen" :size="20" aria-hidden="true" />
        <Expand v-else :size="20" aria-hidden="true" />
      </button>

      <div class="cashier-clock" :aria-label="t('shell.currentTime')">
        <Clock3 :size="18" aria-hidden="true" />
        <span><strong>{{ timeText }}</strong><small>{{ dateText }}</small></span>
      </div>

      <AccountMenu
        :staff-name="staffName"
        :role="role"
        :logging-out="loggingOut"
        @logout="$emit('logout')"
      />
    </section>
  </header>
</template>
