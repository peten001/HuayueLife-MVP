import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePollingTask } from './usePollingTask';

describe('single polling coordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('skips overlap, pauses while hidden, and performs one refresh when visible again', async () => {
    vi.useFakeTimers();
    const first = deferred<void>();
    const task = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const polling = usePollingTask(task, { intervalMs: 1_000, runWhenHidden: false });
    polling.start(false);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(1);
    const overlapping = polling.runNow();
    expect(task).toHaveBeenCalledTimes(1);
    first.resolve();
    await overlapping;

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(task).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(2);
    polling.stop();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
