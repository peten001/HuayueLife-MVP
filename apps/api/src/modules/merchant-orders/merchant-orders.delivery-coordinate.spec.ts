import { Prisma } from '@prisma/client';
import { serializeApiSuccessResponse } from '../../common/utils/api-success-response';
import { MerchantOrdersService } from './merchant-orders.service';

const order = {
  id: 41n,
  merchantId: 7n,
  orderType: 'DELIVERY',
  orderNo: 'HY-DELIVERY-LOCATION',
  createdAt: new Date('2026-10-25T02:00:00Z'),
  readyAt: null,
  deliveryAddress: 'Cổng bắc, tòa nhà 3',
  deliveryLatitude: new Prisma.Decimal('21.2812345'),
  deliveryLongitude: new Prisma.Decimal('106.1971234'),
};

function harness(rows: unknown[]) {
  const prisma = { order: {
    findFirst: jest.fn().mockResolvedValue(rows[0]),
    findMany: jest.fn().mockResolvedValue(rows),
  } };
  return { prisma, service: new MerchantOrdersService(
    prisma as never, {} as never, {} as never, {} as never, {} as never,
  ) };
}

describe('merchant delivery coordinates in the actual success envelope', () => {
  it('returns decimal coordinate strings from detail without changing the stored values or address', async () => {
    const { service, prisma } = harness([order]);
    const result = await service.get(7n, 41n);
    const response = JSON.parse(serializeApiSuccessResponse(result, 'location-detail'));
    expect(response.data).toMatchObject({
      deliveryAddress: order.deliveryAddress,
      deliveryLatitude: '21.2812345', deliveryLongitude: '106.1971234',
    });
    expect(order.deliveryLatitude).toBeInstanceOf(Prisma.Decimal);
    expect(prisma.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ merchantId: 7n, id: 41n }),
    }));
  });

  it('keeps list coordinates usable and retains null when an order has no selected point', async () => {
    const { service } = harness([order, {
      ...order, id: 42n, deliveryLatitude: null, deliveryLongitude: null,
    }]);
    const response = JSON.parse(serializeApiSuccessResponse(
      await service.list(7n, { orderType: 'DELIVERY' }), 'location-list',
    ));
    expect(response.data.map((item: Record<string, unknown>) => [
      item.deliveryLatitude, item.deliveryLongitude,
    ])).toEqual([['21.2812345', '106.1971234'], [null, null]]);
  });
});
