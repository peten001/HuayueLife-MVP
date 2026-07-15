<script setup lang="ts">
import {
  Bell,
  Clock,
  LoaderCircle,
  Maximize,
  Minimize,
  Printer,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from '@/i18n';

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
}>();

const emit = defineEmits<{
  openNewOrders: [];
  toggleSound: [];
  fullscreenError: [];
}>();

const { t, locale } = useI18n();
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
const stats = computed(() => [
  { key: 'all', label: t('stats.totalTables'), value: props.totalTableCount, tone: 'neutral' },
  { key: 'available', label: t('stats.availableTables'), value: props.availableTableCount, tone: 'success' },
  { key: 'in-use', label: t('stats.inUseTables'), value: props.inUseTableCount, tone: 'info' },
  { key: 'disabled', label: t('stats.disabledTables'), value: props.disabledTableCount, tone: 'muted' },
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
  <header class="cashier-header" data-testid="cashier-topbar">
    <section class="cashier-top-metrics" :aria-label="t('stats.title')" data-testid="top-metrics">
      <article
        v-for="item in stats"
        :key="item.key"
        :class="`cashier-top-metric cashier-top-metric--${item.tone}`"
        :data-testid="`top-metric-${item.key}`"
      >
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </article>
    </section>

    <section class="cashier-top-status" data-testid="top-status">
      <button
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
      </button>

      <span
        class="top-status-item top-status-item--pending"
        :title="t('print.featurePending')"
        aria-disabled="true"
        data-testid="top-print-status"
      >
        <span class="top-status-item__icon"><Printer :size="28" :stroke-width="1.9" aria-hidden="true" /></span>
        <span>{{ t('print.pendingShort') }}</span>
      </span>

      <button
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
