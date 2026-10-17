import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { OrderType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('KDS real MySQL workflow', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let merchantId: bigint, otherId: bigint, staffId: bigint, ordinaryId: bigint;
  let productId: bigint, barProductId: bigint, categoryId: bigint, barCategoryId: bigint;
  let token: string, otherToken: string, staffToken: string;
  let count = 0;
  const settings = (servingEnabled = true) => ({ enabled: true, servingEnabled, timeoutMinutes: 15, stations: ['热厨', '吧台'],
    categoryRoutes: [{ categoryId: barCategoryId.toString(), station: '吧台' }] });
  const call = (method: 'get' | 'post' | 'patch', path: string, data?: object, access = token) => {
    const req = request(app.getHttpServer())[method](`/api/v1${path}`).set('Authorization', `Bearer ${access}`);
    return data ? req.send(data) : req;
  };
  const board = async () => (await call('get', '/merchant/kds').expect(200)).body.data;
  const action = (task: { id: string; version: number }, quantity: number, kind = 'MAKE', key = randomUUID()) =>
    call('post', '/merchant/kds/actions', { action: kind, requestKey: key, lines: [{ taskId: task.id, version: task.version, quantity }] });

  beforeAll(async () => {
    process.env.PRINTING_TASK_CENTER_ENABLED = 'false';
    process.env.PRINTING_AUTO_CREATE_ENABLED = 'false';
    process.env.CLOUD_PRINT_WORKER_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init(); prisma = app.get(PrismaService);
    const merchantData = (name: string) => ({ nameZh: name, contactName: '测试', contactPhone: '0900000000',
      province: 'Bac Ninh', city: 'Bac Ninh', addressDetail: '隔离测试库', latitude: 21.17, longitude: 106.07,
      businessHours: {}, status: 'ACTIVE' as const, merchantMode: 'MANAGED' as const, pickupEnabled: true, deliveryEnabled: true });
    merchantId = (await prisma.merchant.create({ data: merchantData('KDS 隔离测试') })).id;
    otherId = (await prisma.merchant.create({ data: merchantData('KDS 另一门店') })).id;
    const passwordHash = await bcrypt.hash('KdsTest123!', 4);
    staffId = (await prisma.merchantStaff.create({ data: { merchantId, username: `kds-${randomUUID().slice(0, 8)}`, displayName: 'KDS 店主', role: 'OWNER', passwordHash } })).id;
    ordinaryId = (await prisma.merchantStaff.create({ data: { merchantId, username: `kds-${randomUUID().slice(0, 8)}`, displayName: 'KDS 员工', role: 'STAFF', passwordHash } })).id;
    const otherStaff = await prisma.merchantStaff.create({ data: { merchantId: otherId, username: `kds-${randomUUID().slice(0, 8)}`, displayName: '另一门店', role: 'OWNER', passwordHash } });
    const jwt = app.get(JwtService);
    const sign = (id: bigint, merchant: bigint, role: string) => jwt.sign({ sub: id.toString(), merchantId: merchant.toString(), role, accountType: 'MERCHANT_STAFF' });
    token = sign(staffId, merchantId, 'OWNER'); otherToken = sign(otherStaff.id, otherId, 'OWNER'); staffToken = sign(ordinaryId, merchantId, 'STAFF');
    categoryId = (await prisma.category.create({ data: { merchantId, nameZh: '热菜' } })).id;
    barCategoryId = (await prisma.category.create({ data: { merchantId, nameZh: '饮品' } })).id;
    productId = (await prisma.product.create({ data: { merchantId, categoryId, nameZh: '宫保鸡丁', priceVnd: 10000n, status: 'ON_SALE', unit: '份' } })).id;
    barProductId = (await prisma.product.create({ data: { merchantId, categoryId: barCategoryId, nameZh: '茶饮', priceVnd: 10000n, status: 'ON_SALE', unit: '份' } })).id;
    await call('patch', '/merchant/kds/settings', settings()).expect(200);
  }, 30000);

  async function order(orderType: OrderType = 'DINE_IN', quantity = 3, notified = quantity, extraDrink = false, pending = false) {
    count++;
    let tableId: bigint | undefined, tableSessionId: bigint | undefined;
    if (orderType === 'DINE_IN') {
      const table = await prisma.diningTable.create({ data: { merchantId, tableNo: `${count}`, qrToken: randomUUID() } }); tableId = table.id;
      const session = await prisma.tableSession.create({ data: { merchantId, tableId, openTableId: tableId, sessionNo: randomUUID().replace(/-/g, '').slice(0, 32) } }); tableSessionId = session.id;
    }
    const items = [{ productId, productNameZhSnapshot: '宫保鸡丁', unitPriceVnd: 10000n, quantity, productionNotifiedQuantity: notified, subtotalVnd: BigInt(quantity) * 10000n },
      ...(extraDrink ? [{ productId: barProductId, productNameZhSnapshot: '茶饮', unitPriceVnd: 10000n, quantity: 1, productionNotifiedQuantity: 0, subtotalVnd: 10000n }] : [])];
    const row = await prisma.order.create({ data: {
      merchantId, createdByStaffId: staffId, orderNo: `KDS${randomUUID().replace(/-/g, '').slice(0, 25)}`,
      idempotencyKey: randomUUID(), orderType, status: pending ? 'PENDING_ACCEPTANCE' : 'ACCEPTED', acceptedAt: pending ? null : new Date(), tableId, tableSessionId,
      tableNoSnapshot: orderType === 'DINE_IN' ? String(count) : null, itemAmountVnd: BigInt(quantity + Number(extraDrink)) * 10000n,
      totalAmountVnd: BigInt(quantity + Number(extraDrink)) * 10000n, items: { create: items },
    }, include: { items: true } });
    await board();
    return row;
  }
  async function task(orderId: bigint, product = productId) {
    return (await board()).tasks.find((row: { orderId: string; productId: string }) => row.orderId === orderId.toString() && row.productId === product.toString());
  }

  it('supports manual reporting without a printing feature, printer or print rule', async () => {
    const row = await order('DINE_IN', 3, 0);
    expect(await task(row.id)).toBeUndefined();
    const key = randomUUID();
    const response = await call('post', `/merchant/table-sessions/${row.tableSessionId}/production-notifications`, { requestKey: key }).expect(201);
    expect(response.body.data.queuedItemQuantity).toBe(3);
    expect((await task(row.id)).quantity).toBe(3);
    const replay = await call('post', `/merchant/table-sessions/${row.tableSessionId}/production-notifications`, { requestKey: key }).expect(201);
    expect(replay.body.data.idempotentReplay).toBe(true);
    expect(await prisma.printTriggerOutbox.count({ where: { merchantId } })).toBe(0);
  });
  it('makes 2 of 3, preserves the second table, and replays an identical request once', async () => {
    const first = await order(); const second = await order('DINE_IN', 2);
    const firstTask = await task(first.id); const key = randomUUID();
    expect(firstTask.order.tableSessionId).toBe(first.tableSessionId!.toString());
    await action(firstTask, 2, 'MAKE', key).expect(201);
    const replay = await action(firstTask, 2, 'MAKE', key).expect(201);
    expect(replay.body.data.replay).toBe(true);
    expect((await task(first.id)).madeQuantity).toBe(2);
    expect((await task(second.id)).madeQuantity).toBe(0);
    await action(await task(first.id), 2).expect(409);
  });
  it('creates kitchen tasks atomically on accepting pickup without printing configured', async () => {
    const row = await order('PICKUP', 1, 0, false, true);
    expect(await task(row.id)).toBeUndefined();
    await call('post', `/merchant/orders/${row.id}/accept`, {}).expect(201);
    expect((await task(row.id)).quantity).toBe(1);
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: row.items[0]!.id } })).productionNotifiedQuantity).toBe(1);
  });
  it('returns dining-session identity and atomically bumps same-session orders without touching another station', async () => {
    const first = await order('DINE_IN', 3, 3, true);
    const added = await order('DINE_IN', 1);
    await prisma.order.update({ where: { id: added.id }, data: { tableId: first.tableId,
      tableSessionId: first.tableSessionId, tableNoSnapshot: first.tableNoSnapshot } });
    await call('post', `/merchant/table-sessions/${first.tableSessionId}/production-notifications`, { requestKey: randomUUID() }).expect(201);
    const one = await task(first.id); const two = await task(added.id);
    expect(one.order.tableSessionId).toBe(first.tableSessionId!.toString());
    expect(two.order.tableSessionId).toBe(one.order.tableSessionId);
    expect(one.order.tableNo).toBe(two.order.tableNo);
    await call('post', '/merchant/kds/actions', { action: 'MAKE', requestKey: randomUUID(), lines: [
      { taskId: one.id, version: one.version, quantity: 3 }, { taskId: two.id, version: two.version, quantity: 1 },
    ] }).expect(201);
    expect((await task(first.id)).madeQuantity).toBe(3);
    expect((await task(added.id)).madeQuantity).toBe(1);
    expect((await task(first.id, barProductId)).madeQuantity).toBe(0);
  });
  it('reports only added portions without resetting previous work', async () => {
    const row = await order(); await action(await task(row.id), 2).expect(201);
    await prisma.orderItem.update({ where: { id: row.items[0]!.id }, data: { quantity: 5 } });
    expect((await task(row.id)).quantity).toBe(3);
    await call('post', `/merchant/table-sessions/${row.tableSessionId}/production-notifications`, { requestKey: randomUUID() }).expect(201);
    const after = await task(row.id); expect(after.quantity).toBe(5); expect(after.madeQuantity).toBe(2);
  });
  it('rejects duplicate task entries, fractions and reused request keys with different payloads', async () => {
    const row = await order(); const item = await task(row.id); const key = randomUUID();
    await action(item, 1, 'MAKE', key).expect(201);
    await action(item, 2, 'MAKE', key).expect(409);
    await action(await task(row.id), 1.5).expect(400);
    await call('post', '/merchant/kds/actions', { action: 'MAKE', requestKey: randomUUID(), lines: [
      { taskId: item.id, version: item.version, quantity: 1 }, { taskId: item.id, version: item.version, quantity: 1 },
    ] }).expect(400);
  });
  it('accepts only one of two simultaneous bumps from the same task version', async () => {
    const row = await order(); const item = await task(row.id);
    const replies = await Promise.all([action(item, 2), action(item, 2)]);
    expect(replies.map(reply => reply.status).sort()).toEqual([201, 409]);
    expect((await task(row.id)).madeQuantity).toBe(2);
  });
  it('rushes a waiting dish without silently starting or completing it', async () => {
    const row = await order(); await action(await task(row.id), 1, 'URGE').expect(201);
    const rushed = await task(row.id); expect(rushed.urgentAt).not.toBeNull();
    expect(rushed.startedAt).toBeNull(); expect(rushed.madeQuantity).toBe(0);
  });
  it('retains unfinished kitchen work after dine-in financial completion', async () => {
    const row = await order();
    await prisma.order.update({ where: { id: row.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    const item = await task(row.id); expect(item.quantity).toBe(3);
    await action(item, 2).expect(201);
    expect((await task(row.id)).madeQuantity).toBe(2);
  });
  it('retains a fully returned original item, prepared quantities and history, invalidating its stale batch', async () => {
    const row = await order(); const item = await task(row.id);
    await action(item, 2).expect(201);
    await call('post', `/merchant/orders/${row.id}/items/${row.items[0]!.id}/return`, { requestKey: randomUUID(), expectedQuantity: 3, returnQuantity: 3 }).expect(201);
    const returned = await task(row.id); expect(returned.quantity).toBe(0); expect(returned.cancelledQuantity).toBe(3);
    expect(await prisma.orderItem.findUnique({ where: { id: row.items[0]!.id } })).toMatchObject({ quantity: 0, returnedQuantity: 3, subtotalVnd: 0n });
    expect(returned.returnedMadeQuantity).toBe(2);
    const state = (await call('get', `/merchant/table-sessions/${row.tableSessionId}/canonical-state`).expect(200)).body.data;
    expect(state.items).toHaveLength(0);
    expect(state.returnedItems).toEqual([expect.objectContaining({ quantity: 0, returnedQuantity: 3 })]);
    expect(state.totals.payableAmountVnd).toBe('0');
    const operations = (await board()).operations.filter((op: { kind: string }) => op.kind === 'RETURN');
    expect(operations.some((op: { lines: { taskId: string; removedMade: number }[] }) => op.lines.some(line => line.taskId === item.id && line.removedMade === 2))).toBe(true);
    await action(item, 1).expect(409);
  });
  it('partially returns unmade portions, replays once, preserves make/serve history, then returns the rest', async () => {
    const row = await order('DINE_IN', 3, 3, true);
    const original = await task(row.id);
    await action(original, 2).expect(201);
    await action(await task(row.id), 1, 'SERVE').expect(201);
    const path = `/merchant/orders/${row.id}/items/${row.items[0]!.id}/return`;
    const payload = { requestKey: randomUUID(), expectedQuantity: 3, returnQuantity: 1 };
    await call('post', path, payload).expect(201);
    await call('post', path, payload).expect(201);
    expect(await task(row.id)).toMatchObject({ quantity: 2, madeQuantity: 2, servedQuantity: 1, cancelledQuantity: 1, returnedMadeQuantity: 0 });
    expect(await prisma.order.findUnique({ where: { id: row.id } })).toMatchObject({ itemAmountVnd: 30000n });
    await call('post', path, { requestKey: randomUUID(), expectedQuantity: 3, returnQuantity: 1 }).expect(409);
    await call('post', path, { requestKey: randomUUID(), expectedQuantity: 2, returnQuantity: 2 }).expect(201);
    expect(await task(row.id)).toMatchObject({ quantity: 0, cancelledQuantity: 3, returnedMadeQuantity: 2, returnedServedQuantity: 1 });
    expect(await prisma.order.findUnique({ where: { id: row.id } })).toMatchObject({ status: 'PREPARING', itemAmountVnd: 10000n });
    const state = (await call('get', `/merchant/table-sessions/${row.tableSessionId}/canonical-state`).expect(200)).body.data;
    expect(state.items).toHaveLength(1);
    expect(state.returnedItems).toHaveLength(1);
    expect(state.totals.payableAmountVnd).toBe('10000');
    await call('post', path, { requestKey: randomUUID(), expectedQuantity: 0, returnQuantity: 1 }).expect(400);
  });
  it('retains returned rows through canonical reconcile, reordering and checkout without billing them', async () => {
    const row = await order('DINE_IN', 3, 3, true);
    await action(await task(row.id), 2).expect(201);
    const path = `/merchant/table-sessions/${row.tableSessionId}/canonical-state`;
    let state = (await call('get', path).expect(200)).body.data;
    const desiredItems = state.items.map((line: { lineKey: string; quantity: number; productId: string }) => ({ lineKey: line.lineKey, desiredQuantity: line.productId === productId.toString() ? 2 : line.quantity }));
    const partial = { requestKey: randomUUID(), baseRevision: state.revision, desiredItems };
    await call('post', `${path}/reconcile`, partial).expect(201);
    await call('post', `${path}/reconcile`, partial).expect(201);
    state = (await call('get', path).expect(200)).body.data;
    expect(state.items.find((line: { productId: string }) => line.productId === productId.toString())).toMatchObject({ quantity: 2, returnedQuantity: 1 });
    expect(state.totals.payableAmountVnd).toBe('30000');
    await call('post', `${path}/reconcile`, { requestKey: randomUUID(), baseRevision: state.revision,
      desiredItems: state.items.map((line: { lineKey: string; quantity: number; productId: string }) => ({ lineKey: line.lineKey, desiredQuantity: line.productId === productId.toString() ? 0 : line.quantity })) }).expect(201);
    state = (await call('get', path).expect(200)).body.data;
    expect(state.returnedItems).toEqual([expect.objectContaining({ quantity: 0, returnedQuantity: 3 })]);
    expect(state.totals.payableAmountVnd).toBe('10000');
    await call('post', `${path}/reconcile`, { requestKey: randomUUID(), baseRevision: state.revision,
      desiredItems: [...state.items.map((line: { lineKey: string; quantity: number }) => ({ lineKey: line.lineKey, desiredQuantity: line.quantity })),
        { productId: productId.toString(), desiredQuantity: 1 }] }).expect(201);
    const rows = await prisma.orderItem.findMany({ where: { orderId: row.id, productId } });
    expect(rows).toHaveLength(2);
    expect(rows.find(item => item.id === row.items[0]!.id)).toMatchObject({ quantity: 0, returnedQuantity: 3 });
    expect(rows.find(item => item.id !== row.items[0]!.id)).toMatchObject({ quantity: 1, returnedQuantity: 0 });
    state = (await call('get', path).expect(200)).body.data;
    await call('post', `/merchant/table-sessions/${row.tableSessionId}/checkout`, {
      paymentMethod: 'CASH', expectedRevision: state.revision, requestKey: randomUUID(),
    }).expect(201);
    const history = (await call('get', `/merchant/settlements/session:${row.tableSessionId}`).expect(200)).body.data;
    expect(history.finalReceivableVnd).toBe('20000');
    expect(history.items).toEqual(expect.arrayContaining([expect.objectContaining({ quantity: 0, returnedQuantity: 3, subtotalVnd: '0' })]));
  });
  it('keeps an all-returned canonical session in complete order history after auto-release', async () => {
    const row = await order('DINE_IN', 2);
    const path = `/merchant/table-sessions/${row.tableSessionId}/canonical-state`;
    const state = (await call('get', path).expect(200)).body.data;
    const reply = await call('post', `${path}/reconcile`, { requestKey: randomUUID(), baseRevision: state.revision,
      desiredItems: state.items.map((line: { lineKey: string }) => ({ lineKey: line.lineKey, desiredQuantity: 0 })) }).expect(201);
    expect(reply.body.data).toMatchObject({ sessionStatus: 'CLOSED', releasedBecause: 'EMPTY_AFTER_RECONCILE', totals: { payableAmountVnd: '0' } });
    const history = (await call('get', `/merchant/settlements/session:${row.tableSessionId}`).expect(200)).body.data;
    expect(history).toMatchObject({ status: 'CANCELLED', finalReceivableVnd: '0', itemQuantity: 0 });
    expect(history.items).toEqual([expect.objectContaining({ quantity: 0, returnedQuantity: 2 })]);
  });
  it('serves only made dine-in portions and blocks undo after a later serving action', async () => {
    const row = await order(); const made = await action(await task(row.id), 2).expect(201);
    await action(await task(row.id), 3, 'SERVE').expect(409);
    await action(await task(row.id), 1, 'SERVE').expect(201);
    await call('post', '/merchant/kds/undo', { operationId: made.body.data.operationId, requestKey: randomUUID() }).expect(409);
    expect((await task(row.id)).servedQuantity).toBe(1);
  });
  it('undoes a valid bump atomically and replays the undo request', async () => {
    const row = await order(); const made = await action(await task(row.id), 2).expect(201); const key = randomUUID();
    const payload = { operationId: made.body.data.operationId, requestKey: key };
    await call('post', '/merchant/kds/undo', payload).expect(201);
    await call('post', '/merchant/kds/undo', payload).expect(201);
    expect((await task(row.id)).madeQuantity).toBe(0);
  });
  it('requires all stations and packing checks, then connects pickup and merchant delivery', async () => {
    for (const type of ['PICKUP', 'DELIVERY'] as const) {
      const row = await order(type, 1, 0, true);
      expect((await task(row.id, barProductId)).station).toBe('吧台');
      await action(await task(row.id), 1).expect(201);
      const pack = { orderId: row.id.toString(), requestKey: randomUUID(), itemsChecked: true, utensilsChecked: true, remarksChecked: true };
      await call('post', '/merchant/kds/pack', pack).expect(409);
      await call('post', `/merchant/orders/${row.id}/ready`, {}).expect(409);
      await action(await task(row.id, barProductId), 1).expect(201);
      await call('post', '/merchant/kds/pack', { ...pack, utensilsChecked: false }).expect(400);
      await call('post', '/merchant/kds/pack', pack).expect(201);
      const ready = await prisma.order.findUniqueOrThrow({ where: { id: row.id } });
      expect(ready.status).toBe('READY'); expect(ready.kdsPackedAt).not.toBeNull();
      if (type === 'DELIVERY') await call('post', `/merchant/orders/${row.id}/start-delivery`, {}).expect(201);
      await call('post', `/merchant/orders/${row.id}/cashier-complete`, { paymentMethod: 'CASH' }).expect(201);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('COMPLETED');
    }
  });
  it.each(['PICKUP', 'DELIVERY'] as const)('releases %s only after every station serves, without packing checks', async type => {
    const row = await order(type, 2, 0, true);
    await action(await task(row.id), 2).expect(201);
    const firstServe = await action(await task(row.id), 1, 'SERVE').expect(201);
    expect((await task(row.id)).servedQuantity).toBe(1);
    expect((await task(row.id)).order.status).toBe('PREPARING');
    expect((await task(row.id)).order.kdsPackedAt).toBeNull();
    await action(await task(row.id), 2, 'SERVE').expect(409);
    await call('post', `/merchant/orders/${row.id}/ready`, {}).expect(409);
    await action(await task(row.id), 1, 'SERVE').expect(201);
    await action(await task(row.id, barProductId), 1).expect(201);
    expect((await task(row.id)).order.status).toBe('PREPARING');
    const drink = await task(row.id, barProductId); const key = randomUUID();
    const done = await action(drink, 1, 'SERVE', key).expect(201);
    const replay = await action(drink, 1, 'SERVE', key).expect(201);
    expect(replay.body.data.replay).toBe(true);
    const ready = await prisma.order.findUniqueOrThrow({ where: { id: row.id } });
    expect(ready.status).toBe('READY'); expect(ready.kdsPackedAt).not.toBeNull();
    expect(await prisma.orderStatusLog.count({ where: { orderId: row.id, action: 'KDS_SERVED' } })).toBe(1);
    await call('post', '/merchant/kds/undo', { operationId: done.body.data.operationId, requestKey: randomUUID() }).expect(409);
    await call('post', '/merchant/kds/undo', { operationId: firstServe.body.data.operationId, requestKey: randomUUID() }).expect(409);
    expect((await task(row.id)).order).not.toHaveProperty('contactPhone');
    expect((await task(row.id)).order).not.toHaveProperty('deliveryAddress');
    if (type === 'DELIVERY') await call('post', `/merchant/orders/${row.id}/start-delivery`, {}).expect(201);
    await call('post', `/merchant/orders/${row.id}/cashier-complete`, { paymentMethod: 'CASH' }).expect(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('COMPLETED');
  });
  it('serves a cross-order batch atomically and keeps the untouched station waiting', async () => {
    const pickup = await order('PICKUP', 1, 0, true); const delivery = await order('DELIVERY', 1, 0);
    await action(await task(pickup.id), 1).expect(201); await action(await task(delivery.id), 1).expect(201);
    const one = await task(pickup.id); const two = await task(delivery.id);
    await call('post', '/merchant/kds/actions', { action: 'SERVE', requestKey: randomUUID(), lines: [
      { taskId: one.id, version: one.version, quantity: 1 }, { taskId: two.id, version: two.version, quantity: 1 },
    ] }).expect(201);
    expect((await task(pickup.id)).order.status).toBe('PREPARING');
    expect((await task(pickup.id, barProductId)).servedQuantity).toBe(0);
    expect((await task(delivery.id)).order.status).toBe('READY');
    await action(await task(pickup.id, barProductId), 1, 'SERVE').expect(409);
  });
  it('prevents one station from packing a changed order and requires renewed preparation', async () => {
    const row = await order('PICKUP', 1, 0);
    await action(await task(row.id), 1).expect(201);
    await call('post', '/merchant/kds/pack', { orderId: row.id.toString(), requestKey: randomUUID(), itemsChecked: true, utensilsChecked: true, remarksChecked: true }).expect(201);
    await prisma.orderItem.update({ where: { id: row.items[0]!.id }, data: { quantity: 2, productionNotifiedQuantity: 2 } });
    const after = await task(row.id);
    expect(after.madeQuantity).toBe(1); expect(after.order.kdsPackedAt).toBeNull(); expect(after.order.status).toBe('PREPARING');
    await call('post', `/merchant/orders/${row.id}/cashier-complete`, { paymentMethod: 'CASH' }).expect(409);
  });
  it('enforces store ownership, current roles and disabled staff', async () => {
    const row = await order(); const item = await task(row.id);
    await action(item, 1).expect(201);
    const foreign = await call('post', '/merchant/kds/actions', { action: 'MAKE', requestKey: randomUUID(), lines: [{ taskId: item.id, version: item.version, quantity: 1 }] }, otherToken);
    expect([404, 409]).toContain(foreign.status);
    await call('patch', '/merchant/kds/settings', settings(), staffToken).expect(403);
    await prisma.merchantStaff.update({ where: { id: ordinaryId }, data: { status: 'DISABLED' } });
    await call('get', '/merchant/kds', undefined, staffToken).expect(403);
  });
  it('allows already-ready legacy orders to finish without being re-cooked on KDS activation', async () => {
    const row = await prisma.order.create({ data: {
      merchantId, createdByStaffId: staffId, orderNo: `OLD${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      idempotencyKey: randomUUID(), orderType: 'PICKUP', status: 'READY', readyAt: new Date(),
      createdAt: new Date(Date.now() - 86400000), itemAmountVnd: 10000n, totalAmountVnd: 10000n,
      items: { create: { productId, productNameZhSnapshot: '旧单', quantity: 1, unitPriceVnd: 10000n, subtotalVnd: 10000n } },
    } });
    expect(await task(row.id)).toBeUndefined();
    await call('post', `/merchant/orders/${row.id}/cashier-complete`, { paymentMethod: 'CASH' }).expect(201);
  });
  it('snapshots the selling unit rather than turning skewers into portions', async () => {
    await prisma.product.update({ where: { id: productId }, data: { unit: '串' } });
    const row = await order(); expect((await task(row.id)).unit).toBe('串');
    await prisma.product.update({ where: { id: productId }, data: { unit: '份' } });
    expect((await task(row.id)).unit).toBe('串');
  });
  it('records external handoff after KDS is disabled and re-enabled without re-cooking it', async () => {
    const row = await order('PICKUP', 1, 0);
    await call('patch', '/merchant/kds/settings', { ...settings(), enabled: false }).expect(200);
    await call('post', `/merchant/orders/${row.id}/start-preparing`, {}).expect(201);
    await call('post', `/merchant/orders/${row.id}/ready`, {}).expect(201);
    await call('post', `/merchant/orders/${row.id}/cashier-complete`, { paymentMethod: 'CASH' }).expect(201);
    await call('patch', '/merchant/kds/settings', settings()).expect(200);
    const done = await task(row.id); expect(done.madeQuantity).toBe(1); expect(done.servedQuantity).toBe(1);
    expect((await board()).operations.some((op: { kind: string }) => op.kind === 'HANDOFF')).toBe(true);
  });

  it('disables serving for the whole merchant, releases existing prepared quantities and keeps partial make/undo working', async () => {
    const row=await order('DINE_IN',3); const original=await task(row.id);
    await action(original,1).expect(201);
    await call('patch','/merchant/kds/settings',settings(false)).expect(200);
    let current=await task(row.id);
    expect(current.madeQuantity).toBe(1);expect(current.servedQuantity).toBe(1);
    await action(current,1,'SERVE').expect(409);
    await action(original,1).expect(409);
    const made=await action(current,1,'MAKE').expect(201);
    current=await task(row.id);expect(current.madeQuantity).toBe(2);expect(current.servedQuantity).toBe(2);
    await call('post','/merchant/kds/undo',{operationId:made.body.data.operationId,requestKey:randomUUID()}).expect(201);
    current=await task(row.id);expect(current.madeQuantity).toBe(1);expect(current.servedQuantity).toBe(1);
    // Older clients changing another setting must not silently turn serving back on.
    const {servingEnabled: omitted,...legacySettings}=settings();
    expect(omitted).toBe(true);
    await call('patch','/merchant/kds/settings',legacySettings).expect(200);
    expect((await board()).settings.servingEnabled).toBe(false);
    await call('patch','/merchant/kds/settings',settings()).expect(200);
    current=await task(row.id);expect(current.servedQuantity).toBe(1);
    await action(current,1).expect(201);
    current=await task(row.id);expect(current.madeQuantity).toBe(2);expect(current.servedQuantity).toBe(1);
    await action(current,1,'SERVE').expect(201);
  });

  it.each(['PICKUP','DELIVERY'] as const)('reaches READY after every station is made with serving off and retains the cashier %s handoff', async type => {
    await call('patch','/merchant/kds/settings',settings(false)).expect(200);
    const row=await order(type,2,2,true);
    await call('post',`/merchant/orders/${row.id}/ready`,{}).expect(409);
    let main=await task(row.id);
    await action(main,1).expect(201);expect((await task(row.id)).order.status).toBe('PREPARING');
    main=await task(row.id);await action(main,1).expect(201);
    expect((await task(row.id)).order.kdsPackedAt).toBeNull();
    const drink=await task(row.id,barProductId);await action(drink,1).expect(201);
    const ready=await task(row.id);expect(ready.order.status).toBe('READY');expect(ready.order.kdsPackedAt).not.toBeNull();
    if(type==='DELIVERY')await call('post',`/merchant/orders/${row.id}/start-delivery`,{}).expect(201);
    await call('post',`/merchant/orders/${row.id}/cashier-complete`,{paymentMethod:'CASH'}).expect(201);
    expect((await prisma.order.findUniqueOrThrow({where:{id:row.id}})).status).toBe('COMPLETED');
    await call('patch','/merchant/kds/settings',settings()).expect(200);
  });

  it('turns a previously made pickup into READY when serving is turned off, and does not queue it again on re-enable', async () => {
    const row=await order('PICKUP',1);await action(await task(row.id),1).expect(201);
    expect((await task(row.id)).order.status).toBe('PREPARING');
    await call('patch','/merchant/kds/settings',settings(false)).expect(200);
    expect((await task(row.id)).order.status).toBe('READY');
    await call('patch','/merchant/kds/settings',settings()).expect(200);
    const current=await task(row.id);expect(current.servedQuantity).toBe(1);expect(current.order.status).toBe('READY');
  });

  it('serializes a serving toggle with an in-flight make without losing or duplicating finished portions', async () => {
    const row=await order('DINE_IN',3);const current=await task(row.id);const key=randomUUID();
    const results=await Promise.all([action(current,1,'MAKE',key),call('patch','/merchant/kds/settings',settings(false))]);
    expect(results.map(r=>r.status)).toEqual([201,200]);
    const after=await task(row.id);expect(after.madeQuantity).toBe(1);expect(after.servedQuantity).toBe(1);
    await action(current,1,'MAKE',key).expect(201);expect((await task(row.id)).madeQuantity).toBe(1);
    await call('patch','/merchant/kds/settings',settings()).expect(200);
  });

  it('keeps dine-in returns and added portions usable without serving', async () => {
    await call('patch','/merchant/kds/settings',settings(false)).expect(200);
    const row=await order('DINE_IN',3);await action(await task(row.id),1).expect(201);
    await call('post',`/merchant/orders/${row.id}/items/${row.items[0]!.id}/return`,{
      requestKey:randomUUID(),expectedQuantity:3,returnQuantity:2,
    }).expect(201);
    let current=await task(row.id);expect(current.quantity).toBe(1);expect(current.servedQuantity).toBe(1);
    await prisma.orderItem.update({where:{id:row.items[0]!.id},data:{quantity:2,productionNotifiedQuantity:2}});
    current=await task(row.id);expect(current.madeQuantity).toBe(1);expect(current.servedQuantity).toBe(1);
    expect(current.order.status).toBe('PREPARING');expect(current.order.kdsPackedAt).toBeNull();
    await action(current,1).expect(201);expect((await task(row.id)).servedQuantity).toBe(2);
    await call('patch','/merchant/kds/settings',settings()).expect(200);
  });

  it('reopens only newly added pickup quantities and keeps cashier completion usable with serving off', async () => {
    await call('patch','/merchant/kds/settings',settings(false)).expect(200);
    const row=await order('PICKUP',1);await action(await task(row.id),1).expect(201);
    expect((await task(row.id)).order.status).toBe('READY');
    await prisma.orderItem.update({where:{id:row.items[0]!.id},data:{quantity:2,productionNotifiedQuantity:2}});
    const current=await task(row.id);expect(current.madeQuantity).toBe(1);expect(current.servedQuantity).toBe(1);
    expect(current.order.status).toBe('PREPARING');expect(current.order.kdsPackedAt).toBeNull();
    await action(current,1).expect(201);expect((await task(row.id)).order.status).toBe('READY');
    await call('post',`/merchant/orders/${row.id}/cashier-complete`,{paymentMethod:'CASH'}).expect(201);
    await call('patch','/merchant/kds/settings',settings()).expect(200);
  });

  it('can resolve an already successful serving retry after disabling while refusing new serving writes', async () => {
    await call('patch','/merchant/kds/settings',settings()).expect(200);
    const row=await order('DINE_IN',3);await action(await task(row.id),1).expect(201);
    const current=await task(row.id);const key=randomUUID();await action(current,1,'SERVE',key).expect(201);
    await call('patch','/merchant/kds/settings',settings(false)).expect(200);
    const retry=await action(current,1,'SERVE',key).expect(201);expect(retry.body.data.replay).toBe(true);
    await action(await task(row.id),1,'SERVE').expect(409);
    expect((await task(row.id)).servedQuantity).toBe(1);
    await call('patch','/merchant/kds/settings',settings()).expect(200);
  });

  it('defaults a new merchant to serving enabled and refuses invalid or unauthorized switch changes', async () => {
    const created=await call('patch','/merchant/kds/settings',{
      enabled:true,timeoutMinutes:15,stations:['热厨'],categoryRoutes:[],
    },otherToken).expect(200);
    expect(created.body.data.servingEnabled).toBe(true);
    await call('patch','/merchant/kds/settings',{...settings(),servingEnabled:null}).expect(400);
    await call('patch','/merchant/kds/settings',{...settings(),servingEnabled:'false'}).expect(400);
    await call('patch','/merchant/kds/settings',settings(false),staffToken).expect(403);
    expect((await board()).settings.servingEnabled).toBe(true);
  });

  afterAll(async () => {
    if (prisma && merchantId) {
      const ids = [merchantId, otherId];
      await prisma.kdsOperation.deleteMany({ where: { merchantId: { in: ids } } });
      await prisma.kdsTask.deleteMany({ where: { merchantId: { in: ids } } });
      await prisma.kdsSetting.deleteMany({ where: { merchantId: { in: ids } } });
      await prisma.order.deleteMany({ where: { merchantId: { in: ids } } });
      await prisma.tableSession.deleteMany({ where: { merchantId: { in: ids } } });
      await prisma.diningTable.deleteMany({ where: { merchantId: { in: ids } } });
      await prisma.product.deleteMany({ where: { merchantId: { in: ids } } });
      await prisma.category.deleteMany({ where: { merchantId: { in: ids } } });
      await prisma.merchantStaff.deleteMany({ where: { merchantId: { in: ids } } });
      await prisma.merchant.deleteMany({ where: { id: { in: ids } } });
    }
    await app?.close();
  });
});
