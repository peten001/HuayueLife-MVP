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

const AUTOMATIC_CREATION_CAPABILITY = 'automaticCreationEnabled';

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
      select: {
        id: true,
        status: true,
        printingEnabled: true,
        capabilities: {
          where: { capability: { code: AUTOMATIC_CREATION_CAPABILITY } },
          select: { isEnabled: true },
        },
      },
    });
    if (!merchant) this.notFound();
    return {
      id: merchant.id,
      status: merchant.status,
      printingEnabled: merchant.printingEnabled,
      automaticCreationEnabled: merchant.capabilities[0]?.isEnabled === true,
      featureFlags: this.flags.status(),
    };
  }

  async updateAutomaticCreation(
    merchantId: bigint,
    automaticCreationEnabled: boolean,
  ) {
    this.flags.assertTaskCenterEnabled();
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, status: true, printingEnabled: true },
    });
    if (!merchant) this.notFound();
    if (
      automaticCreationEnabled &&
      (merchant.status !== 'ACTIVE' || !merchant.printingEnabled)
    ) {
      throw new ServiceUnavailableException({
        code: PRINTING_ERROR_CODES.PRINTING_NOT_ENABLED,
        message: '打印功能未开通，无法开启自动创建打印任务。',
      });
    }

    const capability = await this.prisma.capability.upsert({
      where: { code: AUTOMATIC_CREATION_CAPABILITY },
      create: {
        code: AUTOMATIC_CREATION_CAPABILITY,
        nameZh: '自动创建打印任务',
        nameVi: 'Tu dong tao tac vu in',
        nameEn: 'Automatic print task creation',
        groupCode: 'RESTAURANT',
        groupNameZh: '餐厅能力',
        groupNameVi: 'Nha hang',
        groupNameEn: 'Restaurant',
        enabled: true,
        defaultValue: false,
        sortOrder: 115,
      },
      update: {},
      select: { id: true },
    });
    await this.prisma.merchantCapability.upsert({
      where: {
        merchantId_capabilityId: { merchantId, capabilityId: capability.id },
      },
      create: { merchantId, capabilityId: capability.id, isEnabled: automaticCreationEnabled },
      update: { isEnabled: automaticCreationEnabled },
    });
    return this.get(merchantId);
  }

  async assertMerchantAutomaticCreationEnabled(
    merchantId: bigint,
    client: MerchantReader = this.prisma,
  ) {
    const merchant = await client.merchant.findUnique({
      where: { id: merchantId },
      select: {
        capabilities: {
          where: { capability: { code: AUTOMATIC_CREATION_CAPABILITY } },
          select: { isEnabled: true },
        },
      },
    });
    if (merchant?.capabilities[0]?.isEnabled !== true) {
      throw new ServiceUnavailableException({
        code: PRINTING_ERROR_CODES.AUTO_CREATE_DISABLED,
        message: '商家尚未开启自动创建打印任务。',
      });
    }
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
