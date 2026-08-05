import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { UpdatePrintingRoutingDto } from '../dto/printing-routing.dto';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';
import { PrintingSettingsService } from './printing-settings.service';

export const MANAGED_RULE_PREFIX = '__ROUTING_NEW_ORDER__:';
export const FRONT_DESK_RULE_PREFIX = `${MANAGED_RULE_PREFIX}FRONT_DESK:`;
export const KITCHEN_RULE_PREFIX = `${MANAGED_RULE_PREFIX}KITCHEN:`;

type DbClient = PrismaService | Prisma.TransactionClient;
type RoutingScene = 'FRONT_DESK' | 'KITCHEN';
type RoutingEntry = {
  printerId: bigint;
  newOrderAutoPrint: boolean;
  categoryIds: bigint[];
};

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
    const [routing, bindings, managedRules, currentPrinters] = await Promise.all([
      this.prisma.merchantPrintingRouting.findUnique({ where: { merchantId } }),
      this.prisma.printerCategoryBinding.findMany({
        where: {
          merchantId,
          printer: { merchantId, deletedAt: null },
        },
        select: { printerId: true, categoryId: true },
      }),
      this.prisma.printRule.findMany({
        where: {
          merchantId,
          name: { startsWith: MANAGED_RULE_PREFIX },
          printer: { merchantId, deletedAt: null },
        },
        select: {
          name: true,
          printerId: true,
          autoPrint: true,
          enabled: true,
          printer: { select: { purpose: true } },
        },
      }),
      this.prisma.printer.findMany({
        where: { merchantId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    const currentPrinterIds = new Set(
      currentPrinters.map((printer) => printer.id.toString()),
    );
    const categoryIdsByPrinter = new Map<string, string[]>();
    for (const binding of bindings) {
      const key = binding.printerId.toString();
      if (!currentPrinterIds.has(key)) continue;
      categoryIdsByPrinter.set(key, [
        ...(categoryIdsByPrinter.get(key) ?? []),
        binding.categoryId.toString(),
      ]);
    }
    const frontDeskPrinters: Array<{ printerId: string; newOrderAutoPrint: boolean; categoryIds: string[] }> = [];
    const kitchenPrinters: Array<{ printerId: string; newOrderAutoPrint: boolean; categoryIds: string[] }> = [];
    for (const rule of managedRules) {
      if (!currentPrinterIds.has(rule.printerId.toString())) continue;
      const explicitScene = this.sceneForRuleName(rule.name);
      // A disabled legacy rule was retired during conversion. It must not
      // surface as a second scene entry beside the new explicit rule.
      if (!explicitScene && !rule.autoPrint && !rule.enabled) continue;
      // Rules saved before the split-scene contract are rendered once using
      // their legacy physical-purpose value, then converted on the next save.
      const scene = explicitScene
        ?? (rule.printer.purpose === 'KITCHEN' ? 'KITCHEN' : 'FRONT_DESK');
      const entry = {
        printerId: rule.printerId.toString(),
        newOrderAutoPrint: rule.autoPrint && rule.enabled,
        categoryIds: scene === 'KITCHEN'
          ? categoryIdsByPrinter.get(rule.printerId.toString()) ?? []
          : [],
      };
      (scene === 'FRONT_DESK' ? frontDeskPrinters : kitchenPrinters).push(entry);
    }
    return {
      configured: Boolean(routing),
      checkoutDefaultPrinterId:
        routing?.checkoutDefaultPrinterId &&
        currentPrinterIds.has(routing.checkoutDefaultPrinterId.toString())
          ? routing.checkoutDefaultPrinterId.toString()
          : null,
      defaultKitchenPrinterId:
        routing?.defaultKitchenPrinterId &&
        currentPrinterIds.has(routing.defaultKitchenPrinterId.toString())
          ? routing.defaultKitchenPrinterId.toString()
          : null,
      frontDeskPrinters,
      kitchenPrinters,
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
    const frontDeskPrinters = this.normalizeEntries(dto.frontDeskPrinters, '前台');
    const kitchenPrinters = this.normalizeEntries(dto.kitchenPrinters, '厨房');
    const allEntries = [
      ...frontDeskPrinters.map((entry) => ({ ...entry, scene: 'FRONT_DESK' as const })),
      ...kitchenPrinters.map((entry) => ({ ...entry, scene: 'KITCHEN' as const })),
    ];
    const allReferencedIds = [
      ...allEntries.map(({ printerId }) => printerId),
      ...(dto.checkoutDefaultPrinterId ? [BigInt(dto.checkoutDefaultPrinterId)] : []),
      ...(dto.defaultKitchenPrinterId ? [BigInt(dto.defaultKitchenPrinterId)] : []),
    ];
    const printers = await this.prisma.printer.findMany({
      where: {
        merchantId,
        id: { in: [...new Set(allReferencedIds)] },
        deletedAt: null,
      },
      select: { id: true, enabled: true },
    });
    const byId = new Map(printers.map((printer) => [printer.id, printer]));
    if (printers.length !== new Set(allReferencedIds).size) {
      this.invalid('打印机不存在、已删除或不属于当前商家');
    }
    for (const entry of allEntries) {
      if (!byId.get(entry.printerId)?.enabled) {
        this.invalid('已停用的打印机不能配置自动打印');
      }
    }
    const frontIds = new Set(frontDeskPrinters.map(({ printerId }) => printerId));
    const kitchenIds = new Set(kitchenPrinters.map(({ printerId }) => printerId));
    this.assertDefaultInScene(
      byId,
      dto.checkoutDefaultPrinterId ? BigInt(dto.checkoutDefaultPrinterId) : null,
      frontIds,
      '结账默认打印机必须是已启用的前台打印机',
    );
    this.assertDefaultInScene(
      byId,
      dto.defaultKitchenPrinterId ? BigInt(dto.defaultKitchenPrinterId) : null,
      kitchenIds,
      '默认厨房打印机必须是已启用的厨房打印机',
    );
    const categoryIds = kitchenPrinters.flatMap((entry) => entry.categoryIds);
    if (new Set(categoryIds.map(String)).size !== categoryIds.length) {
      this.invalid('一个菜品分类只能绑定一台启用中的厨房打印机');
    }
    if (categoryIds.length > 0 && !dto.defaultKitchenPrinterId) {
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
          checkoutDefaultPrinterId: dto.checkoutDefaultPrinterId ? BigInt(dto.checkoutDefaultPrinterId) : null,
          defaultKitchenPrinterId: dto.defaultKitchenPrinterId ? BigInt(dto.defaultKitchenPrinterId) : null,
        },
        update: {
          checkoutDefaultPrinterId: dto.checkoutDefaultPrinterId ? BigInt(dto.checkoutDefaultPrinterId) : null,
          defaultKitchenPrinterId: dto.defaultKitchenPrinterId ? BigInt(dto.defaultKitchenPrinterId) : null,
        },
      });
      await tx.printerCategoryBinding.deleteMany({ where: { merchantId } });
      const bindings = kitchenPrinters.flatMap((entry) =>
        entry.categoryIds.map((categoryId) => ({ merchantId, printerId: entry.printerId, categoryId })),
      );
      if (bindings.length) await tx.printerCategoryBinding.createMany({ data: bindings });

      const managed = await tx.printRule.findMany({
        where: { merchantId, name: { startsWith: MANAGED_RULE_PREFIX } },
        select: { id: true, printerId: true, name: true },
      });
      const desiredByName = new Map(
        allEntries.map((entry) => [this.ruleName(entry.scene, entry.printerId), entry]),
      );
      for (const rule of managed) {
        // Always retire legacy single-purpose routing rules. They are replaced
        // by one explicit rule per scene, so a physical printer may be in both.
        if (!desiredByName.has(rule.name)) {
          await tx.printRule.update({
            where: { id: rule.id },
            data: { autoPrint: false, enabled: false },
          });
        }
      }
      for (const [name, entry] of desiredByName) {
        const existing = managed.find((rule) => rule.name === name);
        const data = {
          autoPrint: entry.newOrderAutoPrint,
          enabled: entry.newOrderAutoPrint,
          copies: 1,
          priority: 100,
        };
        if (existing) {
          await tx.printRule.update({ where: { id: existing.id }, data });
        } else {
          await tx.printRule.create({
            data: {
              merchantId,
              name,
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
            checkoutDefaultPrinterId: dto.checkoutDefaultPrinterId ?? null,
            defaultKitchenPrinterId: dto.defaultKitchenPrinterId ?? null,
            frontDeskPrinterIds: frontDeskPrinters.map(({ printerId }) => printerId.toString()),
            kitchenPrinterIds: kitchenPrinters.map(({ printerId }) => printerId.toString()),
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
    const rule = await this.prisma.printRule.findFirst({
      where: {
        merchantId,
        printerId: routing.checkoutDefaultPrinterId,
        name: this.ruleName('FRONT_DESK', routing.checkoutDefaultPrinterId),
        printer: { enabled: true, deletedAt: null },
      },
      select: { printerId: true },
    });
    if (!rule) this.invalid('结账默认前台打印机不可用');
    return rule.printerId;
  }

  async kitchenRoutingForOrder(
    merchantId: bigint,
    printerId: bigint,
    orderId: bigint,
    routingRuleId: bigint,
  ): Promise<{ isKitchen: boolean; categoryIds: bigint[] }> {
    const [routing, kitchenRule, bindings, order] = await Promise.all([
      this.prisma.merchantPrintingRouting.findUnique({ where: { merchantId } }),
      this.prisma.printRule.findFirst({
        where: {
          id: routingRuleId,
          merchantId,
          printerId,
          name: this.ruleName('KITCHEN', printerId),
          enabled: true,
          printer: { enabled: true, deletedAt: null },
        },
        select: { id: true },
      }),
      this.prisma.printerCategoryBinding.findMany({
        where: { merchantId },
        select: { printerId: true, categoryId: true },
      }),
      this.prisma.order.findFirst({
        where: { id: orderId, merchantId },
        select: { items: { select: { product: { select: { categoryId: true } } } } },
      }),
    ]);
    if (!routing || !kitchenRule || !order) return { isKitchen: false, categoryIds: [] };
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

  private normalizeEntries(entries: UpdatePrintingRoutingDto['frontDeskPrinters'], label: string): RoutingEntry[] {
    const seen = new Set<string>();
    return entries.map((entry) => {
      const printerId = BigInt(entry.printerId);
      const key = printerId.toString();
      if (seen.has(key)) this.invalid(`同一打印机不能重复添加到${label}配置`);
      seen.add(key);
      const categoryIds = (entry.categoryIds ?? []).map((id) => BigInt(id));
      if (new Set(categoryIds.map(String)).size !== categoryIds.length) {
        this.invalid('同一打印机不能重复绑定分类');
      }
      return { printerId, newOrderAutoPrint: entry.newOrderAutoPrint, categoryIds };
    });
  }

  private assertDefaultInScene(
    printers: Map<bigint, { enabled: boolean }>,
    id: bigint | null,
    scenePrinterIds: Set<bigint>,
    message: string,
  ) {
    if (!id) return;
    if (!scenePrinterIds.has(id) || !printers.get(id)?.enabled) this.invalid(message);
  }

  private ruleName(scene: RoutingScene, printerId: bigint) {
    return `${scene === 'FRONT_DESK' ? FRONT_DESK_RULE_PREFIX : KITCHEN_RULE_PREFIX}${printerId.toString()}`;
  }

  private sceneForRuleName(name: string): RoutingScene | null {
    if (name.startsWith(FRONT_DESK_RULE_PREFIX)) return 'FRONT_DESK';
    if (name.startsWith(KITCHEN_RULE_PREFIX)) return 'KITCHEN';
    return null;
  }

  private invalid(message: string): never {
    throw new BadRequestException({ code: PRINTING_ERROR_CODES.CONFIG_INVALID, message });
  }
}
