import { effectiveOrderWhere, isEffectiveOrder, lockEffectivePrintTarget } from './effective-order';

describe('effective order scope and print lock gate', () => {
  it('preserves existing AND and OR filters while adding both order and session exclusions', () => {
    const predicate = effectiveOrderWhere({ merchantId: 18n, AND: { status: 'COMPLETED' }, OR: [{ businessDate: null }] });
    expect(predicate.merchantId).toBe(18n);
    expect(predicate.OR).toEqual([{ businessDate: null }]);
    expect(predicate.AND).toEqual([{ status: 'COMPLETED' }, { voidedAt: null }, { OR: [{ tableSessionId: null }, { tableSession: { is: { voidedAt: null } } }] }]);
    expect(isEffectiveOrder({})).toBe(true);
    expect(isEffectiveOrder({ voidedAt: new Date() })).toBe(false);
    expect(isEffectiveOrder({ tableSession: { voidedAt: new Date() } })).toBe(false);
  });
  it('locks session before order and refuses a changed parent after the locking read', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValueOnce([{ table_session_id: 41n }])
      .mockResolvedValueOnce([{ voided_at: null }]).mockResolvedValueOnce([{ voided_at: null, table_session_id: 42n }]) };
    await expect(lockEffectivePrintTarget(tx as never, 18n, { orderId: 1n })).rejects.toMatchObject({ response: { code: 'VOID_SCOPE_CONFLICT' } });
    expect(tx.$queryRaw.mock.calls[1][0].join('')).toContain('FROM table_sessions');
    expect(tx.$queryRaw.mock.calls[2][0].join('')).toContain('FROM orders');
  });
  it('fails closed on a voided parent even if a child marker is missing', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValueOnce([{ table_session_id: 41n }])
      .mockResolvedValueOnce([{ voided_at: new Date() }]) };
    await expect(lockEffectivePrintTarget(tx as never, 18n, { orderId: 1n })).rejects.toMatchObject({ response: { code: 'ORDER_VOIDED' } });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
