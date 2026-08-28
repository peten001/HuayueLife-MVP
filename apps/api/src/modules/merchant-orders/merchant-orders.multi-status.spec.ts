import { MerchantOrdersService } from './merchant-orders.service';

describe('MerchantOrdersService multi-status list', () => {
  it('uses one status IN query while preserving the single-status precedence', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new MerchantOrdersService(
      { order: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.list(7n, { statuses: ['ACCEPTED', 'PREPARING', 'READY'] });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        merchantId: 7n,
        status: { in: ['ACCEPTED', 'PREPARING', 'READY'] },
      }),
    }));

    await service.list(7n, { status: 'READY', statuses: ['ACCEPTED'] });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'READY' }),
    }));
  });
});
