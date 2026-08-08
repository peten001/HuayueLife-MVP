import { ConflictException } from '@nestjs/common';
import { MerchantOrdersService } from './merchant-orders.service';

function buildHarness(overrides: Record<string, unknown> = {}) {
  const current = {
    id: 41n,
    orderType: 'PICKUP',
    orderNo: 'HY-00000041',
    status: 'PENDING_ACCEPTANCE',
    settlementStatus: 'UNSETTLED',
    itemAmountVnd: 513_000n,
    deliveryFeeVnd: 0n,
    totalAmountVnd: 513_000n,
    discountPayableRateBps: null,
    discountAmountVnd: 0n,
    discountAppliedByStaffId: null,
    discountAppliedAt: null,
    roundingAmountVnd: 0n,
    roundingAppliedByStaffId: null,
    roundingAppliedAt: null,
    updatedAt: new Date('2026-07-27T10:00:00.000Z'),
    createdAt: new Date('2026-07-27T09:00:00.000Z'),
    readyAt: null,
    statusLogs: [],
    ...overrides,
  };
  const tx = {
    order: {
      findFirst: jest.fn().mockResolvedValue(current),
      findFirstOrThrow: jest.fn().mockResolvedValue(current),
      updateMany: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(current, data);
        return { count: 1 };
      }),
    },
    orderStatusLog: { create: jest.fn().mockResolvedValue({ id: 77n }) },
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const service = new MerchantOrdersService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { current, tx, service };
}

describe('MerchantOrdersService pickup rounding', () => {
  it('applies 513,000 VND to 510,000 VND using the shared algorithm', async () => {
    const { tx, service } = buildHarness();

    const result = await service.setRounding(7n, 11n, 41n, true);

    expect(result).toMatchObject({
      originalAmountVnd: 513_000n,
      roundingAmountVnd: 3_000n,
      payableAmountVnd: 510_000n,
      roundingApplied: true,
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 41n,
        orderType: 'PICKUP',
        settlementStatus: 'UNSETTLED',
      }),
      data: expect.objectContaining({
        roundingAmountVnd: 3_000n,
        roundingAppliedByStaffId: 11n,
      }),
    });
    expect(tx.orderStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PICKUP_ORDER_ROUNDING_APPLIED',
        operatorStaffId: 11n,
      }),
    });
  });

  it('cancels rounding and restores the original amount', async () => {
    const { tx, service } = buildHarness({
      roundingAmountVnd: 3_000n,
      roundingAppliedByStaffId: 11n,
      roundingAppliedAt: new Date('2026-07-27T10:01:00.000Z'),
    });

    const result = await service.setRounding(7n, 11n, 41n, false);

    expect(result).toMatchObject({
      originalAmountVnd: 513_000n,
      roundingAmountVnd: 0n,
      payableAmountVnd: 513_000n,
      roundingApplied: false,
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 41n }),
      data: {
        roundingAmountVnd: 0n,
        roundingAppliedByStaffId: null,
        roundingAppliedAt: null,
      },
    });
  });

  it('is idempotent for repeated apply and cancel requests', async () => {
    const applied = buildHarness({
      roundingAmountVnd: 3_000n,
      roundingAppliedByStaffId: 11n,
      roundingAppliedAt: new Date('2026-07-27T10:01:00.000Z'),
    });
    await applied.service.setRounding(7n, 11n, 41n, true);
    expect(applied.tx.order.updateMany).not.toHaveBeenCalled();
    expect(applied.tx.orderStatusLog.create).not.toHaveBeenCalled();

    const cancelled = buildHarness();
    await cancelled.service.setRounding(7n, 11n, 41n, false);
    expect(cancelled.tx.order.updateMany).not.toHaveBeenCalled();
    expect(cancelled.tx.orderStatusLog.create).not.toHaveBeenCalled();
  });

  it.each(['ACCEPTED', 'PREPARING', 'READY'])(
    'allows %s pickup orders',
    async (status) => {
      const { service } = buildHarness({ status });
      await expect(service.setRounding(7n, 11n, 41n, true)).resolves.toMatchObject({
        roundingApplied: true,
      });
    },
  );

  it.each(['COMPLETED', 'CANCELLED', 'REJECTED'])(
    'rejects %s orders',
    async (status) => {
      const { service } = buildHarness({ status });
      await expect(service.setRounding(7n, 11n, 41n, true)).rejects.toBeInstanceOf(
        ConflictException,
      );
    },
  );

  it('allows an unsettled delivery order through DELIVERING', async () => {
    const { service, tx } = buildHarness({ orderType: 'DELIVERY', status: 'DELIVERING' });
    await expect(service.setRounding(7n, 11n, 41n, true)).resolves.toMatchObject({
      roundingAmountVnd: 3_000n,
      payableAmountVnd: 510_000n,
      roundingApplied: true,
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ orderType: 'DELIVERY' }),
    }));
    expect(tx.orderStatusLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'DELIVERY_ORDER_ROUNDING_APPLIED' }),
    });
  });

  it('rejects dine-in orders', async () => {
    const { service } = buildHarness({ orderType: 'DINE_IN' });
    await expect(service.setRounding(7n, 11n, 41n, true)).rejects.toMatchObject({
      response: { code: 'ORDER_ROUNDING_ORDER_TYPE_NOT_ALLOWED' },
    });
  });

  it('rejects a stale concurrent update without writing an audit event', async () => {
    const { tx, service } = buildHarness();
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.setRounding(7n, 11n, 41n, true)).rejects.toMatchObject({
      response: { code: 'ORDER_ROUNDING_CONCURRENT_UPDATE' },
    });
    expect(tx.orderStatusLog.create).not.toHaveBeenCalled();
  });
});

describe('MerchantOrdersService settlement adjustment', () => {
  it('applies, changes, and cancels a pickup discount', async () => {
    const applied = buildHarness({ itemAmountVnd: 1_003_000n, totalAmountVnd: 1_003_000n });
    await expect(applied.service.setSettlementAdjustment(7n, 11n, 41n, {
      discountPayableRateBps: 9_000,
      roundingEnabled: false,
    })).resolves.toMatchObject({
      discountPayableRateBps: 9_000,
      discountAmountVnd: 100_300n,
      payableAmountVnd: 902_700n,
    });

    await expect(applied.service.setSettlementAdjustment(7n, 11n, 41n, {
      discountPayableRateBps: 8_500,
      roundingEnabled: false,
    })).resolves.toMatchObject({
      discountPayableRateBps: 8_500,
      discountAmountVnd: 150_450n,
      payableAmountVnd: 852_550n,
    });

    await expect(applied.service.setSettlementAdjustment(7n, 11n, 41n, {
      discountPayableRateBps: null,
      roundingEnabled: false,
    })).resolves.toMatchObject({
      discountPayableRateBps: null,
      discountAmountVnd: 0n,
      discountAppliedByStaffId: null,
      payableAmountVnd: 1_003_000n,
    });
  });

  it('updates discount and rounding atomically', async () => {
    const { service, tx } = buildHarness({ itemAmountVnd: 1_003_000n, totalAmountVnd: 1_003_000n });

    await expect(service.setSettlementAdjustment(7n, 11n, 41n, {
      discountPayableRateBps: 9_000,
      roundingEnabled: true,
    })).resolves.toMatchObject({
      discountAmountVnd: 100_300n,
      roundingAmountVnd: 2_700n,
      payableAmountVnd: 900_000n,
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        discountPayableRateBps: 9_000,
        discountAmountVnd: 100_300n,
        roundingAmountVnd: 2_700n,
      }),
    }));
  });

  it('keeps discount when the legacy rounding endpoint changes only rounding', async () => {
    const appliedAt = new Date('2026-08-08T08:00:00.000Z');
    const { service } = buildHarness({
      itemAmountVnd: 1_003_000n,
      totalAmountVnd: 1_003_000n,
      discountPayableRateBps: 9_000,
      discountAmountVnd: 100_300n,
      discountAppliedByStaffId: 12n,
      discountAppliedAt: appliedAt,
    });

    await expect(service.setRounding(7n, 11n, 41n, true)).resolves.toMatchObject({
      discountPayableRateBps: 9_000,
      discountAmountVnd: 100_300n,
      discountAppliedByStaffId: 12n,
      discountAppliedAt: appliedAt,
      roundingAmountVnd: 2_700n,
    });
  });

  it('cancels discount while preserving enabled rounding and recalculating it', async () => {
    const { service } = buildHarness({
      itemAmountVnd: 1_003_000n,
      totalAmountVnd: 1_003_000n,
      discountPayableRateBps: 9_000,
      discountAmountVnd: 100_300n,
      discountAppliedByStaffId: 11n,
      discountAppliedAt: new Date(),
      roundingAmountVnd: 2_700n,
      roundingAppliedByStaffId: 11n,
      roundingAppliedAt: new Date(),
    });

    await expect(service.setSettlementAdjustment(7n, 11n, 41n, {
      discountPayableRateBps: null,
      roundingEnabled: true,
    })).resolves.toMatchObject({
      discountPayableRateBps: null,
      discountAmountVnd: 0n,
      roundingApplied: true,
      roundingAmountVnd: 3_000n,
      payableAmountVnd: 1_000_000n,
    });
  });

  it('excludes delivery fee from discount', async () => {
    const { service } = buildHarness({
      orderType: 'DELIVERY',
      itemAmountVnd: 1_000_000n,
      deliveryFeeVnd: 30_000n,
      totalAmountVnd: 1_030_000n,
    });
    await expect(service.setSettlementAdjustment(7n, 11n, 41n, {
      discountPayableRateBps: 9_000,
      roundingEnabled: true,
    })).resolves.toMatchObject({
      discountAmountVnd: 100_000n,
      roundingAmountVnd: 0n,
      payableAmountVnd: 930_000n,
    });
  });

  it('rejects DINE_IN, settled, and stale updates through existing gates', async () => {
    await expect(buildHarness({ orderType: 'DINE_IN' }).service.setSettlementAdjustment(
      7n, 11n, 41n, { discountPayableRateBps: 9_000, roundingEnabled: false },
    )).rejects.toMatchObject({ response: { code: 'ORDER_ROUNDING_ORDER_TYPE_NOT_ALLOWED' } });
    await expect(buildHarness({ settlementStatus: 'SETTLED' }).service.setSettlementAdjustment(
      7n, 11n, 41n, { discountPayableRateBps: 9_000, roundingEnabled: false },
    )).rejects.toMatchObject({ response: { code: 'ORDER_ROUNDING_ALREADY_SETTLED' } });
    const stale = buildHarness();
    stale.tx.order.updateMany.mockResolvedValue({ count: 0 });
    await expect(stale.service.setSettlementAdjustment(
      7n, 11n, 41n, { discountPayableRateBps: 9_000, roundingEnabled: false },
    )).rejects.toMatchObject({ response: { code: 'ORDER_ROUNDING_CONCURRENT_UPDATE' } });
  });
});
