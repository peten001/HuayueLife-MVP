import { describe, expect, it, vi } from 'vitest';
import {
  createMobileMenuProgressiveRender,
  mobileMenuInitialRenderCount,
} from './mobile-menu-progressive-render';

function createSchedulerHarness() {
  const frames: FrameRequestCallback[] = [];
  const idleTasks: Array<(deadline: { didTimeout: boolean; timeRemaining: () => number }) => void> = [];
  return {
    frames,
    idleTasks,
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }),
    cancelAnimationFrame: vi.fn(),
    requestIdleCallback: vi.fn((callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void) => {
      idleTasks.push(callback);
      return idleTasks.length;
    }),
    cancelIdleCallback: vi.fn(),
  };
}

describe('mobile menu progressive first paint', () => {
  it('matches the measured first-screen image window without mounting off-screen rows', () => {
    expect(mobileMenuInitialRenderCount(20)).toBe(20);
    expect(mobileMenuInitialRenderCount(24)).toBe(24);
    expect(mobileMenuInitialRenderCount(0)).toBe(20);
  });

  it('defers only below-the-fold cards until after the first paint boundary', () => {
    const scheduler = createSchedulerHarness();
    const visibleCounts: number[] = [];
    const onFirstPaint = vi.fn();
    const progressive = createMobileMenuProgressiveRender({
      onVisibleCountChange: (count) => visibleCounts.push(count),
      onFirstPaint,
      chunkSize: 32,
      ...scheduler,
    });

    progressive.reset({ totalCount: 201, initialCount: 20, progressive: true });
    expect(visibleCounts).toEqual([20]);
    expect(scheduler.idleTasks).toHaveLength(0);

    scheduler.frames.shift()?.(0);
    expect(onFirstPaint).not.toHaveBeenCalled();
    scheduler.frames.shift()?.(16);
    expect(onFirstPaint).toHaveBeenCalledOnce();
    expect(scheduler.idleTasks).toHaveLength(1);

    while (scheduler.idleTasks.length) {
      scheduler.idleTasks.shift()?.({ didTimeout: false, timeRemaining: () => 8 });
    }
    expect(visibleCounts).toEqual([20, 52, 84, 116, 148, 180, 201]);
  });

  it('renders non-cold filtered results immediately and cancels stale scheduled work', () => {
    const scheduler = createSchedulerHarness();
    const visibleCounts: number[] = [];
    const progressive = createMobileMenuProgressiveRender({
      onVisibleCountChange: (count) => visibleCounts.push(count),
      ...scheduler,
    });

    progressive.reset({ totalCount: 201, initialCount: 20, progressive: true });
    progressive.reset({ totalCount: 7, initialCount: 20, progressive: false });
    expect(visibleCounts).toEqual([20, 7]);
    scheduler.frames.splice(0).forEach((frame) => frame(16));
    expect(scheduler.idleTasks).toHaveLength(0);
    expect(progressive.getVisibleCount()).toBe(7);
  });
});
