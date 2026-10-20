import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import request = require('supertest');
import sharp = require('sharp');
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
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
  const freshDiningCart = async () => {
    await prisma.cart.updateMany({ where: { userId, merchantId, orderType: 'DINE_IN', tableId: null, status: 'ACTIVE' }, data: { status: 'ABANDONED' } });
    return (await addItem('DINE_IN').expect(201)).body.data;
  };

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
  it('adds dishes after confirmation once, enforces ownership and keeps an ambiguous retry safe after seating', async () => {
    const row = (await dining().expect(201)).body.data;
    const cart = await freshDiningCart();
    const key = randomUUID(), payload = { cartId: cart.id, expectedAmountVnd: '100000' };
    const save = (token = userToken) => call('post', `/reservations/${row.id}/dishes`, payload, token, key);
    await save().expect(409);
    await action(row.id, 'CONFIRM').expect(201);
    await save(otherUserToken).expect(404);
    const responses = await Promise.all([save(), save(), save()]);
    expect(responses.map(r => r.status)).toEqual([201, 201, 201]);
    expect(responses.map(r => r.body.data.items.length)).toEqual([1, 1, 1]);
    expect(responses[0].body.data.itemAmountVnd).toBe('100000');
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: BigInt(cart.id) } })).status).toBe('CHECKED_OUT');
    expect(responses[0].body.data.tableSessionId).toBeNull();
    const other = (await dining().expect(201)).body.data;
    await action(other.id, 'CONFIRM').expect(201);
    await call('post', `/reservations/${other.id}/dishes`, payload, userToken, randomUUID()).expect(409);
    const table = await newTable();
    const seated = (await action(row.id, 'SEAT', { tableId: table.id.toString() }).expect(201)).body.data;
    await save().expect(201);
    await call('post', `/reservations/${row.id}/dishes`, payload, userToken, randomUUID()).expect(409);
    expect(await prisma.orderItem.count({ where: { orderId: BigInt(seated.orderId) } })).toBe(1);
    expect(await prisma.kdsTask.count({ where: { orderId: BigInt(seated.orderId) } })).toBe(0);
  });
  it('preserves existing dishes and the cart on price changes, then accepts the refreshed amount', async () => {
    const row = (await dining().expect(201)).body.data;
    await action(row.id, 'CONFIRM').expect(201);
    const cart = await freshDiningCart();
    await prisma.product.update({ where: { id: productId }, data: { priceVnd: 60000n } });
    try {
      await call('post', `/reservations/${row.id}/dishes`, { cartId: cart.id, expectedAmountVnd: '100000' }, userToken, randomUUID()).expect(409);
      expect((await prisma.cart.findUniqueOrThrow({ where: { id: BigInt(cart.id) } })).status).toBe('ACTIVE');
      expect((await call('get', `/reservations/${row.id}`).expect(200)).body.data.items).toEqual([]);
      await call('post', `/reservations/${row.id}/dishes`, { cartId: cart.id, expectedAmountVnd: '120000' }, userToken, randomUUID()).expect(201);
      const more = await freshDiningCart();
      const result = (await call('post', `/reservations/${row.id}/dishes`, { cartId: more.id, expectedAmountVnd: '120000' }, userToken, randomUUID()).expect(201)).body.data;
      expect(result.items).toHaveLength(2); expect(result.itemAmountVnd).toBe('240000');
    } finally { await prisma.product.update({ where: { id: productId }, data: { priceVnd: 50000n } }); }
  });
  it('blocks dishes during a time change and atomically resolves a race with seating', async () => {
    const row = (await dining().expect(201)).body.data;
    await action(row.id, 'CONFIRM').expect(201);
    const cart = await freshDiningCart(), time = future(180);
    const payload = { cartId: cart.id, expectedAmountVnd: '100000' };
    await action(row.id, 'PROPOSE_TIME', { scheduledFor: time }).expect(201);
    await call('post', `/reservations/${row.id}/dishes`, payload, userToken, randomUUID()).expect(409);
    await call('post', `/reservations/DINE_IN/${row.id}/reply-time`, { accept: false, proposedScheduledFor: time }).expect(201);
    const table = await newTable();
    const [added, seated] = await Promise.all([
      call('post', `/reservations/${row.id}/dishes`, payload, userToken, randomUUID()),
      action(row.id, 'SEAT', { tableId: table.id.toString() }),
    ]);
    expect(seated.status).toBe(201); expect([201, 409]).toContain(added.status);
    const actual = (await call('get', `/reservations/${row.id}`).expect(200)).body.data;
    expect(actual.items.length).toBe(added.status === 201 ? 1 : 0);
    const orders = await prisma.order.findMany({ where: { tableSessionId: BigInt(actual.tableSessionId) }, include: { items: true } });
    expect(orders.flatMap(order => order.items).length).toBe(actual.items.length);
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
  describe('reservation conversations', () => {
    it('allows a pending seats-only reservation to chat without creating an order or kitchen task', async () => {
      const row = (await dining().expect(201)).body.data;
      const before = await prisma.order.count({ where: { merchantId } });
      const chat = (await call('get', `/reservations/${row.id}/chat`).expect(200)).body.data;
      expect(chat).toMatchObject({ orderId: null, reservationId: row.id, status: 'ACTIVE', order: null,
        reservation: { id: row.id, status: 'PENDING' } });
      expect(chat.reservation.tableSession).toBeUndefined();
      await call('post', `/reservations/${row.id}/chat/messages`, { content: '  我会晚到十分钟  ' }).expect(201);
      const inbox = (await call('get', '/merchant/chat/conversations?unreadOnly=true', undefined, staffToken).expect(200)).body.data;
      expect(inbox).toEqual(expect.arrayContaining([expect.objectContaining({ reservationId: row.id, merchantUnreadCount: 1 })]));
      const rows = (await call('get', '/merchant/reservations', undefined, staffToken).expect(200)).body.data.reservations;
      expect(rows.find((candidate: { id: string; kind: string }) => candidate.id === row.id && candidate.kind === 'DINE_IN').chatConversation.merchantUnreadCount).toBe(1);
      expect(await prisma.order.count({ where: { merchantId } })).toBe(before);
      expect(await prisma.orderChatConversation.count({ where: { reservationId: BigInt(row.id) } })).toBe(1);
      expect((await call('get', `/reservations/${row.id}`).expect(200)).body.data.orderId).toBeNull();
    });
    it('serializes simultaneous first opens from both sides and concurrent sends into one conversation', async () => {
      const row = (await dining().expect(201)).body.data;
      const path = `/reservations/${row.id}/chat`;
      const results = await Promise.all([
        call('get', path).expect(200), call('get', `${path}/messages?limit=50`).expect(200),
        call('get', `/merchant${path}`, undefined, staffToken).expect(200),
        call('get', `/merchant${path}/messages`, undefined, staffToken).expect(200),
        call('post', `${path}/messages`, { content: '我会晚到' }).expect(201),
        call('post', `/merchant${path}/messages`, { content: '收到' }, staffToken).expect(201),
      ]);
      expect(results[0].body.data.id).toBe(results[2].body.data.id);
      expect(await prisma.orderChatConversation.count({ where: { reservationId: BigInt(row.id) } })).toBe(1);
      expect((await call('get', path).expect(200)).body.data).toMatchObject({ customerUnreadCount: 1, merchantUnreadCount: 1 });
      expect((await call('get', `${path}/messages`).expect(200)).body.data.items).toHaveLength(2);
    });
    it('supports merchant replies, unread summaries, forward pagination and read receipts on both sides', async () => {
      const row = (await dining().expect(201)).body.data;
      const path = `/reservations/${row.id}/chat`;
      const first = (await call('post', `${path}/messages`, { content: '临时多来一位' }).expect(201)).body.data;
      const reply = (await call('post', `/merchant${path}/messages`, { content: '收到，为您安排' }, staffToken).expect(201)).body.data;
      const location = (await call('post', `${path}/messages`, { messageType: 'LOCATION', latitude: 21.281, longitude: 106.197 }).expect(201)).body.data;
      expect(location).toMatchObject({ messageType: 'LOCATION', orderId: null, latitude: 21.281, longitude: 106.197 });
      const page = (await call('get', `${path}/messages?limit=1`).expect(200)).body.data;
      expect(page.items.map((message: { id: string }) => message.id)).toEqual([first.id]);
      expect(page.pageInfo).toMatchObject({ hasMore: true, nextCursor: first.id });
      const next = (await call('get', `${path}/messages?cursor=${first.id}&limit=50`).expect(200)).body.data;
      expect(next.items.map((message: { id: string }) => message.id)).toEqual([reply.id, location.id]);
      expect((await call('get', '/reservations').expect(200)).body.data.find((candidate: { id: string }) => candidate.id === row.id).chatConversation.customerUnreadCount).toBe(1);
      const read = (await call('post', `${path}/read`, {}).expect(201)).body.data;
      expect(read.customerUnreadCount).toBe(0); expect(read.merchantUnreadCount).toBe(2);
      const merchantRead = (await call('post', `/merchant${path}/read`, {}, staffToken).expect(201)).body.data;
      expect(merchantRead.merchantUnreadCount).toBe(0);
      const messages = (await call('get', `${path}/messages`).expect(200)).body.data.items;
      expect(messages.every((message: { readAt: string | null }) => message.readAt)).toBe(true);
      expect((await call('get', `/reservations/${row.id}`).expect(200)).body.data).toMatchObject({ guestCount: 2, status: 'PENDING', proposedScheduledFor: null });
    });
    it('isolates reservation read, send, read receipts and image uploads by customer, merchant and account type', async () => {
      const row = (await dining().expect(201)).body.data;
      const userPath = `/reservations/${row.id}/chat`;
      for (const [method, suffix, body] of [['get', '', undefined], ['get', '/messages', undefined], ['post', '/messages', { content: '禁止越权' }], ['post', '/read', {}]] as const) {
        await call(method, `${userPath}${suffix}`, body, otherUserToken).expect(404);
        await call(method, `/merchant${userPath}${suffix}`, body, otherStaffToken).expect(404);
      }
      await call('get', userPath, undefined, staffToken).expect(403);
      await call('get', `/merchant${userPath}`, undefined, userToken).expect(403);
      await request(app.getHttpServer()).get(`/api/v1${userPath}`).expect(401);
      await request(app.getHttpServer()).post(`/api/v1${userPath}/images`).set('Authorization', `Bearer ${otherUserToken}`)
        .attach('file', Buffer.from('invalid'), { filename: 'test.png', contentType: 'image/png' }).expect(404);
      expect(await prisma.orderChatConversation.count({ where: { reservationId: BigInt(row.id) } })).toBe(0);
    });
    it('keeps pickup, delivery and reservation conversations separate even when numeric IDs overlap', async () => {
      await addItem('PICKUP').expect(201);
      const order = (await pickup().expect(201)).body.data;
      const source = (await dining().expect(201)).body.data;
      // Fresh IDs avoid borrowing another fixture's reservation on repeated runs.
      const sharedId = BigInt(Date.now()) * 1000n + BigInt(randomBytes(2).readUInt16BE() % 1000);
      await prisma.order.update({ where: { id: BigInt(order.id) }, data: { id: sharedId } });
      await prisma.diningReservation.update({ where: { id: BigInt(source.id) }, data: { id: sharedId } });
      order.id = sharedId.toString();
      const reservationId = sharedId.toString();
      await call('post', `/orders/${order.id}/chat/messages`, { content: '自取改计划' }).expect(201);
      await call('post', `/reservations/${reservationId}/chat/messages`, { content: '用餐改计划' }).expect(201);
      const pickupChat = (await call('get', `/orders/${order.id}/chat`).expect(200)).body.data;
      const diningChat = (await call('get', `/reservations/${reservationId}/chat`).expect(200)).body.data;
      expect(pickupChat.id).not.toBe(diningChat.id);
      expect((await call('get', `/orders/${order.id}/chat/messages`).expect(200)).body.data.items.map((message: { content: string }) => message.content)).toEqual(['自取改计划']);
      expect((await call('get', `/reservations/${reservationId}/chat/messages`).expect(200)).body.data.items.map((message: { content: string }) => message.content)).toEqual(['用餐改计划']);
      const orders = (await call('get', '/orders').expect(200)).body.data;
      expect(orders.find((candidate: { id: string }) => candidate.id === order.id).chatConversation.lastMessage.content).toBe('自取改计划');
      await call('post', `/merchant/orders/${order.id}/chat/messages`, { content: '自取收到' }, staffToken).expect(201);
      expect((await call('get', `/orders/${order.id}/chat`).expect(200)).body.data.customerUnreadCount).toBe(1);
    });
    it('reuses image upload and optimization for reservation chat on both sides', async () => {
      const row = (await dining().expect(201)).body.data;
      const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#43a047' } }).png().toBuffer();
      const paths: string[] = [];
      try {
        for (const [prefix, token] of [['', userToken], ['/merchant', staffToken]]) {
          const result = await request(app.getHttpServer()).post(`/api/v1${prefix}/reservations/${row.id}/chat/images`)
            .set('Authorization', `Bearer ${token}`).attach('file', image, { filename: 'test.png', contentType: 'image/png' }).expect(201);
          expect(result.body.data).toMatchObject({ orderId: null, messageType: 'IMAGE', content: '[图片]' });
          expect(result.body.data.mediaUrl).toMatch(/^\/uploads\/chat\/[\da-f-]+\.webp$/);
          paths.push(result.body.data.mediaUrl);
        }
        const history = (await call('get', `/reservations/${row.id}/chat/messages`).expect(200)).body.data.items;
        expect(history.map((message: { senderType: string }) => message.senderType)).toEqual(['CUSTOMER', 'MERCHANT']);
      } finally {
        await Promise.all(paths.map(path => rm(join(process.cwd(), path.slice(1)), { force: true })));
      }
    });
    it('preserves the existing delivery chat routes and order-backed messages', async () => {
      const seed = await prisma.order.findFirstOrThrow({ where: { merchantId, userId }, orderBy: { id: 'desc' } });
      const { id: _id, ...data } = seed;
      const order = await prisma.order.create({ data: { ...data, orderNo: `CHAT${randomBytes(10).toString('hex')}`,
        idempotencyKey: randomUUID(), orderType: 'DELIVERY', isReservation: false, status: 'ACCEPTED' } });
      await call('post', `/orders/${order.id}/chat/messages`, { content: '配送联系' }).expect(201);
      await call('post', `/merchant/orders/${order.id}/chat/messages`, { messageType: 'LOCATION', latitude: 21.281, longitude: 106.197 }, staffToken).expect(201);
      expect((await call('get', `/orders/${order.id}/chat`).expect(200)).body.data).toMatchObject({ orderId: order.id.toString(), reservationId: null, status: 'ACTIVE' });
      const messages = (await call('get', `/orders/${order.id}/chat/messages`).expect(200)).body.data.items;
      expect(messages).toHaveLength(2); expect(messages.every((message: { orderId: string }) => message.orderId === order.id.toString())).toBe(true);
    });
    it('retains readable history after cancellation and rejects further messages from both sides', async () => {
      const row = (await dining().expect(201)).body.data;
      const path = `/reservations/${row.id}/chat`;
      await call('post', `${path}/messages`, { content: '今天临时有事' }).expect(201);
      await call('post', `/reservations/${row.id}/cancel`, {}).expect(201);
      expect((await call('get', path).expect(200)).body.data.status).toBe('CLOSED');
      expect((await call('get', `${path}/messages`).expect(200)).body.data.items).toHaveLength(1);
      await call('post', `${path}/messages`, { content: '结束后不能发' }).expect(409);
      await call('post', `/merchant${path}/messages`, { content: '结束后不能发' }, staffToken).expect(409);
      await call('post', `${path}/read`, {}).expect(201);
    });
    it('preserves the same conversation after seating and closes it when the table session ends', async () => {
      const row = (await dining().expect(201)).body.data;
      const path = `/reservations/${row.id}/chat`;
      const before = (await call('get', path).expect(200)).body.data;
      await action(row.id, 'CONFIRM').expect(201);
      const table = await newTable();
      const seated = (await action(row.id, 'SEAT', { tableId: table.id.toString() }).expect(201)).body.data;
      await call('post', `${path}/messages`, { content: '已经到店了' }).expect(201);
      expect((await call('get', path).expect(200)).body.data).toMatchObject({ id: before.id, status: 'ACTIVE', reservation: { status: 'SEATED' } });
      // Closing only a disposable, seats-only fixture; no payment or production writes.
      await prisma.tableSession.update({ where: { id: BigInt(seated.tableSessionId) }, data: { status: 'CLOSED', closedAt: new Date() } });
      const ended = (await call('get', path).expect(200)).body.data;
      expect(ended).toMatchObject({ id: before.id, status: 'CLOSED', reservation: { status: 'COMPLETED' } });
      expect(ended.reservation.tableSession).toBeUndefined();
      await call('post', `${path}/messages`, { messageType: 'LOCATION', latitude: 21, longitude: 106 }).expect(409);
    });
    it('makes no-show reservations read-only while preserving merchant unread history', async () => {
      const row = (await dining().expect(201)).body.data;
      await call('post', `/reservations/${row.id}/chat/messages`, { content: '可能赶不上了' }).expect(201);
      await action(row.id, 'CONFIRM').expect(201);
      await prisma.diningReservation.update({ where: { id: BigInt(row.id) }, data: { scheduledFor: new Date(Date.now() - 60000) } });
      await action(row.id, 'NO_SHOW').expect(201);
      const chat = (await call('get', `/merchant/reservations/${row.id}/chat`, undefined, staffToken).expect(200)).body.data;
      expect(chat).toMatchObject({ status: 'CLOSED', merchantUnreadCount: 1, reservation: { status: 'NO_SHOW' } });
      await call('post', `/reservations/${row.id}/chat/messages`, { content: '结束' }).expect(409);
    });
  });

});
