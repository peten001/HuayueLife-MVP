import { afterEach, describe, expect, it, vi } from 'vitest';

describe('fixture repository WebView compatibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('imports and clones fixture data when structuredClone is unavailable', async () => {
    vi.stubGlobal('structuredClone', undefined);
    vi.resetModules();

    const { demoRepository, resetDemoRepository } = await import('./repository');
    resetDemoRepository();

    const firstRead = demoRepository.orders();
    const originalOrderNo = firstRead[0]?.orderNo;
    if (firstRead[0]) firstRead[0].orderNo = 'MUTATED-OUTSIDE-REPOSITORY';

    expect(demoRepository.orders()[0]?.orderNo).toBe(originalOrderNo);
    expect(demoRepository.openSessions()[0]?.openedAt).toBeTruthy();
  });
});
