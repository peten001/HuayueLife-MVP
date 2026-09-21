<script setup lang="ts">
import { BellRing, X } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useOrderPush } from '@/composables/useOrderPush';
import { useI18n } from '@/i18n';

const props = withDefaults(defineProps<{
  mobile?: boolean;
}>(), {
  mobile: false,
});

const { locale, t } = useI18n();
const push = useOrderPush(locale);
const dismissed = ref(props.mobile);
const mobileSheet = ref<HTMLElement | null>(null);
let openedManually = false;
const messageKey = computed(() => ({
  'install-required': 'orderPush.installRequired',
  denied: 'orderPush.denied',
  unavailable: 'orderPush.unavailable',
  unsupported: 'orderPush.unsupported',
  error: 'orderPush.error',
} as Record<string, string>)[push.state.value] || 'orderPush.description');
const enabled = computed(() => push.state.value === 'enabled');
const switchDisabled = computed(() => push.working.value || [
  'checking',
  'unsupported',
  'install-required',
  'unavailable',
  'denied',
].includes(push.state.value));

onMounted(async () => {
  document.addEventListener('keydown', closeOnEscape);
  await push.refresh();
  if ((props.mobile || push.state.value === 'enabled') && !openedManually) dismissed.value = true;
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', closeOnEscape);
});

async function turnOn() {
  await push.enable();
  if (push.state.value === 'enabled' && !props.mobile) {
    dismissed.value = true;
  }
}

async function toggleNotifications() {
  if (switchDisabled.value) return;
  if (enabled.value) await push.disable();
  else await turnOn();
}

function openSettings() {
  openedManually = true;
  dismissed.value = false;
  void nextTick(() => {
    mobileSheet.value?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  });
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.mobile && !dismissed.value) dismissed.value = true;
}

watch(() => props.mobile, (mobile) => {
  if (mobile && !openedManually) dismissed.value = true;
});

defineExpose({ disable: push.disable, openSettings });
</script>

<template>
  <div
    v-if="mobile && !dismissed"
    class="order-push-settings"
    data-testid="mobile-notification-settings"
  >
    <button
      class="order-push-settings__backdrop"
      type="button"
      :aria-label="t('common.close')"
      @click="dismissed = true"
    />
    <aside
      ref="mobileSheet"
      class="order-push-settings__sheet"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="'order-push-settings-title'"
    >
      <header class="order-push-settings__header">
        <div>
          <strong id="order-push-settings-title">{{ t('orderPush.mobileSettings') }}</strong>
          <span>{{ t('orderPush.mobileDescription') }}</span>
        </div>
        <button
          class="order-push-settings__close"
          type="button"
          :aria-label="t('common.close')"
          @click="dismissed = true"
        ><X :size="21" aria-hidden="true" /></button>
      </header>

      <section class="order-push-settings__row">
        <span class="order-push-settings__icon" aria-hidden="true"><BellRing :size="21" /></span>
        <div class="order-push-settings__copy">
          <strong>{{ t('orderPush.mobileOrderAlerts') }}</strong>
          <span>{{ t(enabled ? 'orderPush.mobileOn' : 'orderPush.mobileOff') }}</span>
        </div>
        <button
          class="order-push-settings__switch"
          :class="{
            'is-on': enabled,
            'is-working': push.working.value,
            'is-error': push.state.value === 'error',
          }"
          type="button"
          role="switch"
          data-testid="mobile-notification-switch"
          :aria-checked="enabled"
          :aria-busy="push.working.value"
          :aria-label="t(enabled ? 'orderPush.disable' : 'orderPush.enable')"
          :disabled="switchDisabled"
          @click="toggleNotifications"
        ><span aria-hidden="true" /></button>
      </section>

      <p
        v-if="push.state.value !== 'enabled' && push.state.value !== 'disabled'"
        class="order-push-settings__message"
        :class="{ 'is-error': push.state.value === 'error' || push.state.value === 'denied' }"
        role="status"
      >{{ t(push.state.value === 'checking' ? 'orderPush.working' : messageKey) }}</p>
    </aside>
  </div>

  <aside
    v-else-if="!dismissed && push.state.value !== 'checking' && push.state.value !== 'unsupported'"
    class="order-push-control"
    :class="{ 'order-push-control--enabled': push.state.value === 'enabled' }"
    role="status"
  >
    <BellRing :size="19" aria-hidden="true" />
    <div class="order-push-control__copy">
      <strong>{{ t(push.state.value === 'enabled' ? 'orderPush.enabled' : 'orderPush.title') }}</strong>
      <span v-if="push.state.value !== 'enabled'">{{ t(messageKey) }}</span>
    </div>
    <button
      v-if="push.state.value === 'disabled' || push.state.value === 'error'"
      class="order-push-control__action"
      type="button"
      :disabled="push.working.value"
      @click="turnOn"
    >{{ t(push.working.value ? 'orderPush.working' : push.state.value === 'error' ? 'orderPush.retry' : 'orderPush.enable') }}</button>
    <button
      v-else-if="push.state.value === 'enabled'"
      class="order-push-control__secondary"
      type="button"
      :disabled="push.working.value"
      @click="push.disable"
    >{{ t('orderPush.disable') }}</button>
    <button
      class="order-push-control__close"
      type="button"
      :aria-label="t('common.close')"
      @click="dismissed = true"
    ><X :size="16" aria-hidden="true" /></button>
  </aside>
</template>

<style scoped>
/* finesse · component: notification settings switch · register=product
 * states: default · hover · focus-visible · active · disabled · loading · error · success
 * tokens: inherited (mobile-v2.css) */
.order-push-settings {
  position: fixed;
  z-index: var(--mobile-v2-layer-dialog);
  inset: 0;
  display: grid;
  align-items: end;
}
.order-push-settings__backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: var(--mobile-v2-overlay);
}
.order-push-settings__sheet {
  position: relative;
  width: min(100%, 540px);
  margin: 0 auto;
  padding: 8px 16px calc(18px + env(safe-area-inset-bottom));
  border: 1px solid var(--mobile-v2-line);
  border-bottom: 0;
  border-radius: 20px 20px 0 0;
  color: var(--mobile-v2-text);
  background: var(--mobile-v2-surface);
  box-shadow: var(--mobile-v2-shadow-float);
}
.order-push-settings__sheet::before {
  display: block;
  width: 38px;
  height: 4px;
  margin: 0 auto 6px;
  border-radius: 999px;
  background: var(--mobile-v2-line-strong);
  content: '';
}
.order-push-settings__header {
  display: flex;
  min-height: 64px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.order-push-settings__header > div { display: grid; min-width: 0; gap: 3px; }
.order-push-settings__header strong { font-size: 19px; font-weight: 850; letter-spacing: -.02em; }
.order-push-settings__header span { color: var(--mobile-v2-muted); font-size: 12px; line-height: 1.45; }
.order-push-settings__close {
  display: grid;
  flex: none;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 0;
  border-radius: var(--mobile-v2-radius-control);
  color: var(--mobile-v2-muted);
  background: transparent;
  cursor: pointer;
}
.order-push-settings__row {
  display: grid;
  min-height: 76px;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--mobile-v2-line);
  border-radius: var(--mobile-v2-radius-card);
  background: var(--mobile-v2-surface-raised);
}
.order-push-settings__icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: var(--mobile-v2-radius-control);
  color: var(--mobile-v2-green-strong);
  background: var(--mobile-v2-green-soft);
}
.order-push-settings__copy { display: grid; min-width: 0; gap: 4px; }
.order-push-settings__copy strong { font-size: 15px; font-weight: 800; }
.order-push-settings__copy span { color: var(--mobile-v2-muted); font-size: 12px; line-height: 1.4; }
.order-push-settings__switch {
  position: relative;
  width: 52px;
  height: 32px;
  flex: none;
  padding: 3px;
  border: 1px solid transparent;
  border-radius: 999px;
  outline: 2px solid transparent;
  outline-offset: 2px;
  background: var(--mobile-v2-line-strong);
  cursor: pointer;
  transition: background-color 160ms ease;
}
.order-push-settings__switch > span {
  display: block;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--mobile-v2-surface);
  box-shadow: var(--mobile-v2-shadow-soft);
  transition: transform 160ms var(--mobile-v2-ease-out);
}
.order-push-settings__switch.is-on { background: var(--mobile-v2-green); }
.order-push-settings__switch.is-on > span { transform: translateX(20px); }
.order-push-settings__switch.is-error { background: var(--mobile-v2-red); }
.order-push-settings__switch:focus-visible,
.order-push-settings__close:focus-visible { outline: 3px solid var(--mobile-v2-focus); outline-offset: 2px; }
.order-push-settings__switch:active > span { transform: scale(.92); }
.order-push-settings__switch.is-on:active > span { transform: translateX(20px) scale(.92); }
.order-push-settings__switch:disabled { opacity: .52; cursor: not-allowed; }
.order-push-settings__switch.is-working > span { animation: notification-switch-working 800ms ease-in-out infinite alternate; }
.order-push-settings__message {
  margin: 10px 4px 0;
  padding: 10px 12px;
  border-radius: var(--mobile-v2-radius-small);
  color: var(--mobile-v2-amber);
  background: var(--mobile-v2-amber-soft);
  font-size: 12px;
  line-height: 1.5;
}
.order-push-settings__message.is-error { color: var(--mobile-v2-red); background: var(--mobile-v2-red-soft); }
@media (hover: hover) {
  .order-push-settings__close:hover { color: var(--mobile-v2-text); background: var(--mobile-v2-surface-muted); }
  .order-push-settings__switch:not(:disabled):hover { filter: brightness(.96); }
}
@keyframes notification-switch-working {
  from { opacity: .58; }
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .order-push-settings__switch,
  .order-push-settings__switch > span { transition: none; }
  .order-push-settings__switch.is-working > span { animation: none; }
}

.order-push-control {
  position: fixed;
  z-index: 82;
  top: calc(88px + env(safe-area-inset-top));
  right: 16px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: min(360px, calc(100vw - 32px));
  padding: 14px;
  border: 1px solid #cfe6d8;
  border-radius: 16px;
  color: #204231;
  background: #f6fff8;
  box-shadow: 0 14px 36px rgb(7 38 22 / 17%);
}
.order-push-control--enabled { align-items: center; padding: 9px 12px; }
.order-push-control__copy { display: grid; flex: 1; gap: 3px; font-size: 12px; line-height: 1.4; }
.order-push-control__copy strong { font-size: 13px; }
.order-push-control__action,
.order-push-control__secondary {
  align-self: center;
  flex: none;
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  color: #fff;
  background: #20794a;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}
.order-push-control__secondary { color: #296143; background: #e7f5eb; }
.order-push-control__close {
  display: grid;
  flex: none;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  color: #557363;
  background: transparent;
}
@media (max-width: 899px) {
  .order-push-control { top: calc(72px + env(safe-area-inset-top)); right: 10px; width: min(350px, calc(100vw - 20px)); }
  .order-push-control__close { width: 44px; height: 44px; }
}
</style>
