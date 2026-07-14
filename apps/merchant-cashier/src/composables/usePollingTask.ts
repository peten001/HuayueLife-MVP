import { readonly, ref } from 'vue';

export interface PollingTaskOptions {
  intervalMs: number;
  runWhenHidden?: boolean;
  runWhenOffline?: boolean;
}

export function usePollingTask(
  task: () => Promise<void> | void,
  options: PollingTaskOptions,
) {
  const started = ref(false);
  const running = ref(false);
  let timer: number | undefined;
  let inFlight: Promise<void> | null = null;

  const canRun = () => {
    if (typeof document !== 'undefined' && !options.runWhenHidden && document.hidden) return false;
    if (typeof navigator !== 'undefined' && !options.runWhenOffline && !navigator.onLine) return false;
    return true;
  };

  const clearTimer = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };

  const schedule = () => {
    clearTimer();
    if (!started.value || typeof window === 'undefined') return;
    timer = window.setTimeout(invokeSafely, options.intervalMs);
  };

  const runNow = () => {
    if (!started.value || !canRun()) {
      schedule();
      return Promise.resolve();
    }
    if (inFlight) return inFlight;
    running.value = true;
    inFlight = Promise.resolve(task())
      .finally(() => {
        running.value = false;
        inFlight = null;
        schedule();
      });
    return inFlight;
  };

  // Background polling failures are exposed by the owning store. Consume the
  // rejected promise here so a transient outage does not create an unhandled
  // rejection in the browser; direct callers of runNow still receive errors.
  function invokeSafely() {
    void runNow().catch(() => undefined);
  }

  const handleVisibility = () => {
    if (!document.hidden) invokeSafely();
    else clearTimer();
  };
  const handleOnline = invokeSafely;
  const handleOffline = () => clearTimer();

  const start = (immediate = true) => {
    if (started.value || typeof window === 'undefined') return;
    started.value = true;
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (immediate) invokeSafely();
    else schedule();
  };

  const stop = () => {
    if (!started.value || typeof window === 'undefined') return;
    started.value = false;
    clearTimer();
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };

  return {
    started: readonly(started),
    running: readonly(running),
    runNow,
    start,
    stop,
  };
}
