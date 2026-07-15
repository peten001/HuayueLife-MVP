import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PRINTING_ERROR_CODES } from '../types/printing-errors';
import { PrintingFeatureFlagsService } from './printing-feature-flags.service';

type MerchantReader = Pick<Prisma.TransactionClient, 'merchant'>;

@Injectable()
export class PrintingSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: PrintingFeatureFlagsService,
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
    _merchantId: bigint,
    _actorStaffId: bigint,
    _requestId: string | undefined,
    _printingEnabled: boolean,
  ) {
    this.flags.assertTaskCenterEnabled();
    throw new ForbiddenException({
      code: PRINTING_ERROR_CODES.PERMISSION_DENIED,
      message: '打印总能力只能由平台管理员开启或关闭',
    });
  }

  async assertMerchantPrintingEnabled(
    merchantId: bigint,
    client: MerchantReader = this.prisma,
  ) {
    const merchant = await client.merchant.findUnique({
      where: { id: merchantId },
      select: { status: true, printingEnabled: true },
    });
    if (merchant?.status !== 'ACTIVE' || !merchant.printingEnabled) {
      throw new ServiceUnavailableException({
        code: PRINTING_ERROR_CODES.PRINTING_NOT_ENABLED,
        message: '打印功能未开通，请联系平台管理员。',
      });
    }
  }

  private notFound(): never {
    throw new NotFoundException({
      code: PRINTING_ERROR_CODES.RESOURCE_NOT_FOUND,
      message: '商家不存在',
    });
  }

}
