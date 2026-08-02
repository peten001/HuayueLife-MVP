import { MerchantOrdersService } from './merchant-orders.service';

describe('MerchantOrdersService.summary', () => {
  it('returns full server-side counts and excludes cancelled order amounts', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { status: 'COMPLETED', orderType: 'DINE_IN', totalAmountVnd: 120000n, createdAt: new Date(), printLogs: [] },
      { status: 'CANCELLED', orderType: 'PICKUP', totalAmountVnd: 90000n, createdAt: new Date(), printLogs: [] },
      { status: 'PENDING_ACCEPTANCE', orderType: 'DELIVERY', totalAmountVnd: 50000n, createdAt: new Date(Date.now() - 21 * 60 * 1000), printLogs: [] },
      { status: 'COMPLETED', orderType: 'DELIVERY', totalAmountVnd: 70000n, createdAt: new Date(), printLogs: [{ status: 'FAILED' }] },
    ]);
    const service = new MerchantOrdersService(
      { order: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.summary(7n, { date: '2026-08-02' })).resolves.toEqual({
      ALL: { count: 4, amountVnd: '240000' },
      DINE_IN: { count: 1, amountVnd: '120000' },
      PICKUP: { count: 1, amountVnd: '0' },
      DELIVERY: { count: 2, amountVnd: '120000' },
      ABNORMAL: { count: 2, amountVnd: '120000' },
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ merchantId: 7n }),
    }));
  });
});
