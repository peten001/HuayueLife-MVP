import { ref } from 'vue';
import { defineStore } from 'pinia';
import { cashierStorageKeys } from '@/config';
import { t, useI18n } from '@/i18n';

export const useSoundStore = defineStore('cashier-sound', () => {
  const enabled = ref(false);
  const unlocked = ref(false);
  const supported = ref(typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window));
  const lastError = ref('');
  const lastNotifiedOrderIds = ref<string[]>([]);
  const initializedMerchants = new Set<string>();
  let audioContext: AudioContext | null = null;

  async function enable() {
    lastError.value = '';
    try {
      const context = getAudioContext();
      if (!context) throw new Error('Web Audio is not supported');
      if (context.state === 'suspended') await context.resume();
      playBeep(context, 0.08, 0.12);
      unlocked.value = context.state === 'running';
      enabled.value = unlocked.value;
      return enabled.value;
    } catch (error) {
      enabled.value = false;
      unlocked.value = false;
      lastError.value = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  function disable() {
    enabled.value = false;
  }

  function notifyNewOrders(orderIds: string[], merchantId: string) {
    const current = [...new Set(orderIds.filter(Boolean))].slice(0, 100);
    const previous = new Set(readSnapshot(merchantId));
    const firstObservation = !initializedMerchants.has(merchantId);
    initializedMerchants.add(merchantId);
    persistSnapshot(merchantId, current);
    if (firstObservation) return [];

    const newIds = current.filter((id) => !previous.has(id));
    lastNotifiedOrderIds.value = newIds;
    if (newIds.length && enabled.value && unlocked.value) {
      const context = getAudioContext();
      if (context?.state === 'running') playBeep(context, 0.2, 0.32);
      speakNewOrderMessage();
    }
    return newIds;
  }

  function resetMerchant(merchantId?: string) {
    lastNotifiedOrderIds.value = [];
    if (merchantId) initializedMerchants.delete(merchantId);
    else initializedMerchants.clear();
  }

  function speakNewOrderMessage() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      const { locale } = useI18n();
      const utterance = new SpeechSynthesisUtterance(t('sound.newOrderSpeech'));
      utterance.lang = locale.value === 'zh' ? 'zh-CN' : locale.value === 'vi' ? 'vi-VN' : 'en-US';
      utterance.rate = 0.92;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error);
    }
  }

  function getAudioContext() {
    if (audioContext) return audioContext;
    if (typeof window === 'undefined') return null;
    const Context = window.AudioContext ?? window.webkitAudioContext;
    audioContext = Context ? new Context() : null;
    supported.value = Boolean(audioContext);
    return audioContext;
  }

  return {
    enabled,
    unlocked,
    supported,
    lastError,
    lastNotifiedOrderIds,
    enable,
    disable,
    notifyNewOrders,
    resetMerchant,
  };
});

function playBeep(context: AudioContext, volume: number, duration: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 880;
  gain.gain.value = volume;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
}

function snapshotKey(merchantId: string) {
  return `${cashierStorageKeys.pendingOrderSnapshotPrefix}:${merchantId}`;
}

function readSnapshot(merchantId: string) {
  if (typeof window === 'undefined') return [];
  try {
    const value = window.localStorage.getItem(snapshotKey(merchantId));
    return value ? (JSON.parse(value) as string[]) : [];
  } catch {
    return [];
  }
}

function persistSnapshot(merchantId: string, ids: string[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(snapshotKey(merchantId), JSON.stringify(ids));
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
