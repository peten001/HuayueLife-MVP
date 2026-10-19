import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { ReceiptSnapshotService } from '../src/modules/printing/services/receipt-snapshot.service';
import { renderPrintDocumentV3 } from '../src/modules/printing/services/print-document-renderer';
import { printDocumentLines } from '../src/modules/printing/services/cloud-receipt-renderer';

describe('arrival reservations: isolated MySQL end-to-end', () => {
  let app: INestApplication, prisma: PrismaService;
  let merchantId: bigint, otherMerchantId: bigint, userId: bigint, otherUserId: bigint;
  let productId: bigint, userToken: string, otherUserToken: string, staffToken: string, otherStaffToken: string;
  const future = (minutes = 60) => new Date(Date.now() + minutes * 60_000).toISOString();
  const call = (method: 'get' | 'post' | 'patch', path: string, body?: object, token = userToken, key?: string) => {
    const req = request(app.getHttpServer())[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
    if (key) req.set('Idempotency-Key', key);
    return body ? req.send(body) : req;
  };
  const dining = (patch: object = {}, key = randomUUID()) => call('post', '/reservations', {
    merchantId: merchantId.toString(), scheduledFor: future(), guestCount: 2,
    contactName: '预约验收', contactPhone: '0901234567', withCart: false, ...patch,
  }, userToken, key);
  const action = (id: string, action: string, extra: object = {}, kind = 'DINE_IN', token = staffToken) =>
    call('post', `/merchant/reservations/${kind}/${id}/actions`, { action, ...extra }, token);
  const newTable = () => prisma.diningTable.create({ data: { merchantId, tableNo: `T${randomBytes(5).toString('hex')}`, qrToken: randomBytes(32).toString('hex') } });
  const addItem = (type: 'DINE_IN' | 'PICKUP', tableToken?: string) => call('post', '/cart/items', {
    merchantId: merchantId.toString(), orderType: type, reservation: !tableToken,
    tableToken, productId: productId.toString(), quantity: 2, remark: '少辣',
  });
  const pickup = (scheduledFor?: string, key = randomUUID()) => call('post', '/orders', {
    merchantId: merchantId.toString(), orderType: 'PICKUP', reservation: true, scheduledFor,
    expectedAmountVnd: '100000', contactName: '自取验收', contactPhone: '0901234567',
  }, userToken, key);

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'mysql://invalid');
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/huayue_arrival_test_')) {
      throw new Error('Reservation E2E requires an explicitly named, isolated local test database');
    }
    process.env.PLATFORM_ORDERING_ENABLED = 'true';
    process.env.JWT_SECRET = 'arrival-e2e-local-only-never-production';
    process.env.PRINTING_TASK_CENTER_ENABLED = 'false';
    process.env.PRINTING_AUTO_CREATE_ENABLED = 'false';
    process.env.CLOUD_PRINT_WORKER_ENABLED = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init(); prisma = app.get(PrismaService);
    const merchantData = (name: string) => ({ nameZh: name, nameVi: 'Nhà hàng kiểm thử', nameEn: 'Reservation test restaurant',
      contactName: '隔离验收', contactPhone: '0901234567', province: '北宁', city: '北宁', addressDetail: '隔离数据库，无生产数据',
      latitude: 21.17, longitude: 106.07, businessHours: {}, status: 'ACTIVE' as const,
      merchantMode: 'MANAGED' as const, claimStatus: 'CLAIMED' as const, dineInEnabled: true, pickupEnabled: true, deliveryEnabled: true });
    merchantId = (await prisma.merchant.create({ data: merchantData('预约到店·隔离验收') })).id;
    otherMerchantId = (await prisma.merchant.create({ data: merchantData('另一门店·隔离验收') })).id;
    userId = (await prisma.user.create({ data: { openid: `arrival-${randomUUID()}`, nickname: '预约顾客' } })).id;
    otherUserId = (await prisma.user.create({ data: { openid: `arrival-${randomUUID()}` } })).id;
    const staff = await prisma.merchantStaff.create({ data: { merchantId, username: `arrival-${randomUUID()}`, passwordHash: 'TEST_ONLY', displayName: '预约验收店主', role: 'OWNER' } });
    const otherStaff = await prisma.merchantStaff.create({ data: { merchantId: otherMerchantId, username: `arrival-${randomUUID()}`, passwordHash: 'TEST_ONLY', displayName: '另一店主', role: 'OWNER' } });
    const jwt = app.get(JwtService);
    const signUser = (id: bigint) => jwt.sign({ sub: id.toString(), accountType: 'USER' });
    const signStaff = (id: bigint, merchant: bigint) => jwt.sign({ sub: id.toString(), merchantId: merchant.toString(), accountType: 'MERCHANT_STAFF', role: 'OWNER' });
    userToken = signUser(userId); otherUserToken = signUser(otherUserId);
    staffToken = signStaff(staff.id, merchantId); otherStaffToken = signStaff(otherStaff.id, otherMerchantId);
    const category = await prisma.category.create({ data: { merchantId, nameZh: '餐品' } });
    productId = (await prisma.product.create({ data: { merchantId, categoryId: category.id, nameZh: '招牌炒饭', nameVi: 'Cơm rang', nameEn: 'Fried rice', priceVnd: 50000n, status: 'ON_SALE' } })).id;
    await prisma.kdsSetting.create({ data: { merchantId, enabled: true, servingEnabled: false, stations: ['热厨'], categoryRoutes: [] } });
  }, 30000);
  afterAll(async () => { if (app) await app.close(); });

  it('enforces customer and merchant account boundaries', async () => {
    await request(app.getHttpServer()).get('/api/v1/reservations').expect(401);
    await call('get', '/merchant/reservations').expect(403);
    await call('get', '/reservations', undefined, staffToken).expect(403);
  });
  it('publishes reservation services for a closed merchant without claiming instant confirmation', async () => {
    const result = await call('get', `/merchants/${merchantId}`).expect(200);
    expect(result.body.data).toMatchObject({ isOpen: false, pickupReservationEnabled: true, dineInReservationEnabled: true });
  });
  it('accepts a large group and a distant date without opening a table bill', async () => {
    const result = await dining({ guestCount: 1000, scheduledFor: future(60 * 24 * 45) }).expect(201);
    expect(result.body.data.status).toBe('PENDING');
    expect(await prisma.order.count({ where: { merchantId } })).toBe(0);
    expect(await prisma.tableSession.count({ where: { merchantId } })).toBe(0);
  });
  it.each([{ guestCount: 0 }, { scheduledFor: '2020-01-01T00:00:00Z' }, { scheduledFor: '2026-10-20T12:00:00' }, { contactPhone: 'abc' }])('rejects invalid required information %j', async patch => {
    await dining(patch).expect(400);
  });
  it('allows cancellation while pending and keeps it idempotent', async () => {
    const row = (await dining().expect(201)).body.data;
    await call('post', `/reservations/${row.id}/cancel`).expect(201);
    await call('post', `/reservations/${row.id}/cancel`).expect(201);
    await action(row.id, 'CONFIRM').expect(409);
  });
  it('isolates customer ownership and merchant ownership', async () => {
    const row = (await dining().expect(201)).body.data;
    await call('get', `/reservations/${row.id}`, undefined, otherUserToken).expect(404);
    await action(row.id, 'CONFIRM', {}, 'DINE_IN', otherStaffToken).expect(404);
    const otherList = (await call('get', '/merchant/reservations', undefined, otherStaffToken).expect(200)).body.data.reservations;
    expect(otherList).toEqual([]);
  });
  it('serializes concurrent duplicate seats-only submissions to one reservation', async () => {
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 4 }, () => dining({}, key)));
    expect(responses.map(response => response.status)).toEqual([201, 201, 201, 201]);
    expect(new Set(responses.map(response => response.body.data.id)).size).toBe(1);
    expect(await prisma.diningReservation.count({ where: { userId, idempotencyKey: key } })).toBe(1);
  });
  it('requires the customer to accept a proposed time and rejects stale replies', async () => {
    const row = (await dining().expect(201)).body.data;
    const newTime = future(180);
    const proposed = (await action(row.id, 'PROPOSE_TIME', { scheduledFor: newTime }).expect(201)).body.data;
    expect(proposed.scheduledFor).toBe(row.scheduledFor);
    await action(row.id, 'CONFIRM').expect(409);
    await call('post', `/reservations/DINE_IN/${row.id}/reply-time`, { accept: true, proposedScheduledFor: future(240) }).expect(409);
    const accepted = (await call('post', `/reservations/DINE_IN/${row.id}/reply-time`, { accept: true, proposedScheduledFor: newTime }).expect(201)).body.data;
    expect(accepted.scheduledFor).toBe(newTime);
    await action(row.id, 'CONFIRM').expect(201);
    await call('post', `/reservations/${row.id}/cancel`).expect(409);
  });
  it('defers preselected dishes, seats exactly once, reuses the order for scanned additions and checks out once', async () => {
    await addItem('DINE_IN').expect(201);
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 3 }, () => dining({ withCart: true, expectedAmountVnd: '100000' }, key)));
    expect(responses.map(response => response.status)).toEqual([201, 201, 201]);
    const row = responses[0].body.data;
    expect(new Set(responses.map(response => response.body.data.id)).size).toBe(1);
    expect(row.items).toHaveLength(1);
    expect(await prisma.order.count({ where: { userId } })).toBe(0);
    const table = await newTable();
    await action(row.id, 'SEAT', { tableId: table.id.toString() }).expect(409);
    await action(row.id, 'CONFIRM').expect(201);
    const seats = await Promise.all(Array.from({ length: 3 }, () => action(row.id, 'SEAT', { tableId: table.id.toString() })));
    expect(seats.map(response => response.status)).toEqual([201, 201, 201]);
    const seated = seats[0].body.data;
    expect(seated.status).toBe('SEATED');
    expect(await prisma.order.count({ where: { tableSessionId: BigInt(seated.tableSessionId) } })).toBe(1);
    expect(await prisma.kdsTask.count({ where: { orderId: BigInt(seated.orderId) } })).toBe(0);
    const otherTable = await newTable();
    await action(row.id, 'SEAT', { tableId: otherTable.id.toString() }).expect(409);
    await addItem('DINE_IN', table.qrToken).expect(201);
    const added = await call('post', '/orders', { merchantId: merchantId.toString(), orderType: 'DINE_IN', tableToken: table.qrToken }, userToken, randomUUID()).expect(201);
    expect(added.body.data.id).toBe(seated.orderId);
    const canonical = (await call('get', `/merchant/table-sessions/${seated.tableSessionId}/canonical-state`, undefined, staffToken).expect(200)).body.data;
    expect(canonical.totals.originalAmountVnd).toBe('200000');
    await call('post', `/merchant/table-sessions/${seated.tableSessionId}/cashier-checkout`, { paymentMethod: 'CASH' }, staffToken).expect(201);
    expect((await call('get', `/reservations/${row.id}`).expect(200)).body.data.status).toBe('COMPLETED');
  });
  it('never seats another party into an occupied table', async () => {
    const table = await newTable();
    const rows = await Promise.all([dining(), dining()]);
    for (const response of rows) await action(response.body.data.id, 'CONFIRM').expect(201);
    const seats = await Promise.all(rows.map(response => action(response.body.data.id, 'SEAT', { tableId: table.id.toString() })));
    expect(seats.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.tableSession.count({ where: { tableId: table.id, status: 'OPEN' } })).toBe(1);
  });
  it('plans a future visit on an occupied table, keeps both parties independent, and seats on a different free table', async () => {
    const table = await newTable(); const replacement = await newTable();
    const first = (await dining()).body.data;
    await action(first.id, 'CONFIRM').expect(201);
    const seatedFirst = (await action(first.id, 'SEAT', { tableId: table.id.toString() }).expect(201)).body.data;
    const second = (await dining({ contactName: '后续预约', scheduledFor: future(180) })).body.data;
    const beforeOrders = await prisma.order.count({ where: { merchantId } });
    const beforeSessions = await prisma.tableSession.count({ where: { merchantId } });
    const confirmed = (await action(second.id, 'CONFIRM', { tableId: table.id.toString() }).expect(201)).body.data;
    expect(confirmed.assignedTable).toEqual({ id: table.id.toString(), tableNo: table.tableNo, tableName: null });
    expect(confirmed.table).toBeNull(); expect(confirmed.tableSessionId).toBeNull();
    expect(JSON.stringify(confirmed)).not.toContain('qrToken');
    expect(await prisma.order.count({ where: { merchantId } })).toBe(beforeOrders);
    expect(await prisma.tableSession.count({ where: { merchantId } })).toBe(beforeSessions);
    const customer = (await call('get', `/reservations/${second.id}`).expect(200)).body.data;
    expect(customer.assignedTable.tableNo).toBe(table.tableNo);
    await action(second.id, 'SEAT', { tableId: table.id.toString() }).expect(409);
    const moved = (await action(second.id, 'SEAT', { tableId: replacement.id.toString() }).expect(201)).body.data;
    expect(moved.table.id).toBe(replacement.id.toString());
    expect(moved.assignedTable.tableNo).toBe(replacement.tableNo);
    expect(moved.tableSessionId).not.toBe(seatedFirst.tableSessionId);
    const firstAfter = (await call('get', `/reservations/${first.id}`).expect(200)).body.data;
    expect(firstAfter.tableSessionId).toBe(seatedFirst.tableSessionId);
    expect(firstAfter.status).toBe('SEATED');
  });

  it('assigns only owned active tables and can change or clear a plan after confirmation', async () => {
    const row = (await dining()).body.data;
    const foreign = await prisma.diningTable.create({ data: { merchantId: otherMerchantId, tableNo: `F${randomBytes(5).toString('hex')}`, qrToken: randomBytes(32).toString('hex') } });
    const disabled = await prisma.diningTable.create({ data: { merchantId, tableNo: `D${randomBytes(5).toString('hex')}`, qrToken: randomBytes(32).toString('hex'), status: 'DISABLED' } });
    await action(row.id, 'CONFIRM', { tableId: foreign.id.toString() }).expect(400);
    await action(row.id, 'CONFIRM', { tableId: '0' }).expect(400);
    await action(row.id, 'CONFIRM', { tableId: disabled.id.toString() }).expect(400);
    await action(row.id, 'ASSIGN_TABLE').expect(409);
    const table = await newTable(); const other = await newTable();
    await action(row.id, 'CONFIRM', { tableId: table.id.toString() }).expect(201);
    expect((await action(row.id, 'CONFIRM').expect(201)).body.data.assignedTable.id).toBe(table.id.toString());
    await action(row.id, 'CONFIRM', { tableId: other.id.toString() }).expect(409);
    await action(row.id, 'ASSIGN_TABLE', { tableId: other.id.toString() }, 'DINE_IN', otherStaffToken).expect(404);
    expect((await action(row.id, 'ASSIGN_TABLE', { tableId: other.id.toString() }).expect(201)).body.data.assignedTable.id).toBe(other.id.toString());
    expect((await action(row.id, 'ASSIGN_TABLE').expect(201)).body.data.assignedTable).toBeNull();
  });

  it('serializes concurrent confirmations and keeps the winning table snapshot on retries', async () => {
    const row = (await dining()).body.data; const one = await newTable(); const two = await newTable();
    const results = await Promise.all([action(row.id, 'CONFIRM', { tableId: one.id.toString() }), action(row.id, 'CONFIRM', { tableId: two.id.toString() })]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    const winner = results.find(result => result.status === 201)!.body.data;
    expect((await action(row.id, 'CONFIRM').expect(201)).body.data.assignedTable).toEqual(winner.assignedTable);
  });
  it('creates a future pickup while closed, holds kitchen work until start, and retains pickup time on its receipt', async () => {
    await addItem('PICKUP').expect(201);
    const time = future(240);
    const row = (await pickup(time).expect(201)).body.data;
    const orderId = BigInt(row.id);
    expect(row).toMatchObject({ isReservation: true, status: 'PENDING_ACCEPTANCE', scheduledFor: time });
    await action(row.id, 'CONFIRM', {}, 'PICKUP').expect(201);
    await call('get', '/merchant/kds', undefined, staffToken).expect(200);
    expect(await prisma.kdsTask.count({ where: { orderId } })).toBe(0);
    expect(await prisma.printTriggerOutbox.count({ where: { orderId } })).toBe(0);
    await call('post', `/merchant/orders/${row.id}/start-preparing`, {}, staffToken).expect(201);
    expect(await prisma.kdsTask.count({ where: { orderId } })).toBe(1);
    const receipt = await app.get(ReceiptSnapshotService).fromOrder(merchantId, orderId);
    expect(receipt.order?.scheduledFor).toBe(time);
    for (const paperWidth of ['MM58', 'MM80'] as const) {
      const printed = printDocumentLines(renderPrintDocumentV3({ receipt, paperWidth, purpose: 'FRONT_DESK' })).join('\n');
      expect(printed).toContain('预约取餐'); expect(printed).toContain(receipt.order!.pickupCode!);
    }
    await call('post', `/merchant/orders/${row.id}/ready`, {}, staffToken).expect(201);
    await call('post', `/merchant/orders/${row.id}/cashier-complete`, { paymentMethod: 'CASH' }, staffToken).expect(201);
    expect((await call('get', `/orders/${row.id}`).expect(200)).body.data.status).toBe('COMPLETED');
  });
  it('prevents pickup preparation while a time change is awaiting consent', async () => {
    await addItem('PICKUP').expect(201);
    const row = (await pickup().expect(201)).body.data;
    await action(row.id, 'CONFIRM', {}, 'PICKUP').expect(201);
    const newTime = future(180);
    await action(row.id, 'PROPOSE_TIME', { scheduledFor: newTime }, 'PICKUP').expect(201);
    await call('post', `/merchant/orders/${row.id}/start-preparing`, {}, staffToken).expect(409);
    await call('post', `/reservations/PICKUP/${row.id}/reply-time`, { accept: false, proposedScheduledFor: newTime }).expect(201);
    await call('post', `/merchant/orders/${row.id}/start-preparing`, {}, staffToken).expect(201);
  });
  it('blocks new reservations after the merchant disables the service, while keeping existing requests', async () => {
    await call('patch', '/merchant/profile', { dineInReservationEnabled: null }, staffToken).expect(400);
    const row = (await dining().expect(201)).body.data;
    await call('patch', '/merchant/profile', { dineInReservationEnabled: false }, staffToken).expect(200);
    await dining().expect(400);
    await action(row.id, 'CONFIRM').expect(201);
    await call('patch', '/merchant/profile', { dineInReservationEnabled: true }, staffToken).expect(200);
  });
});
