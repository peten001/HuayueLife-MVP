import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { parseReservationTime } from './reservation-policy';
import { CreateDiningReservationDto } from './reservation.dto';

function setup() {
  let row: any = { id: 11n, userId: 2n, merchantId: 3n, reservationNo: 'YY11', status: 'PENDING',
    scheduledFor: new Date(Date.now() + 60_000), proposedScheduledFor: null, guestCount: 2,
    contactName: '张先生', contactPhone: '0901234567', items: [], itemAmountVnd: 0n, audit: [],
    createdAt: new Date(), merchant: { id: 3n, nameZh: '预约测试餐厅' }, tableSession: null };
  const product = { id: 9n, merchantId: 3n, categoryId: 7n, category: { isActive: true },
    nameZh: '炒饭', nameVi: 'Cơm', nameEn: 'Rice', status: 'ON_SALE', priceVnd: 50000n,
    deletedAt: null, productType: 'FOOD', imageUrl: null };
  const table = { id: 6n, merchantId: 3n, tableNo: 'A6', qrToken: 'a'.repeat(64), status: 'ACTIVE' };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 11n }]),
    diningReservation: {
      findUnique: jest.fn().mockImplementation(async () => null),
      findFirst: jest.fn().mockImplementation(async () => row),
      create: jest.fn().mockImplementation(async ({ data }) => ({ ...row, ...data })),
      update: jest.fn().mockImplementation(async ({ data }) => {
        row = { ...row, ...data };
        if (data.tableSessionId) row.tableSession = { id: 8n, status: 'OPEN', tableId: 6n, table };
        return row;
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    cart: { findFirst: jest.fn().mockResolvedValue({ id: 10n, items: [{ quantity: 2, remark: '少辣', product }] }), update: jest.fn() },
    diningTable: { findFirst: jest.fn().mockResolvedValue(table) },
    product: { findMany: jest.fn().mockResolvedValue([product]) },
    merchant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ businessHours: {} }) },
    order: {
      findFirst: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn(), findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 19n }),
    },
    orderStatusLog: { create: jest.fn() },
  };
  const prisma = { ...tx, $transaction: jest.fn(async work => work(tx)) };
  const cart = { resolveContext: jest.fn().mockResolvedValue({ merchantId: 3n, orderType: 'DINE_IN', tableId: null }),
    findActiveCart: jest.fn().mockResolvedValue({ id: 10n }) };
  const creators = { assertValid: jest.fn() };
  const tables = { getOrCreateOpenSession: jest.fn().mockResolvedValue({ id: 8n, created: true }) };
  const push = { enqueueReservation: jest.fn() };
  const merchantOrders = { transition: jest.fn() };
  const service = new ReservationsService(prisma as never, { assertOrderingEnabled: jest.fn() } as never,
    cart as never, tables as never, creators as never, merchantOrders as never, push as never);
  const dto: CreateDiningReservationDto = { merchantId: '3', scheduledFor: new Date(Date.now() + 120_000).toISOString(),
    guestCount: 2, contactName: '张先生', contactPhone: '0901234567', withCart: false };
  return { service, prisma, tx, cart, tables, creators, push, merchantOrders, dto, product, row: () => row,
    set: (value: object) => { row = { ...row, ...value }; } };
}

describe('arrival reservation policy', () => {
  it('accepts any future time, including outside business hours, far future and immediate requests', () => {
    const now = Date.parse('2026-10-19T10:00:00Z');
    for (const value of ['2026-10-19T17:00:01+07:00', '2030-01-01T03:07:00+07:00']) {
      expect(parseReservationTime(value, now).getTime()).toBeGreaterThan(now);
    }
  });
  it.each(['invalid', '2026-10-19T10:00:00', '2026-10-18T10:00:00Z'])('rejects malformed, timezone-free or past time %s', value => {
    expect(() => parseReservationTime(value, Date.parse('2026-10-19T10:00:00Z'))).toThrow(BadRequestException);
  });
});

describe('ReservationsService', () => {
  it('creates a seats-only request without a dining order, table session or kitchen task and without capacity limits', async () => {
    const h = setup();
    await h.service.create(2n, 'reservation-key-1', { ...h.dto, guestCount: 1000 });
    expect(h.cart.resolveContext).toHaveBeenCalledWith(h.tx, { merchantId: '3', orderType: 'DINE_IN', reservation: true });
    expect(h.tx.diningReservation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ guestCount: 1000, items: [], itemAmountVnd: 0n }) }));
    expect(h.tables.getOrCreateOpenSession).not.toHaveBeenCalled();
    expect(h.tx.order.create).not.toHaveBeenCalled();
    expect(h.push.enqueueReservation).toHaveBeenCalledWith(h.tx, 11n);
  });
  it('snapshots preselected dishes in the request and consumes the cart transactionally', async () => {
    const h = setup();
    const result = await h.service.create(2n, 'reservation-key-1', { ...h.dto, withCart: true, expectedAmountVnd: '100000' });
    expect(result.itemAmountVnd).toBe(100000n);
    expect(result.items).toEqual([expect.objectContaining({ productId: '9', quantity: 2, unitPriceVnd: '50000', productNameViSnapshot: 'Cơm', remark: '少辣' })]);
    expect(h.tx.cart.update).toHaveBeenCalledWith({ where: { id: 10n }, data: { status: 'CHECKED_OUT' } });
    expect(h.tx.order.create).not.toHaveBeenCalled();
  });
  it('does not accept a price change without user confirmation', async () => {
    const h = setup();
    await expect(h.service.create(2n, 'reservation-key-1', { ...h.dto, withCart: true, expectedAmountVnd: '90000' })).rejects.toThrow(ConflictException);
    expect(h.tx.diningReservation.create).not.toHaveBeenCalled();
    expect(h.tx.cart.update).not.toHaveBeenCalled();
  });
  it('replays a committed request before pricing or validating a now-past appointment time', async () => {
    const h = setup();
    h.tx.diningReservation.findUnique.mockResolvedValue(h.row());
    await h.service.create(2n, 'reservation-key-1', { ...h.dto, scheduledFor: '2020-01-01T00:00:00Z' });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.tx.diningReservation.create).not.toHaveBeenCalled();
  });
  it('requires user ownership when reading a reservation', async () => {
    const h = setup(); h.tx.diningReservation.findFirst.mockResolvedValue(null);
    await expect(h.service.getUser(99n, 11n)).rejects.toThrow(NotFoundException);
    expect(h.tx.diningReservation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 11n, userId: 99n } }));
  });
  it('requires merchant ownership before confirming', async () => {
    const h = setup(); h.tx.diningReservation.findFirst.mockResolvedValue(null);
    await expect(h.service.merchantAction(90n, 5n, 'DINE_IN', 11n, { action: 'CONFIRM' })).rejects.toThrow(NotFoundException);
    expect(h.tx.diningReservation.update).not.toHaveBeenCalled();
  });
  it('confirms without opening a table or authorizing kitchen preparation', async () => {
    const h = setup();
    const result = await h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'CONFIRM' });
    expect(result.status).toBe('CONFIRMED');
    expect(h.tx.order.create).not.toHaveBeenCalled();
    expect(h.tables.getOrCreateOpenSession).not.toHaveBeenCalled();
  });
  it('allows the customer to cancel pending requests only', async () => {
    const h = setup();
    expect((await h.service.cancelUser(2n, 11n)).status).toBe('CANCELLED');
    h.set({ status: 'CONFIRMED' });
    await expect(h.service.cancelUser(2n, 11n)).rejects.toThrow(ConflictException);
  });
  it('shares the planned table without a QR, a live bill or kitchen work', async () => {
    const h = setup();
    const result = await h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'CONFIRM', tableId: '6' });
    expect(result).toMatchObject({ assignedTable: { id: 6n, tableNo: 'A6', tableName: null } });
    expect(result.table).toBeNull();
    expect(JSON.stringify(result, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).not.toContain('qrToken');
    expect(h.tx.diningTable.findFirst).toHaveBeenCalledWith({ where: { id: 6n, merchantId: 3n, status: 'ACTIVE' } });
    expect(h.tx.order.create).not.toHaveBeenCalled();
    expect(h.tables.getOrCreateOpenSession).not.toHaveBeenCalled();
    await h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'CONFIRM' });
    expect(h.row().assignedTableId).toBe(6n);
    expect(h.tx.diningReservation.update).toHaveBeenCalledTimes(1);
  });
  it('allows staff to change or clear a confirmed plan without opening a table', async () => {
    const h = setup(); h.set({ status: 'CONFIRMED' });
    expect(await h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'ASSIGN_TABLE', tableId: '6' })).toMatchObject({ assignedTable: { tableNo: 'A6' } });
    expect(await h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'ASSIGN_TABLE' })).toMatchObject({ assignedTable: null });
    expect(h.tables.getOrCreateOpenSession).not.toHaveBeenCalled();
    expect(h.tx.order.create).not.toHaveBeenCalled();
  });
  it.each(['PENDING', 'SEATED', 'CANCELLED', 'NO_SHOW', 'COMPLETED'])('does not assign a table to %s reservations', async status => {
    const h = setup(); h.set({ status });
    await expect(h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'ASSIGN_TABLE', tableId: '6' })).rejects.toThrow(ConflictException);
    expect(h.tx.diningReservation.update).not.toHaveBeenCalled();
  });
  it('does not assign an unavailable or foreign table', async () => {
    const h = setup(); h.tx.diningTable.findFirst.mockResolvedValue(null);
    await expect(h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'CONFIRM', tableId: '99' })).rejects.toThrow(BadRequestException);
    expect(h.tx.diningReservation.update).not.toHaveBeenCalled();
  });
  it('keeps the original time while staff proposes a change', async () => {
    const h = setup(); const original = h.row().scheduledFor;
    const next = new Date(Date.now() + 3600000).toISOString();
    const result = await h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'PROPOSE_TIME', scheduledFor: next });
    expect(result.scheduledFor).toEqual(original);
    expect(result.proposedScheduledFor).toEqual(new Date(next));
    await expect(h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'CONFIRM' })).rejects.toThrow(ConflictException);
    const accepted = await h.service.replyTime(2n, 'DINE_IN', 11n, { accept: true, proposedScheduledFor: next });
    expect(accepted.scheduledFor).toEqual(new Date(next));
    expect(accepted.proposedScheduledFor).toBeNull();
  });
  it('rejects a stale response to a superseded time proposal', async () => {
    const h = setup(); h.set({ proposedScheduledFor: new Date(Date.now() + 3600000) });
    await expect(h.service.replyTime(2n, 'DINE_IN', 11n, { accept: true, proposedScheduledFor: new Date(Date.now() + 7200000).toISOString() })).rejects.toThrow(ConflictException);
    expect(h.tx.diningReservation.update).not.toHaveBeenCalled();
  });
  it('declining a time change preserves the original appointment', async () => {
    const h = setup(); const original = h.row().scheduledFor;
    const next = new Date(Date.now() + 3600000); h.set({ proposedScheduledFor: next });
    const result = await h.service.replyTime(2n, 'DINE_IN', 11n, { accept: false, proposedScheduledFor: next.toISOString() });
    expect(result.scheduledFor).toEqual(original); expect(result.proposedScheduledFor).toBeNull();
  });
  it('seats a confirmed party without dishes by opening exactly one empty table session', async () => {
    const h = setup(); h.set({ status: 'CONFIRMED' });
    const first = await h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'SEAT', tableId: '6' });
    const replay = await h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'SEAT', tableId: '6' });
    expect(first.status).toBe('SEATED'); expect(replay.table?.qrToken).toHaveLength(64);
    expect(h.tables.getOrCreateOpenSession).toHaveBeenCalledTimes(1);
    expect(h.tx.order.create).not.toHaveBeenCalled();
    await expect(h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'SEAT', tableId: '99' })).rejects.toThrow(ConflictException);
  });
  it('preselected dishes join the table bill once and preserve the customer creator', async () => {
    const h = setup(); h.set({ status: 'CONFIRMED', itemAmountVnd: 100000n,
      items: [{ productId: '9', productNameZhSnapshot: '炒饭', quantity: 2, unitPriceVnd: '50000', subtotalVnd: '100000', remark: '' }] });
    await h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'SEAT', tableId: '6' });
    await h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'SEAT', tableId: '6' });
    expect(h.tx.order.create).toHaveBeenCalledTimes(1);
    expect(h.tx.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      userId: 2n, tableSessionId: 8n, idempotencyKey: 'reservation-11', status: 'ACCEPTED', totalAmountVnd: 100000n,
    }) }));
  });
  it('does not seat into another party’s existing table bill', async () => {
    const h = setup(); h.set({ status: 'CONFIRMED' }); h.tables.getOrCreateOpenSession.mockResolvedValue({ id: 8n, created: false });
    await expect(h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'SEAT', tableId: '6' })).rejects.toThrow(ConflictException);
    expect(h.tx.order.create).not.toHaveBeenCalled();
  });
  it('rechecks dish supply and pricing before seating', async () => {
    const h = setup(); h.set({ status: 'CONFIRMED', items: [{ productId: '9', quantity: 1, unitPriceVnd: '40000' }] });
    await expect(h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'SEAT', tableId: '6' })).rejects.toThrow(ConflictException);
    expect(h.tables.getOrCreateOpenSession).not.toHaveBeenCalled();
  });
  it('projects completed status from the closed table session without exposing the full session', async () => {
    const h = setup(); h.set({ status: 'SEATED', tableSession: { status: 'CLOSED', tableId: 6n, table: { tableNo: '6', qrToken: 'token' } } });
    const result = await h.service.getUser(2n, 11n);
    expect(result.status).toBe('COMPLETED'); expect(result.tableSession).toBeUndefined(); expect(result.table?.qrToken).toBeUndefined();
  });
  it('does not mark a future appointment as no-show', async () => {
    const h = setup(); h.set({ status: 'CONFIRMED' });
    await expect(h.service.merchantAction(3n, 5n, 'DINE_IN', 11n, { action: 'NO_SHOW' })).rejects.toThrow(ConflictException);
  });
});
