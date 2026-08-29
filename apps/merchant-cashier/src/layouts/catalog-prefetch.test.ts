import { describe, expect, it, vi } from 'vitest';

import { createCatalogPrefetchCoordinator } from './catalog-prefetch';

describe('cashier catalog background prefetch coordinator', () => {
  it('does not schedule before cashier ready and runs once from the idle callback', async () => {
    const prefetch = vi.fn().mockResolvedValue(undefined);
    let idleCallback: ((deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) | undefined;
    const coordinator = createCatalogPrefetchCoordinator({
      prefetch,
      isVisible: () => true,
      requestIdleCallback: vi.fn((callback) => {
        idleCallback = callback;
        return 1;
      }),
    });

    expect(coordinator.schedule()).toBe(false);
    expect(coordinator.markReady()).toBe(true);
    expect(coordinator.schedule()).toBe(false);
    expect(prefetch).not.toHaveBeenCalled();
    idleCallback?.({ didTimeout: false, timeRemaining: () => 10 });
    await Promise.resolve();
    expect(prefetch).toHaveBeenCalledOnce();
  });

  it('does not start while hidden and schedules one controlled prefetch when visible', async () => {
    const prefetch = vi.fn().mockResolvedValue(undefined);
    let visible = false;
    const callbacks: Array<(deadline: { didTimeout: boolean; timeRemaining: () => number }) => void> = [];
    const coordinator = createCatalogPrefetchCoordinator({
      prefetch,
      isVisible: () => visible,
      requestIdleCallback: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
    });

    expect(coordinator.markReady()).toBe(false);
    expect(callbacks).toHaveLength(0);
    visible = true;
    coordinator.handleVisibilityChange();
    coordinator.handleVisibilityChange();
    expect(callbacks).toHaveLength(1);
    callbacks[0]?.({ didTimeout: false, timeRemaining: () => 10 });
    await Promise.resolve();
    expect(prefetch).toHaveBeenCalledOnce();
  });

  it('uses the fallback delay and cancels pending work on stop', () => {
    const prefetch = vi.fn().mockResolvedValue(undefined);
    const clearTimeout = vi.fn();
    const coordinator = createCatalogPrefetchCoordinator({
      prefetch,
      isVisible: () => true,
      requestIdleCallback: undefined,
      setTimeout: vi.fn(() => 12),
      clearTimeout,
    });

    coordinator.markReady();
    coordinator.stop();
    expect(clearTimeout).toHaveBeenCalledWith(12);
    expect(prefetch).not.toHaveBeenCalled();
  });
});
