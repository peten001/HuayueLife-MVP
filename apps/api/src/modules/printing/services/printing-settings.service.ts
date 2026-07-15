import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { PrintingAuditService } from './printing-audit.service';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';

@Injectable()
export class PrintingSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
    private readonly audit: PrintingAuditService,
  ) {}

  async get(merchantId: bigint) {
    this.flags.assertTaskCenterEnabled();
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, status: true, printingEnabled: true },
    });
    if (!merchant) this.notFound();
    return { ...merchant, featureFlags: this.flags.status() };
  }

  async update(
    merchantId: bigint,
    actorStaffId: bigint,
    requestId: string | undefined,
    printingEnabled: boolean,
  ) {
    this.flags.assertTaskCenterEnabled();
    const existing = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, status: true, printingEnabled: true },
    });
    if (!existing) this.notFound();
    if (printingEnabled && existing.status !== 'ACTIVE') {
      this.merchantInactive();
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = printingEnabled
        ? await this.enableWithActiveMerchantCompareAndSet(tx, merchantId)
        : await tx.merchant.update({
            where: { id: merchantId },
            data: { printingEnabled: false },
            select: { id: true, status: true, printingEnabled: true },
          });
      await this.audit.record(
        {
          merchantId,
          actorStaffId,
          action: printingEnabled
            ? 'MERCHANT_PRINTING_ENABLED'
            : 'MERCHANT_PRINTING_DISABLED',
          resourceType: 'MerchantPrintingSettings',
          resourceId: merchantId,
          beforeData: existing,
          afterData: updated,
          requestId,
        },
        tx,
      );
      return { ...updated, featureFlags: this.flags.status() };
    });
  }

  async assertMerchantEnabled(merchantId: bigint) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { status: true, printingEnabled: true },
    });
    if (merchant?.status !== 'ACTIVE' || !merchant.printingEnabled) {
      throw new ServiceUnavailableException({
        code: PRINTING_ERROR_CODES.MERCHANT_PRINTING_DISABLED,
        message: '商家账号或打印总开关当前关闭',
      });
    }
  }

  private notFound(): never {
    throw new NotFoundException({
      code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: '商家不存在',
    });
  }

  private async enableWithActiveMerchantCompareAndSet(
    tx: Prisma.TransactionClient,
    merchantId: bigint,
  ) {
    const changed = await tx.merchant.updateMany({
      where: { id: merchantId, status: 'ACTIVE' },
      data: { printingEnabled: true },
    });
    if (changed.count !== 1) this.merchantInactive();
    return tx.merchant.findUniqueOrThrow({
      where: { id: merchantId },
      select: { id: true, status: true, printingEnabled: true },
    });
  }

  private merchantInactive(): never {
    throw new BadRequestException({
      code: PRINTING_ERROR_CODES.MERCHANT_PRINTING_DISABLED,
      message: '商家账号未启用，不能开启打印',
    });
  }
}
