import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { beginImmediateTableSelectionTransition } from './table-selection-transition';

describe('immediate table selection transition', () => {
  it.each(['AVAILABLE', 'IN_USE'])('presents an %s table target before delayed hydration starts', async () => {
    const events: string[] = [];
    const delayedHydration = deferred<void>();

    beginImmediateTableSelectionTransition({
      primeSelection: () => events.push('selected-table'),
      navigate: async () => { events.push('target-view-navigation-started'); },
      afterDomCommit: () => {
        events.push('hydration-started');
        return delayedHydration.promise;
      },
    });

    expect(events).toEqual(['selected-table', 'target-view-navigation-started']);
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([
      'selected-table',
      'target-view-navigation-started',
      'hydration-started',
    ]);
    delayedHydration.resolve();
  });

  it('does not await a 1500ms-equivalent network promise before presenting the target', () => {
    const presentTargetView = vi.fn();
    const neverSettlesDuringAssertion = new Promise<void>(() => undefined);

    beginImmediateTableSelectionTransition({
      primeSelection: vi.fn(),
      navigate: async () => { presentTargetView(); },
      afterDomCommit: () => neverSettlesDuringAssertion,
    });

    expect(presentTargetView).toHaveBeenCalledTimes(1);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
