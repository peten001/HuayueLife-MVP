import { computed, ref } from 'vue';

const STORAGE_KEY = 'huayue_merchant_screen_wake_lock_enabled';

const isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

const preferredEnabled = ref(readPreference());
const active = ref(false);
const supported = ref(isSupported);

let wakeLock: WakeLockSentinel | null = null;
let listenersAttached = false;

export const screenWakeLockSupported = computed(() => supported.value);
export const screenWakeLockEnabled = computed(() => preferredEnabled.value);
export const screenWakeLockActive = computed(() => active.value);
export const screenWakeLockLabel = computed(() => {
  if (!supported.value) return '当前浏览器不支持屏幕常亮';
  return preferredEnabled.value ? '屏幕常亮已开启' : '保持屏幕常亮';
});

export async function restoreScreenWakeLock() {
  attachListeners();
  if (!preferredEnabled.value) return false;
  return requestScreenWakeLock();
}

export async function enableScreenWakeLock() {
  attachListeners();
  preferredEnabled.value = true;
  persistPreference(true);
  return requestScreenWakeLock();
}

export async function disableScreenWakeLock() {
  attachListeners();
  preferredEnabled.value = false;
  persistPreference(false);
  await releaseScreenWakeLock();
}

export async function toggleScreenWakeLock() {
  if (!supported.value) return false;
  if (preferredEnabled.value) {
    await disableScreenWakeLock();
    return false;
  }
  return enableScreenWakeLock();
}

function attachListeners() {
  if (listenersAttached || typeof document === 'undefined') return;
  listenersAttached = true;

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && preferredEnabled.value) {
      void requestScreenWakeLock();
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleVisibilityChange);
}

async function requestScreenWakeLock() {
  attachListeners();
  if (!supported.value || typeof navigator === 'undefined' || !navigator.wakeLock) {
    active.value = false;
    supported.value = false;
    return false;
  }
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return false;
  }

  try {
    if (wakeLock) {
      try {
        await wakeLock.release();
      } catch {
        // ignore stale release errors
      }
      wakeLock = null;
    }

    const sentinel = await navigator.wakeLock.request('screen');
    wakeLock = sentinel;
    active.value = true;
    supported.value = true;
    sentinel.addEventListener('release', () => {
      if (wakeLock === sentinel) {
        wakeLock = null;
        active.value = false;
      }
    });
    return true;
  } catch {
    active.value = false;
    return false;
  }
}

async function releaseScreenWakeLock() {
  if (!wakeLock) {
    active.value = false;
    return;
  }
  try {
    await wakeLock.release();
  } catch {
    // ignore release errors
  } finally {
    wakeLock = null;
    active.value = false;
  }
}

function readPreference() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY) === '1';
}

function persistPreference(value: boolean) {
  if (typeof window === 'undefined') return;
  if (value) {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
