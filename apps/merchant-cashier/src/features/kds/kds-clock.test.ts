import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKdsClock, kitchenWaitMinutes } from './kds-clock';

afterEach(() => vi.restoreAllMocks());
describe('kitchen waiting time', () => {
  it.each([-3600000, 3600000])('does not count a %i ms device clock difference as kitchen waiting', deviceOffset => {
    const server = Date.parse('2026-10-14T01:26:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(server + deviceOffset);
    let elapsed = 100;
    const clock = createKdsClock(() => elapsed);
    clock.synchronize(new Date(server).toISOString());
    expect(kitchenWaitMinutes('2026-10-14T01:25:50Z', clock.now())).toBe(0);
    elapsed += 60000;
    expect(kitchenWaitMinutes('2026-10-14T01:25:50Z', clock.now())).toBe(1);
    vi.mocked(Date.now).mockReturnValue(server + deviceOffset + 86400000);
    expect(kitchenWaitMinutes('2026-10-14T01:25:50Z', clock.now())).toBe(1);
  });
  it('resynchronizes from the next server response and preserves real waiting time', () => {
    let elapsed = 0;
    const clock = createKdsClock(() => elapsed);
    clock.synchronize('2026-10-14T01:26:00Z');
    expect(kitchenWaitMinutes('2026-10-14T01:10:00Z', clock.now())).toBe(16);
    elapsed = 5000;
    clock.synchronize('2026-10-14T01:27:00Z');
    elapsed += 60000;
    expect(kitchenWaitMinutes('2026-10-14T01:26:00Z', clock.now())).toBe(2);
  });
  it('avoids false overdue values before synchronization or with invalid/future timestamps', () => {
    const clock = createKdsClock(() => 0);
    expect(kitchenWaitMinutes('2026-10-14T01:26:00Z', clock.now())).toBe(0);
    expect(clock.synchronize('invalid')).toBe(false);
    clock.synchronize('2026-10-14T01:26:00Z');
    expect(kitchenWaitMinutes('invalid', clock.now())).toBe(0);
    expect(kitchenWaitMinutes('2026-10-14T02:26:00Z', clock.now())).toBe(0);
  });
});
