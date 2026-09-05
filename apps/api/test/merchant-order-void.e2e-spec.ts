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
import { MerchantReportsService } from '../src/modules/merchant-reports/merchant-reports.service';
import { PublicMerchantsService } from '../src/modules/public-merchants/public-merchants.service';
import { effectiveOrderWhere, lockEffectivePrintTarget } from '../src/modules/orders/effective-order';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

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
      status: 'CLOSED', closedAt: createdAt, businessDate, paymentMethod: 'CASH', discountAmountVnd: 20000n, roundingAmountVnd: 1000n } });
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

  it('preserves cross-business-day allocation and legacy null date fallback without deducting again today', async () => {
    const scope = await tableScope();
    await prisma.tableSession.update({ where: { id: scope.session.id }, data: { discountAmountVnd: 0n, roundingAmountVnd: 0n } });
    await prisma.order.update({ where: { id: scope.b.id }, data: { businessDate: null, createdAt: new Date('2026-09-03T05:00:00Z'), completedAt: createdAt } });
    const preview = await service.preview(merchantId, staffId, scope.target);
    expect(preview.businessDayImpacts.map(row => row.businessDate)).toEqual(['2026-09-03', '2026-09-04']);
    expect(preview.businessDayImpacts.map(row => row.netSettledAmountVnd)).toEqual(['100000', '100000']);
    const before3 = await summaries.businessDaySummary(merchantId, '2026-09-03');
    const before4 = await summaries.businessDaySummary(merchantId, '2026-09-04');
    await execute(scope.target, preview);
    const after3 = await summaries.businessDaySummary(merchantId, '2026-09-03');
    const after4 = await summaries.businessDaySummary(merchantId, '2026-09-04');
    expect(BigInt(before3.totalRevenueVnd) + BigInt(before4.totalRevenueVnd)).toBe(200000n);
    expect(after3.totalRevenueVnd).toBe('0'); expect(after4.totalRevenueVnd).toBe('0');
    expect((await summaries.businessDaySummary(merchantId, '2026-09-05')).totalRevenueVnd).toBe('0');
  });

  it('fails closed on the existing cross-date adjustment mismatch without rewriting financial history', async () => {
    const scope = await tableScope();
    await prisma.order.update({ where: { id: scope.b.id }, data: { businessDate: null, createdAt: new Date('2026-09-03T05:00:00Z') } });
    const day3 = await summaries.businessDaySummary(merchantId, '2026-09-03');
    const day4 = await summaries.businessDaySummary(merchantId, '2026-09-04');
    expect(BigInt(day3.totalRevenueVnd) + BigInt(day4.totalRevenueVnd)).toBe(168500n);
    await expect(service.preview(merchantId, staffId, scope.target)).rejects.toMatchObject({ response: { code: 'VOID_BUSINESS_DAY_CONFLICT' } });
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: scope.session.id } })).voidedAt).toBeNull();
  });

  it('keeps calendar-midnight orders in the original overnight business day with discount and rounding', async () => {
    const scope = await tableScope();
    const overnight = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, ['18:00-02:00']]));
    await prisma.merchant.update({ where: { id: merchantId }, data: { businessHours: overnight } });
    const closedAt = new Date('2026-09-03T18:30:00Z'); // 01:30 on Sep 4 in Vietnam.
    await prisma.tableSession.update({ where: { id: scope.session.id }, data: { businessDate: new Date('2026-09-03T00:00:00Z'), closedAt } });
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
    const key = randomUUID();
    const results = await Promise.all([key, randomUUID()].map(requestKey => service.void(merchantId, staffId, target, { reason: 'TEST', version: preview.version, requestKey })));
    expect(results[0]!.operationId).toBe(results[1]!.operationId);
    const other = await order();
    await expect(service.void(merchantId, staffId, `order:${other.id}`, { reason: 'TEST', version: preview.version, requestKey: key })).rejects.toMatchObject({ response: { code: 'VOID_REQUEST_KEY_CONFLICT' } });
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
