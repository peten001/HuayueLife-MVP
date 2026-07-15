import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  CreateReceiptTemplateDto,
  UpdateReceiptTemplateDto,
} from '../dto/receipt-template.dto';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { assertReceiptTemplateDefinition } from '../types/receipt-document';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';

@Injectable()
export class ReceiptTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly audit: PrintingAuditService,
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

  async create(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    dto: CreateReceiptTemplateDto,
  ) {
    this.flags.assertTaskCenterEnabled();
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
