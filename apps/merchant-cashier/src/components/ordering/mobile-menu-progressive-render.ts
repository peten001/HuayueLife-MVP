export const MOBILE_MENU_MINIMUM_INITIAL_COUNT = 20;
export const MOBILE_MENU_RENDER_CHUNK_SIZE = 32;

interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining: () => number;
}

export interface MobileMenuProgressiveRenderOptions {
  onVisibleCountChange: (count: number) => void;
  onFirstPaint?: () => void;
  chunkSize?: number;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (id: number) => void;
  setTimeout?: (callback: () => void, delayMs: number) => number;
  clearTimeout?: (id: number) => void;
}

export function mobileMenuInitialRenderCount(eagerImageCount: number) {
  return Math.max(MOBILE_MENU_MINIMUM_INITIAL_COUNT, eagerImageCount);
}

export function createMobileMenuProgressiveRender(
  options: MobileMenuProgressiveRenderOptions,
) {
  const requestFrame = options.requestAnimationFrame
    ?? window.requestAnimationFrame.bind(window);
  const cancelFrame = options.cancelAnimationFrame
    ?? window.cancelAnimationFrame.bind(window);
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
  const chunkSize = Math.max(1, options.chunkSize ?? MOBILE_MENU_RENDER_CHUNK_SIZE);
  let generation = 0;
  let totalCount = 0;
  let visibleCount = 0;
  let firstFrameId: number | undefined;
  let secondFrameId: number | undefined;
  let idleId: number | undefined;
  let timeoutId: number | undefined;

  function cancelScheduledWork() {
    if (firstFrameId !== undefined) cancelFrame(firstFrameId);
    if (secondFrameId !== undefined) cancelFrame(secondFrameId);
    if (idleId !== undefined && cancelIdle) cancelIdle(idleId);
    if (timeoutId !== undefined) cancelTimeout(timeoutId);
    firstFrameId = undefined;
    secondFrameId = undefined;
    idleId = undefined;
    timeoutId = undefined;
  }

  function setVisibleCount(count: number) {
    visibleCount = Math.min(totalCount, Math.max(0, count));
    options.onVisibleCountChange(visibleCount);
  }

  function scheduleRemaining(expectedGeneration: number) {
    if (expectedGeneration !== generation || visibleCount >= totalCount) return;
    if (requestIdle) {
      idleId = requestIdle(() => appendChunk(expectedGeneration), { timeout: 120 });
    } else {
      timeoutId = scheduleTimeout(() => appendChunk(expectedGeneration), 0);
    }
  }

  function appendChunk(expectedGeneration: number) {
    idleId = undefined;
    timeoutId = undefined;
    if (expectedGeneration !== generation || visibleCount >= totalCount) return;
    setVisibleCount(visibleCount + chunkSize);
    scheduleRemaining(expectedGeneration);
  }

  function reset(next: {
    totalCount: number;
    initialCount: number;
    progressive: boolean;
  }) {
    generation += 1;
    cancelScheduledWork();
    totalCount = Math.max(0, next.totalCount);
    setVisibleCount(next.progressive ? Math.min(totalCount, next.initialCount) : totalCount);
    const expectedGeneration = generation;
    firstFrameId = requestFrame(() => {
      firstFrameId = undefined;
      secondFrameId = requestFrame(() => {
        secondFrameId = undefined;
        if (expectedGeneration !== generation) return;
        options.onFirstPaint?.();
        scheduleRemaining(expectedGeneration);
      });
    });
  }

  function stop() {
    generation += 1;
    cancelScheduledWork();
  }

  return {
    reset,
    stop,
    getVisibleCount: () => visibleCount,
  };
}
