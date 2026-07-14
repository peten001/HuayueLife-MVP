import { ref } from 'vue';
import { defineStore } from 'pinia';

export type DetailKind = 'order' | 'table' | null;
export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface CashierToast {
  id: number;
  message: string;
  tone: ToastTone;
}

export const useUiStore = defineStore('cashier-ui', () => {
  const detailOpen = ref(false);
  const detailKind = ref<DetailKind>(null);
  const detailId = ref('');
  const toasts = ref<CashierToast[]>([]);
  let nextToastId = 1;

  function openDetail(kind: Exclude<DetailKind, null>, id: string) {
    detailKind.value = kind;
    detailId.value = id;
    detailOpen.value = true;
  }

  function closeDetail() {
    detailOpen.value = false;
    detailKind.value = null;
    detailId.value = '';
  }

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
    detailOpen,
    detailKind,
    detailId,
    toasts,
    openDetail,
    closeDetail,
    pushToast,
    dismissToast,
    clearToasts,
  };
});
