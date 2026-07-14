import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { CASHIER_API_ACTIVITY_EVENT } from '@/config';
import type { ApiActivityDetail } from '@/types';

export const useNetworkStore = defineStore('cashier-network', () => {
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine);
  const apiReachable = ref<boolean | null>(null);
  const lastSuccessAt = ref<string | null>(null);
  const lastFailureAt = ref<string | null>(null);
  const lastErrorCode = ref('');
  const started = ref(false);

  const degraded = computed(() => !online.value || apiReachable.value === false);

  const refreshBrowserStatus = () => {
    online.value = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (!online.value) apiReachable.value = false;
  };

  const handleOnline = () => {
    online.value = true;
    apiReachable.value = null;
  };
  const handleOffline = () => {
    online.value = false;
    apiReachable.value = false;
    lastFailureAt.value = new Date().toISOString();
    lastErrorCode.value = 'OFFLINE';
  };
  const handleActivity = (event: Event) => {
    const detail = (event as CustomEvent<ApiActivityDetail>).detail;
    if (!detail) return;
    if (detail.status === 'success') {
      apiReachable.value = true;
      lastSuccessAt.value = detail.occurredAt;
      lastErrorCode.value = '';
      return;
    }
    lastFailureAt.value = detail.occurredAt;
    lastErrorCode.value = detail.errorCode;
    const transportFailure = ['NETWORK_ERROR', 'REQUEST_ABORTED'].includes(detail.errorCode);
    if (!detail.online || transportFailure || (detail.statusCode ?? 0) >= 500) {
      apiReachable.value = false;
    } else if ((detail.statusCode ?? 0) >= 400) {
      // A business/auth error still proves the API answered the request.
      apiReachable.value = true;
    }
  };

  function start() {
    if (started.value || typeof window === 'undefined') return;
    started.value = true;
    refreshBrowserStatus();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener(CASHIER_API_ACTIVITY_EVENT, handleActivity);
  }

  function stop() {
    if (!started.value || typeof window === 'undefined') return;
    started.value = false;
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    window.removeEventListener(CASHIER_API_ACTIVITY_EVENT, handleActivity);
  }

  return {
    online,
    apiReachable,
    lastSuccessAt,
    lastFailureAt,
    lastErrorCode,
    started,
    degraded,
    start,
    stop,
    refreshBrowserStatus,
  };
});
