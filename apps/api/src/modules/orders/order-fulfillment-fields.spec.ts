import { MerchantOrdersService } from '../merchant-orders/merchant-orders.service';
import { OrdersService } from './orders.service';
import {
  pickupFulfillmentFields,
  withPickupFulfillmentFields,
} from './order-fulfillment-fields';

describe('pickup fulfillment fields', () => {
  const createdAt = new Date('2026-07-24T08:00:00.000Z');

  it('derives a stable four-character code and a 30-minute estimate', () => {
    const result = pickupFulfillmentFields({
      orderType: 'PICKUP',
      orderNo: 'HY-20260724-A9f2',
      createdAt,
      readyAt: null,
    });

    expect(result).toEqual({
      pickupCode: 'A9F2',
      estimatedReadyAt: new Date('2026-07-24T08:30:00.000Z'),
    });
  });

  it('uses the actual ready time once it exists', () => {
    const readyAt = new Date('2026-07-24T08:17:00.000Z');
    const result = pickupFulfillmentFields({
      orderType: 'PICKUP',
      orderNo: 'HY202607240188',
      createdAt,
      readyAt,
    });

    expect(result?.estimatedReadyAt).toEqual(readyAt);
    expect(result?.estimatedReadyAt).not.toBe(readyAt);
  });

  it('does not add pickup fields to non-pickup orders', () => {
    const source = {
      orderType: 'DELIVERY' as const,
      orderNo: 'HY202607240188',
      createdAt,
      readyAt: null,
    };
    const result = withPickupFulfillmentFields(source);

    expect(result).toBe(source);
    expect(result).not.toHaveProperty('pickupCode');
    expect(result).not.toHaveProperty('estimatedReadyAt');
  });

  it('projects identical pickup fields from customer and merchant list/detail APIs', async () => {
    const pickup = {
      id: 19n,
      createdByStaffId: null,
      orderType: 'PICKUP' as const,
      orderNo: 'HY20260724BC31',
      createdAt,
      readyAt: null,
    };
    const customerPrisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([pickup]),
        findFirst: jest.fn().mockResolvedValue(pickup),
      },
    };
    const merchantPrisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([pickup]),
        findFirst: jest.fn().mockResolvedValue(pickup),
      },
    };
    const customerService = new OrdersService(
      customerPrisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const merchantService = new MerchantOrdersService(
      merchantPrisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const [customerOrders, merchantOrders, customerDetail, merchantDetail] =
      await Promise.all([
        customerService.list(37n),
        merchantService.list(7n, {}),
        customerService.get(37n, 19n),
        merchantService.get(7n, 19n),
      ]);

    const expectedFields = {
      pickupCode: 'BC31',
      estimatedReadyAt: new Date('2026-07-24T08:30:00.000Z'),
    };
    for (const projected of [
      customerOrders[0],
      merchantOrders[0],
      customerDetail,
      merchantDetail,
    ]) {
      expect(projected).toEqual(expect.objectContaining(expectedFields));
    }
  });
});
