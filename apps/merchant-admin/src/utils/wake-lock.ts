let wakeLock: WakeLockSentinel | null = null;
let visibilityListenerAttached = false;
let autoModeStarted = false;
const AUTO_REASONS = new Set(['auto-start', 'visibilitychange', 'release']);

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
  console.log('[wake-lock] auto start');
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
  attachVisibilityListener();
  if (reason && !AUTO_REASONS.has(reason)) {
    console.log('[wake-lock] request from user gesture', reason);
  }
  if (!isSupported()) {
    console.warn('[wake-lock] unsupported', reason);
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
    console.log('[wake-lock] active', reason);
    sentinel.addEventListener('release', () => {
      if (wakeLock === sentinel) {
        wakeLock = null;
      }
      console.log('[wake-lock] released');
      if (autoModeStarted && document.visibilityState === 'visible') {
        void ensureWakeLock('release');
      }
    });
    return true;
  } catch (error) {
    console.warn('[wake-lock] request failed', reason, error);
    return false;
  }
}

async function releaseScreenWakeLock() {
  if (!wakeLock) return;
  try {
    await wakeLock.release();
  } catch (error) {
    console.warn('[wake-lock] release failed', error);
  } finally {
    wakeLock = null;
  }
}
