import { Prisma } from '@prisma/client';
import { distanceKm } from '../../common/utils/merchant-hours';
import { OrderRequestDto } from './dto/order-request.dto';
import { OrdersService } from './orders.service';

const origin = { latitude: 21.281, longitude: 106.197 };
const nearby = { deliveryLatitude: 21.282, deliveryLongitude: 106.198 };
const farAway = { deliveryLatitude: 21.4, deliveryLongitude: 106.4 };
const dto: OrderRequestDto = {
  merchantId: '7', orderType: 'DELIVERY', contactPhone: '0912345678',
  deliveryAddress: '收餐点', ...nearby,
};

function harness() {
  const merchant = {
    id: 7n, status: 'ACTIVE', nameZh: '配送范围餐厅', ...origin,
    businessHours: Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, ['00:00-24:00']])),
    deliveryRadiusKm: new Prisma.Decimal(5), deliveryFeeVnd: 15000n,
  };
  const stored = { id: 91n, merchantId: 7n, orderType: 'DELIVERY', status: 'PENDING_ACCEPTANCE', createdAt: new Date(), readyAt: null, createdByStaffId: null };
  const tx = {
    merchant: { findUnique: jest.fn(async () => merchant) },
    cart: {
      findUnique: jest.fn().mockResolvedValue({ id: 31n, table: null, items: [{
        quantity: 1, product: { id: 41n, merchantId: 7n, nameZh: '餐品', priceVnd: 50000n, productType: 'FOOD', status: 'ON_SALE', category: { isActive: true } },
      }] }),
      update: jest.fn(),
    },
    order: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(stored) },
  };
  const prisma = { order: tx.order, $transaction: jest.fn(async work => work(tx)) };
  const push = { enqueue: jest.fn() };
  const printing = { printOrder: jest.fn() };
  const service = new OrdersService(
    prisma as never,
    { resolveContext: jest.fn(async () => ({ merchantId: 7n })), findActiveCart: jest.fn(async () => ({ id: 31n })) } as never,
    printing as never, {} as never,
    { assertOrderingEnabled: jest.fn() } as never,
    { legacyPrintingEnabled: jest.fn(() => false) } as never,
    { assertValid: jest.fn() } as never,
    {} as never, push as never,
  );
  return { service, merchant, tx, push, printing };
}

describe('customer delivery radius enforcement', () => {
  it.each(['preview', 'create'] as const)('rejects an out-of-range %s without writing an order or consuming the cart', async operation => {
    const h = harness();
    const request = { ...dto, ...farAway };
    const result = operation === 'preview' ? h.service.preview(5n, request) : h.service.create(5n, 'delivery_range_001', request);
    await expect(result).rejects.toThrow('配送地址超出商家配送范围');
    expect(h.tx.order.create).not.toHaveBeenCalled();
    expect(h.tx.cart.update).not.toHaveBeenCalled();
    expect(h.push.enqueue).not.toHaveBeenCalled();
    expect(h.printing.printOrder).not.toHaveBeenCalled();
  });

  it.each([
    {}, { deliveryLatitude: 21.282 }, { deliveryLongitude: 106.198 },
    { deliveryLatitude: NaN, deliveryLongitude: 106.198 },
    { deliveryLatitude: 91, deliveryLongitude: 106.198 },
    { deliveryLatitude: 21.282, deliveryLongitude: 181 },
    { deliveryLatitude: 0, deliveryLongitude: 0 },
  ])('does not permit missing or invalid coordinates to bypass the radius: %j', async coordinate => {
    const h = harness();
    const request = { ...dto, deliveryLatitude: undefined, deliveryLongitude: undefined, ...coordinate };
    await expect(h.service.create(5n, 'delivery_range_002', request)).rejects.toThrow('请选择有效的配送收餐位置');
    expect(h.tx.order.create).not.toHaveBeenCalled();
    expect(h.tx.cart.update).not.toHaveBeenCalled();
  });

  it('uses the current merchant radius again when creating after a successful preview', async () => {
    const h = harness();
    await expect(h.service.preview(5n, dto)).resolves.toMatchObject({ deliveryRangeVerified: true, requiresPhoneConfirmation: false, deliveryFeeVnd: 15000n });
    h.merchant.deliveryRadiusKm = new Prisma.Decimal('0.01');
    await expect(h.service.create(5n, 'delivery_range_003', dto)).rejects.toThrow('配送地址超出商家配送范围');
    expect(h.tx.order.create).not.toHaveBeenCalled();
  });

  it('allows a new in-range order and charges the configured delivery fee', async () => {
    const h = harness();
    await h.service.create(5n, 'delivery_range_004', dto);
    expect(h.tx.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deliveryFeeVnd: 15000n, totalAmountVnd: 65000n, status: 'PENDING_ACCEPTANCE' }) }));
    expect(h.tx.cart.update).toHaveBeenCalledTimes(1);
  });

  it('includes the exact radius boundary and rejects a point beyond it without rounding', async () => {
    const h = harness();
    const boundary = distanceKm(origin.latitude, origin.longitude, nearby.deliveryLatitude, nearby.deliveryLongitude);
    h.merchant.deliveryRadiusKm = new Prisma.Decimal(boundary);
    await expect(h.service.preview(5n, dto)).resolves.toMatchObject({ deliveryRangeVerified: true });
    h.merchant.deliveryRadiusKm = new Prisma.Decimal(boundary - 0.000001);
    await expect(h.service.preview(5n, dto)).rejects.toThrow('配送地址超出商家配送范围');
  });

  it('treats a zero radius as zero kilometres, rather than unlimited delivery', async () => {
    const h = harness(); h.merchant.deliveryRadiusKm = new Prisma.Decimal(0);
    await expect(h.service.preview(5n, { ...dto, deliveryLatitude: origin.latitude, deliveryLongitude: origin.longitude })).resolves.toMatchObject({ deliveryRangeVerified: true });
    await expect(h.service.preview(5n, dto)).rejects.toThrow('配送地址超出商家配送范围');
  });

  it('rejects invalid merchant range configuration', async () => {
    const h = harness(); h.merchant.deliveryRadiusKm = new Prisma.Decimal(-1);
    await expect(h.service.preview(5n, dto)).rejects.toThrow('商家配送范围暂时无法校验');
  });

  it.each(['PICKUP', 'DINE_IN'] as const)('keeps %s outside the delivery-radius policy', async orderType => {
    const h = harness();
    await expect(h.service.preview(5n, { ...dto, ...farAway, orderType })).resolves.toMatchObject({ deliveryFeeVnd: 0n, requiresPhoneConfirmation: false });
  });
});
