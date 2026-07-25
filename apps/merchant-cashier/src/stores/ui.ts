import { ref } from 'vue';
import { defineStore } from 'pinia';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface CashierToast {
  id: number;
  message: string;
  tone: ToastTone;
}

export const useUiStore = defineStore('cashier-ui', () => {
  const toasts = ref<CashierToast[]>([]);
  let nextToastId = 1;

  function pushToast(message: string, tone: ToastTone = 'info', durationMs = 4_000) {
    const toast = { id: nextToastId++, message, tone };
    toasts.value.push(toast);
    if (typeof window !== 'undefined' && durationMs > 0) {
      window.setTimeout(() => dismissToast(toast.id), durationMs);
    }
    return toast.id;
  }

  function dismissToast(id: number) {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function clearToasts() {
    toasts.value = [];
  }

  return {
    toasts,
    pushToast,
    dismissToast,
    clearToasts,
  };
});
