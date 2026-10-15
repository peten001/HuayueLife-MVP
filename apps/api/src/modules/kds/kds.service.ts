import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { KdsTask, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { applyKitchenAction } from './kds-domain';
import { KdsActionDto, KdsPackDto, KdsSettingsDto, KdsUndoDto } from './kds.dto';
import { DEFAULT_KDS_STATIONS, finishKdsOrder, kdsEnabled, kdsHash, syncKdsOrder } from './kds-sync';

type OperationLine = {
  taskId: string; orderId: string; dishName: string; quantity: number;
  beforeMade: number; beforeServed: number; beforeStarted: string | null; afterVersion: number;
  station: string; unit: string; orderNo?: string; tableNo?: string | null; orderType?: string;
  autoServed?: boolean;
};

@Injectable()
export class KdsService {
  constructor(private readonly prisma: PrismaService) {}

  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(work, { timeout: 20000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }); }
      catch (error) {
        if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2034'].includes(error.code)) continue;
        throw error;
      }
    }
  }

  async board(merchantId: bigint) {
    await this.assertMerchantActive(this.prisma, merchantId);
    await this.transaction(async tx => {
      const setting = await kdsEnabled(tx, merchantId);
      if (!setting) return;
      const active = await tx.order.findMany({ where: {
        merchantId, voidedAt: null, status: { in: ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'] },
      }, select: { id: true } });
      const outstanding = await tx.kdsTask.findMany({ where: { merchantId, resolvedAt: null }, select: { orderId: true } });
      const orderIds = [...new Set([...active.map(order => order.id), ...outstanding.map(task => task.orderId)])];
      await this.lockOrders(tx, merchantId, orderIds);
      for (const id of orderIds) await syncKdsOrder(tx, merchantId, id);
    });
    const [settings, tasks, operations, categories] = await Promise.all([
      this.prisma.kdsSetting.findUnique({ where: { merchantId } }),
      this.prisma.kdsTask.findMany({
        where: { merchantId, OR: [{ resolvedAt: null }, { updatedAt: { gte: new Date(Date.now() - 86400000) } },
          { order: { status: { in: ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'] } } }] },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { order: { select: {
          id: true, orderNo: true, orderType: true, status: true, tableNoSnapshot: true, tableSessionId: true,
          table: { select: { tableNo: true } }, customerRemark: true, createdAt: true,
          kdsPackedAt: true,
          items: { select: { id: true, quantity: true, productNameZhSnapshot: true } },
        } } },
      }),
      this.prisma.kdsOperation.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' }, take: 200 }),
      this.prisma.category.findMany({ where: { merchantId }, select: { id: true, nameZh: true }, orderBy: { sortOrder: 'asc' } }),
    ]);
    const visibleTaskIds = new Set(tasks.map(task => task.id.toString()));
    const historyTaskIds = [...new Set(operations.flatMap(operation => Array.isArray(operation.lines)
      ? operation.lines.flatMap(line => line && typeof line === 'object' && !Array.isArray(line) &&
        typeof line.taskId === 'string' && /^\d+$/.test(line.taskId) && !visibleTaskIds.has(line.taskId) ? [line.taskId] : []) : []))];
    // Recent records may refer to tasks outside the active board; keep their original IDs and snapshots.
    const historyTasks = historyTaskIds.length ? await this.prisma.kdsTask.findMany({
      where: { merchantId, id: { in: historyTaskIds.map(id => BigInt(id)) } }, select: { id: true, productId: true },
    }) : [];
    const taskProducts = new Map([...tasks, ...historyTasks].map(task => [task.id.toString(), task.productId]));
    const productIds = [...new Set([...taskProducts.values()].flatMap(id => id === null ? [] : [id]))];
    // Read existing compressed menu images in one merchant-scoped query; never fall back to originals.
    const products = productIds.length ? await this.prisma.product.findMany({
      where: { merchantId, id: { in: productIds }, deletedAt: null },
      select: { id: true, menuThumbnailUrl: true, nameVi: true, nameEn: true },
    }) : [];
    const productDisplay = new Map(products.map(product => [product.id, product]));
    const translatedNames = (productId: bigint | null | undefined) => {
      const product = productId == null ? undefined : productDisplay.get(productId);
      return { dishNameVi: product?.nameVi ?? null, dishNameEn: product?.nameEn ?? null };
    };
    return {
      settings: settings ?? { enabled: false, servingEnabled: true, timeoutMinutes: 15, stations: DEFAULT_KDS_STATIONS, categoryRoutes: [] },
      tasks: tasks.map(task => ({ ...task, ...translatedNames(task.productId),
        menuThumbnailUrl: task.productId === null ? null : productDisplay.get(task.productId)?.menuThumbnailUrl ?? null, order: {
        ...task.order, tableNo: task.order.table?.tableNo ?? task.order.tableNoSnapshot,
        pickupCode: task.order.orderType === 'PICKUP' ? task.order.orderNo.replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase() : null,
      } })), operations: operations.map(operation => ({ ...operation, lines: Array.isArray(operation.lines)
        ? operation.lines.map(line => line && typeof line === 'object' && !Array.isArray(line)
          ? { ...line, ...translatedNames(taskProducts.get(String(line.taskId))) } : line) : operation.lines,
      })), categories, serverTime: new Date(),
    };
  }

  async settings(merchantId: bigint, dto: KdsSettingsDto) {
    const stations = dto.stations.map(station => station.trim());
    if (stations.some(station => !station) || new Set(stations).size !== stations.length ||
      dto.categoryRoutes.some(route => !stations.includes(route.station))) {
      throw new BadRequestException('档口名称不能为空或重复，分类必须关联已有档口');
    }
    const categoryIds = dto.categoryRoutes.map(route => BigInt(route.categoryId));
    if (new Set(dto.categoryRoutes.map(route => route.categoryId)).size !== categoryIds.length) {
      throw new BadRequestException('每个分类只能关联一个档口');
    }
    return this.transaction(async tx => {
      await this.assertMerchantActive(tx, merchantId);
      await this.lockSettings(tx, merchantId);
      const count = await tx.category.count({ where: { merchantId, id: { in: categoryIds } } });
      if (count !== categoryIds.length) throw new BadRequestException('菜品分类不属于当前门店');
      const previous = await tx.kdsSetting.findUnique({ where: { merchantId }, select: { enabled: true } });
      const settings = await tx.kdsSetting.upsert({ where: { merchantId },
        create: { merchantId, ...dto, servingEnabled: dto.servingEnabled ?? true, stations, categoryRoutes: dto.categoryRoutes as unknown as Prisma.InputJsonValue, activatedAt: dto.enabled ? new Date() : null },
        update: { ...dto, stations, categoryRoutes: dto.categoryRoutes as unknown as Prisma.InputJsonValue,
          ...(dto.enabled && !previous?.enabled ? { activatedAt: new Date() } : {}),
          ...(dto.enabled ? {} : { enabled: false }) },
      });
      if (settings.enabled && settings.servingEnabled === false) {
        const active = await tx.order.findMany({ where: { merchantId, voidedAt: null, status: { in: ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'] } }, select: { id: true } });
        const outstanding = await tx.kdsTask.findMany({ where: { merchantId, resolvedAt: null }, select: { orderId: true } });
        const ids = [...new Set([...active.map(order => order.id), ...outstanding.map(task => task.orderId)])];
        await this.lockOrders(tx, merchantId, ids);
        for (const id of ids) await syncKdsOrder(tx, merchantId, id);
      }
      return settings;
    });
  }

  async action(merchantId: bigint, staffId: bigint, dto: KdsActionDto) {
    if (new Set(dto.lines.map(line => line.taskId)).size !== dto.lines.length) throw new BadRequestException('同一任务不能重复提交');
    return this.transaction(async tx => {
      const settings = await this.requireEnabled(tx, merchantId);
      const replay = await this.replay(tx, merchantId, staffId, dto.requestKey, dto);
      if (replay) return replay;
      if (dto.action === 'SERVE' && settings.servingEnabled === false) throw new ConflictException('当前门店未开启传菜');
      const found = await tx.kdsTask.findMany({ where: { merchantId, id: { in: dto.lines.map(line => BigInt(line.taskId)) } } });
      if (found.length !== dto.lines.length) throw new NotFoundException('厨房任务不存在');
      await this.lockOrders(tx, merchantId, found.map(task => task.orderId));
      for (const orderId of new Set(found.map(task => task.orderId))) await syncKdsOrder(tx, merchantId, orderId);
      const lines: OperationLine[] = [];
      for (const line of dto.lines) {
        const task = await tx.kdsTask.findFirstOrThrow({ where: { id: BigInt(line.taskId), merchantId }, include: { order: true } });
        if (task.version !== line.version) throw new ConflictException('菜品数量或进度已变化，请刷新后重新选择');
        if (task.order.status === 'CANCELLED' || task.order.voidedAt || task.quantity === 0) throw new ConflictException('订单已退菜或作废');
        if (task.order.orderType !== 'DINE_IN' && ['READY', 'DELIVERING', 'COMPLETED'].includes(task.order.status)) {
          throw new ConflictException('订单已进入交付阶段，不能修改制作进度');
        }
        const next = applyKitchenAction(task, dto.action, line.quantity, settings.servingEnabled);
        if (['START', 'URGE'].includes(dto.action) && task.quantity === task.madeQuantity) throw new ConflictException('菜品已经做好');
        await this.updateTask(tx, task, {
          ...next, startedAt: ['START', 'MAKE'].includes(dto.action) ? task.startedAt ?? new Date() : task.startedAt,
          ...(dto.action === 'URGE' ? { urgentAt: new Date() } : {}),
          resolvedAt: next.servedQuantity === task.quantity ? new Date() : null,
        });
        lines.push({ ...this.operationLine(task, line.quantity),
          ...(dto.action === 'MAKE' && settings.servingEnabled === false ? { autoServed: true } : {}),
        });
        if (['START', 'MAKE'].includes(dto.action) && task.order.status === 'ACCEPTED') {
          const updated = await tx.order.updateMany({ where: { id: task.orderId, merchantId, status: 'ACCEPTED' }, data: { status: 'PREPARING' } });
          if (updated.count) await tx.orderStatusLog.create({ data: {
            orderId: task.orderId, fromStatus: 'ACCEPTED', toStatus: 'PREPARING',
            operatorType: 'MERCHANT_STAFF', operatorStaffId: staffId, action: 'KDS_STARTED', remark: '厨房开始制作',
          } });
        }
      }
      if (dto.action === 'SERVE' || (dto.action === 'MAKE' && settings.servingEnabled === false)) {
        for (const orderId of new Set(found.map(task => task.orderId))) {
          await finishKdsOrder(tx, merchantId, orderId, { staffId, requestKey: dto.requestKey, withoutServing: settings.servingEnabled === false });
        }
      }
      return this.record(tx, merchantId, staffId, dto.requestKey, dto.action, dto, lines);
    });
  }

  async pack(merchantId: bigint, staffId: bigint, dto: KdsPackDto) {
    if (!dto.itemsChecked || !dto.utensilsChecked || !dto.remarksChecked) throw new BadRequestException('请完成菜品、餐具和备注核对');
    return this.transaction(async tx => {
      await this.requireEnabled(tx, merchantId);
      const replay = await this.replay(tx, merchantId, staffId, dto.requestKey, dto);
      if (replay) return replay;
      const orderId = BigInt(dto.orderId);
      await this.lockOrders(tx, merchantId, [orderId]);
      await syncKdsOrder(tx, merchantId, orderId);
      const order = await tx.order.findFirst({ where: { id: orderId, merchantId, voidedAt: null }, include: { items: true } });
      if (!order) throw new NotFoundException('订单不存在');
      if (order.orderType === 'DINE_IN' || !['ACCEPTED', 'PREPARING', 'READY'].includes(order.status)) throw new ConflictException('当前订单不能打包');
      const tasks = await tx.kdsTask.findMany({ where: { merchantId, orderId, quantity: { gt: 0 } } });
      if (!order.items.length || order.items.some(item => {
        const task = tasks.find(row => row.orderItemId === item.id);
        return !task || task.quantity !== item.quantity || task.madeQuantity !== item.quantity;
      })) throw new ConflictException('所有档口菜品尚未齐全，不能确认打包');
      if (order.kdsPackedAt) throw new ConflictException('该订单已经打包，请刷新');
      for (const task of tasks) await this.updateTask(tx, task, { servedQuantity: task.madeQuantity, resolvedAt: new Date() });
      const now = new Date();
      await tx.order.update({ where: { id: orderId }, data: { status: 'READY', readyAt: order.readyAt ?? now, kdsPackedAt: now } });
      await tx.orderStatusLog.create({ data: {
        orderId, fromStatus: order.status, toStatus: 'READY', operatorType: 'MERCHANT_STAFF',
        operatorStaffId: staffId, action: 'KDS_PACKED', requestKey: dto.requestKey, remark: '菜品、餐具与备注已核对，打包完成',
      } });
      return this.record(tx, merchantId, staffId, dto.requestKey, 'PACK', dto, tasks.map(task => this.operationLine({ ...task, order }, task.madeQuantity - task.servedQuantity)));
    });
  }

  async undo(merchantId: bigint, staffId: bigint, dto: KdsUndoDto) {
    return this.transaction(async tx => {
      const settings = await this.requireEnabled(tx, merchantId);
      const replay = await this.replay(tx, merchantId, staffId, dto.requestKey, dto);
      if (replay) return replay;
      const operation = await tx.kdsOperation.findFirst({ where: { id: dto.operationId, merchantId, staffId } });
      if (!operation || !['MAKE', 'SERVE'].includes(operation.kind) || operation.reversedAt) throw new ConflictException('该操作不能撤销');
      if (operation.kind === 'SERVE' && settings.servingEnabled === false) throw new ConflictException('当前门店未开启传菜');
      const lines = operation.lines as unknown as OperationLine[];
      await this.lockOrders(tx, merchantId, lines.map(line => BigInt(line.orderId)));
      for (const id of new Set(lines.map(line => line.orderId))) await syncKdsOrder(tx, merchantId, BigInt(id));
      for (const line of lines) {
        const task = await tx.kdsTask.findFirst({ where: { id: BigInt(line.taskId), merchantId }, include: { order: true } });
        if (!task || task.version !== line.afterVersion || task.order.kdsPackedAt ||
          task.order.voidedAt || task.order.status === 'CANCELLED' ||
          (task.order.orderType !== 'DINE_IN' && ['READY', 'DELIVERING', 'COMPLETED'].includes(task.order.status))) {
          throw new ConflictException('菜品已有后续操作或已交付，不能直接撤销');
        }
        await this.updateTask(tx, task, {
          madeQuantity: line.beforeMade, servedQuantity: line.beforeServed,
          startedAt: line.beforeStarted ? new Date(line.beforeStarted) : null,
          resolvedAt: line.beforeServed === task.quantity ? new Date() : null,
        });
      }
      await tx.kdsOperation.update({ where: { id: operation.id }, data: { reversedAt: new Date() } });
      return this.record(tx, merchantId, staffId, dto.requestKey, 'UNDO', dto, lines);
    });
  }

  private async lockOrders(tx: Prisma.TransactionClient, merchantId: bigint, ids: bigint[]) {
    const sorted = [...new Set(ids)].sort((a, b) => a < b ? -1 : 1);
    for (const id of sorted) await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} AND merchant_id = ${merchantId} FOR UPDATE`;
  }
  private async requireEnabled(tx: Prisma.TransactionClient, id: bigint) {
    await this.assertMerchantActive(tx, id);
    await this.lockSettings(tx, id);
    const settings = await kdsEnabled(tx, id);
    if (!settings) throw new ConflictException('请先由店主或经理开启 KDS');
    return settings;
  }
  private async lockSettings(tx: Prisma.TransactionClient, merchantId: bigint) {
    // All KDS writes take the settings lock before order locks, so another screen cannot race a policy change.
    await tx.$queryRaw`SELECT merchant_id FROM kds_settings WHERE merchant_id = ${merchantId} FOR UPDATE`;
  }
  private async assertMerchantActive(tx: Prisma.TransactionClient, merchantId: bigint) {
    if (!await tx.merchant.count({ where: { id: merchantId, status: 'ACTIVE' } })) throw new ForbiddenException('当前商家已停用');
  }
  private async updateTask(tx: Prisma.TransactionClient, task: KdsTask, data: Prisma.KdsTaskUpdateManyMutationInput) {
    const updated = await tx.kdsTask.updateMany({ where: { id: task.id, merchantId: task.merchantId, version: task.version }, data: { ...data, version: { increment: 1 } } });
    if (updated.count !== 1) throw new ConflictException('厨房任务已由其他设备更新，请刷新');
  }
  private operationLine(task: KdsTask & { order?: { orderNo: string; tableNoSnapshot: string | null; orderType: string } }, quantity: number): OperationLine {
    return { taskId: task.id.toString(), orderId: task.orderId.toString(), dishName: task.dishName, quantity,
      beforeMade: task.madeQuantity, beforeServed: task.servedQuantity,
      beforeStarted: task.startedAt?.toISOString() ?? null, afterVersion: task.version + 1,
      station: task.station, unit: task.unit, orderNo: task.order?.orderNo, tableNo: task.order?.tableNoSnapshot, orderType: task.order?.orderType };
  }
  private async replay(tx: Prisma.TransactionClient, merchantId: bigint, staffId: bigint, requestKey: string, payload: unknown) {
    const op = await tx.kdsOperation.findUnique({ where: { merchantId_requestKey: { merchantId, requestKey } } });
    if (!op) return null;
    if (op.payloadHash !== kdsHash(payload) || op.staffId !== staffId) throw new ConflictException('请求编号已用于其他操作');
    return { operationId: op.id, replay: true };
  }
  private async record(tx: Prisma.TransactionClient, merchantId: bigint, staffId: bigint, requestKey: string, kind: string, payload: unknown, lines: OperationLine[]) {
    const op = await tx.kdsOperation.create({ data: {
      id: randomUUID(), merchantId, staffId, requestKey, payloadHash: kdsHash(payload), kind,
      lines: lines as unknown as Prisma.InputJsonValue,
    } });
    return { operationId: op.id, replay: false };
  }
}
