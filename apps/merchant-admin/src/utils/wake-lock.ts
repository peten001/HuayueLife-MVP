import { computed, ref } from 'vue';

let wakeLock: WakeLockSentinel | null = null;
let visibilityListenerAttached = false;
let autoModeStarted = false;
const wakeLockDebugState = ref<'active' | 'inactive' | 'unknown'>('unknown');

export const wakeLockDebugStatus = computed(() => wakeLockDebugState.value);

function isSupported() {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

function attachVisibilityListener() {
  if (visibilityListenerAttached || typeof document === 'undefined') return;
  visibilityListenerAttached = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && autoModeStarted) {
      void ensureWakeLock('visibilitychange');
    }
  });
}

export async function startAutoWakeLock() {
  autoModeStarted = true;
  attachVisibilityListener();
  await ensureWakeLock('auto-start');
}

export async function stopAutoWakeLock() {
  autoModeStarted = false;
  await releaseScreenWakeLock();
}

export async function requestWakeLockOnce(reason?: string) {
  return ensureWakeLock(reason);
}

export async function ensureWakeLock(reason?: string) {
  void reason;
  attachVisibilityListener();
  if (!isSupported()) {
    wakeLockDebugState.value = 'unknown';
    return false;
  }
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return false;
  }
  if (wakeLock) {
    return true;
  }

  try {
    const sentinel = await navigator.wakeLock.request('screen');
    wakeLock = sentinel;
    wakeLockDebugState.value = 'active';
    sentinel.addEventListener('release', () => {
      if (wakeLock === sentinel) {
        wakeLock = null;
      }
      wakeLockDebugState.value = 'inactive';
      if (autoModeStarted && document.visibilityState === 'visible') {
        void ensureWakeLock('release');
      }
    });
    return true;
  } catch (error) {
    wakeLockDebugState.value = 'inactive';
    return false;
  }
}

async function releaseScreenWakeLock() {
  if (!wakeLock) return;
  try {
    await wakeLock.release();
  } catch (error) {
    wakeLockDebugState.value = 'inactive';
  } finally {
    wakeLock = null;
    wakeLockDebugState.value = 'inactive';
  }
}
