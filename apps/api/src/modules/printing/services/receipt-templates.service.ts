import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReceiptType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  CreateReceiptTemplateDto,
  SaveCurrentOrderCustomerReceiptSettingsDto,
  SaveCurrentReceiptSettingsDto,
  SaveCurrentTableBillReceiptSettingsDto,
  UpdateReceiptTemplateDto,
} from '../dto/receipt-template.dto';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import {
  assertReceiptTemplateDefinition,
  DEFAULT_RECEIPT_TEMPLATE_DISPLAY,
  RECEIPT_TEMPLATE_SECTION_TYPES,
} from '../types/receipt-document';
import {
  DEFAULT_RECEIPT_FOOTER_VI,
  DEFAULT_RECEIPT_FOOTER_ZH,
} from '../types/bilingual-receipt';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';
import { PrintingSettingsService } from './printing-settings.service';

const CURRENT_ORDER_CUSTOMER_TEMPLATE_NAME = '商家默认';
const CURRENT_TABLE_BILL_TEMPLATE_NAME = '结账小票默认';

@Injectable()
export class ReceiptTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly audit: PrintingAuditService,
    private readonly settings: PrintingSettingsService,
  ) {}

  list(merchantId: bigint) {
    this.flags.assertTaskCenterEnabled();
    return this.prisma.receiptTemplate.findMany({
      where: { OR: [{ merchantId }, { merchantId: null }] },
      orderBy: [{ merchantId: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async get(merchantId: bigint, id: bigint) {
    this.flags.assertTaskCenterEnabled();
    return this.requireReadable(merchantId, id);
  }

  getCurrentOrderCustomer(merchantId: bigint) {
    this.flags.assertTaskCenterEnabled();
    return this.resolveCurrentOrderCustomer(merchantId);
  }

  resolveCurrentOrderCustomer(
    merchantId: bigint,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return this.resolveCurrent(merchantId, 'ORDER_CUSTOMER', client);
  }

  async getCurrentTableBill(merchantId: bigint) {
    this.flags.assertTaskCenterEnabled();
    return (
      (await this.resolveCurrentTableBill(merchantId)) ??
      this.defaultCurrentTableBillSettings(merchantId)
    );
  }

  resolveCurrentTableBill(
    merchantId: bigint,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return this.resolveCurrent(merchantId, 'TABLE_BILL', client);
  }

  private resolveCurrent(
    merchantId: bigint,
    receiptType: ReceiptType,
    client: PrismaService | Prisma.TransactionClient,
  ) {
    return client.receiptTemplate.findFirst({
      where: {
        merchantId,
        receiptType,
        enabled: true,
      },
      orderBy: [{ createdAt: 'desc' }, { version: 'desc' }, { id: 'desc' }],
    });
  }

  async saveCurrentOrderCustomer(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    dto: SaveCurrentOrderCustomerReceiptSettingsDto,
  ) {
    return this.saveCurrentReceiptSettings(
      merchantId,
      actorStaffId,
      requestId,
      'ORDER_CUSTOMER',
      CURRENT_ORDER_CUSTOMER_TEMPLATE_NAME,
      dto,
    );
  }

  async saveCurrentTableBill(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    dto: SaveCurrentTableBillReceiptSettingsDto,
  ) {
    return this.saveCurrentReceiptSettings(
      merchantId,
      actorStaffId,
      requestId,
      'TABLE_BILL',
      CURRENT_TABLE_BILL_TEMPLATE_NAME,
      dto,
    );
  }

  private async saveCurrentReceiptSettings(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    receiptType: ReceiptType,
    internalName: string,
    dto: SaveCurrentReceiptSettingsDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    await this.settings.assertMerchantPrintingEnabled(merchantId);
    const definition = this.validateDefinition(dto.definition);
    try {
      return await this.saveCurrentReceiptSettingsAttempt(
        merchantId,
        actorStaffId,
        requestId,
        receiptType,
        internalName,
        dto,
        definition,
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    try {
      return await this.saveCurrentReceiptSettingsAttempt(
        merchantId,
        actorStaffId,
        requestId,
        receiptType,
        internalName,
        dto,
        definition,
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw new ConflictException({
        code: PRINTING_ERROR_CODES.TEMPLATE_VERSION_CONFLICT,
        message: '当前小票设置已被其他操作更新，请刷新后重试',
      });
    }
  }

  async create(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    dto: CreateReceiptTemplateDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    await this.settings.assertMerchantPrintingEnabled(merchantId);
    const definition = this.validateDefinition(dto.definition);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.receiptTemplate.create({
        data: {
          merchantId,
          name: dto.name,
          receiptType: dto.receiptType,
          paperWidth: dto.paperWidth,
          languageMode: dto.languageMode,
          definition,
          version: 1,
          enabled: dto.enabled ?? true,
        },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'RECEIPT_TEMPLATE_CREATED',
          resourceType: 'ReceiptTemplate',
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
    dto: UpdateReceiptTemplateDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    await this.settings.assertMerchantPrintingEnabled(merchantId);
    const existing = await this.requireOwned(merchantId, id);
    const definition = dto.definition
      ? this.validateDefinition(dto.definition)
      : undefined;
    return this.prisma.$transaction(async (tx) => {
      const nextName = dto.name ?? existing.name;
      const latest = await tx.receiptTemplate.aggregate({
        where: { merchantId, name: nextName },
        _max: { version: true },
      });
      const updated = await tx.receiptTemplate.create({
        data: {
          merchantId,
          name: nextName,
          receiptType: dto.receiptType ?? existing.receiptType,
          paperWidth: dto.paperWidth ?? existing.paperWidth,
          languageMode: dto.languageMode ?? existing.languageMode,
          definition:
            definition ?? (existing.definition as Prisma.InputJsonValue),
          enabled: dto.enabled ?? existing.enabled,
          version: Math.max(existing.version, latest._max.version ?? 0) + 1,
        },
      });
      await tx.receiptTemplate.update({
        where: { id },
        data: { enabled: false },
      });
      const relinkedRules = await tx.printRule.updateMany({
        where: { merchantId, receiptTemplateId: id },
        data: {
          receiptTemplateId: updated.id,
          enabled: false,
          autoPrint: false,
        },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'RECEIPT_TEMPLATE_UPDATED',
          resourceType: 'ReceiptTemplate',
          resourceId: updated.id,
          beforeData: this.auditView(existing),
          afterData: {
            ...this.auditView(updated),
            previousTemplateId: id.toString(),
            relinkedRules: relinkedRules.count,
          },
          requestId,
        },
        tx,
      );
      return updated;
    });
  }

  async duplicate(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
  ) {
    this.flags.assertTaskCenterEnabled();
    await this.settings.assertMerchantPrintingEnabled(merchantId);
    const source = await this.requireReadable(merchantId, id);
    return this.prisma.$transaction(async (tx) => {
      const copyName = `${source.name} - 副本`.slice(0, 80);
      const latest = await tx.receiptTemplate.aggregate({
        where: { merchantId, name: copyName },
        _max: { version: true },
      });
      const copy = await tx.receiptTemplate.create({
        data: {
          merchantId,
          name: copyName,
          receiptType: source.receiptType,
          paperWidth: source.paperWidth,
          languageMode: source.languageMode,
          definition: source.definition as Prisma.InputJsonValue,
          version: (latest._max.version ?? 0) + 1,
          enabled: false,
        },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'RECEIPT_TEMPLATE_DUPLICATED',
          resourceType: 'ReceiptTemplate',
          resourceId: copy.id,
          afterData: { ...this.auditView(copy), sourceTemplateId: source.id.toString() },
          requestId,
        },
        tx,
      );
      return copy;
    });
  }

  async requireReadable(merchantId: bigint, id: bigint) {
    const template = await this.prisma.receiptTemplate.findFirst({
      where: { id, OR: [{ merchantId }, { merchantId: null }] },
    });
    if (!template) this.notFound();
    return template;
  }

  async requireOwned(merchantId: bigint, id: bigint) {
    const template = await this.prisma.receiptTemplate.findFirst({
      where: { id, merchantId },
    });
    if (!template) this.notFound();
    return template;
  }

  private saveCurrentReceiptSettingsAttempt(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    receiptType: ReceiptType,
    internalName: string,
    dto: SaveCurrentReceiptSettingsDto,
    definition: Prisma.InputJsonObject,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.resolveCurrent(merchantId, receiptType, tx);
      // Current settings use one reserved name per receipt type. This keeps
      // the database's merchant/name/version unique key from coupling ORDER
      // and TABLE_BILL version sequences without requiring a migration.
      const name = internalName;
      const latest = await tx.receiptTemplate.aggregate({
        where: { merchantId, receiptType, name },
        _max: { version: true },
      });
      const saved = await tx.receiptTemplate.create({
        data: {
          merchantId,
          name,
          receiptType,
          paperWidth: dto.paperWidth,
          languageMode: dto.languageMode,
          definition,
          version: Math.max(current?.version ?? 0, latest._max.version ?? 0) + 1,
          enabled: true,
        },
      });
      let relinkedRules = 0;
      if (current) {
        await tx.receiptTemplate.update({
          where: { id: current.id },
          data: { enabled: false },
        });
        const relinked = await tx.printRule.updateMany({
          where: { merchantId, receiptTemplateId: current.id },
          data: {
            receiptTemplateId: saved.id,
            enabled: false,
            autoPrint: false,
          },
        });
        relinkedRules = relinked.count;
      }
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: current ? 'RECEIPT_TEMPLATE_UPDATED' : 'RECEIPT_TEMPLATE_CREATED',
          resourceType: 'ReceiptTemplate',
          resourceId: saved.id,
          beforeData: current ? this.auditView(current) : undefined,
          afterData: {
            ...this.auditView(saved),
            ...(current
              ? {
                  previousTemplateId: current.id.toString(),
                  relinkedRules,
                }
              : {}),
          },
          requestId,
        },
        tx,
      );
      return saved;
    });
  }

  private validateDefinition(value: Record<string, unknown>) {
    try {
      assertReceiptTemplateDefinition(value);
    } catch (error) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.TEMPLATE_INVALID,
        message: error instanceof Error ? error.message : '模板定义无效',
      });
    }
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
  }

  private defaultCurrentTableBillSettings(merchantId: bigint) {
    return {
      id: null,
      merchantId,
      name: CURRENT_TABLE_BILL_TEMPLATE_NAME,
      receiptType: 'TABLE_BILL' as const,
      paperWidth: 'MM80' as const,
      languageMode: 'MERCHANT_DEFAULT' as const,
      version: 0,
      definition: {
        schemaVersion: 1,
        sections: RECEIPT_TEMPLATE_SECTION_TYPES.map((type) => ({ type })),
        display: { ...DEFAULT_RECEIPT_TEMPLATE_DISPLAY },
        footerTextZh: DEFAULT_RECEIPT_FOOTER_ZH,
        footerTextVi: DEFAULT_RECEIPT_FOOTER_VI,
      },
      enabled: true,
      createdAt: null,
      updatedAt: null,
    };
  }

  private notFound(): never {
    throw new NotFoundException({
      code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: '小票模板不存在',
    });
  }

  private auditView(template: {
    id: bigint;
    name: string;
    receiptType: string;
    paperWidth: string;
    languageMode: string;
    version: number;
    enabled: boolean;
  }) {
    return {
      id: template.id.toString(),
      name: template.name,
      receiptType: template.receiptType,
      paperWidth: template.paperWidth,
      languageMode: template.languageMode,
      version: template.version,
      enabled: template.enabled,
    };
  }
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
