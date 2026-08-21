import { MerchantSettlementsService } from './merchant-settlements.service';
import {
  deliveryTwoOrdersFixture,
  session415Fixture,
  session417Fixture,
} from './__fixtures__/settlement-view.fixture';

function asPrismaRows(orders: ReturnType<typeof session415Fixture>) {
  return orders.map((order) => ({ ...order, statusLogs: [] }));
}

describe('MerchantSettlementsService', () => {
  function serviceWith(orders: ReturnType<typeof session415Fixture>) {
    const prisma = {
      merchant: {
        findUnique: jest.fn().mockResolvedValue({
          businessHours: {
            monday: ['17:00-02:00'],
            tuesday: ['17:00-02:00'],
            wednesday: ['17:00-02:00'],
            thursday: ['17:00-02:00'],
            friday: ['17:00-02:00'],
            saturday: ['17:00-02:00'],
            sunday: ['17:00-02:00'],
          },
        }),
      },
      order: {
        findMany: jest.fn().mockResolvedValue(asPrismaRows(orders)),
      },
    };
    return {
      service: new MerchantSettlementsService(prisma as never),
      prisma,
    };
  }

  it('paginates after aggregation so a 5-order session never splits across pages', async () => {
    const { service } = serviceWith([
      ...session415Fixture(),
      ...session417Fixture(),
      ...deliveryTwoOrdersFixture(),
    ]);
    const page1 = await service.list(11n, { page: 1, pageSize: 2 });
    expect(page1.total).toBe(4);
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    const grouped = page1.items.find((item) => item.settlementId === 'session:417');
    expect(grouped?.orderCount).toBe(5);
    expect(grouped?.itemQuantity).toBe(12);

    const page2 = await service.list(11n, { page: 2, pageSize: 2 });
    expect(page2.items).toHaveLength(2);
    expect(page2.hasMore).toBe(false);
    const ids = [...page1.items, ...page2.items].map((item) => item.settlementId);
    expect(ids).toContain('session:417');
    expect(new Set(ids).size).toBe(4);
  });

  it('finds the grouped settlement when searching any child orderNo', async () => {
    const { service } = serviceWith(session415Fixture());
    const result = await service.list(11n, { search: 'hy-test-632' });
    expect(result.total).toBe(1);
    expect(result.items[0]!.settlementId).toBe('session:415');
    expect(result.items[0]!.orderCount).toBe(3);
  });

  it('finds the grouped settlement when searching a child order id', async () => {
    const { service } = serviceWith(session415Fixture());
    const result = await service.list(11n, { search: '632' });
    expect(result.total).toBe(1);
    expect(result.items[0]!.settlementId).toBe('session:415');
  });

  it('filters settlements by their canonical business date', async () => {
    const { service } = serviceWith(session415Fixture());
    const result = await service.list(11n, { date: '2026-08-17' });
    expect(result.total).toBe(1);
    const empty = await service.list(11n, { date: '2026-08-18' });
    expect(empty.total).toBe(0);
  });

  it('returns a full settlement detail with all child items and source orders', async () => {
    const { service } = serviceWith(session417Fixture());
    const detail = await service.get(11n, 'session:417');
    expect(detail.orderCount).toBe(5);
    expect(detail.itemQuantity).toBe(12);
    expect(detail.sourceOrders).toHaveLength(5);
    expect(detail.originalAmountVnd).toBe('1458000');
    expect(detail.finalReceivableVnd).toBe('1450000');
  });

  it('scopes every query to the authenticated merchant', async () => {
    const { service, prisma } = serviceWith(session415Fixture());
    await service.list(11n, { page: 1, pageSize: 10 });
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ merchantId: 11n }),
      }),
    );
  });
});
