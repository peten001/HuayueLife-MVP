import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { reconcileKitchenQuantity } from './kds-domain';

export const DEFAULT_KDS_STATIONS = ['热厨', '烧烤档', '粉面档', '吧台'];
export type CategoryRoute = { categoryId: string; station: string };

export function kdsHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function kdsEnabled(tx: Prisma.TransactionClient, merchantId: bigint) {
  // Some legacy service unit tests use narrow transaction doubles.
  if (!tx.kdsSetting) return null;
  const settings = await tx.kdsSetting.findUnique({ where: { merchantId } });
  return settings?.enabled ? settings : null;
}

/** Caller holds the order lock. Tasks and source deltas commit together. */
export async function syncKdsOrder(
  tx: Prisma.TransactionClient, merchantId: bigint, orderId: bigint,
  notifyDineIn = false,
) {
  const settings = await kdsEnabled(tx, merchantId);
  if (!settings) return;
  const order = await tx.order.findFirst({
    where: { id: orderId, merchantId },
    include: { items: { include: { product: { select: { categoryId: true, unit: true } } } } },
  });
  if (!order) return;
  const existing = await tx.kdsTask.findMany({ where: { merchantId, orderId } });
  if (!existing.length && (order.voidedAt || order.status === 'CANCELLED' ||
    (['READY', 'DELIVERING', 'COMPLETED'].includes(order.status) && order.createdAt < (settings.activatedAt ?? new Date())))) return;
  const cancelled = Boolean(order.voidedAt || order.status === 'CANCELLED');
  const routes = settings.categoryRoutes as CategoryRoute[];
  const stations = settings.stations as string[];
  const sourceItems = new Map(order.items.map(item => [item.id.toString(), item]));
  for (const item of order.items) {
    if (cancelled || order.status === 'PENDING_ACCEPTANCE') continue;
    if ((order.orderType !== 'DINE_IN' && ['ACCEPTED', 'PREPARING'].includes(order.status)) || notifyDineIn) {
      if (item.productionNotifiedQuantity < item.quantity) {
        await tx.orderItem.update({ where: { id: item.id }, data: { productionNotifiedQuantity: item.quantity } });
        item.productionNotifiedQuantity = item.quantity;
      }
    }
    const quantity = Math.min(item.quantity, item.productionNotifiedQuantity);
    if (!quantity || existing.some(task => task.orderItemId === item.id)) continue;
    const station = routes.find(route => route.categoryId === item.product?.categoryId?.toString())?.station
      ?? stations[0] ?? '热厨';
    const created = await tx.kdsTask.create({ data: {
      merchantId, orderId, orderItemId: item.id, productId: item.productId,
      categoryId: item.product?.categoryId, dishName: item.productNameZhSnapshot,
      remark: item.remark, unit: item.product?.unit?.trim() || '份', station, quantity,
    } });
    if (existing.length) {
      const lines = [{ taskId: created.id.toString(), orderId: orderId.toString(), dishName: created.dishName,
        station, unit: created.unit, orderNo: order.orderNo, orderType: order.orderType, tableNo: order.tableNoSnapshot, quantity }];
      await tx.kdsOperation.create({ data: { id: randomUUID(), merchantId, requestKey: `sync:new:${created.id}`,
        payloadHash: kdsHash(lines), kind: 'ADD', lines } });
    }
  }
  let changed = false;
  for (const task of existing) {
    const source = sourceItems.get(task.orderItemId.toString());
    const target = cancelled || !source ? 0 : Math.min(source.quantity, source.productionNotifiedQuantity);
    if (target === task.quantity) continue;
    changed = true;
    const next = reconcileKitchenQuantity(task, target);
    const result = await tx.kdsTask.updateMany({
      where: { id: task.id, merchantId, version: task.version },
      data: {
        quantity: target, madeQuantity: next.madeQuantity, servedQuantity: next.servedQuantity,
        cancelledQuantity: { increment: next.cancelled }, version: { increment: 1 },
        resolvedAt: next.servedQuantity === target ? new Date() : null,
      },
    });
    if (result.count !== 1) throw new ConflictException('厨房任务已变化，请刷新重试');
    const lines = [{ taskId: task.id.toString(), orderId: orderId.toString(), dishName: task.dishName,
      station: task.station, unit: task.unit, orderNo: order.orderNo, orderType: order.orderType, tableNo: order.tableNoSnapshot,
      quantity: Math.abs(target - task.quantity), beforeQuantity: task.quantity, afterQuantity: target,
      removedMade: next.removedMade, removedServed: next.removedServed, reason: order.cancelReason ?? '订单数量调整' }];
    await tx.kdsOperation.create({ data: {
      id: randomUUID(), merchantId, requestKey: `sync:${task.id}:${task.version + 1}`,
      payloadHash: kdsHash(lines), kind: target < task.quantity ? 'RETURN' : 'ADD', lines,
    } });
  }
  if (!cancelled && order.orderType !== 'DINE_IN' && !order.kdsPackedAt &&
    ['READY', 'DELIVERING', 'COMPLETED'].includes(order.status) && order.createdAt < (settings.activatedAt ?? new Date())) {
    // A fulfillment performed while KDS was off is a separate source event,
    // never a fabricated kitchen MAKE/PACK action or a reason to re-cook.
    const remaining = await tx.kdsTask.findMany({ where: { merchantId, orderId, resolvedAt: null } });
    for (const task of remaining) {
      await tx.kdsTask.update({ where: { id: task.id }, data: {
        madeQuantity: task.quantity, servedQuantity: task.quantity, resolvedAt: new Date(), version: { increment: 1 },
      } });
      const lines = [{ taskId: task.id.toString(), orderId: orderId.toString(), dishName: task.dishName,
        unit: task.unit, station: task.station, orderNo: order.orderNo, tableNo: order.tableNoSnapshot,
        orderType: order.orderType, quantity: task.quantity, reason: 'KDS 停用期间按收银交付流程完成' }];
      await tx.kdsOperation.create({ data: { id: randomUUID(), merchantId, requestKey: `handoff:${task.id}:${task.version}`,
        payloadHash: kdsHash(lines), kind: 'HANDOFF', lines } });
    }
  }
  if (changed || order.items.some(item => !existing.some(task => task.orderItemId === item.id) && item.productionNotifiedQuantity > 0)) {
    // An already packed pickup/delivery order must be rechecked after any delta.
    if (order.orderType !== 'DINE_IN' && order.kdsPackedAt) {
      const status = order.status === 'READY' ? 'PREPARING' : order.status;
      await tx.order.update({ where: { id: orderId }, data: { kdsPackedAt: null, status, ...(status !== order.status ? { readyAt: null } : {}) } });
      if (status !== order.status) await tx.orderStatusLog.create({ data: {
        orderId, fromStatus: order.status, toStatus: status, operatorType: 'SYSTEM',
        action: 'KDS_PACKING_INVALIDATED', remark: '菜品数量变化，需要重新核对打包',
      } });
    }
  }
}
