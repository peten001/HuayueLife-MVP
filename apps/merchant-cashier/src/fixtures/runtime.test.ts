import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadRuntime(fixtureFlag: string | undefined) {
  vi.stubEnv('VITE_CASHIER_USE_FIXTURES', fixtureFlag);
  vi.resetModules();
  return import('./runtime');
}

describe('fixture runtime boundary', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is disabled when the fixture flag is absent', async () => {
    const runtime = await loadRuntime(undefined);

    expect(runtime.isDemoSessionActive()).toBe(false);
    expect(() => runtime.activateDemoSession()).toThrow('Fixture mode is disabled');
    expect(runtime.isDemoSessionActive()).toBe(false);
  });

  it.each(['false', 'TRUE', '1', 'yes'])('does not enable fixtures for %j', async (value) => {
    const runtime = await loadRuntime(value);

    expect(() => runtime.activateDemoSession()).toThrow('Fixture mode is disabled');
    expect(runtime.isDemoSessionActive()).toBe(false);
  });

  it('allows an explicitly enabled demo session and can deactivate it', async () => {
    const runtime = await loadRuntime('true');

    expect(runtime.isDemoSessionActive()).toBe(false);
    runtime.activateDemoSession();
    expect(runtime.isDemoSessionActive()).toBe(true);
    runtime.deactivateDemoSession();
    expect(runtime.isDemoSessionActive()).toBe(false);
  });
});
