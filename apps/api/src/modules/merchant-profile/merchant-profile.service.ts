import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UpdateMerchantProfileDto } from './dto/update-merchant-profile.dto';
import {
  parseHomepageCategoryKeys,
  stringifyHomepageCategoryKeys,
} from '../shared/homepage-category-keys';

@Injectable()
export class MerchantProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(merchantId: bigint) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      include: { capabilities: { include: { capability: true } } },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }
    return this.serializeMerchantProfile(merchant);
  }

  async updateProfile(merchantId: bigint, dto: UpdateMerchantProfileDto) {
    const currentProfile = await this.getProfile(merchantId);
    validateRequiredUpdateValues(dto);

    const { homepageCategoryKeys, ...profileDto } = dto;
    const nextHomepageCategoryKeys =
      homepageCategoryKeys === undefined
        ? undefined
        : mergeMerchantEditableHomepageCategoryKeys(
            currentProfile.homepageCategoryKeys,
            homepageCategoryKeys,
          );
    const data = stripUndefined({
      ...profileDto,
      homepageCategoryKeys:
        nextHomepageCategoryKeys === undefined
          ? undefined
          : stringifyHomepageCategoryKeys(nextHomepageCategoryKeys),
      minimumDeliveryAmountVnd:
        dto.minimumDeliveryAmountVnd === undefined
          ? undefined
          : BigInt(dto.minimumDeliveryAmountVnd),
      deliveryFeeVnd:
        dto.deliveryFeeVnd === undefined ? undefined : BigInt(dto.deliveryFeeVnd),
      businessHours:
        dto.businessHours === undefined
          ? undefined
          : (dto.businessHours as Prisma.InputJsonValue),
    }) as Prisma.MerchantUpdateInput;

    return this.prisma.merchant.update({
      where: { id: merchantId },
      data,
    }).then((merchant) => this.serializeMerchantProfile(merchant));
  }

  private serializeMerchantProfile(merchant: any) {
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    return {
      ...merchant,
      latitude: merchant.latitude.toString(),
      longitude: merchant.longitude.toString(),
      minimumDeliveryAmountVnd: merchant.minimumDeliveryAmountVnd.toString(),
      deliveryFeeVnd: merchant.deliveryFeeVnd.toString(),
      deliveryRadiusKm: merchant.deliveryRadiusKm.toString(),
      isVisibleOnClient: merchant.isVisibleOnClient,
      merchantMode: merchant.merchantMode,
      reportFeatureEnabled: Boolean(merchant.reportFeatureEnabled),
      capabilities: serializeCapabilities(merchant),
      homepageCategoryKeys: parseHomepageCategoryKeys(
        merchant.homepageCategoryKeys,
      ),
      manualPopular: Boolean(merchant.manualPopular),
    };
  }
}

function serializeCapabilities(merchant: {
  dineInEnabled?: boolean;
  pickupEnabled?: boolean;
  deliveryEnabled?: boolean;
  reportFeatureEnabled?: boolean;
  capabilities?: Array<{
    isEnabled: boolean;
    capability: {
      code: string;
      nameZh: string;
      groupCode: string;
    };
  }>;
}) {
  const explicit = (merchant.capabilities ?? []).map((item) => ({
    code: item.capability.code,
    nameZh: item.capability.nameZh,
    groupCode: item.capability.groupCode,
    isEnabled: item.isEnabled,
  }));
  if (explicit.length) return explicit;
  const dineInEnabled = Boolean(merchant.dineInEnabled);
  const pickupEnabled = Boolean(merchant.pickupEnabled);
  const deliveryEnabled = Boolean(merchant.deliveryEnabled);
  const hasOrder = dineInEnabled || pickupEnabled || deliveryEnabled;
  return [
    { code: 'phoneEnabled', nameZh: '电话', groupCode: 'DISPLAY', isEnabled: true },
    { code: 'navigationEnabled', nameZh: '导航', groupCode: 'DISPLAY', isEnabled: true },
    { code: 'imageGalleryEnabled', nameZh: '图片/相册展示', groupCode: 'DISPLAY', isEnabled: true },
    { code: 'productDisplayEnabled', nameZh: '商品展示', groupCode: 'PRODUCT', isEnabled: hasOrder },
    { code: 'onlineOrderEnabled', nameZh: '在线下单', groupCode: 'ORDER', isEnabled: pickupEnabled || deliveryEnabled },
    { code: 'pickupEnabled', nameZh: '到店自取', groupCode: 'ORDER', isEnabled: pickupEnabled },
    { code: 'deliveryEnabled', nameZh: '商家配送', groupCode: 'ORDER', isEnabled: deliveryEnabled },
    { code: 'qrOrderEnabled', nameZh: '扫码点餐', groupCode: 'RESTAURANT', isEnabled: dineInEnabled },
    { code: 'tableManagementEnabled', nameZh: '桌台管理', groupCode: 'RESTAURANT', isEnabled: dineInEnabled },
    { code: 'printerEnabled', nameZh: '打印机', groupCode: 'RESTAURANT', isEnabled: hasOrder },
    { code: 'zaloReportEnabled', nameZh: 'Zalo 日报', groupCode: 'OPERATION', isEnabled: Boolean(merchant.reportFeatureEnabled) },
    { code: 'chatEnabled', nameZh: '订单聊天', groupCode: 'ORDER', isEnabled: hasOrder },
    { code: 'voiceNotifyEnabled', nameZh: '语音播报', groupCode: 'RESTAURANT', isEnabled: hasOrder },
  ];
}

function validateRequiredUpdateValues(dto: UpdateMerchantProfileDto) {
  if (
    dto.businessHours !== undefined &&
    (dto.businessHours === null ||
      typeof dto.businessHours !== 'object' ||
      Array.isArray(dto.businessHours))
  ) {
    throw new BadRequestException(
      'businessHours must be an object and cannot be null or an array',
    );
  }

  assertNumber(dto.minimumDeliveryAmountVnd, 'minimumDeliveryAmountVnd');
  assertNumber(dto.deliveryFeeVnd, 'deliveryFeeVnd');
  assertNumber(dto.deliveryRadiusKm, 'deliveryRadiusKm');
}

function mergeMerchantEditableHomepageCategoryKeys(
  existingKeys: string[],
  requestedKeys: string[],
) {
  const preservedPlatformKeys = parseHomepageCategoryKeys(existingKeys).filter(
    (key) => key === 'popular_food',
  );
  const editableKeys = parseHomepageCategoryKeys(requestedKeys).filter(
    (key) => key !== 'popular_food',
  );
  return Array.from(new Set([...preservedPlatformKeys, ...editableKeys]));
}

function assertNumber(value: number | undefined, field: string) {
  if (
    value !== undefined &&
    (value === null || typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new BadRequestException(
      `${field} must be a number and cannot be null or empty`,
    );
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}
