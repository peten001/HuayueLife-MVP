import { afterEach, describe, expect, it, vi } from 'vitest';
import { elapsedDuration } from './view-models';

describe('elapsedDuration', () => {
  afterEach(() => vi.restoreAllMocks());

  it('clamps a server timestamp ahead of the terminal clock to zero', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-30T00:00:00.000Z'));
    expect(elapsedDuration('2026-08-30T00:00:02.000Z')).toEqual({
      abnormal: false,
      hours: 0,
      minutes: 0,
    });
  });

  it.each([
    ['5 seconds', '2026-08-29T23:59:55.000Z', 0],
    ['59 seconds', '2026-08-29T23:59:01.000Z', 0],
    ['one minute', '2026-08-29T23:59:00.000Z', 1],
    ['cross midnight', '2026-08-29T23:58:00.000Z', 2],
  ])('uses the authoritative server time for %s', (_label, openedAt, minutes) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-30T00:00:00.000Z'));
    expect(elapsedDuration(openedAt)?.minutes).toBe(minutes);
  });
});
