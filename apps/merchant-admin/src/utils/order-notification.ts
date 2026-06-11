import { computed, ref } from 'vue';

const STORAGE_KEY = 'huayue_merchant_order_sound_enabled';

const soundEnabled = ref(readSoundPreference());
const pendingOrderIds = ref<string[]>([]);
const initialized = ref(false);
let knownPendingIds = new Set<string>();

export const pendingOrderCount = computed(() => pendingOrderIds.value.length);

export function isOrderSoundEnabled() {
  return soundEnabled.value;
}

export async function enableOrderSound() {
  setOrderSoundEnabled(true);
  await beep(0.05);
}

export function disableOrderSound() {
  setOrderSoundEnabled(false);
}

export function toggleOrderSound() {
  setOrderSoundEnabled(!soundEnabled.value);
}

export function notifyNewPendingOrders(ids: string[]) {
  const current = unique(ids);
  const currentSet = new Set(current);
  const newIds = initialized.value
    ? current.filter((id) => !knownPendingIds.has(id))
    : [];
  pendingOrderIds.value = current;
  knownPendingIds = currentSet;
  initialized.value = true;
  if (soundEnabled.value && newIds.length) {
    void beep(0.25);
  }
  return newIds;
}

async function beep(duration: number) {
  const AudioContextClass =
    window.AudioContext ||
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;
  if (!AudioContextClass) return;

  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 880;
  gain.gain.value = 0.12;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
  oscillator.addEventListener('ended', () => void context.close());
}

function unique(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

function setOrderSoundEnabled(value: boolean) {
  soundEnabled.value = value;
  persistSoundPreference(value);
}

function readSoundPreference() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY) === '1';
}

function persistSoundPreference(value: boolean) {
  if (typeof window === 'undefined') return;
  if (value) {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
