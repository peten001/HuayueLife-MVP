import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, PrinterPurpose } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { UpdatePrintingRoutingDto } from '../dto/printing-routing.dto';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';
import { PrintingSettingsService } from './printing-settings.service';

export const MANAGED_RULE_PREFIX = '__ROUTING_NEW_ORDER__:';

type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class PrintingRoutingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly settings: PrintingSettingsService,
    private readonly audit: PrintingAuditService,
  ) {}

  async get(merchantId: bigint) {
    this.flags.assertTaskCenterEnabled();
    const [routing, bindings, managedRules] = await Promise.all([
      this.prisma.merchantPrintingRouting.findUnique({ where: { merchantId } }),
      this.prisma.printerCategoryBinding.findMany({
        where: { merchantId },
        select: { printerId: true, categoryId: true },
      }),
      this.prisma.printRule.findMany({
        where: { merchantId, name: { startsWith: MANAGED_RULE_PREFIX } },
        select: { printerId: true, autoPrint: true, enabled: true },
      }),
    ]);
    const categoryIdsByPrinter = new Map<string, string[]>();
    for (const binding of bindings) {
      const key = binding.printerId.toString();
      categoryIdsByPrinter.set(key, [
        ...(categoryIdsByPrinter.get(key) ?? []),
        binding.categoryId.toString(),
      ]);
    }
    return {
      configured: Boolean(routing),
      checkoutDefaultPrinterId: routing?.checkoutDefaultPrinterId?.toString() ?? null,
      defaultKitchenPrinterId: routing?.defaultKitchenPrinterId?.toString() ?? null,
      printers: managedRules.map((rule) => ({
        printerId: rule.printerId.toString(),
        newOrderAutoPrint: rule.autoPrint && rule.enabled,
        categoryIds: categoryIdsByPrinter.get(rule.printerId.toString()) ?? [],
      })),
    };
  }

  async update(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    dto: UpdatePrintingRoutingDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    await this.settings.assertMerchantPrintingEnabled(merchantId);
    const normalized = this.normalize(dto);
    const printerIds = normalized.printers.map(({ printerId }) => printerId);
    const allReferencedIds = [
      ...printerIds,
      ...(normalized.checkoutDefaultPrinterId ? [normalized.checkoutDefaultPrinterId] : []),
      ...(normalized.defaultKitchenPrinterId ? [normalized.defaultKitchenPrinterId] : []),
    ];
    const printers = await this.prisma.printer.findMany({
      where: {
        merchantId,
        id: { in: [...new Set(allReferencedIds)] },
        deletedAt: null,
      },
      select: { id: true, purpose: true, enabled: true },
    });
    const byId = new Map(printers.map((printer) => [printer.id, printer]));
    if (printers.length !== new Set(allReferencedIds).size) {
      this.invalid('打印机不存在、已删除或不属于当前商家');
    }
    for (const entry of normalized.printers) {
      const printer = byId.get(entry.printerId);
      if (!printer || !['FRONT_DESK', 'KITCHEN'].includes(printer.purpose)) {
        this.invalid('自动打印只支持前台或厨房打印机');
      }
      if (!printer.enabled) this.invalid('已停用的打印机不能配置自动打印');
      if (printer.purpose !== 'KITCHEN' && entry.categoryIds.length > 0) {
        this.invalid('只有厨房打印机可以绑定菜品分类');
      }
    }
    this.assertDefaultPrinter(
      byId,
      normalized.checkoutDefaultPrinterId,
      'FRONT_DESK',
      '结账默认打印机必须是已启用的前台打印机',
    );
    this.assertDefaultPrinter(
      byId,
      normalized.defaultKitchenPrinterId,
      'KITCHEN',
      '默认厨房打印机必须是已启用的厨房打印机',
    );
    const categoryIds = normalized.printers.flatMap((entry) => entry.categoryIds);
    if (new Set(categoryIds).size !== categoryIds.length) {
      this.invalid('一个菜品分类只能绑定一台厨房打印机');
    }
    if (categoryIds.length > 0 && !normalized.defaultKitchenPrinterId) {
      this.invalid('启用分类分单前必须设置默认厨房打印机');
    }
    if (categoryIds.length > 0) {
      const categories = await this.prisma.category.findMany({
        where: { merchantId, id: { in: categoryIds } },
        select: { id: true },
      });
      if (categories.length !== categoryIds.length) {
        this.invalid('菜品分类不存在或不属于当前商家');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const previous = await tx.merchantPrintingRouting.findUnique({ where: { merchantId } });
      await tx.merchantPrintingRouting.upsert({
        where: { merchantId },
        create: {
          merchantId,
          checkoutDefaultPrinterId: normalized.checkoutDefaultPrinterId,
          defaultKitchenPrinterId: normalized.defaultKitchenPrinterId,
        },
        update: {
          checkoutDefaultPrinterId: normalized.checkoutDefaultPrinterId,
          defaultKitchenPrinterId: normalized.defaultKitchenPrinterId,
        },
      });
      await tx.printerCategoryBinding.deleteMany({ where: { merchantId } });
      const bindings = normalized.printers.flatMap((entry) =>
        entry.categoryIds.map((categoryId) => ({ merchantId, printerId: entry.printerId, categoryId })),
      );
      if (bindings.length) await tx.printerCategoryBinding.createMany({ data: bindings });

      const managed = await tx.printRule.findMany({
        where: { merchantId, name: { startsWith: MANAGED_RULE_PREFIX } },
        select: { id: true, printerId: true },
      });
      const configuredIds = new Set(printerIds);
      for (const rule of managed) {
        if (!configuredIds.has(rule.printerId)) {
          await tx.printRule.update({ where: { id: rule.id }, data: { autoPrint: false, enabled: false } });
        }
      }
      for (const entry of normalized.printers) {
        const data = {
          autoPrint: entry.newOrderAutoPrint,
          enabled: entry.newOrderAutoPrint,
          copies: 1,
          priority: 100,
        };
        const existing = managed.find((rule) => rule.printerId === entry.printerId);
        if (existing) {
          await tx.printRule.update({ where: { id: existing.id }, data });
        } else {
          await tx.printRule.create({
            data: {
              merchantId,
              name: `${MANAGED_RULE_PREFIX}${entry.printerId.toString()}`,
              orderType: null,
              triggerEvent: 'ORDER_ACCEPTED',
              receiptType: 'ORDER_CUSTOMER',
              printerId: entry.printerId,
              receiptTemplateId: null,
              ...data,
            },
          });
        }
      }
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'PRINTING_ROUTING_UPDATED',
          resourceType: 'MerchantPrintingRouting',
          resourceId: merchantId,
          beforeData: previous
            ? {
                checkoutDefaultPrinterId: previous.checkoutDefaultPrinterId?.toString() ?? null,
                defaultKitchenPrinterId: previous.defaultKitchenPrinterId?.toString() ?? null,
              }
            : null,
          afterData: {
            checkoutDefaultPrinterId: normalized.checkoutDefaultPrinterId?.toString() ?? null,
            defaultKitchenPrinterId: normalized.defaultKitchenPrinterId?.toString() ?? null,
            printerIds: normalized.printers.map((entry) => entry.printerId.toString()),
          },
          requestId,
        },
        tx,
      );
    });
    return this.get(merchantId);
  }

  async routingModeEnabled(client: DbClient, merchantId: bigint) {
    return Boolean(await client.merchantPrintingRouting.findUnique({ where: { merchantId }, select: { merchantId: true } }));
  }

  async requireCheckoutDefaultPrinter(merchantId: bigint) {
    const routing = await this.prisma.merchantPrintingRouting.findUnique({ where: { merchantId } });
    if (!routing?.checkoutDefaultPrinterId) this.invalid('请先设置结账默认前台打印机');
    const printer = await this.prisma.printer.findFirst({
      where: {
        id: routing.checkoutDefaultPrinterId,
        merchantId,
        purpose: 'FRONT_DESK',
        enabled: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!printer) this.invalid('结账默认前台打印机不可用');
    return printer.id;
  }

  async kitchenRoutingForOrder(
    merchantId: bigint,
    printerId: bigint,
    orderId: bigint,
  ): Promise<{ isKitchen: boolean; categoryIds: bigint[] }> {
    const [routing, printer, bindings, order] = await Promise.all([
      this.prisma.merchantPrintingRouting.findUnique({ where: { merchantId } }),
      this.prisma.printer.findFirst({ where: { id: printerId, merchantId, deletedAt: null }, select: { purpose: true, enabled: true } }),
      this.prisma.printerCategoryBinding.findMany({ where: { merchantId }, select: { printerId: true, categoryId: true } }),
      this.prisma.order.findFirst({
        where: { id: orderId, merchantId },
        select: { items: { select: { product: { select: { categoryId: true } } } } },
      }),
    ]);
    if (!routing || !printer || !printer.enabled || printer.purpose !== 'KITCHEN' || !order) {
      return { isKitchen: false, categoryIds: [] };
    }
    const boundCategoryIds = new Set(bindings.map((binding) => binding.categoryId));
    const ownCategoryIds = new Set(
      bindings.filter((binding) => binding.printerId === printerId).map((binding) => binding.categoryId),
    );
    const assigned = new Set<bigint>();
    for (const item of order.items) {
      const categoryId = item.product?.categoryId;
      if (!categoryId) continue;
      if (ownCategoryIds.has(categoryId)) assigned.add(categoryId);
      if (!boundCategoryIds.has(categoryId) && routing.defaultKitchenPrinterId === printerId) {
        assigned.add(categoryId);
      }
    }
    return { isKitchen: true, categoryIds: [...assigned] };
  }

  private normalize(dto: UpdatePrintingRoutingDto) {
    const seen = new Set<string>();
    const printers = dto.printers.map((entry) => {
      const printerId = BigInt(entry.printerId);
      const key = printerId.toString();
      if (seen.has(key)) this.invalid('同一打印机不能重复提交');
      seen.add(key);
      const categoryIds = (entry.categoryIds ?? []).map((id) => BigInt(id));
      if (new Set(categoryIds.map(String)).size !== categoryIds.length) {
        this.invalid('同一打印机不能重复绑定分类');
      }
      return { printerId, newOrderAutoPrint: entry.newOrderAutoPrint, categoryIds };
    });
    return {
      printers,
      checkoutDefaultPrinterId: dto.checkoutDefaultPrinterId ? BigInt(dto.checkoutDefaultPrinterId) : null,
      defaultKitchenPrinterId: dto.defaultKitchenPrinterId ? BigInt(dto.defaultKitchenPrinterId) : null,
    };
  }

  private assertDefaultPrinter(
    printers: Map<bigint, { purpose: PrinterPurpose; enabled: boolean }>,
    id: bigint | null,
    purpose: PrinterPurpose,
    message: string,
  ) {
    if (!id) return;
    const printer = printers.get(id);
    if (!printer || printer.purpose !== purpose || !printer.enabled) this.invalid(message);
  }

  private invalid(message: string): never {
    throw new BadRequestException({ code: PRINTING_ERROR_CODES.CONFIG_INVALID, message });
  }
}
