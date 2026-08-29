export interface CatalogPrefetchCoordinatorOptions {
  prefetch: () => Promise<unknown>;
  isVisible?: () => boolean;
  idleTimeoutMs?: number;
  fallbackDelayMs?: number;
  requestIdleCallback?: (
    callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (id: number) => void;
  setTimeout?: (callback: () => void, delayMs: number) => number;
  clearTimeout?: (id: number) => void;
}

export function createCatalogPrefetchCoordinator(options: CatalogPrefetchCoordinatorOptions) {
  const isVisible = options.isVisible ?? (() => document.visibilityState !== 'hidden');
  const requestIdle = options.requestIdleCallback
    ?? (typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback.bind(window)
      : undefined);
  const cancelIdle = options.cancelIdleCallback
    ?? (typeof window.cancelIdleCallback === 'function'
      ? window.cancelIdleCallback.bind(window)
      : undefined);
  const scheduleTimeout = options.setTimeout ?? window.setTimeout.bind(window);
  const cancelTimeout = options.clearTimeout ?? window.clearTimeout.bind(window);
  let ready = false;
  let stopped = false;
  let scheduled = false;
  let idleId: number | undefined;
  let timeoutId: number | undefined;

  function markReady() {
    ready = true;
    return schedule();
  }

  function schedule() {
    if (!ready || stopped || scheduled || !isVisible()) return false;
    scheduled = true;
    if (requestIdle) {
      idleId = requestIdle(run, { timeout: options.idleTimeoutMs ?? 1_200 });
    } else {
      timeoutId = scheduleTimeout(run, options.fallbackDelayMs ?? 250);
    }
    return true;
  }

  function handleVisibilityChange() {
    if (isVisible()) schedule();
  }

  function stop() {
    stopped = true;
    ready = false;
    scheduled = false;
    if (idleId !== undefined && cancelIdle) cancelIdle(idleId);
    if (timeoutId !== undefined) cancelTimeout(timeoutId);
    idleId = undefined;
    timeoutId = undefined;
  }

  function run() {
    scheduled = false;
    idleId = undefined;
    timeoutId = undefined;
    if (stopped || !ready || !isVisible()) return;
    void options.prefetch().catch(() => undefined);
  }

  return {
    markReady,
    schedule,
    handleVisibilityChange,
    stop,
  };
}
