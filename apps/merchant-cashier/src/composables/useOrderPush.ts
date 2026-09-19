import { ref } from 'vue';
import {
  getCashierPushConfiguration,
  removeCashierPushSubscription,
  saveCashierPushSubscription,
} from '@/api';
import type { Locale } from '@/i18n';

export type OrderPushState =
  | 'checking' | 'unsupported' | 'install-required' | 'unavailable'
  | 'denied' | 'disabled' | 'enabled' | 'error';

function isIosBrowser() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function vapidKeyBytes(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes.buffer;
}

export function useOrderPush(locale: { value: Locale }) {
  const state = ref<OrderPushState>('checking');
  const working = ref(false);

  async function registration() {
    return navigator.serviceWorker.register('/cashier-push-sw.js', { scope: '/' });
  }

  async function syncSubscription(subscription: PushSubscription) {
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
      throw new Error('Invalid browser push subscription');
    }
    await saveCashierPushSubscription({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      locale: locale.value,
    });
  }

  async function refresh() {
    if (isIosBrowser() && !isStandalone()) {
      state.value = 'install-required';
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      state.value = 'unsupported';
      return;
    }
    if (Notification.permission === 'denied') {
      state.value = 'denied';
      return;
    }
    state.value = 'checking';
    try {
      const config = await getCashierPushConfiguration();
      if (!config.enabled || !config.publicKey) {
        state.value = 'unavailable';
        return;
      }
      const worker = await registration();
      const subscription = await worker.pushManager.getSubscription();
      if (subscription && Notification.permission === 'granted') {
        await syncSubscription(subscription);
        state.value = 'enabled';
      } else {
        state.value = 'disabled';
      }
    } catch {
      state.value = 'error';
    }
  }

  async function enable() {
    if (working.value || state.value === 'install-required' || state.value === 'unsupported') return;
    working.value = true;
    try {
      // On iOS the permission call must begin inside this button's user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        state.value = permission === 'denied' ? 'denied' : 'disabled';
        return;
      }
      const config = await getCashierPushConfiguration();
      if (!config.enabled || !config.publicKey) {
        state.value = 'unavailable';
        return;
      }
      const worker = await registration();
      const subscription = await worker.pushManager.getSubscription()
        ?? await worker.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyBytes(config.publicKey),
        });
      await syncSubscription(subscription);
      state.value = 'enabled';
    } catch {
      state.value = 'error';
    } finally {
      working.value = false;
    }
  }

  async function disable() {
    if (working.value || !('serviceWorker' in navigator)) return;
    working.value = true;
    try {
      const worker = await navigator.serviceWorker.getRegistration('/');
      const subscription = await worker?.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        // Local removal takes effect immediately. Server cleanup is best-effort;
        // an expired endpoint is also removed after the push provider returns 410.
        void removeCashierPushSubscription(subscription.endpoint).catch(() => undefined);
      }
      state.value = 'disabled';
    } catch {
      state.value = 'error';
    } finally {
      working.value = false;
    }
  }

  return { state, working, refresh, enable, disable };
}
