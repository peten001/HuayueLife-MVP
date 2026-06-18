let wakeLock: WakeLockSentinel | null = null;
let visibilityListenerAttached = false;
let autoModeStarted = false;

function isSupported() {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

function attachVisibilityListener() {
  if (visibilityListenerAttached || typeof document === 'undefined') return;
  visibilityListenerAttached = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && autoModeStarted) {
      void requestScreenWakeLock();
    }
  });
}

export async function startAutoWakeLock() {
  autoModeStarted = true;
  attachVisibilityListener();
  await requestScreenWakeLock();
}

export async function stopAutoWakeLock() {
  autoModeStarted = false;
  await releaseScreenWakeLock();
}

async function requestScreenWakeLock() {
  attachVisibilityListener();
  if (!isSupported()) {
    console.warn('[wake-lock] browser does not support screen wake lock');
    return false;
  }
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return false;
  }

  try {
    if (wakeLock) {
      await wakeLock.release().catch(() => undefined);
      wakeLock = null;
    }

    const sentinel = await navigator.wakeLock.request('screen');
    wakeLock = sentinel;
    sentinel.addEventListener('release', () => {
      if (wakeLock === sentinel) {
        wakeLock = null;
      }
      if (autoModeStarted && document.visibilityState === 'visible') {
        void requestScreenWakeLock();
      }
    });
    return true;
  } catch (error) {
    console.warn('[wake-lock] request failed', error);
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
