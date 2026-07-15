import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { CreatePrintRuleDto, UpdatePrintRuleDto } from '../dto/print-rule.dto';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';
import { PrintingSettingsService } from './printing-settings.service';

@Injectable()
export class PrintRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly audit: PrintingAuditService,
    private readonly settings: PrintingSettingsService,
  ) {}

  list(merchantId: bigint) {
    this.flags.assertTaskCenterEnabled();
    return this.prisma.printRule.findMany({
      where: { merchantId },
      include: {
        printer: { select: { id: true, name: true, enabled: true } },
        receiptTemplate: { select: { id: true, name: true, version: true } },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    dto: CreatePrintRuleDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    await this.settings.assertMerchantPrintingEnabled(merchantId);
    this.validateV1Semantics(
      dto.triggerEvent,
      dto.receiptType,
      dto.autoPrint ?? false,
    );
    await this.validateReferences(
      merchantId,
      BigInt(dto.printerId),
      dto.receiptTemplateId ? BigInt(dto.receiptTemplateId) : null,
      dto.receiptType,
    );
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.printRule.create({
        data: {
          merchantId,
          name: dto.name,
          orderType: dto.orderType,
          triggerEvent: dto.triggerEvent,
          receiptType: dto.receiptType,
          printerId: BigInt(dto.printerId),
          receiptTemplateId: dto.receiptTemplateId
            ? BigInt(dto.receiptTemplateId)
            : null,
          copies: dto.copies ?? 1,
          autoPrint: dto.autoPrint ?? false,
          enabled: false,
          priority: dto.priority ?? 100,
        },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'PRINT_RULE_CREATED',
          resourceType: 'PrintRule',
          resourceId: created.id,
          afterData: this.auditView(created),
          requestId,
        },
        tx,
      );
      return created;
    });
  }

  async update(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
    dto: UpdatePrintRuleDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    await this.settings.assertMerchantPrintingEnabled(merchantId);
    const existing = await this.requireOwned(merchantId, id);
    const printerId = dto.printerId ? BigInt(dto.printerId) : existing.printerId;
    const receiptTemplateId =
      dto.receiptTemplateId === null
        ? null
        : dto.receiptTemplateId
          ? BigInt(dto.receiptTemplateId)
          : existing.receiptTemplateId;
    this.validateV1Semantics(
      dto.triggerEvent ?? existing.triggerEvent,
      dto.receiptType ?? existing.receiptType,
      dto.autoPrint ?? existing.autoPrint,
    );
    await this.validateReferences(
      merchantId,
      printerId,
      receiptTemplateId,
      dto.receiptType ?? existing.receiptType,
    );
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.printRule.update({
        where: { id },
        data: {
          name: dto.name,
          orderType: dto.orderType,
          triggerEvent: dto.triggerEvent,
          receiptType: dto.receiptType,
          printerId: dto.printerId ? printerId : undefined,
          receiptTemplateId:
            dto.receiptTemplateId !== undefined ? receiptTemplateId : undefined,
          copies: dto.copies,
          autoPrint: dto.autoPrint,
          priority: dto.priority,
        },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'PRINT_RULE_UPDATED',
          resourceType: 'PrintRule',
          resourceId: id,
          beforeData: this.auditView(existing),
          afterData: this.auditView(updated),
          requestId,
        },
        tx,
      );
      return updated;
    });
  }

  enable(merchantId: bigint, actorStaffId: bigint, requestId: string | undefined, id: bigint) {
    return this.setEnabled(merchantId, actorStaffId, requestId, id, true);
  }

  disable(merchantId: bigint, actorStaffId: bigint, requestId: string | undefined, id: bigint) {
    return this.setEnabled(merchantId, actorStaffId, requestId, id, false);
  }

  private async setEnabled(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
    enabled: boolean,
  ) {
    this.flags.assertTaskCenterEnabled();
    await this.settings.assertMerchantPrintingEnabled(merchantId);
    const existing = await this.requireOwned(merchantId, id);
    if (enabled) {
      this.validateV1Semantics(
        existing.triggerEvent,
        existing.receiptType,
        existing.autoPrint,
      );
      await this.validateReferences(
        merchantId,
        existing.printerId,
        existing.receiptTemplateId,
        existing.receiptType,
        true,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.printRule.update({ where: { id }, data: { enabled } });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: enabled ? 'PRINT_RULE_ENABLED' : 'PRINT_RULE_DISABLED',
          resourceType: 'PrintRule',
          resourceId: id,
          beforeData: this.auditView(existing),
          afterData: this.auditView(updated),
          requestId,
        },
        tx,
      );
      return updated;
    });
  }

  private async validateReferences(
    merchantId: bigint,
    printerId: bigint,
    templateId: bigint | null,
    receiptType: string,
    requireEnabledPrinter = false,
  ) {
    const [printer, template] = await Promise.all([
      this.prisma.printer.findFirst({
        where: { id: printerId, merchantId, deletedAt: null },
      }),
      templateId
        ? this.prisma.receiptTemplate.findFirst({
            where: { id: templateId, OR: [{ merchantId }, { merchantId: null }] },
          })
        : null,
    ]);
    if (!printer) this.referenceError('目标打印机不存在或不属于当前商家');
    if (requireEnabledPrinter && !printer.enabled) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.PRINTER_DISABLED,
        message: '目标打印机已停用',
      });
    }
    if (requireEnabledPrinter && printer.channelType !== 'LOCAL_USB_ESCPOS') {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CHANNEL_NOT_IMPLEMENTED,
        message: '当前 Release Candidate 只能启用 USB ESC/POS 规则',
      });
    }
    if (templateId && !template) this.referenceError('小票模板不存在');
    if (template && !template.enabled) {
      this.referenceError('小票模板已停用');
    }
    if (template && template.receiptType !== receiptType) {
      this.referenceError('规则的小票类型与模板不一致');
    }
    if (template && template.paperWidth !== printer.paperWidth) {
      this.referenceError('打印机纸宽与模板纸宽不一致');
    }
  }

  private async requireOwned(merchantId: bigint, id: bigint) {
    const rule = await this.prisma.printRule.findFirst({ where: { id, merchantId } });
    if (!rule) {
      throw new NotFoundException({
        code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
        message: '打印规则不存在',
      });
    }
    return rule;
  }

  private validateV1Semantics(
    triggerEvent: string,
    receiptType: string,
    autoPrint: boolean,
  ) {
    if (
      ['ORDER_ACCEPTED', 'ORDER_COMPLETED'].includes(triggerEvent) &&
      receiptType !== 'ORDER_CUSTOMER'
    ) {
      this.referenceError('订单状态自动触发只支持订单客单');
    }
    if (autoPrint && triggerEvent === 'MANUAL') {
      this.referenceError('手动触发规则不能开启自动打印');
    }
  }

  private referenceError(message: string): never {
    throw new BadRequestException({ code: PRINTING_ERROR_CODES.CONFIG_INVALID, message });
  }

  private auditView(rule: {
    id: bigint;
    name: string;
    printerId: bigint;
    receiptTemplateId: bigint | null;
    orderType: string | null;
    triggerEvent: string;
    receiptType: string;
    copies: number;
    autoPrint: boolean;
    enabled: boolean;
    priority: number;
  }) {
    return {
      id: rule.id.toString(),
      name: rule.name,
      printerId: rule.printerId.toString(),
      receiptTemplateId: rule.receiptTemplateId?.toString() ?? null,
      orderType: rule.orderType,
      triggerEvent: rule.triggerEvent,
      receiptType: rule.receiptType,
      copies: rule.copies,
      autoPrint: rule.autoPrint,
      enabled: rule.enabled,
      priority: rule.priority,
    };
  }
}
