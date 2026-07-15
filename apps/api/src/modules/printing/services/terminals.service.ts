import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  CreateMerchantTerminalDto,
  UpdateMerchantTerminalDto,
} from '../dto/terminal.dto';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';

@Injectable()
export class TerminalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly audit: PrintingAuditService,
  ) {}

  async list(merchantId: bigint) {
    this.flags.assertTaskCenterEnabled();
    const terminals = await this.prisma.merchantTerminal.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
    });
    return terminals.map((terminal) => this.serialize(terminal));
  }

  async create(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    dto: CreateMerchantTerminalDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    const capabilities = this.normalizeCapabilities(dto.capabilities ?? {});
    const terminal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.merchantTerminal.create({
        data: {
          merchantId,
          name: dto.name,
          platform: dto.platform,
          status: 'UNPAIRED',
          capabilities,
        },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'TERMINAL_CREATED',
          resourceType: 'MerchantTerminal',
          resourceId: created.id,
          afterData: this.auditView(created),
          requestId,
        },
        tx,
      );
      return created;
    });
    return this.serialize(terminal);
  }

  async update(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
    dto: UpdateMerchantTerminalDto,
  ) {
    this.flags.assertTaskCenterEnabled();
    const existing = await this.requireOwned(merchantId, id);
    const capabilities = dto.capabilities
      ? this.normalizeCapabilities(dto.capabilities)
      : undefined;
    const terminal = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.merchantTerminal.update({
        where: { id },
        data: { name: dto.name, platform: dto.platform, capabilities },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'TERMINAL_UPDATED',
          resourceType: 'MerchantTerminal',
          resourceId: id,
          beforeData: this.auditView(existing),
          afterData: this.auditView(updated),
          requestId,
        },
        tx,
      );
      return updated;
    });
    return this.serialize(terminal);
  }

  async revoke(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    id: bigint,
  ) {
    this.flags.assertTaskCenterEnabled();
    const existing = await this.requireOwned(merchantId, id);
    const terminal = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.merchantTerminal.update({
        where: { id },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: 'TERMINAL_REVOKED',
          resourceType: 'MerchantTerminal',
          resourceId: id,
          beforeData: this.auditView(existing),
          afterData: this.auditView(updated),
          requestId,
        },
        tx,
      );
      return updated;
    });
    return this.serialize(terminal);
  }

  private async requireOwned(merchantId: bigint, id: bigint) {
    const terminal = await this.prisma.merchantTerminal.findFirst({
      where: { id, merchantId },
    });
    if (!terminal) {
      throw new NotFoundException({
        code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
        message: '商家终端不存在',
      });
    }
    return terminal;
  }

  private serialize<T extends { status: string; lastSeenAt: Date | null }>(terminal: T) {
    return {
      ...terminal,
      pairingState: terminal.status === 'UNPAIRED' ? 'NOT_PAIRED' : terminal.status,
      onlineState: 'NOT_CONNECTED',
    };
  }

  private assertNoSecrets(value: unknown) {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (/password|secret|token|cookie|authorization|credential|api[_-]?key/i.test(key)) {
        throw new BadRequestException({
          code: PRINTING_ERROR_CODES.CONFIG_INVALID,
          message: '终端能力信息不允许保存密钥字段',
        });
      }
      this.assertNoSecrets(nested);
    }
  }

  private normalizeCapabilities(value: Record<string, unknown>) {
    this.assertNoSecrets(value);
    try {
      const serialized = JSON.stringify(value);
      if (serialized.length > 8_192) {
        throw new Error('capabilities exceeds 8192 bytes');
      }
      return JSON.parse(serialized) as Prisma.InputJsonObject;
    } catch (error) {
      throw new BadRequestException({
        code: PRINTING_ERROR_CODES.CONFIG_INVALID,
        message:
          error instanceof Error && error.message.includes('8192')
            ? '终端能力信息过大'
            : '终端能力信息必须是有效 JSON',
      });
    }
  }

  private auditView(terminal: {
    id: bigint;
    name: string;
    platform: string;
    status: string;
    appVersion: string | null;
    lastSeenAt: Date | null;
    revokedAt: Date | null;
  }) {
    return {
      id: terminal.id.toString(),
      name: terminal.name,
      platform: terminal.platform,
      status: terminal.status,
      appVersion: terminal.appVersion,
      lastSeenAt: terminal.lastSeenAt,
      revokedAt: terminal.revokedAt,
    };
  }
}
