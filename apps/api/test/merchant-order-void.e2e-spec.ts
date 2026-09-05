import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Order, PaymentMethod, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request = require('supertest');
import { PrismaService } from '../src/database/prisma.service';
import { MerchantOrderVoidController } from '../src/modules/merchant-orders/merchant-order-void.controller';
import { MerchantOrderVoidService, OrderVoidPreview } from '../src/modules/merchant-orders/merchant-order-void.service';
import { MerchantOrdersService } from '../src/modules/merchant-orders/merchant-orders.service';
import { MerchantSettlementsService } from '../src/modules/merchant-orders/merchant-settlements.service';
import { MerchantAnalyticsService } from '../src/modules/merchant-orders/merchant-analytics.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { TableSessionsService } from '../src/modules/table-sessions/table-sessions.service';
import { PlatformAnalyticsService } from '../src/modules/platform/platform-analytics.service';
import { PlatformMerchantsService } from '../src/modules/platform/platform-merchants.service';
import { MerchantReportsService } from '../src/modules/merchant-reports/merchant-reports.service';
import { PublicMerchantsService } from '../src/modules/public-merchants/public-merchants.service';
import { effectiveOrderWhere, lockEffectivePrintTarget } from '../src/modules/orders/effective-order';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { resolveBusinessDate } from '../src/common/utils/merchant-hours';
import { backfillSessionOpeningDays } from '../scripts/backfill-session-opening-days';

// Never silently fall back to a developer/production DATABASE_URL.
const url = process.env.ORDER_VOID_TEST_DATABASE_URL;
const parsed = url ? new URL(url) : null;
if (!parsed || parsed.hostname !== '127.0.0.1' || parsed.port !== '3398' || parsed.pathname !== '/yunqiao_void_test') {
  throw new Error('Requires explicit ORDER_VOID_TEST_DATABASE_URL on isolated 127.0.0.1:3398/yunqiao_void_test');
}

describe('Order void / isolated MySQL transactions and HTTP contracts', () => {
  let app: INestApplication;
  const prisma = new PrismaService({ datasources: { db: { url } } });
  const service = new MerchantOrderVoidService(prisma);
  const summaries = new MerchantOrdersService(prisma, {} as never, {} as never, {} as never, {} as never);
  const settlements = new MerchantSettlementsService(prisma);
  const analytics = new MerchantAnalyticsService(prisma);
  const sessions = new TableSessionsService(prisma, { getProductionNotificationState: async () => ({}) } as never);
  const platformAnalytics = new PlatformAnalyticsService(prisma);
  const platformMerchants = new PlatformMerchantsService(prisma, {} as never, {} as never, {} as never,
    { automaticCreationEnabled: () => false } as never);
  const reports = new MerchantReportsService(prisma, { renderDailyReport: async () => ({ imageUrl: 'fixture://not-sent' }) } as never, {} as never);
  const publicMerchants = new PublicMerchantsService(prisma, {} as never, {} as never);
  const customer = new OrdersService(prisma, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const merchantIds: bigint[] = [];
  let merchantId: bigint;
  let staffId: bigint;
  let userId: bigint;
  let productId: bigint;
  let token: string;
  let jwt: JwtService;
  const businessDate = new Date('2026-09-04T00:00:00Z');
  const createdAt = new Date('2026-09-04T05:00:00Z');

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'isolated-order-void-test-secret-32-characters' })],
      controllers: [MerchantOrderVoidController],
      providers: [{ provide: PrismaService, useValue: prisma }, { provide: MerchantOrderVoidService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); jwt = app.get(JwtService);
    userId = (await prisma.user.create({ data: { openid: `void-test-${randomUUID()}` } })).id;
  });

  beforeEach(async () => {
    const merchant = await prisma.merchant.create({ data: {
      nameZh: `void-test-${randomUUID()}`, contactName: 'Test', contactPhone: '00000000', province: 'Test', city: 'Test',
      addressDetail: 'Isolated fixture', latitude: 21, longitude: 106,
      businessHours: { monday: ['00:00-23:59'], tuesday: ['00:00-23:59'], wednesday: ['00:00-23:59'],
        thursday: ['00:00-23:59'], friday: ['00:00-23:59'], saturday: ['00:00-23:59'], sunday: ['00:00-23:59'] },
    } });
    merchantId = merchant.id; merchantIds.push(merchantId);
    staffId = (await prisma.merchantStaff.create({ data: { merchantId, username: 'owner', displayName: 'Fixture Owner', passwordHash: 'not-a-login-hash', role: 'OWNER' } })).id;
    const category = await prisma.category.create({ data: { merchantId, nameZh: 'fixture' } });
    productId = (await prisma.product.create({ data: { merchantId, categoryId: category.id, nameZh: '酸辣蕨根粉', priceVnd: 100000n } })).id;
    token = jwt.sign({ accountType: 'MERCHANT_STAFF', sub: String(staffId), merchantId: String(merchantId), role: 'OWNER' });
  });

  afterAll(async () => {
    // Exact fixture merchant IDs in an explicitly guarded throwaway database only.
    const where = { merchantId: { in: merchantIds } };
    await prisma.printTriggerOutbox.deleteMany({ where });
    await prisma.printJob.deleteMany({ where });
    await prisma.printRule.deleteMany({ where });
    await prisma.printer.deleteMany({ where });
    await prisma.order.deleteMany({ where });
    await prisma.product.deleteMany({ where });
    await prisma.merchant.deleteMany({ where: { id: { in: merchantIds } } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await app?.close(); await prisma.$disconnect();
  });

  async function order(extra: Partial<Order> = {}) {
    const number = randomUUID().slice(0, 8);
    return prisma.order.create({ data: {
      orderNo: `VOID-${number}`, idempotencyKey: randomUUID(), merchantId, userId, orderType: 'PICKUP', status: 'COMPLETED',
      itemAmountVnd: 100000n, totalAmountVnd: 100000n, businessDate, createdAt, updatedAt: createdAt, completedAt: createdAt,
      paymentMethod: 'CASH', ...extra,
      items: { create: { productId, productNameZhSnapshot: '酸辣蕨根粉', quantity: 1,
        unitPriceVnd: extra.itemAmountVnd ?? 100000n, subtotalVnd: extra.itemAmountVnd ?? 100000n } },
    } });
  }
  async function tableScope() {
    const table = await prisma.diningTable.create({ data: { merchantId, tableNo: 'A05', qrToken: randomUUID() } });
    const session = await prisma.tableSession.create({ data: { merchantId, tableId: table.id, sessionNo: randomUUID().slice(0, 30),
      status: 'CLOSED', openedAt: createdAt, closedAt: createdAt, businessDate, paymentMethod: 'CASH', discountAmountVnd: 20000n, roundingAmountVnd: 1000n } });
    const a = await order({ orderType: 'DINE_IN', tableId: table.id, tableSessionId: session.id });
    const b = await order({ orderType: 'DINE_IN', tableId: table.id, tableSessionId: session.id });
    const cancelled = await order({ orderType: 'DINE_IN', tableId: table.id, tableSessionId: session.id, status: 'CANCELLED', completedAt: null, cancelledAt: createdAt });
    return { table, session, a, b, cancelled, target: `session:${session.id}` };
  }
  async function execute(target: string, preview?: OrderVoidPreview) {
    const evidence = preview ?? await service.preview(merchantId, staffId, target);
    return service.void(merchantId, staffId, target, { reason: 'TEST', note: 'isolated fixture', version: evidence.version, requestKey: randomUUID() });
  }
  const get = (path: string, auth = token) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${auth}`);
  const post = (target: string, body: object, auth = token) => request(app.getHttpServer()).post(`/merchant/order-voids/${target}`).set('Authorization', `Bearer ${auth}`).send(body);
  async function revenue() {
    return { summary: await summaries.summary(merchantId, { date: '2026-09-04' }),
      day: await summaries.businessDaySummary(merchantId, '2026-09-04'),
      analytics: await analytics.getAnalytics(merchantId, { dateFrom: '2026-09-04', dateTo: '2026-09-04' }),
      settlements: await settlements.list(merchantId, { date: '2026-09-04' }),
      sold: await prisma.orderItem.aggregate({ where: { productId, order: effectiveOrderWhere({ status: 'COMPLETED' }) }, _sum: { quantity: true } }),
    };
  }

  it.each(['CASH', 'BANK_TRANSFER', null] as Array<PaymentMethod | null>)('voids PICKUP %s once and aligns every effective financial read', async paymentMethod => {
    const source = await order({ paymentMethod, discountAmountVnd: 10000n, roundingAmountVnd: 1000n });
    const before = await revenue();
    expect(before.summary.COMPLETED.amountVnd).toBe('89000');
    expect(before.analytics.overview.revenueVnd).toBe('89000');
    const target = `order:${source.id}`;
    const preview = await service.preview(merchantId, staffId, target);
    const dto = { reason: 'MISTAKE' as const, version: preview.version, requestKey: randomUUID() };
    const [first, second] = await Promise.all([service.void(merchantId, staffId, target, dto), service.void(merchantId, staffId, target, dto)]);
    expect(first.operationId).toBe(second.operationId);
    expect(first.businessDayImpacts[0]?.netSettledAmountVnd).toBe('89000');
    const after = await revenue();
    expect(after.summary.COMPLETED.amountVnd).toBe('0'); expect(after.day.totalRevenueVnd).toBe('0');
    expect(after.analytics.overview.revenueVnd).toBe('0'); expect(after.settlements.total).toBe(0);
    expect(after.sold._sum.quantity).toBeNull();
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: source.id } });
    expect(saved.status).toBe(source.status); expect(saved.paymentMethod).toBe(paymentMethod);
    expect(saved.completedAt).toEqual(source.completedAt); expect(saved.businessDate).toEqual(source.businessDate);
    expect(await prisma.orderStatusLog.count({ where: { orderId: source.id, action: 'MERCHANT_ORDER_VOID' } })).toBe(1);
    await expect(summaries.settle(merchantId, source.id)).rejects.toMatchObject({ response: { code: 'ORDER_VOIDED' } });
    await expect(summaries.get(merchantId, source.id)).rejects.toMatchObject({ status: 404 });
  });

  it('voids DELIVERY independently and keeps customer history private and compatible', async () => {
    const source = await order({ orderType: 'DELIVERY', deliveryFeeVnd: 20000n, totalAmountVnd: 120000n, paymentMethod: 'BANK_TRANSFER' });
    const before = await customer.get(userId, source.id);
    await execute(`order:${source.id}`);
    const after = await customer.get(userId, source.id);
    expect(after.status).toBe(before.status); expect(after.totalAmountVnd).toBe(before.totalAmountVnd);
    for (const key of ['voidedAt', 'voidedByStaffId', 'voidReason', 'voidReasonNote', 'voidOperationId']) expect(after).not.toHaveProperty(key);
    expect(after.statusLogs).toEqual(before.statusLogs);
    expect((await customer.list(userId)).some(row => row.id === source.id)).toBe(true);
  });

  it('voids the closed session and all children, counts it once, leaves a new session on the same table unchanged', async () => {
    const scope = await tableScope();
    const current = await prisma.tableSession.create({ data: { merchantId, tableId: scope.table.id, openTableId: scope.table.id, sessionNo: randomUUID().slice(0, 30) } });
    const preview = await service.preview(merchantId, staffId, scope.target);
    expect(preview.affectedOrderIds).toHaveLength(3); expect(preview.settlement.orderCount).toBe(2);
    expect(preview.settlement.finalReceivableVnd).toBe('179000');
    const result = await execute(scope.target, preview);
    const children = await prisma.order.findMany({ where: { tableSessionId: scope.session.id } });
    expect(children.every(row => row.voidOperationId === result.operationId)).toBe(true);
    expect(children.filter(row => row.status === 'CANCELLED')).toHaveLength(1);
    expect(await prisma.tableSession.findUnique({ where: { id: current.id } })).toEqual(current);
    expect(await prisma.diningTable.findUnique({ where: { id: scope.table.id } })).toEqual(scope.table);
    await expect(sessions.getSessionDetail(merchantId, scope.session.id)).rejects.toMatchObject({ status: 404 });
    await expect(sessions.getCanonicalState(merchantId, scope.session.id)).rejects.toMatchObject({ status: 404 });
    await expect(sessions.closeSession(merchantId, scope.session.id)).rejects.toMatchObject({ status: 404 });
    await expect(sessions.setSettlementAdjustment(merchantId, staffId, scope.session.id, { discountPayableRateBps: null, roundingEnabled: false })).rejects.toMatchObject({ status: 404 });
    const archive = await service.list(merchantId, staffId, { search: scope.cancelled.orderNo });
    expect(archive.total).toBe(1); expect(archive.items[0]?.settlement.settledAt).toBe(preview.settlement.settledAt);
    expect((await revenue()).summary.COMPLETED.amountVnd).toBe('0');
  });

  it('attributes legacy cross-day children to opening day without deducting again on void day', async () => {
    const scope = await tableScope();
    await prisma.tableSession.update({ where: { id: scope.session.id }, data: { openedAt: new Date('2026-09-03T04:00:00Z'), discountAmountVnd: 0n, roundingAmountVnd: 0n } });
    await prisma.order.update({ where: { id: scope.b.id }, data: { businessDate: null, createdAt: new Date('2026-09-03T05:00:00Z'), completedAt: createdAt } });
    const preview = await service.preview(merchantId, staffId, scope.target);
    expect(preview.businessDayImpacts.map(row => row.businessDate)).toEqual(['2026-09-03']);
    expect(preview.businessDayImpacts.map(row => row.netSettledAmountVnd)).toEqual(['200000']);
    const before3 = await summaries.businessDaySummary(merchantId, '2026-09-03');
    const before4 = await summaries.businessDaySummary(merchantId, '2026-09-04');
    await execute(scope.target, preview);
    const after3 = await summaries.businessDaySummary(merchantId, '2026-09-03');
    const after4 = await summaries.businessDaySummary(merchantId, '2026-09-04');
    expect(BigInt(before3.totalRevenueVnd) + BigInt(before4.totalRevenueVnd)).toBe(200000n);
    expect(after3.totalRevenueVnd).toBe('0'); expect(after4.totalRevenueVnd).toBe('0');
    expect((await summaries.businessDaySummary(merchantId, '2026-09-05')).totalRevenueVnd).toBe('0');
  });

  it('keeps next-day checkouts visible until they are actually voided, then removes every statistics contribution', async () => {
    const previousDate = new Date('2026-09-03T00:00:00Z');
    const placedAt = new Date('2026-09-03T05:00:00Z');
    const targets: string[] = [];
    for (const [index, amount, discount, rounding, paymentMethod] of [
      [0, 470000n, 235000n, 5000n, 'BANK_TRANSFER'],
      [1, 247000n, 0n, 0n, 'CASH'],
    ] as const) {
      const table = await prisma.diningTable.create({ data: { merchantId, tableNo: `T${index}`, qrToken: randomUUID() } });
      const session = await prisma.tableSession.create({ data: { merchantId, tableId: table.id, sessionNo: randomUUID().slice(0, 30),
        status: 'CLOSED', openedAt: placedAt, closedAt: createdAt, businessDate, paymentMethod,
        discountAmountVnd: discount, roundingAmountVnd: rounding } });
      await order({ orderType: 'DINE_IN', tableId: table.id, tableSessionId: session.id, businessDate: previousDate,
        createdAt: placedAt, completedAt: createdAt, itemAmountVnd: amount, totalAmountVnd: amount });
      targets.push(`session:${session.id}`);
    }
    // The immutable opening day is Sep 3 even though actual checkout is Sep 4.
    expect((await summaries.businessDaySummary(merchantId, '2026-09-03')).totalRevenueVnd).toBe('477000');
    expect((await summaries.summary(merchantId, { date: '2026-09-04' })).COMPLETED.amountVnd).toBe('0');
    const before = await analytics.getAnalytics(merchantId, { dateFrom: '2026-09-03', dateTo: '2026-09-03' });
    expect(before.overview).toMatchObject({ revenueVnd: '477000', settlementCount: 2,
      funds: { discountAmountVnd: '235000', roundingAmountVnd: '5000', cashRevenueVnd: '247000', bankTransferRevenueVnd: '230000' } });
    expect(before.topDishes).toHaveLength(1);
    expect((await settlements.list(merchantId, { date: '2026-09-03' })).total).toBe(2);
    expect((await settlements.list(merchantId, { date: '2026-09-04' })).total).toBe(0);
    const nextDay = await analytics.getAnalytics(merchantId, { dateFrom: '2026-09-04', dateTo: '2026-09-04' });
    expect(nextDay.overview.revenueVnd).toBe('0');
    expect(nextDay.overview.previous.revenueVnd).toBe('477000');
    for (const target of targets) {
      const preview = await service.preview(merchantId, staffId, target);
      expect(preview.businessDayImpacts.map(impact => impact.businessDate)).toEqual(['2026-09-03']);
      expect(preview.settlementImpact.businessDate).toBe('2026-09-03');
      await execute(target, preview);
    }
    for (const date of ['2026-09-03', '2026-09-04', '2026-09-05']) {
      const stats = await analytics.getAnalytics(merchantId, { dateFrom: date, dateTo: date });
      expect(stats.overview).toMatchObject({ revenueVnd: '0', settlementCount: 0, averageOrderValueVnd: '0',
        funds: { grossAmountVnd: '0', discountAmountVnd: '0', roundingAmountVnd: '0', netSettledAmountVnd: '0',
          cashRevenueVnd: '0', bankTransferRevenueVnd: '0', unrecordedRevenueVnd: '0' } });
      expect(stats.topDishes).toEqual([]);
      expect(stats.peakPeriod).toBeNull();
      expect(stats.trend.every(row => row.revenueVnd === '0' && row.settlementCount === 0)).toBe(true);
      expect(stats.timeDistribution.every(row => row.revenueVnd === '0' && row.settlementCount === 0)).toBe(true);
      expect((await summaries.summary(merchantId, { date })).COMPLETED.amountVnd).toBe('0');
      expect((await summaries.businessDaySummary(merchantId, date)).totalRevenueVnd).toBe('0');
      expect((await settlements.list(merchantId, { date })).total).toBe(0);
    }
    expect((await publicMerchants['salesByProductId'](merchantId)).has(String(productId))).toBe(false);
    expect((await service.list(merchantId, staffId, {})).total).toBe(2);
  });

  it.each(['ORDER', 'SESSION'] as const)('excludes a voided %s from the latest-order metric but preserves raw history', async scope => {
    const olderAt = new Date('2026-09-03T05:00:00Z');
    const older = await order({ createdAt: olderAt, completedAt: olderAt, businessDate: new Date('2026-09-03T00:00:00Z') });
    const target = scope === 'SESSION' ? (await tableScope()).target : `order:${(await order()).id}`;
    expect((await platformMerchants.detail(merchantId)).metrics.lastOrderAt).toBe(createdAt.toISOString());
    await execute(target);
    const after = await platformMerchants.detail(merchantId);
    expect(after.metrics.lastOrderAt).toBe(olderAt.toISOString());
    expect(after.recentOrders.length).toBeGreaterThan(1);
    await execute(`order:${older.id}`);
    const empty = await platformMerchants.detail(merchantId);
    expect(empty.metrics.lastOrderAt).toBeNull();
    expect(empty.recentOrders).toHaveLength(after.recentOrders.length);
  });

  it.each([false, true])('uses one opening day for multi-day add-ons, late checkout, charts and void (snapshot=%s)', async snapshot => {
    const schedule = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, ['18:00-02:00']]));
    await prisma.merchant.update({ where: { id: merchantId }, data: { businessHours: schedule } });
    const openedAt = new Date('2026-09-03T18:30:00Z'); // Sep 4 01:30, still Sep 3 business day.
    const openingDate = new Date('2026-09-03T00:00:00Z');
    const checkoutAt = new Date('2026-09-08T05:00:00Z');
    const table = await prisma.diningTable.create({ data: { merchantId, tableNo: 'Late', qrToken: randomUUID() } });
    const session = await prisma.tableSession.create({ data: {
      merchantId, tableId: table.id, sessionNo: randomUUID().slice(0, 30), status: 'CLOSED', openedAt,
      openedBusinessDate: snapshot ? openingDate : null, closedAt: checkoutAt,
      businessDate: new Date('2026-09-08T00:00:00Z'), discountAmountVnd: 50000n, roundingAmountVnd: 1000n, paymentMethod: 'CASH',
    } });
    const a = await order({ orderType: 'DINE_IN', tableId: table.id, tableSessionId: session.id,
      createdAt: new Date('2026-09-04T10:00:00Z'), businessDate, completedAt: checkoutAt,
      itemAmountVnd: 200000n, totalAmountVnd: 200000n });
    const b = await order({ orderType: 'DINE_IN', tableId: table.id, tableSessionId: session.id,
      createdAt: new Date('2026-09-07T05:00:00Z'), businessDate: new Date('2026-09-07T00:00:00Z'), completedAt: checkoutAt,
      itemAmountVnd: 300000n, totalAmountVnd: 300000n });
    // Historical cancelled child may retain item rows/amounts, but contributes zero.
    await order({ orderType: 'DINE_IN', tableId: table.id, tableSessionId: session.id, status: 'CANCELLED',
      completedAt: null, cancelledAt: checkoutAt });
    if (snapshot) {
      // Later hours edits must not move a frozen opening date.
      await prisma.merchant.update({ where: { id: merchantId }, data: { businessHours: {} } });
    }
    const report = await summaries.businessDaySummary(merchantId, '2026-09-03');
    expect(report).toMatchObject({ totalRevenueVnd: '449000', orderCount: 2, settlementCount: 1,
      cashRevenueVnd: '449000', discountAmountVnd: '50000', roundingAmountVnd: '1000' });
    expect(report.itemSummary.reduce((sum, row) => sum + row.quantity, 0)).toBe(2);
    const rows = await summaries.list(merchantId, { date: '2026-09-03', status: 'COMPLETED' });
    expect(new Set(rows.map(row => String(row.id)))).toEqual(new Set([String(a.id), String(b.id)]));
    expect((await summaries.summary(merchantId, { date: '2026-09-03' })).COMPLETED).toMatchObject({ count: 2, settlementCount: 1, amountVnd: '449000' });
    const stats = await analytics.getAnalytics(merchantId, { dateFrom: '2026-09-03', dateTo: '2026-09-03' });
    expect(stats.overview).toMatchObject({ revenueVnd: '449000', settlementCount: 1, averageOrderValueVnd: '449000' });
    expect(stats.topDishes.reduce((sum, row) => sum + row.quantity, 0)).toBe(2);
    expect(stats.trend.find(row => row.key === '01')).toMatchObject({ settlementCount: 1, revenueVnd: '449000' });
    expect(stats.timeDistribution.filter(row => row.settlementCount)).toEqual([expect.objectContaining({ weekday: 3, startHour: 0, settlementCount: 1 })]);
    const history = await settlements.list(merchantId, { date: '2026-09-03', pageSize: 1 });
    expect(history.total).toBe(1);
    expect(history.items[0]).toMatchObject({ orderCount: 2, finalReceivableVnd: '449000', businessDate: '2026-09-03', settledAt: checkoutAt.toISOString() });
    expect(history.items[0]!.sourceOrders).toHaveLength(3);
    for (const date of ['2026-09-04', '2026-09-07', '2026-09-08']) {
      expect((await summaries.businessDaySummary(merchantId, date)).totalRevenueVnd).toBe('0');
      expect((await summaries.summary(merchantId, { date })).COMPLETED.count).toBe(0);
      expect((await settlements.list(merchantId, { date })).total).toBe(0);
      expect((await analytics.getAnalytics(merchantId, { dateFrom: date, dateTo: date })).overview.revenueVnd).toBe('0');
    }
    expect((await analytics.getAnalytics(merchantId, { dateFrom: '2026-09-04', dateTo: '2026-09-04' })).overview.previous.revenueVnd).toBe('449000');
    expect((await analytics.getAnalytics(merchantId, { dateFrom: '2026-09-03', dateTo: '2026-09-08' })).overview).toMatchObject({ revenueVnd: '449000', settlementCount: 1 });
    const preview = await service.preview(merchantId, staffId, `session:${session.id}`);
    expect(preview.businessDayImpacts).toEqual([expect.objectContaining({ businessDate: '2026-09-03', netSettledAmountVnd: '449000' })]);
    expect(preview.settlementImpact).toEqual({ businessDate: '2026-09-03', settlementCount: 1, revenueVnd: '449000' });
    await execute(`session:${session.id}`, preview);
    expect((await summaries.businessDaySummary(merchantId, '2026-09-03')).totalRevenueVnd).toBe('0');
    expect((await analytics.getAnalytics(merchantId, { dateFrom: '2026-09-03', dateTo: '2026-09-08' })).overview.revenueVnd).toBe('0');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: b.id } })).businessDate?.toISOString().slice(0, 10)).toBe('2026-09-07');
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } })).businessDate?.toISOString().slice(0, 10)).toBe('2026-09-08');
  });

  it('freezes opening business date on actual table creation and does not rewrite it when reused', async () => {
    const table = await prisma.diningTable.create({ data: { merchantId, tableNo: 'Open', qrToken: randomUUID() } });
    const opened = await prisma.$transaction(tx => sessions.getOrCreateOpenSession(tx, merchantId, table.id));
    const first = await prisma.tableSession.findUniqueOrThrow({ where: { id: opened.id } });
    const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    expect(first.openedBusinessDate?.toISOString().slice(0, 10)).toBe(resolveBusinessDate(merchant.businessHours, first.openedAt));
    await prisma.merchant.update({ where: { id: merchantId }, data: { businessHours: {} } });
    expect(await prisma.$transaction(tx => sessions.getOrCreateOpenSession(tx, merchantId, table.id))).toEqual({ id: opened.id, created: false });
    expect(await prisma.tableSession.findUniqueOrThrow({ where: { id: opened.id } })).toEqual(first);
  });

  it('backfills only null opening snapshots, preserves original timestamps and is retry-safe', async () => {
    const scope = await tableScope();
    const prior = await prisma.tableSession.findUniqueOrThrow({ where: { id: scope.session.id } });
    expect(await backfillSessionOpeningDays(prisma, merchantId)).toEqual({ mode: 'DRY_RUN', examined: 1, updated: 0, remaining: 1 });
    expect(await prisma.tableSession.findUniqueOrThrow({ where: { id: prior.id } })).toEqual(prior);
    expect(await backfillSessionOpeningDays(prisma, merchantId, true)).toEqual({ mode: 'APPLY', examined: 1, updated: 1, remaining: 0 });
    expect(await prisma.tableSession.findUniqueOrThrow({ where: { id: prior.id } })).toEqual({ ...prior, openedBusinessDate: businessDate });
    await prisma.merchant.update({ where: { id: merchantId }, data: { businessHours: {} } });
    expect(await backfillSessionOpeningDays(prisma, merchantId, true)).toEqual({ mode: 'APPLY', examined: 0, updated: 0, remaining: 0 });
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: prior.id } })).openedBusinessDate).toEqual(businessDate);
  });

  it('does not treat an empty cancelled closed table as a settlement even with stale checkout fields', async () => {
    const scope = await tableScope();
    await prisma.order.updateMany({ where: { tableSessionId: scope.session.id }, data: { status: 'CANCELLED', completedAt: null, cancelledAt: createdAt } });
    const result = await revenue();
    expect(result.day.totalRevenueVnd).toBe('0');
    expect(result.analytics.overview).toMatchObject({ revenueVnd: '0', settlementCount: 0 });
    expect(result.analytics.topDishes).toEqual([]);
    expect(result.settlements.total).toBe(0);
  });

  it('loads the whole cross-day session once so discount and rounding are not allocated twice', async () => {
    const scope = await tableScope();
    await prisma.tableSession.update({ where: { id: scope.session.id }, data: { openedAt: new Date('2026-09-03T04:00:00Z') } });
    await prisma.order.update({ where: { id: scope.b.id }, data: { businessDate: null, createdAt: new Date('2026-09-03T05:00:00Z') } });
    const day3 = await summaries.businessDaySummary(merchantId, '2026-09-03');
    const day4 = await summaries.businessDaySummary(merchantId, '2026-09-04');
    expect(day3.totalRevenueVnd).toBe('179000');
    expect(day4.totalRevenueVnd).toBe('0');
    const preview = await service.preview(merchantId, staffId, scope.target);
    expect(preview.businessDayImpacts.map(row => [row.businessDate, row.netSettledAmountVnd])).toEqual([['2026-09-03', '179000']]);
    await execute(scope.target, preview);
    expect((await summaries.businessDaySummary(merchantId, '2026-09-03')).totalRevenueVnd).toBe('0');
  });

  it('keeps calendar-midnight orders in the original overnight business day with discount and rounding', async () => {
    const scope = await tableScope();
    const overnight = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, ['18:00-02:00']]));
    await prisma.merchant.update({ where: { id: merchantId }, data: { businessHours: overnight } });
    const closedAt = new Date('2026-09-03T18:30:00Z'); // 01:30 on Sep 4 in Vietnam.
    await prisma.tableSession.update({ where: { id: scope.session.id }, data: { openedAt: new Date('2026-09-03T16:00:00Z'), businessDate: new Date('2026-09-03T00:00:00Z'), closedAt } });
    await prisma.order.update({ where: { id: scope.a.id }, data: { businessDate: null, createdAt: new Date('2026-09-03T16:00:00Z'), completedAt: closedAt } });
    await prisma.order.update({ where: { id: scope.b.id }, data: { businessDate: null, createdAt: new Date('2026-09-03T18:00:00Z'), completedAt: closedAt } });
    await prisma.order.update({ where: { id: scope.cancelled.id }, data: { businessDate: new Date('2026-09-03T00:00:00Z'), createdAt: new Date('2026-09-03T16:00:00Z') } });
    const preview = await service.preview(merchantId, staffId, scope.target);
    expect(preview.businessDayImpacts.map(row => [row.businessDate, row.netSettledAmountVnd])).toEqual([['2026-09-03', '179000']]);
    expect((await summaries.businessDaySummary(merchantId, '2026-09-03')).totalRevenueVnd).toBe('179000');
    expect((await summaries.businessDaySummary(merchantId, '2026-09-04')).totalRevenueVnd).toBe('0');
    await execute(scope.target, preview);
    expect((await summaries.businessDaySummary(merchantId, '2026-09-03')).totalRevenueVnd).toBe('0');
    expect((await summaries.businessDaySummary(merchantId, '2026-09-04')).totalRevenueVnd).toBe('0');
  });

  it('removes a cancelled independent order with zero monetary impact', async () => {
    const source = await order({ status: 'CANCELLED', completedAt: null, cancelledAt: createdAt });
    const result = await execute(`order:${source.id}`);
    expect(result.settlementImpact.revenueVnd).toBe('0'); expect(result.settlementImpact.settlementCount).toBe(0);
    expect(result.businessDayImpacts[0]?.netSettledAmountVnd).toBe('0');
  });

  it('excludes voided orders in actual platform analytics, regenerated reports and public product sales queries', async () => {
    const source = await order();
    const query = { merchantId: String(merchantId), dateFrom: '2026-09-04', dateTo: '2026-09-04' };
    const beforePlatform = await platformAnalytics.getAnalytics(query);
    const beforeReport = await reports['buildSnapshot'](merchantId, 'Fixture', null, 'zh', businessDate);
    const beforeSales = await publicMerchants['salesByProductId'](merchantId);
    expect(beforePlatform.summary.orderAmount).toBe('100000');
    expect(beforeReport.summary.totalAmount).toBe('100000');
    expect(beforeSales.get(String(productId))).toBe(1);
    await execute(`order:${source.id}`);
    expect((await platformAnalytics.getAnalytics(query)).summary.orderAmount).toBe('0');
    expect((await reports['buildSnapshot'](merchantId, 'Fixture', null, 'zh', businessDate)).summary.totalAmount).toBe('0');
    expect((await publicMerchants['salesByProductId'](merchantId)).has(String(productId))).toBe(false);
    // Rendering is stubbed above: no message is sent, and previous snapshots are not overwritten.
    expect(beforeReport.summary.totalAmount).toBe('100000');
  });

  it.each(['PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'] as const)('blocks active order %s', async status => {
    const source = await order({ status });
    await expect(service.preview(merchantId, staffId, `order:${source.id}`)).rejects.toMatchObject({ response: { code: 'VOID_ACTIVE_ORDER' } });
  });

  it('blocks every child of an open session, and exposes a safe whole-session redirect without allowing child POST', async () => {
    const scope = await tableScope();
    const redirect = await get(`/merchant/order-voids/order:${scope.a.id}/preview`).expect(409);
    expect(redirect.body.target).toBe(scope.target);
    await post(`order:${scope.a.id}`, { reason: 'TEST', requestKey: randomUUID(), version: 'a'.repeat(64) }).expect(409);
    await prisma.tableSession.update({ where: { id: scope.session.id }, data: { status: 'OPEN', openTableId: scope.table.id } });
    await expect(service.preview(merchantId, staffId, scope.target)).rejects.toMatchObject({ response: { code: 'VOID_OPEN_SESSION' } });
  });

  it('rejects invalid/missing dine-in scope, inconsistent amounts and cross-merchant targets', async () => {
    const invalid = await order({ orderType: 'DINE_IN' });
    await expect(service.preview(merchantId, staffId, `order:${invalid.id}`)).rejects.toMatchObject({ response: { code: 'VOID_SCOPE_CONFLICT' } });
    const badMoney = await order({ totalAmountVnd: 150000n });
    await expect(service.preview(merchantId, staffId, `order:${badMoney.id}`)).rejects.toMatchObject({ response: { code: 'VOID_AMOUNT_CONFLICT' } });
    const other = merchantIds[0]!;
    const foreign = await prisma.order.findFirstOrThrow({ where: { merchantId: other } });
    await get(`/merchant/order-voids/order:${foreign.id}/preview`).expect(404);
  });

  it.each(['MANAGER', 'STAFF', 'DISABLED', 'MERCHANT_DISABLED', 'PASSWORD_REQUIRED'] as const)('checks current authority, not stale OWNER JWT: %s', async state => {
    const source = await order();
    const preview = await service.preview(merchantId, staffId, `order:${source.id}`);
    if (state === 'MERCHANT_DISABLED') await prisma.merchant.update({ where: { id: merchantId }, data: { status: 'DISABLED' } });
    else if (state === 'PASSWORD_REQUIRED') await prisma.merchantStaff.update({ where: { id: staffId }, data: { mustChangePassword: true } });
    else await prisma.merchantStaff.update({ where: { id: staffId }, data: state === 'DISABLED' ? { status: 'DISABLED' } : { role: state } });
    await get(`/merchant/order-voids/order:${source.id}/preview`).expect(403);
    await get('/merchant/order-voids').expect(403);
    await post(`order:${source.id}`, { reason: 'TEST', requestKey: randomUUID(), version: preview.version }).expect(403);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: source.id } })).voidedAt).toBeNull();
  });

  it('validates reason, protected body fields, account type and preview version', async () => {
    const source = await order(); const target = `order:${source.id}`;
    const preview = await service.preview(merchantId, staffId, target);
    const body = { reason: 'TEST', requestKey: randomUUID(), version: preview.version };
    await post(target, { ...body, reason: 'OTHER' }).expect(400);
    await post(target, { ...body, merchantId: '18' }).expect(400);
    await post(target, body, jwt.sign({ accountType: 'USER', sub: String(staffId), merchantId: String(merchantId), role: 'OWNER' })).expect(403);
    await prisma.order.update({ where: { id: source.id }, data: { paymentMethod: 'BANK_TRANSFER' } });
    expect((await post(target, body).expect(409)).body.code).toBe('VOID_PREVIEW_STALE');
  });

  it('handles two distinct request keys and rejects reuse of a key on a different target', async () => {
    const source = await order(); const target = `order:${source.id}`;
    const preview = await service.preview(merchantId, staffId, target);
    const keys = [randomUUID(), randomUUID()];
    const results = await Promise.all(keys.map(requestKey => service.void(merchantId, staffId, target, { reason: 'TEST', version: preview.version, requestKey })));
    expect(results[0]!.operationId).toBe(results[1]!.operationId);
    // Either request can win the row lock; only the committed key is recorded.
    const log = await prisma.orderStatusLog.findFirstOrThrow({ where: { orderId: source.id, action: 'MERCHANT_ORDER_VOID' } });
    expect(keys.map(key => `void:${key}`)).toContain(log.requestKey);
    const committedKey = log.requestKey!.slice('void:'.length);
    const other = await order();
    const otherPreview = await service.preview(merchantId, staffId, `order:${other.id}`);
    await expect(service.void(merchantId, staffId, `order:${other.id}`, { reason: 'TEST', version: otherPreview.version, requestKey: committedKey })).rejects.toMatchObject({ response: { code: 'VOID_REQUEST_KEY_CONFLICT' } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: other.id } })).voidedAt).toBeNull();
    expect(await prisma.orderStatusLog.count({ where: { orderId: source.id, action: 'MERCHANT_ORDER_VOID' } })).toBe(1);
  });

  it('rolls back both session and all children if audit persistence fails', async () => {
    const scope = await tableScope(); const preview = await service.preview(merchantId, staffId, scope.target);
    const failing = prisma.$extends({ query: { orderStatusLog: { createMany() { throw new Error('Injected audit persistence failure'); } } } });
    const failingService = new MerchantOrderVoidService(failing as unknown as PrismaService);
    await expect(failingService.void(merchantId, staffId, scope.target, { reason: 'TEST', requestKey: randomUUID(), version: preview.version })).rejects.toThrow('Injected audit persistence failure');
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: scope.session.id } })).voidedAt).toBeNull();
    expect(await prisma.order.count({ where: { tableSessionId: scope.session.id, voidedAt: { not: null } } })).toBe(0);
    expect(await prisma.orderStatusLog.count({ where: { orderId: { in: [scope.a.id, scope.b.id, scope.cancelled.id] }, action: 'MERCHANT_ORDER_VOID' } })).toBe(0);
  });

  it('blocks in-flight legacy prints, preserves snapshots, and serializes new print intent against void', async () => {
    const source = await order(); const target = `order:${source.id}`;
    const preview = await service.preview(merchantId, staffId, target);
    const pending = await prisma.printLog.create({ data: { merchantId, orderId: source.id, status: 'PENDING', printedBy: 'MERCHANT' } });
    await expect(execute(target, preview)).rejects.toMatchObject({ response: { code: 'VOID_PRINT_IN_FLIGHT' } });
    await prisma.printLog.update({ where: { id: pending.id }, data: { status: 'SUCCESS' } });
    const historical = await prisma.printLog.findUniqueOrThrow({ where: { id: pending.id } });
    const result = await execute(target, preview);
    expect(await prisma.printLog.findUnique({ where: { id: pending.id } })).toEqual(historical);
    await expect(prisma.$transaction(tx => lockEffectivePrintTarget(tx, merchantId, { orderId: source.id }))).rejects.toMatchObject({ response: { code: 'ORDER_VOIDED' } });
    expect(result.operationId).toBeTruthy();
  });

  it('uses a real shared row lock to prevent concurrent new print intent after void', async () => {
    const source = await order(); const target = `order:${source.id}`;
    const preview = await service.preview(merchantId, staffId, target);
    let acquired!: () => void; let release!: () => void;
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const printing = prisma.$transaction(async tx => {
      await lockEffectivePrintTarget(tx, merchantId, { orderId: source.id }); acquired(); await gate;
      return tx.printLog.create({ data: { merchantId, orderId: source.id, status: 'PENDING', printedBy: 'MERCHANT' } });
    });
    await locked;
    const deleting = execute(target, preview); release(); await printing;
    await expect(deleting).rejects.toMatchObject({ response: { code: 'VOID_PRINT_IN_FLIGHT' } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: source.id } })).voidedAt).toBeNull();
  });

  it.each(['PENDING', 'CLAIMED', 'PRINTING', 'RETRY_WAIT', 'UNKNOWN_OUTCOME'] as const)('blocks modern print job %s and preserves the job snapshot', async state => {
    const scope = await tableScope(); const preview = await service.preview(merchantId, staffId, scope.target);
    const printer = await prisma.printer.create({ data: { merchantId, name: 'isolated fixture', channelType: 'LOCAL_USB_ESCPOS', connectionConfig: {} } });
    const job = await prisma.printJob.create({ data: {
      merchantId, tableSessionId: scope.session.id, printerId: printer.id, receiptType: 'TABLE_BILL', triggerEvent: 'TABLE_SESSION_SETTLED', source: 'MANUAL',
      status: state === 'UNKNOWN_OUTCOME' ? 'FAILED' : state, lastErrorCode: state === 'UNKNOWN_OUTCOME' ? 'PRINT_OUTCOME_UNKNOWN' : null,
      receiptSnapshot: { fixture: true, amount: '179000' }, renderedPayload: Buffer.from('historical-fixture'),
    } });
    await expect(execute(scope.target, preview)).rejects.toMatchObject({ response: { code: 'VOID_PRINT_IN_FLIGHT' } });
    const printed = await prisma.printJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', lastErrorCode: null } });
    await execute(scope.target, preview);
    const after = await prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after).toEqual(printed);
    await expect(prisma.$transaction(tx => lockEffectivePrintTarget(tx, merchantId, { tableSessionId: scope.session.id }))).rejects.toMatchObject({ response: { code: 'ORDER_VOIDED' } });
  });

  it.each(['PENDING', 'PROCESSING'] as const)('blocks durable outbox %s created after preview', async status => {
    const source = await order(); const target = `order:${source.id}`; const preview = await service.preview(merchantId, staffId, target);
    const printer = await prisma.printer.create({ data: { merchantId, name: 'isolated fixture', channelType: 'LOCAL_USB_ESCPOS', connectionConfig: {} } });
    const rule = await prisma.printRule.create({ data: { merchantId, name: 'fixture rule', printerId: printer.id, triggerEvent: 'ORDER_COMPLETED', receiptType: 'ORDER_CUSTOMER' } });
    await prisma.printTriggerOutbox.create({ data: { merchantId, orderId: source.id, printRuleId: rule.id, printerId: printer.id, eventKey: randomUUID(), triggerEvent: 'ORDER_COMPLETED', ruleVersion: 'fixture-v1', receiptType: 'ORDER_CUSTOMER', status } });
    await expect(execute(target, preview)).rejects.toMatchObject({ response: { code: 'VOID_PRINT_IN_FLIGHT' } });
  });
});
