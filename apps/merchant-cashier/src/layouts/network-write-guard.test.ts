import { describe, expect, it, vi } from 'vitest';
import { guardNetworkWrite } from './network-write-guard';

describe('guardNetworkWrite', () => {
  it('allows writes without notifying when the network is healthy', () => {
    const notifyBlocked = vi.fn();

    expect(guardNetworkWrite(true, true, notifyBlocked)).toBe(true);
    expect(notifyBlocked).not.toHaveBeenCalled();
  });

  it('blocks writes while the device is offline', () => {
    const notifyBlocked = vi.fn();

    expect(guardNetworkWrite(false, false, notifyBlocked)).toBe(false);
    expect(notifyBlocked).toHaveBeenCalledOnce();
  });

  it('blocks writes while API reachability is still being confirmed', () => {
    const notifyBlocked = vi.fn();

    expect(guardNetworkWrite(true, null, notifyBlocked)).toBe(false);
    expect(notifyBlocked).toHaveBeenCalledOnce();
  });

  it('blocks writes when the API is known to be unreachable', () => {
    const notifyBlocked = vi.fn();

    expect(guardNetworkWrite(true, false, notifyBlocked)).toBe(false);
    expect(notifyBlocked).toHaveBeenCalledOnce();
  });
});
